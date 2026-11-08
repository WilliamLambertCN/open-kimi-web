import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalCaRoute } from '../src/localCaRoute.mjs';
import { setupLocalCa } from '../src/tls/localCaStore.mjs';

const prefix = '/__open-kimi-mobile/tls/';
let home;
let tls;
let route;
function request(url, method = 'GET', handler = route) {
  const result = {};
  const res = { writeHead(status, headers) { Object.assign(result, { status, headers }); return this; },
    end(body) { result.body = body; return this; } };
  result.served = handler({ url, method }, res);
  return result;
}
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'local-ca-route-'));
  tls = await setupLocalCa({ home, interfaces: {}, hostname: 'localhost' });
  route = createLocalCaRoute(tls.publicCa);
});
afterAll(async () => { await rm(home, { recursive: true, force: true }); });

describe('local CA public routes', () => {
  it('returns only the verified root DER and public metadata with fixed safe headers', () => {
    const download = request(prefix + 'ca.cer?file=server.key');
    expect(download.status).toBe(200);
    expect(download.body.equals(tls.publicCa.certificate)).toBe(true);
    expect(download.headers).toMatchObject({ 'content-type': 'application/pkix-cert',
      'content-disposition': 'attachment; filename="open-kimi-web-ca.cer"',
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-length': download.body.length });
    expect(download.headers).not.toHaveProperty('access-control-allow-origin');
    const status = request(prefix + 'status');
    expect(status.status).toBe(200);
    expect(JSON.parse(status.body)).toEqual({ source: 'local-ca', fingerprint: tls.publicCa.fingerprint,
      expiresAt: tls.publicCa.expiresAt });
    expect(String(status.body)).not.toMatch(/PRIVATE|BEGIN|localhost|certificate|127\.0\.0\.1/);
    expect(status.headers['content-type']).toBe('application/json; charset=utf-8');
  });
  it.each(['status', 'ca.cer'])('supports HEAD %s without a body', (name) => {
    const get = request(prefix + name);
    const head = request(prefix + name, 'HEAD');
    expect(head).toMatchObject({ served: true, status: 200, headers: get.headers });
    expect(head.body).toBeUndefined();
  });
  it.each(['POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'])('rejects %s without a signing or CORS API', (method) => {
    expect(request(prefix + 'ca.cer', method)).toMatchObject({ status: 405,
      headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' } });
  });
  it.each([
    prefix, prefix + 'server.key', prefix + 'status/extra', prefix + 'ca.cer.bak', prefix + 'sign',
    prefix + '%63a.cer', prefix + '../index.html', '/%5f%5fopen-kimi-mobile/tls/status',
    '/__open-kimi-mobile/%74ls/status', '/__open-kimi-mobile/%2574ls/status',
    '/__open-kimi-mobile%2ftls%2fca.cer', '/__open-kimi-mobile\\tls\\status',
    '/__open-kimi-mobile/./tls/status', '/x/../__open-kimi-mobile/tls/status',
    prefix + 'status#fragment', '/%5f%5fopen-kimi-mobile/tls#ignored',
    '/%5f%5fopen-kimi-mobile/tls#ignored/ca.cer',
  ])('reserves invalid or encoded path %s instead of SPA fallback', (url) => {
    expect(request(url)).toMatchObject({ served: true, status: 404, body: 'Not Found' });
  });
  it('keeps the prefix reserved when CA mode is disabled', () => {
    const disabled = createLocalCaRoute(null);
    expect(request(prefix + 'status', 'GET', disabled).status).toBe(404);
    expect(request(prefix + 'ca.cer', 'POST', disabled).status).toBe(404);
    expect(request('/sessions/fictional', 'GET', disabled).served).toBe(false);
    expect(request('/__open-kimi-mobile/tls-other', 'GET', disabled).served).toBe(false);
    expect(disabled({}, {})).toBe(false);
  });
  it('snapshots only the DER certificate and derives metadata instead of trusting arbitrary fields', () => {
    const certificate = Buffer.from(tls.publicCa.certificate);
    const local = createLocalCaRoute({ certificate, fingerprint: 'forged', expiresAt: 'invalid', privateKey: 'secret' });
    certificate.fill(0);
    expect(request(prefix + 'ca.cer', 'GET', local).body.equals(tls.publicCa.certificate)).toBe(true);
    expect(JSON.parse(request(prefix + 'status', 'GET', local).body).fingerprint).toBe(tls.publicCa.fingerprint);
    expect(() => createLocalCaRoute({ certificate: Buffer.from('invalid') })).toThrow();
    expect(() => createLocalCaRoute({ certificate: Buffer.from(tls.cert) })).toThrow();
  });
});
