import { once } from 'node:events';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { createWsTrace } from '../src/wsDiagnostics.mjs';
import { createWsProxy } from '../src/wsProxy.mjs';

const resources = [];
const sockets = new Set();
const clients = new Set();
const identity = { id: 1, clientTag: '0123456789abcdef', route: 'ws', method: 'GET' };

async function listen(server) {
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  resources.push(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function proxy(target, enabled = true) {
  const events = [];
  const onEnd = vi.fn();
  const log = { emit: (event, fields) => events.push({ event, ...fields }) };
  const diagnostics = enabled ? { ws: () => createWsTrace(log, identity, onEnd) } : undefined;
  const result = createWsProxy(diagnostics);
  const server = createServer();
  server.on('upgrade', (req, socket, head) => result.handleUpgrade(req, socket, head, target));
  const url = await listen(server);
  resources.push(() => {
    result.closeConnections();
    result.wss.close();
  });
  return { ...result, url: url.replace('http:', 'ws:') + '/api/v1/ws?secret-query', events, onEnd };
}

async function upstream(onConnection) {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', onConnection);
  resources.push(() => {
    for (const client of wss.clients) client.terminate();
    wss.close();
  });
  return listen(server);
}

function clientAt(url, protocols) {
  const client = new WebSocket(url, protocols);
  clients.add(client);
  client.on('error', () => {});
  return client;
}

afterEach(async () => {
  for (const client of clients) client.terminate();
  clients.clear();
  const cleanup = resources.splice(0).reverse().map((close) => close());
  for (const socket of sockets) socket.destroy();
  await Promise.all(cleanup);
});

async function relayScenario(enabled) {
  const seen = [];
  const target = await upstream((client) => {
    client.send('server-private-frame');
    client.on('message', (data, binary) => {
      seen.push({ data: data.toString('hex'), binary });
      client.send(data, { binary });
    });
  });
  const fixture = await proxy(target, enabled);
  const client = clientAt(fixture.url, ['private-protocol']);
  const received = [];
  client.on('message', (data, binary) => received.push({ data: data.toString('hex'), binary }));
  await once(client, 'open');
  client.send('é-private-client');
  client.send(Buffer.from([1, 2, 3]));
  await vi.waitFor(() => expect(received).toHaveLength(3));
  const close = once(client, 'close');
  client.close(4001, 'private-close-reason');
  const [code, reason] = await close;
  await vi.waitFor(() => expect(fixture.wss.clients.size).toBe(0));
  if (enabled) await vi.waitFor(() => expect(fixture.onEnd).toHaveBeenCalledTimes(1));
  return { ...fixture, result: { seen, received, code, reason: reason.toString(), protocol: client.protocol } };
}

describe('WebSocket proxy debug forwarding', () => {
  it('keeps real text/binary/subprotocol/close behavior identical with debug on and off', async () => {
    const off = await relayScenario(false);
    const on = await relayScenario(true);
    expect(on.result).toEqual(off.result);
    expect(off.events).toEqual([]);
    expect(on.events.map(({ event }) => event)).toEqual(['ws_begin', 'ws_ready', 'ws_first_frame', 'ws_end']);
    const clientBytes = Buffer.byteLength('é-private-client') + 3;
    expect(on.events.at(-1)).toMatchObject({
      outcome: 'closed', closeCode: 4001, toUpstreamMessages: 2, toUpstreamBytes: clientBytes,
      toClientMessages: 3, toClientBytes: Buffer.byteLength('server-private-frame') + clientBytes,
    });
    expect(JSON.stringify(on.events)).not.toContain('private');
    expect(JSON.stringify(on.events)).not.toContain('secret-query');
  });

  it('ends an active trace as shutdown exactly once', async () => {
    const target = await upstream(() => {});
    const fixture = await proxy(target);
    const client = clientAt(fixture.url);
    await once(client, 'open');
    const closed = once(client, 'close');
    fixture.closeConnections();
    await closed;
    fixture.closeConnections();
    expect(fixture.events.at(-1)).toMatchObject({ event: 'ws_end', outcome: 'shutdown' });
    expect(fixture.onEnd).toHaveBeenCalledTimes(1);
  });
});

describe('WebSocket proxy debug pending paths', () => {
  it('sanitizes synchronous invalid-subprotocol failures', async () => {
    const fixture = await proxy('http://127.0.0.1:1');
    const socket = { end: vi.fn() };
    fixture.handleUpgrade({
      url: '/api/v1/ws', headers: { 'sec-websocket-protocol': 'private-token,private-token' },
    }, socket, Buffer.alloc(0), 'http://127.0.0.1:1');
    expect(socket.end).toHaveBeenCalledWith(expect.stringContaining('HTTP/1.1 400'));
    expect(fixture.events[1]).toMatchObject({ event: 'ws_error', errorCode: 'other' });
    expect(fixture.events.at(-1)).toMatchObject({ event: 'ws_end', outcome: 'error', status: 400 });
    expect(fixture.onEnd).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fixture.events)).not.toContain('private');
  });

  it('records upstream handshake rejection without response body or request secrets', async () => {
    const target = await listen(createServer((_req, res) => res.writeHead(403).end('private-response')));
    const fixture = await proxy(target);
    const client = clientAt(fixture.url);
    const responseStatus = new Promise((resolve) => client.once('unexpected-response', (_req, res) => {
      resolve(res.statusCode);
      res.resume();
      client.terminate();
    }));
    expect(await responseStatus).toBe(403);
    await vi.waitFor(() => expect(fixture.onEnd).toHaveBeenCalledTimes(1));
    expect(fixture.events.at(-1)).toMatchObject({ event: 'ws_end', outcome: 'rejected', status: 403 });
    expect(JSON.stringify(fixture.events)).not.toContain('private');
  });

  it('ends a failed upstream connection with a safe error code', async () => {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const target = `http://127.0.0.1:${server.address().port}`;
    await new Promise((resolve) => server.close(resolve));
    const fixture = await proxy(target);
    const client = clientAt(fixture.url);
    await new Promise((resolve) => client.once('close', resolve));
    expect(fixture.events[1]).toMatchObject({ event: 'ws_error', errorCode: 'ECONNREFUSED' });
    expect(fixture.events.at(-1)).toMatchObject({ event: 'ws_end', outcome: 'error' });
    expect(fixture.onEnd).toHaveBeenCalledTimes(1);
  });

  it('handles malformed target URLs before any upstream attempt', async () => {
    const fixture = await proxy('private-invalid-url');
    const client = clientAt(fixture.url);
    let status;
    client.once('unexpected-response', (_req, res) => {
      status = res.statusCode;
      res.resume();
      client.terminate();
    });
    await new Promise((resolve) => client.once('close', resolve));
    expect(status).toBe(400);
    expect(fixture.events[1]).toMatchObject({ event: 'ws_error', errorCode: 'other' });
    expect(fixture.events.at(-1)).toMatchObject({ event: 'ws_end', outcome: 'error', status: 400 });
    expect(fixture.onEnd).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fixture.events)).not.toContain('private');
  });
});

