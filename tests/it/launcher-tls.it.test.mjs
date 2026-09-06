import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';

import { createLauncher } from '../../packages/launcher/src/serve.mjs';
import { ensureManagedTls } from '../../packages/launcher/src/tlsStore.mjs';

let upstream;
let launcher;
let publicDir;
let tlsHome;
let tlsMaterial;
let lastHttpHeaders;
let lastWsHeaders;

function startUpstream() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      lastHttpHeaders = { ...req.headers };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    const wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
      lastWsHeaders = { ...req.headers };
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.on('message', (data) => ws.send(`echo:${data}`));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, wss, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function httpsGet(url, cert) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { ca: cert, minVersion: 'TLSv1.2' }, (res) => {
      let text = '';
      const protocol = res.socket.getProtocol();
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode, text, protocol, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  publicDir = mkdtempSync(join(tmpdir(), 'launcher-tls-public-'));
  tlsHome = mkdtempSync(join(tmpdir(), 'launcher-tls-home-'));
  writeFileSync(join(publicDir, 'index.html'), '<html>secure fixture</html>');
  upstream = await startUpstream();
  tlsMaterial = await ensureManagedTls({ home: tlsHome, interfaces: {}, hostname: 'localhost' });
  launcher = await createLauncher({
    target: upstream.url,
    publicDir,
    host: '127.0.0.1',
    port: 0,
    tls: tlsMaterial,
  });
});

afterAll(async () => {
  await launcher?.close();
  for (const client of upstream?.wss?.clients ?? []) client.terminate();
  await new Promise((resolve) => upstream?.server?.close(resolve));
  rmSync(publicDir, { recursive: true, force: true });
  rmSync(tlsHome, { recursive: true, force: true });
});

describe('HTTPS launcher', () => {
  it('serves static content with TLS 1.2+ and exposes stable metadata', async () => {
    const res = await httpsGet(`${launcher.url}/`, tlsMaterial.cert);
    expect(res.status).toBe(200);
    expect(res.text).toContain('secure fixture');
    expect(['TLSv1.2', 'TLSv1.3']).toContain(res.protocol);
    expect(res.headers['strict-transport-security']).toBeUndefined();
    expect(launcher.url).toMatch(/^https:\/\//);
    expect(launcher.tls.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(launcher.tls).not.toHaveProperty('key');
    expect(launcher.tls).not.toHaveProperty('cert');
    expect(JSON.stringify(launcher.tls)).not.toContain('PRIVATE KEY');
  });

  it('proxies HTTPS browser REST to HTTP upstream and rewrites Origin', async () => {
    const url = new URL('/api/v1/echo', launcher.url);
    const res = await new Promise((resolve, reject) => {
      const req = httpsRequest(url, {
        ca: tlsMaterial.cert,
        method: 'POST',
        headers: { origin: launcher.url },
      }, (response) => {
        response.resume();
        response.on('end', () => resolve(response));
      });
      req.on('error', reject);
      req.end('x');
    });
    expect(res.statusCode).toBe(200);
    expect(lastHttpHeaders.host).toBe(new URL(upstream.url).host);
    expect(lastHttpHeaders.origin).toBe(new URL(upstream.url).origin);
  });

  it('proxies WSS to WS while preserving protocol and rewriting Origin', async () => {
    const ws = new WebSocket(launcher.url.replace('https:', 'wss:') + '/api/v1/ws',
      'kimi-code.bearer.tls-test', {
        ca: tlsMaterial.cert,
        origin: launcher.url,
      });
    const message = new Promise((resolve) => ws.on('message', (data) => resolve(String(data))));
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
    ws.send('secure');
    expect(await message).toBe('echo:secure');
    expect(lastWsHeaders.host).toBe(new URL(upstream.url).host);
    expect(lastWsHeaders.origin).toBe(new URL(upstream.url).origin);
    expect(lastWsHeaders['sec-websocket-protocol']).toBe('kimi-code.bearer.tls-test');
    ws.close();
  });
});
