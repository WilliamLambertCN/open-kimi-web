import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { ensureManagedTls } from '../../packages/launcher/src/tlsStore.mjs';
import {
  cleanup, event, fixture, markers, own, page, payload, raw, records, requestEvents, socketRequest, transcript,
} from './launcher-debug-helper.mjs';

afterEach(cleanup);

async function openWs(context) {
  const protocol = `kimi-code.bearer.${markers.token}`;
  const ws = new WebSocket(`${context.launcher.url.replace('http', 'ws')}/api/v1/ws?client_id=${markers.session}`, protocol,
    { headers: { cookie: `test=${markers.cookie}` } });
  own(() => ws.terminate());
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  expect(ws.protocol).toBe(protocol);
  return ws;
}

function echo(ws, content) {
  return new Promise((resolve, reject) => {
    ws.once('error', reject);
    ws.once('message', (data, binary) => resolve({ data, binary }));
    ws.send(content);
  });
}

async function closeWs(ws) {
  const closed = new Promise((resolve) => ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));
  ws.close(1000, markers.reason);
  expect(await closed).toEqual({ code: 1000, reason: markers.reason });
}

async function exchange(context) {
  const ws = await openWs(context);
  const text = await echo(ws, markers.body);
  expect(text).toEqual({ data: Buffer.from(markers.body), binary: false });
  const binary = await echo(ws, Buffer.from([0, 1, 255, 37]));
  expect(binary).toEqual({ data: Buffer.from([0, 1, 255, 37]), binary: true });
  await closeWs(ws);
  expect(context.receivedWs[0].headers['sec-websocket-protocol']).toBe(`kimi-code.bearer.${markers.token}`);
  expect(context.receivedWs[0].headers.cookie).toBe(`test=${markers.cookie}`);
}

function assertWsCounts(events) {
  const end = event(events, 'ws_end');
  const bytes = Buffer.byteLength(markers.body) + 4;
  expect(end).toMatchObject({ outcome: 'closed', closeCode: 1000,
    toClientMessages: 2, toClientBytes: bytes, toClientMaxBytes: Buffer.byteLength(markers.body),
    toUpstreamMessages: 2, toUpstreamBytes: bytes, toUpstreamMaxBytes: Buffer.byteLength(markers.body) });
  expect(end.clientBufferedBytes).toBeGreaterThanOrEqual(0);
  expect(end.upstreamBufferedBytes).toBeGreaterThanOrEqual(0);
  expect(end.firstFrameMs).toBeGreaterThanOrEqual(0);
  expect(end.elapsedMs).toBeGreaterThanOrEqual(end.firstFrameMs);
  expect(event(events, 'ws_first_frame').firstFrameMs).toBe(end.firstFrameMs);
  expect(events.map((row) => row.event)).toEqual(['ws_begin', 'ws_ready', 'ws_first_frame', 'ws_end']);
}

