import { createServer } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLauncher } from '../src/serve.mjs';

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function fakeBackend(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

async function launcherFor(target) {
  const launcher = await createLauncher({
    target,
    publicDir: '.',
    host: '127.0.0.1',
    port: 0,
    interfaces: {},
    officialPresentation: true,
  });
  servers.push(launcher.server);
  return launcher;
}

function request(base, body = { sessionId: 'session_archived' }, extra = {}) {
  return fetch(`${base}/__open-kimi-mobile/sessions:delete`, {
    method: 'POST',
    headers: {
      origin: base,
      authorization: 'Bearer page-token',
      'content-type': 'application/json',
      ...extra.headers,
    },
    body: JSON.stringify(body),
    ...extra,
  });
}

// eslint-disable-next-line max-lines-per-function
describe('archived session deletion endpoint', () => {
  it('checks archived state and calls the official same-process deletion service', async () => {
    const calls = [];
    const target = await fakeBackend((req, res) => {
      calls.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
      if (req.url === '/api/v1/sessions/session_archived') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 0, data: { archived: true } }));
        return;
      }
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        calls.at(-1).body = body;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 0, data: null }));
      });
    });
    const launcher = await launcherFor(target);
    const response = await request(launcher.url);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: true });
    expect(calls).toEqual([
      { method: 'GET', url: '/api/v1/sessions/session_archived', authorization: 'Bearer page-token' },
      {
        method: 'POST',
        url: '/api/v1/debug/sessionManager/delete',
        authorization: 'Bearer page-token',
        body: JSON.stringify('session_archived'),
      },
    ]);
  });

  it('rejects cross-origin, malformed, and active-session requests before deletion', async () => {
    const upstream = vi.fn((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 0, data: { archived: false } }));
    });
    const target = await fakeBackend(upstream);
    const launcher = await launcherFor(target);

    const crossOrigin = await request(launcher.url, undefined, { headers: { origin: 'https://example.test' } });
    expect(crossOrigin.status).toBe(403);
    const malformed = await request(launcher.url, { sessionId: '../active' });
    expect(malformed.status).toBe(400);
    const oversized = await fetch(`${launcher.url}/__open-kimi-mobile/sessions:delete`, {
      method: 'POST',
      headers: {
        origin: launcher.url,
        authorization: 'Bearer page-token',
        'content-type': 'application/json',
      },
      body: 'x'.repeat(8193),
    });
    expect(oversized.status).toBe(413);
    const active = await request(launcher.url);
    expect(active.status).toBe(409);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('keeps direct debug routes private and reports an unmanaged backend clearly', async () => {
    const upstream = vi.fn((req, res) => {
      if (req.url === '/api/v1/sessions/session_archived') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 0, data: { archived: true } }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    });
    const target = await fakeBackend(upstream);
    const launcher = await launcherFor(target);

    const blocked = await fetch(`${launcher.url}/api/v1/debug/channels`);
    expect(blocked.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();

    const unavailable = await request(launcher.url);
    expect(unavailable.status).toBe(501);
    await expect(unavailable.json()).resolves.toMatchObject({
      error: expect.stringContaining('managed open-kimi-web'),
    });
  });

  it('does not report success when Kimi rejects deletion', async () => {
    const target = await fakeBackend((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(req.url.includes('sessionManager')
        ? { code: 50000, msg: 'failed', data: null }
        : { code: 0, data: { archived: true } }));
    });
    const launcher = await launcherFor(target);
    const response = await request(launcher.url);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
  });
});
