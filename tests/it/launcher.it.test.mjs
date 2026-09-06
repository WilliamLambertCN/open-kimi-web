// Integration tests for the launcher: real TCP servers on both ends.
// A fake upstream (node:http + ws) stands in for `kimi web`; the launcher
// under test serves a fixture public/ dir and proxies /api to the fake.
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

function startFakeUpstream() {
  return new Promise((resolveListen) => {
    const server = createServer((req, res) => {
      if (req.url === '/api/v1/echo' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          res.writeHead(207, {
            'content-type': 'application/json',
            'x-upstream': 'yes',
            connection: 'keep-alive',
          });
          res.end(
            JSON.stringify({
              body,
              authorization: req.headers.authorization ?? null,
              host: req.headers.host ?? null,
              origin: req.headers.origin ?? null,
              xhop: req.headers['x-hop'] ?? null,
            }),
          );
        });
        return;
      }
      if (req.url === '/api/v1/partial') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.write('partial');
        setImmediate(() => res.destroy(new Error('fixture stream failure')));
        return;
      }
      res.writeHead(404).end();
    });
    const wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
      lastWsHeaders = { ...req.headers };
      if (req.url === '/api/v1/ws?reject=401') {
        socket.end(
          'HTTP/1.1 401 Unauthorized\r\nContent-Length: 6\r\n' +
          'X-Upstream-Secret: hidden\r\n\r\nsecret',
        );
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.send('hello-from-upstream');
        ws.on('message', (data, isBinary) => ws.send(`echo:${data}`, { binary: isBinary }));
        ws.on('close', (code) => {
          lastWsCloseCode = code;
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
        hostname: target.hostname,
        port: target.port,
        method,
        path: path ?? target.pathname,
        headers,
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

function rawWsRequest(url, extraHeaders = []) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const socket = connect(Number(target.port), target.hostname, () => {
      socket.write(
        `GET /api/v1/ws HTTP/1.1\r\nHost: ${target.host}\r\n` +
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
    const wildcard = await createLauncher({
      target: upstreamUrl,
      publicDir,
      host: '0.0.0.0',
      port: 0,
      interfaces: {
        Ethernet: [{ address: '192.168.1.20', family: 'IPv4', internal: false }],
      },
    });
    try {
      const actualPort = wildcard.server.address().port;
      expect(wildcard.url).toBe(`http://127.0.0.1:${actualPort}`);
      expect(wildcard.accessUrls).toEqual([
        { type: 'local', url: `http://127.0.0.1:${actualPort}` },
        { type: 'network', url: `http://192.168.1.20:${actualPort}` },
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

  it('falls back to index.html for unknown SPA routes', async () => {
    const res = await fetch(`${launcherUrl}/session/abc`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('open-kimi-web fixture');
  });

  it('404s missing hashed assets instead of falling back', async () => {
    const res = await fetch(`${launcherUrl}/assets/missing.js`);
    expect(res.status).toBe(404);
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

  it('does not add Origin when the client omitted it', async () => {
    const res = await raw(`${launcherUrl}/api/v1/echo`, { method: 'POST', body: 'x' });
    const echoed = JSON.parse(res.text);
    expect(echoed.origin).toBeNull();
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
    const dead = await createLauncher({
      target: 'http://127.0.0.1:1',
      publicDir,
      host: '127.0.0.1',
      port: 0,
    });
    try {
      const res = await fetch(`${dead.url}/api/v1/echo`, { method: 'POST', body: 'x' });
      expect(res.status).toBe(502);
    } finally {
      await dead.close();
    }
  });

  it('destroys a partial downstream response when the upstream stream fails', async () => {
    const response = await fetch(`${launcherUrl}/api/v1/partial`);
    await expect(response.text()).rejects.toThrow();
    expect((await fetch(`${launcherUrl}/`)).status).toBe(200);
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
    await new Promise((resolveOpen, reject) => {
      ws.on('open', resolveOpen);
      ws.on('error', reject);
    });
    expect(ws.protocol).toBe('kimi-code.bearer.it-token');
    expect(lastWsHeaders['sec-websocket-protocol']).toBe('kimi-code.bearer.it-token');
    expect(lastWsHeaders.host).toBe(new URL(upstreamUrl).host);
    expect(lastWsHeaders.origin).toBe(new URL(upstreamUrl).origin);

    ws.send('ping');
    await new Promise((r) => setTimeout(r, 300));
    expect(messages).toContain('hello-from-upstream');
    expect(messages).toContain('echo:ping');

    ws.close(1000, 'done');
    await new Promise((r) => ws.on('close', r));
  });

  it('does not add Origin to WS when the client omitted it', async () => {
    lastWsHeaders = null;
    const ws = new WebSocket(`${launcherUrl.replace('http', 'ws')}/api/v1/ws`);
    await new Promise((resolveOpen, reject) => {
      ws.on('open', resolveOpen);
      ws.on('error', reject);
    });
    expect(lastWsHeaders.origin).toBeUndefined();
    ws.close(1000, 'done');
    await new Promise((r) => ws.on('close', r));
  });

  it('terminates the upstream after an abnormal client drop', async () => {
    await expect.poll(() => upstream.wss.clients.size).toBe(0);
    lastWsCloseCode = null;
    const ws = new WebSocket(`${launcherUrl.replace('http', 'ws')}/api/v1/ws`);
    await new Promise((resolveOpen, reject) => {
      ws.on('open', resolveOpen);
      ws.on('error', reject);
    });
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
    const dead = await createLauncher({
      target: 'http://127.0.0.1:1',
      publicDir,
      host: '127.0.0.1',
      port: 0,
    });
    try {
      const ws = new WebSocket(`${dead.url.replace('http', 'ws')}/api/v1/ws`);
      const outcome = await new Promise((resolveEvent) => {
        ws.on('open', () => resolveEvent('open'));
        ws.on('error', () => resolveEvent('error'));
        ws.on('close', () => resolveEvent('close'));
      });
      expect(outcome).not.toBe('open');
    } finally {
      await dead.close();
    }
  });

  it('refuses upgrades outside /api/v1/ws', async () => {
    const ws = new WebSocket(`${launcherUrl.replace('http', 'ws')}/api/v1/other`);
    const outcome = await new Promise((resolveEvent) => {
      ws.on('open', () => resolveEvent('open'));
      ws.on('error', () => resolveEvent('error'));
    });
    expect(outcome).toBe('error');
  });
});

describe('WebSocket upgrade routing', () => {
  it('accepts the WS upgrade with a query string (official web appends ?client_id=)', async () => {
    const ws = new WebSocket(
      `${launcherUrl.replace('http', 'ws')}/api/v1/ws?client_id=it-probe`,
      'kimi-code.bearer.it-token',
    );
    const messages = [];
    ws.on('message', (data) => messages.push(String(data)));
    await new Promise((resolveOpen, reject) => {
      ws.on('open', resolveOpen);
      ws.on('error', reject);
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(messages).toContain('hello-from-upstream');
    ws.close(1000, 'done');
    await new Promise((r) => ws.on('close', r));
  });

  it('closes the upstream when the downstream handshake is malformed', async () => {
    const clientsBefore = upstream.wss.clients.size;
    const response = await rawWsRequest(launcherUrl, ['Sec-WebSocket-Version: 13']);
    expect(response).toContain('400 Bad Request');
    await expect.poll(() => upstream.wss.clients.size).toBe(clientsBefore);
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
    const temp = await createLauncher({
      target: upstreamUrl,
      publicDir,
      host: '127.0.0.1',
      port: 0,
    });
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
    const temp = await createLauncher({
      target,
      publicDir,
      host: '127.0.0.1',
      port: 0,
      closeGraceMs: 25,
    });
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
