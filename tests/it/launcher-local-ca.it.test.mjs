import { X509Certificate } from 'node:crypto';
import { createServer } from 'node:http';
import { request } from 'node:https';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkServerIdentity } from 'node:tls';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { startFrontend } from '../../packages/launcher/src/frontend.mjs';
import { frontendOptions } from '../../packages/launcher/src/integration/supervisor.mjs';
import { createLauncher } from '../../packages/launcher/src/serve.mjs';
import { disableLocalCa, setupLocalCa } from '../../packages/launcher/src/tls/localCaStore.mjs';

const prefix = '/__open-kimi-mobile/tls/';
const interfaces = { LAN: [{ address: '192.0.2.40', family: 'IPv4', internal: false }],
  EasyTier: [{ address: '198.51.100.1', family: 'IPv4', internal: false }] };
let home;
let publicDir;
let upstream;
let wss;
let tls;
let wrongRoot;
let frontend;
const requests = [];
const extras = [];

function get(url, ca, options = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { ca, agent: false, ...options }, (res) => {
      const authorized = res.socket.authorized;
      const chunks = [];
      res.on('data', (data) => chunks.push(data));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), authorized }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}
function echo(url, ca) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url.replace('https:', 'wss:') + '/api/v1/ws', { ca });
    ws.on('open', () => ws.send('fictional ping'));
    ws.on('error', reject);
    ws.on('message', (data) => { resolve(String(data)); ws.close(); });
  });
}
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'launcher-local-ca-home-'));
  publicDir = await mkdtemp(join(tmpdir(), 'launcher-local-ca-web-'));
  await writeFile(join(publicDir, 'index.html'), '<html><head></head><body>fictional HTTPS fixture</body></html>');
  upstream = createServer((req, res) => {
    requests.push(req.url);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));
  });
  wss = new WebSocketServer({ server: upstream });
  wss.on('connection', (ws) => ws.on('message', (data) => ws.send('echo:' + String(data))));
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  tls = await setupLocalCa({ home, interfaces, host: '0.0.0.0' });
  const other = await setupLocalCa({ home: join(home, 'unrelated'), interfaces: {}, hostname: 'localhost' });
  wrongRoot = new X509Certificate(other.publicCa.certificate).toString();
  const env = { ...process.env, OPEN_KIMI_WEB_HOME: home, OPEN_KIMI_WEB_DIR: publicDir };
  const options = frontendOptions({ hostBare: true, port: 0 }, upstream.address().port, env);
  frontend = await startFrontend({ ...options, interfaces, noTokenLink: true, log: () => {}, warn: () => {} });
});
afterAll(async () => {
  await frontend?.launcher.close();
  for (const launcher of extras) await launcher.close();
  for (const client of wss?.clients ?? []) client.terminate();
  await new Promise((resolve) => wss?.close(resolve));
  await new Promise((resolve) => upstream?.close(resolve));
  await rm(home, { recursive: true, force: true });
  await rm(publicDir, { recursive: true, force: true });
});