describe('WebSocket proxy debug pending cleanup', () => {
  it.each(['aborted', 'shutdown'])('cleans up %s pending handshakes', async (outcome) => {
    let upgraded;
    const received = new Promise((resolve) => { upgraded = resolve; });
    const server = createServer();
    server.on('upgrade', upgraded);
    const fixture = await proxy(await listen(server));
    const client = clientAt(fixture.url);
    await received;
    const closed = new Promise((resolve) => client.once('close', resolve));
    if (outcome === 'shutdown') fixture.closeConnections();
    else client.terminate();
    await closed;
    await vi.waitFor(() => expect(fixture.onEnd).toHaveBeenCalledTimes(1));
    fixture.closeConnections();
    expect(fixture.events.at(-1)).toMatchObject({ event: 'ws_end', outcome });
    expect(fixture.onEnd).toHaveBeenCalledTimes(1);
  });

  it('ends a client handshake rejected after upstream open without keeping a trace', async () => {
    const target = await upstream(() => {});
    const fixture = await proxy(target);
    const socket = connect(new URL(fixture.url).port, '127.0.0.1');
    socket.on('error', () => {});
    await once(socket, 'connect');
    socket.write('GET /api/v1/ws HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    socket.resume();
    await once(socket, 'close');
    await vi.waitFor(() => expect(fixture.onEnd).toHaveBeenCalledTimes(1));
    expect(fixture.events.at(-1)).toMatchObject({ event: 'ws_end', outcome: 'aborted' });
    fixture.closeConnections();
    expect(fixture.onEnd).toHaveBeenCalledTimes(1);
  });
});
