// Real HTTP/WS servers verify launcher proxy boundaries against an observable fixture upstream.
import { createServer, request as httpRequest } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';

import { createLauncher } from '../../packages/launcher/src/serve.mjs';

let upstream;
let upstreamUrl;
let launcher;
let launcherUrl;
let publicDir;
let lastWsHeaders = null;
let lastWsCloseCode = null;
const upstreamWsConnections = [];
const upstreamRequests = [];
const upstreamWsPaths = [];
const blockedDebugPaths = [
  '/api/v1/debug', '/api/v1/debug/rpc?arg=1', '/api/v1/%64ebug', '/api/v1/deb%75g/rpc',
  '/api/v1/%2564ebug', '/api/v1/%25%36%34ebug', '/api/v1/debug%2Frpc', '/api/v1%2fdebug',
  '/api/v1%5cdebug', '/api/v1/debug\\rpc', '/api//v1/./debug', '/api/v1/fs/%2e%2e/%64ebug',
  '/api/v1/%64ebug/%GG', '/api/v1/debug/../meta', '/%61pi/v1/debug', '/api/v1/debug/',
  '/api/v1/debug#probe', '/api/v1/%64ebug#probe?arg=1'];
const remoteControlPaths = [
  '/api/v1/remote-control', '/api/v1/%72emote-control', '/api/v1/%2572emote-control/start',
  '/api/v1/remote%2Dcontrol', '/api/v1%2fremote-control', '/api/v1%5cremote-control',
  '/api/v1/remote-control#probe', '/api/v1/%72emote-control#probe?arg=1'];
const allowedApiPaths = [
  '/api/v1/meta?path=/api/v1/debug&encoded=%2564ebug&literal=%&plus=a+b',
  '/api/v1/fs/debug:download', '/api/v1/fs/debug/file.txt:download', '/api/v1/debugger',
  '/api/v1/fs/report%25.txt:download', '/api/v1/fs/100%.txt:download',
  '/api/v1/fs/%E4%B8%AD%E6%96%87-debug.txt:download', '/api/v1/fs/a%2Fdebug.txt:download',
  '/api/v1/fs/invalid%FF.txt:download', '/api/v1/%', '/api/v1/%6', '/api/v1/%GG',
  '/api/v1/remote-control%23probe', '/api/v1/fs/report%23name:download'];
const pathProbeHeaders = { 'x-path-policy-probe': 'yes', authorization: 'Bearer it-token' };

function testLauncher(options = {}) {
  return createLauncher({ target: upstreamUrl, publicDir, host: '127.0.0.1', port: 0, ...options });
}