describe('trusted local CA HTTPS through the daily kimi web path', () => {
  const rootPem = () => new X509Certificate(tls.publicCa.certificate).toString();
  it('uses the explicitly enabled home from supervisor env and trusts the root, not a pinned leaf', async () => {
    expect(frontend.tls.source).toBe('local-ca');
    expect(frontend.tls.fingerprint).toBe(tls.fingerprint);
    expect(frontend.tls).not.toHaveProperty('rootKey');
    const response = await get(frontend.launcher.url, rootPem());
    expect(response.status).toBe(200);
    expect(response.authorized).toBe(true);
    expect(String(response.body)).toContain('fictional HTTPS fixture');
    expect(String(response.body)).not.toContain('pwaInstall.js');
    expect(frontend.launcher.tls).not.toHaveProperty('publicCa');
    expect(JSON.stringify(frontend.launcher.tls)).not.toContain('PRIVATE KEY');
  });
  it.each(['192.0.2.40', '198.51.100.1'])('verifies the signed certificate for network identity %s', async (address) => {
    const response = await get(frontend.launcher.url, rootPem(), {
      checkServerIdentity: (_hostname, certificate) => checkServerIdentity(address, certificate),
    });
    expect(response.status).toBe(200);
    expect(response.authorized).toBe(true);
  });
  it('rejects missing trust and incorrect network identities', async () => {
    await expect(get(frontend.launcher.url)).rejects.toMatchObject({ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' });
    await expect(get(frontend.launcher.url, wrongRoot)).rejects.toMatchObject({ code: 'CERT_SIGNATURE_FAILURE' });
    await expect(get(frontend.launcher.url, rootPem(), {
      checkServerIdentity: (_hostname, cert) => checkServerIdentity('203.0.113.99', cert),
    })).rejects.toMatchObject({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
  });
  it('serves only a public CA download and status without authentication or upstream calls', async () => {
    const count = requests.length;
    const status = await get(frontend.launcher.url + prefix + 'status', rootPem());
    expect(JSON.parse(status.body)).toEqual({ source: 'local-ca', fingerprint: tls.publicCa.fingerprint,
      expiresAt: tls.publicCa.expiresAt });
    const download = await get(frontend.launcher.url + prefix + 'ca.cer', rootPem());
    expect(download.body.equals(tls.publicCa.certificate)).toBe(true);
    expect(download.headers).toMatchObject({ 'content-type': 'application/pkix-cert', 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'content-disposition': 'attachment; filename="open-kimi-web-ca.cer"' });
    expect(download.headers).not.toHaveProperty('access-control-allow-origin');
    const head = await get(frontend.launcher.url + prefix + 'ca.cer', rootPem(), { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    expect(Number(head.headers['content-length'])).toBe(download.body.length);
    const invalid = ['server.key', 'status/extra', '%63a.cer', '../../tls/local-ca/root.key'].map((path) => prefix + path);
    invalid.push('/%5f%5fopen-kimi-mobile/tls#ignored');
    for (const path of invalid) {
      const response = await get(frontend.launcher.url, rootPem(), { path });
      expect(response.status).toBe(404);
      expect(String(response.body)).not.toMatch(/<html|PRIVATE KEY/);
    }
    const encoded = await get(frontend.launcher.url + '/__open-kimi-mobile/%2574ls/ca.cer', rootPem());
    expect(encoded.status).toBe(404);
    const post = await get(frontend.launcher.url + prefix + 'ca.cer', rootPem(), { method: 'POST' });
    expect(post.status).toBe(405);
    expect(requests.length).toBe(count);
  });
  it('proxies real REST and WSS using root trust', async () => {
    const response = await get(frontend.launcher.url + '/api/v1/healthz', rootPem());
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(await echo(frontend.launcher.url, rootPem())).toBe('echo:fictional ping');
  });
});

describe('local CA mode compatibility', () => {
  const rootPem = () => new X509Certificate(tls.publicCa.certificate).toString();
  it('keeps explicit custom TLS ahead of local CA and reserves disabled CA routes on HTTP', async () => {
    const certFile = join(home, 'custom.crt');
    const keyFile = join(home, 'custom.key');
    await writeFile(certFile, tls.cert);
    await writeFile(keyFile, tls.key, { mode: 0o600 });
    const custom = await startFrontend({ target: frontendOptions({}, upstream.address().port).target,
      host: '127.0.0.1', port: 0, publicDir, home, interfaces, noTokenLink: true,
      https: true, certFile, keyFile, log: () => {}, warn: () => {} });
    extras.push(custom.launcher);
    expect(custom.tls.source).toBe('custom');
    expect((await get(custom.launcher.url + prefix + 'ca.cer', rootPem())).status).toBe(404);
    const http = await createLauncher({ target: 'http://127.0.0.1:1', publicDir, host: '127.0.0.1', port: 0 });
    extras.push(http);
    const response = await fetch(http.url + prefix + 'status');
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not Found');
  });
  it('disables new CA selection without deleting the root or changing the running listener', async () => {
    await disableLocalCa({ home });
    const disabled = await startFrontend({ target: frontendOptions({}, upstream.address().port).target,
      host: '127.0.0.1', port: 0, publicDir, interfaces, https: true, home,
      noTokenLink: true, log: () => {}, warn: () => {} });
    extras.push(disabled.launcher);
    expect(disabled.tls.source).toBe('managed');
    expect((await get(disabled.launcher.url + prefix + 'status', disabled.tls.cert)).status).toBe(404);
    expect((await get(frontend.launcher.url, rootPem())).authorized).toBe(true);
    const enabled = await setupLocalCa({ home, interfaces, host: '0.0.0.0' });
    expect(enabled.publicCa.fingerprint).toBe(tls.publicCa.fingerprint);
  });
});