describe('real debug-log WebSocket protocol and privacy', () => {
  it('preserves authenticated text/binary messages and close reason with debug both on and omitted', async () => {
    const enabled = await fixture();
    const disabled = await fixture({ debug: false });
    await exchange(enabled);
    await exchange(disabled);
    await expect.poll(() => enabled.wss.clients.size).toBe(0);
    await expect.poll(() => disabled.wss.clients.size).toBe(0);
    assertWsCounts(requestEvents(await records(enabled), 0, 'ws'));
    await disabled.launcher.close();
  });

  it('records one rejected handshake without upstream headers, body or raw error text', async () => {
    const context = await fixture({ upgrade: ({ socket }) => {
      socket.end('HTTP/1.1 401 Unauthorized\r\n' +
        `X-Secret: ${markers.token}\r\nContent-Length: ${markers.body.length}\r\n\r\n${markers.body}`);
    } });
    const ws = new WebSocket(`${context.launcher.url.replace('http', 'ws')}/api/v1/ws?secret=${markers.query}`,
      `kimi-code.bearer.${markers.token}`);
    own(() => ws.terminate());
    const response = await new Promise((resolve, reject) => {
      ws.once('error', reject);
      ws.once('unexpected-response', (_request, res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.once('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
    });
    expect(response.status).toBe(401);
    expect(response.headers['x-secret']).toBeUndefined();
    expect(response.body.length).toBe(0);
    const events = requestEvents(await records(context), 0, 'ws');
    expect(event(events, 'ws_end')).toMatchObject({ outcome: 'rejected', status: 401,
      toClientMessages: 0, toUpstreamMessages: 0 });
    expect(events.map((row) => row.event)).toEqual(['ws_begin', 'ws_end']);
  });

  it('keeps a post-handshake protocol error as an error outcome rather than normal closed', async () => {
    const context = await fixture({ upgrade: ({ req, socket, head, wss }) => {
      wss.handleUpgrade(req, socket, head, (peer) => {
        peer.once('message', () => socket.write(Buffer.from([0xc1, 0x00])));
      });
    } });
    const ws = await openWs(context);
    const closed = new Promise((resolve) => ws.once('close', resolve));
    ws.send(markers.body);
    expect(await closed).toBe(1011);
    const events = requestEvents(await records(context), 0, 'ws');
    expect(event(events, 'ws_error').errorCode).toBe('other');
    expect(event(events, 'ws_end').outcome).toBe('error');
    expect([1006, 1011]).toContain(event(events, 'ws_end').closeCode);
    expect(events.map((row) => row.event)).toEqual(['ws_begin', 'ws_ready', 'ws_error', 'ws_end']);
  });

  it('logs safe WS error codes for an upstream connection reset', async () => {
    const context = await fixture({ upgrade: ({ socket }) => {
      socket.once('error', () => {});
      socket.destroy(new Error(markers.reason));
    } });
    await expect(openWs(context)).rejects.toThrow();
    const events = requestEvents(await records(context), 0, 'ws');
    expect(event(events, 'ws_error').errorCode).toBe('ECONNRESET');
    expect(event(events, 'ws_end').outcome).toBe('error');
  });
});

function slowResponse(_req, res) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.write(payload);
  const timer = setTimeout(() => res.end(payload), 5300);
  res.once('close', () => clearTimeout(timer));
}

describe('real debug-log progress and transport failures', () => {
  it('emits low-frequency aggregate HTTP and WS progress without capturing contents', async () => {
    const context = await fixture({ handler: slowResponse });
    const responsePromise = raw(context.launcher.url, transcript + page);
    const ws = await openWs(context);
    await echo(ws, markers.body);
    await delay(5300);
    await closeWs(ws);
    const response = await responsePromise;
    expect(response.bytes).toEqual(Buffer.concat([payload, payload]));
    const rows = await records(context);
    const http = requestEvents(rows);
    const wsEvents = requestEvents(rows, 0, 'ws');
    const httpProgress = http.filter((row) => row.event === 'http_progress');
    const wsProgress = wsEvents.filter((row) => row.event === 'ws_progress');
    expect(httpProgress).toHaveLength(1);
    expect(wsProgress).toHaveLength(1);
    expect(httpProgress[0]).toMatchObject({ measured: true, rawBytes: payload.length, wireBytes: payload.length });
    expect(wsProgress[0]).toMatchObject({ toClientMessages: 1, toUpstreamMessages: 1 });
    expect(httpProgress[0].elapsedMs).toBeGreaterThanOrEqual(4500);
    expect(wsProgress[0].elapsedMs).toBeGreaterThanOrEqual(4500);
  }, 12000);

  it('records only a safe TLS code for plaintext-to-HTTPS and still serves a valid TLS request', async () => {
    const home = mkdtempSync(join(tmpdir(), 'launcher-debug-tls-it-'));
    own(() => rmSync(home, { recursive: true, force: true }));
    const tls = await ensureManagedTls({ home, interfaces: {}, hostname: 'localhost' });
    const context = await fixture({ launcherOptions: { tls } });
    const result = await socketRequest(context.launcher.url,
      `GET /${markers.workspace}?secret=${markers.query} HTTP/1.1\r\nHost: ${markers.ip}\r\n\r\n`);
    expect(result).toBe('');
    expect((await raw(context.launcher.url, transcript + page, { ca: tls.cert })).bytes).toEqual(payload);
    const rows = await records(context);
    const failures = rows.filter((row) => row.event === 'tls_error');
    expect(failures).toHaveLength(1);
    expect(['ERR_SSL_WRONG_VERSION_NUMBER', 'other']).toContain(failures[0].errorCode);
    expect(Object.keys(failures[0]).sort()).toEqual(['clientTag', 'errorCode', 'event', 'schema', 'time']);
    requestEvents(rows);
  });

  it.each([
    [400, `INVALID METHOD /?secret=${markers.query} HTTP/1.1\r\nHost: fixture\r\n\r\n`],
    [431, `GET / HTTP/1.1\r\nHost: fixture\r\nX-Large: ${'x'.repeat(20000)}${markers.token}\r\n\r\n`],
  ])('retains the default malformed HTTP %i response and cleans sockets', async (status, content) => {
    const context = await fixture();
    const response = await socketRequest(context.launcher.url, content);
    expect(response).toContain(`HTTP/1.1 ${status}`);
    expect((await raw(context.launcher.url, transcript + page)).status).toBe(200);
    const rows = await records(context);
    requestEvents(rows);
    expect(context.launcher.server.listenerCount('clientError')).toBe(0);
  });
});