function opened(ws) {
  return new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

function closeWs(ws) {
  ws.close(1000, 'done');
  return new Promise((resolve) => ws.once('close', resolve));
}

function startFakeUpstream() {
  return new Promise((resolveListen) => {
    const server = createServer((req, res) => {
      upstreamRequests.push({ method: req.method, url: req.url });
      if (req.headers['x-path-policy-probe'] === 'yes') {
        res.writeHead(209, { 'x-upstream': 'path-policy-probe' }).end(req.url);
        return;
      }
      if (req.url === '/api/v1/echo' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          res.writeHead(207, {
            'content-type': 'application/json',
            'x-upstream': 'yes',
            connection: 'keep-alive',
          });
          res.end(JSON.stringify({
            body,
            authorization: req.headers.authorization ?? null,
            host: req.headers.host ?? null,
            origin: req.headers.origin ?? null,
            xhop: req.headers['x-hop'] ?? null,
          }));
        });
        return;
      }
      res.writeHead(404).end();
    });
    const wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
      upstreamWsPaths.push(req.url);
      lastWsHeaders = { ...req.headers };
      if (req.url === '/api/v1/ws?reject=401') {
        socket.end(
          'HTTP/1.1 401 Unauthorized\r\nContent-Length: 6\r\n' +
          'X-Upstream-Secret: hidden\r\n\r\nsecret',
        );
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        let resolveClosed;
        const closed = new Promise((resolve) => (resolveClosed = resolve));
        upstreamWsConnections.push({ ws, closed });
        ws.send('hello-from-upstream');
        ws.on('message', (data, isBinary) => ws.send(`echo:${data}`, { binary: isBinary }));
        ws.on('close', (code) => {
          lastWsCloseCode = code;
          resolveClosed(code);
        });
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolveListen({ server, wss, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

beforeAll(async () => {
  publicDir = mkdtempSync(join(tmpdir(), 'launcher-it-public-'));
  mkdirSync(join(publicDir, 'assets'));
  writeFileSync(join(publicDir, 'index.html'), '<html>open-kimi-web fixture</html>');
  writeFileSync(join(publicDir, 'assets', 'app-HASH.js'), 'console.log(1)');

  upstream = await startFakeUpstream();
  upstreamUrl = upstream.url;
  launcher = await createLauncher({ target: upstreamUrl, publicDir, host: '127.0.0.1', port: 0 });
  launcherUrl = launcher.url;
});

afterAll(async () => {
  await launcher?.close();
  for (const client of upstream?.wss?.clients ?? []) client.terminate();
  await new Promise((r) => upstream?.server?.close(r));
  rmSync(publicDir, { recursive: true, force: true });
});

// Raw request helper: undici fetch normalizes paths and rejects hop-by-hop
// headers, so security-edge requests go through node:http directly.
function raw(url, { method = 'GET', path, headers = {}, body } = {}) {
  return new Promise((resolveReq, reject) => {
    const target = new URL(url);
    const req = httpRequest(
      {
        hostname: target.hostname, port: target.port, method, path: path ?? target.pathname, headers,
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolveReq({ status: res.statusCode, headers: res.headers, text }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function rawWsRequest(url, extraHeaders = [], path = '/api/v1/ws') {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const socket = connect(Number(target.port), target.hostname, () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: ${target.host}\r\n` +
        'Connection: Upgrade\r\nUpgrade: websocket\r\n' +
        `${extraHeaders.join('\r\n')}\r\n\r\n`,
      );
    });
    let response = '';
    socket.on('data', (data) => (response += data));
    socket.on('close', () => resolve(response));
    socket.on('error', reject);
  });
}

describe('launcher access URLs', () => {
  it('uses the actual port assigned by the server and keeps .url compatible', () => {
    const actualPort = launcher.server.address().port;
    expect(actualPort).toBeGreaterThan(0);
    expect(new URL(launcher.url).port).toBe(String(actualPort));
    expect(launcher.accessUrls).toEqual([{ type: 'local', url: launcher.url }]);
  });

  it('builds wildcard access URLs from injected interfaces and the actual port', async () => {
    const wildcard = await testLauncher({
      host: '0.0.0.0',
      interfaces: {
        Ethernet: [
          { address: '192.168.1.20', family: 'IPv4', internal: false },
          { address: '192.168.1.9', family: 4, internal: false },
          { address: '127.0.0.2', family: 'IPv4', internal: false },
          { address: '10.0.0.8', family: 'IPv4', internal: true },
        ],
        WiFi: [
          { address: '192.168.1.20', family: 'IPv4', internal: false },
          { address: 'FE80::1', family: 'IPv6', internal: false },
          { address: '2001:DB8::20', family: 6, internal: false },
          { address: '::1', family: 'IPv6', internal: false },
          { address: 'not-an-address', family: 'unknown', internal: false },
        ],
        Empty: undefined,
      },
    });
    try {
      const actualPort = wildcard.server.address().port;
      expect(wildcard.url).toBe(`http://127.0.0.1:${actualPort}`);
      expect(wildcard.accessUrls).toEqual([
        { type: 'local', url: `http://127.0.0.1:${actualPort}` },
        { type: 'network', url: `http://192.168.1.9:${actualPort}` },
        { type: 'network', url: `http://192.168.1.20:${actualPort}` },
        { type: 'network', url: `http://[2001:db8::20]:${actualPort}` },
      ]);
    } finally {
      await wildcard.close();
    }
  });
});

describe('static files', () => {
  it('serves index.html at / with no-cache', async () => {
    const res = await fetch(`${launcherUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toContain('open-kimi-web fixture');
  });

  it('serves hashed assets with immutable caching', async () => {
    const res = await fetch(`${launcherUrl}/assets/app-HASH.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('falls back for SPA routes but not missing assets', async () => {
    const res = await fetch(`${launcherUrl}/session/abc`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('open-kimi-web fixture');
    expect((await fetch(`${launcherUrl}/assets/missing.js`)).status).toBe(404);
  });

  it('serves HEAD requests with headers and no body', async () => {
    const res = await fetch(`${launcherUrl}/`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toBe('');
  });

  it('rejects non-GET methods on static paths', async () => {
    const res = await fetch(`${launcherUrl}/`, { method: 'PUT' });
    expect(res.status).toBe(405);
  });

  it('refuses path traversal', async () => {
    const res = await raw(launcherUrl, { path: '/%2e%2e/%2e%2e/etc/passwd' });
    expect([400, 404]).toContain(res.status);
  });
});

describe('REST proxy', () => {
  it('forwards method, body, and Authorization; returns upstream status/headers', async () => {
    const res = await fetch(`${launcherUrl}/api/v1/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer it-token' },
      body: JSON.stringify({ hello: 'world' }),
    });
    expect(res.status).toBe(207);
    expect(res.headers.get('x-upstream')).toBe('yes');
    const echoed = await res.json();
    expect(echoed.body).toBe('{"hello":"world"}');
    expect(echoed.authorization).toBe('Bearer it-token');
    expect(echoed.origin).toBeNull();
  });

  it('rewrites Host and an existing Origin to the target origin', async () => {
    const res = await raw(`${launcherUrl}/api/v1/echo`, {
      method: 'POST',
      headers: { host: '192.168.1.20:4173', origin: 'http://192.168.1.20:4173' },
      body: 'x',
    });
    const echoed = JSON.parse(res.text);
    const target = new URL(upstreamUrl);
    expect(echoed.host).toBe(target.host);
    expect(echoed.origin).toBe(target.origin);
  });

  it('does not leak hop-by-hop headers named by connection tokens', async () => {
    const res = await raw(`${launcherUrl}/api/v1/echo`, {
      method: 'POST',
      headers: { connection: 'x-hop', 'x-hop': 'secret', 'content-type': 'text/plain' },
      body: 'x',
    });
    expect(res.status).toBe(207);
    const echoed = JSON.parse(res.text);
    expect(echoed.xhop).toBeNull();
  });

  it('does not proxy paths outside /api and exact /api/*', async () => {
    expect((await fetch(`${launcherUrl}/apix/v1/echo`)).status).toBe(200);
    expect((await fetch(`${launcherUrl}/apiish/v1/echo`)).status).toBe(200);
  });

  it('routes /api with a query string to the upstream', async () => {
    const res = await fetch(`${launcherUrl}/api?probe=1`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('');
  });

  it('returns 502 when the upstream is down', async () => {
    const dead = await testLauncher({ target: 'http://127.0.0.1:1' });
    try {
      const res = await fetch(`${dead.url}/api/v1/echo`, { method: 'POST', body: 'x' });
      expect(res.status).toBe(502);
    } finally {
      await dead.close();
    }
  });
});

describe.each([
  [false, false], [true, false], [true, true],
])('API isolation (officialPresentation=%s, scheduledTasks=%s)', (officialPresentation, scheduledTasks) => {
  let isolated;
  beforeAll(async () => { isolated = await testLauncher({ officialPresentation, scheduledTasks }); });
  afterAll(async () => { await isolated?.close(); });

  it.each([...blockedDebugPaths, ...remoteControlPaths])(
    'applies the raw namespace policy before upstream: %s', async (path) => {
      for (const method of ['GET', 'POST', 'HEAD']) {
        expect((await raw(upstreamUrl, { path, method, headers: pathProbeHeaders })).status).toBe(209);
        const count = upstreamRequests.length;
        const blocked = scheduledTasks || blockedDebugPaths.includes(path);
        const response = await raw(isolated.url, { path, method, headers: pathProbeHeaders });
        expect(response.status).toBe(blocked ? 404 : 209);
        expect(response.headers['x-upstream']).toBe(blocked ? undefined : 'path-policy-probe');
        expect(response.text).toBe(method === 'HEAD' ? '' : blocked ? 'Not Found' : path);
        expect(upstreamRequests).toHaveLength(count + Number(!blocked));
      }
    },
  );

  it.each(allowedApiPaths)('preserves the original non-debug URL: %s', async (path) => {
    const response = await raw(isolated.url, { path, headers: pathProbeHeaders });
    expect(response.status).toBe(209);
    expect(response.headers['x-upstream']).toBe('path-policy-probe');
    expect(response.text).toBe(path);
    expect(upstreamRequests.at(-1)).toEqual({ method: 'GET', url: path });
  });

  it.each([...blockedDebugPaths, '/api/v1/%77s', '/api/v1/ws/', '/api/v1/ws/../debug', '/api/v1/other'])(
    'refuses raw non-allowlisted WS upgrades without reaching upstream: %s', async (path) => {
      const count = upstreamWsPaths.length;
      const response = await rawWsRequest(isolated.url, [
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version: 13',
      ], path);
      expect(response).toBe('');
      expect(upstreamWsPaths).toHaveLength(count);
    },
  );

  it('keeps the exact WS path and query working with a 101 handshake', async () => {
    const path = '/api/v1/ws?client_id=debug&path=%2Fapi%2Fv1%2Fdebug';
    const ws = new WebSocket(`${isolated.url.replace('http', 'ws')}${path}`);
    let status;
    ws.once('upgrade', (res) => { status = res.statusCode; });
    await opened(ws);
    expect(status).toBe(101);
    expect(upstreamWsPaths.at(-1)).toBe(path);
    await closeWs(ws);
  });
});

describe('WebSocket proxy', () => {
  it('preserves the bearer subprotocol, rewrites headers, and relays frames', async () => {
    lastWsHeaders = null;
    const ws = new WebSocket(
      `${launcherUrl.replace('http', 'ws')}/api/v1/ws`,
      'kimi-code.bearer.it-token',
      { origin: 'http://192.168.1.20:4173' },
    );
    const messages = [];
    ws.on('message', (data) => messages.push(String(data)));
    await opened(ws);
    expect(ws.protocol).toBe('kimi-code.bearer.it-token');
    expect(lastWsHeaders['sec-websocket-protocol']).toBe('kimi-code.bearer.it-token');
    expect(lastWsHeaders.host).toBe(new URL(upstreamUrl).host);
    expect(lastWsHeaders.origin).toBe(new URL(upstreamUrl).origin);

    ws.send('ping');
    await new Promise((r) => setTimeout(r, 300));
    expect(messages).toContain('hello-from-upstream');
    expect(messages).toContain('echo:ping');

    await closeWs(ws);
  });

  it('does not add Origin to WS when the client omitted it', async () => {
    lastWsHeaders = null;
    const ws = new WebSocket(`${launcherUrl.replace('http', 'ws')}/api/v1/ws`);
    await opened(ws);
    expect(lastWsHeaders.origin).toBeUndefined();
    await closeWs(ws);
  });

  it('terminates the upstream after an abnormal client drop', async () => {
    await expect.poll(() => upstream.wss.clients.size).toBe(0);
    lastWsCloseCode = null;
    const ws = new WebSocket(`${launcherUrl.replace('http', 'ws')}/api/v1/ws`);
    await opened(ws);
    // TCP drop without a close frame: terminate the matching upstream rather
    // than waiting for a close handshake that can keep shutdown alive.
    ws.terminate();
    const deadline = Date.now() + 5_000;
    while (lastWsCloseCode === null) {
      if (Date.now() > deadline) throw new Error('timed out waiting for upstream close');
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(lastWsCloseCode).toBe(1006);
  });

  it('drops the client when the upstream WS is unreachable', async () => {
    const dead = await testLauncher({ target: 'http://127.0.0.1:1' });
    try {
      const ws = new WebSocket(`${dead.url.replace('http', 'ws')}/api/v1/ws`);
      await expect(opened(ws)).rejects.toThrow();
    } finally {
      await dead.close();
    }
  });
});

describe('WebSocket upgrade routing', () => {
  it('closes the upstream when the downstream handshake is malformed', async () => {
    const connectionIndex = upstreamWsConnections.length;
    const response = await rawWsRequest(launcherUrl, ['Sec-WebSocket-Version: 13']);
    expect(response).toContain('400 Bad Request');
    expect(upstreamWsConnections).toHaveLength(connectionIndex + 1);
    const malformedConnection = upstreamWsConnections[connectionIndex];
    await expect(malformedConnection.closed).resolves.toBe(1006);
    expect(upstream.wss.clients.has(malformedConnection.ws)).toBe(false);
  });

  it('rejects duplicate subprotocols without crashing the launcher', async () => {
    const response = await rawWsRequest(launcherUrl, [
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Protocol: duplicate, duplicate',
    ]);
    expect(response).toContain('400 Bad Request');
    expect((await fetch(`${launcherUrl}/`)).status).toBe(200);
  });

  it('returns only a safe upstream handshake status to the client', async () => {
    const ws = new WebSocket(`${launcherUrl.replace('http', 'ws')}/api/v1/ws?reject=401`);
    const response = await new Promise((resolve, reject) => {
      ws.on('unexpected-response', (_request, res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
      ws.on('error', reject);
    });
    expect(response.status).toBe(401);
    expect(response.headers['x-upstream-secret']).toBeUndefined();
    expect(response.body).toBe('');
  });
});

describe('shutdown', () => {
  it('close() stops accepting connections', async () => {
    const temp = await testLauncher();
    const res = await fetch(`${temp.url}/`);
    expect(res.status).toBe(200);
    await temp.close();
    await expect(fetch(`${temp.url}/`)).rejects.toThrow();
  });

  it('forces active HTTP connections closed after the grace period', async () => {
    let requestStarted;
    let upstreamClosed;
    const started = new Promise((resolve) => (requestStarted = resolve));
    const stopped = new Promise((resolve) => (upstreamClosed = resolve));
    const stalled = createServer((req) => {
      req.socket.once('close', upstreamClosed);
      requestStarted();
    });
    await new Promise((resolve) => stalled.listen(0, '127.0.0.1', resolve));
    const target = `http://127.0.0.1:${stalled.address().port}`;
    const temp = await testLauncher({ target, closeGraceMs: 25 });
    const response = fetch(`${temp.url}/api/v1/hang`).catch(() => null);
    await started;
    const closed = temp.close();
    await expect(Promise.race([
      closed.then(() => 'closed'),
      new Promise((resolve) => setTimeout(() => resolve('timed out'), 500)),
    ])).resolves.toBe('closed');
    await response;
    await expect(Promise.race([
      stopped.then(() => 'closed'),
      new Promise((resolve) => setTimeout(() => resolve('timed out'), 500)),
    ])).resolves.toBe('closed');
    stalled.closeAllConnections();
    await new Promise((resolve) => stalled.close(resolve));
  });
});
