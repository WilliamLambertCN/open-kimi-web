import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { createLauncher } from '../../packages/launcher/src/serve.mjs';
import { createRestartController } from '../../packages/launcher/src/restart/controller.mjs';

const AUTH = 'Bearer fictional-restart-token';
const PREFIX = '/__open-kimi-mobile/service/';
const cleanups = [];
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const json = (res, data) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 0, data }));
async function fixture({ managed = true, enhanced = true } = {}) {
  const publicDir = await mkdtemp(join(tmpdir(), 'okw-restart-'));
  await writeFile(join(publicDir, 'index.html'), '<html><head></head><body>Fictional app</body></html>');
  cleanups.push(() => rm(publicDir, { recursive: true, force: true }));
  const state = { busy: false, calls: [], frames: [], hold: null, started: null };
  const upstream = createServer(async (req, res) => {
    state.calls.push(req.url);
    if (req.headers.authorization !== AUTH) { res.writeHead(401).end(); return; }
    if (req.url === '/api/v1/meta') json(res, { server_version: '2.5.2' });
    else if (req.url.startsWith('/api/v2/sessions?')) json(res, {
      items: state.busy ? [{ id: 'fictional' }] : [], total: state.busy ? 1 : 0, has_more: false,
    });
    else {
      state.started?.resolve(); if (state.hold) await state.hold;
      json(res, { written: true });
    }
  });
  const wss = new WebSocketServer({ server: upstream });
  wss.on('connection', (ws) => ws.on('message', (data) => { state.frames.push(String(data)); ws.send(data); }));
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  cleanups.push(async () => {
    for (const ws of wss.clients) ws.terminate();
    await new Promise((resolve) => wss.close(resolve)); upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
  });
  const reservation = { commit: vi.fn(async () => true), cancel: vi.fn() };
  const prepare = vi.fn(async () => reservation); const stop = vi.fn();
  const control = createRestartController({ prepare: managed ? prepare : undefined, stop });
  const launcher = await createLauncher({ target: `http://127.0.0.1:${upstream.address().port}`,
    publicDir, host: '127.0.0.1', port: 0, officialPresentation: enhanced, officialWebVersion: '2.5.2',
    restartControl: control });
  cleanups.push(() => launcher.close());
  const call = async (path, options = {}) => {
    const response = await fetch(launcher.url + path, { ...options, headers: { authorization: AUTH, ...options.headers } });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  const status = () => call(PREFIX + 'status');
  const restart = async (options = {}) => {
    const current = await status();
    return call(PREFIX + 'restart', { method: 'POST', body: JSON.stringify({ instance: current.body.instance }),
      ...options, headers: { 'content-type': 'application/json', ...options.headers } });
  };
  return { state, launcher, control, prepare, stop, reservation, call, status, restart };
}
async function opened(url) {
  const ws = new WebSocket(url.replace(/^http/, 'ws') + '/api/v1/ws');
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  cleanups.push(() => ws.terminate()); return ws;
}
function raw(origin, path) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(origin, { path, headers: { authorization: AUTH } }, (res) => {
      res.resume(); res.once('end', () => resolve(res.statusCode));
    }); req.once('error', reject); req.end();
  });
}
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

describe('service restart authenticated HTTP contract', () => {
  it('uses exact local endpoints, validates authorization and never exposes launch parameters', async () => {
    const f = await fixture(); const state = await f.status();
    expect(state).toMatchObject({ status: 200, body: { available: true, phase: 'ready' } });
    expect(Object.keys(state.body).sort()).toEqual(['available', 'instance', 'phase']);
    expect(state.headers.get('cache-control')).toBe('no-store'); expect(f.prepare).not.toHaveBeenCalled();
    expect((await f.call(PREFIX + 'status', { headers: { authorization: '' } })).status).toBe(401);
    expect((await f.call(PREFIX + 'status', { headers: { authorization: 'Bearer invalid-fixture' } })).status).toBe(401);
    expect((await f.call(PREFIX + 'status', { method: 'POST' })).status).toBe(405);
    for (const path of [PREFIX + 'status?command=bad', PREFIX + 'restart/extra',
      '/__open-kimi-mobile/%73ervice/status', '/__open-kimi-mobile/service%2fstatus']) {
      expect(await raw(f.launcher.url, path)).toBe(404);
    }
    expect(f.state.calls.every((path) => path === '/api/v1/meta')).toBe(true);
  });
  it('rejects cross-site requests, extra body fields and oversized bodies before preparing', async () => {
    const f = await fixture();
    expect((await f.restart({ headers: { origin: 'https://other.example' } })).status).toBe(403);
    expect((await f.restart({ headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await f.restart({ body: '{"instance":"stale","command":"not-allowed"}' })).body.error).toBe('stale-page');
    expect((await f.restart({ body: 'x'.repeat(257) })).status).toBe(400);
    expect((await f.restart({ headers: { 'content-type': 'text/plain' } })).status).toBe(415);
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it('reports unmanaged instances and leaves custom frontend control unavailable', async () => {
    const unmanaged = await fixture({ managed: false });
    expect((await unmanaged.status()).body.available).toBe(false);
    expect((await unmanaged.restart()).body.error).toBe('unmanaged-or-unsupported');
    const custom = await fixture({ enhanced: false });
    const response = await fetch(custom.launcher.url + PREFIX + 'restart', { method: 'POST' });
    expect(response.status).toBe(405); expect(custom.prepare).not.toHaveBeenCalled();
  });
});

describe('service restart lifecycle and concurrent writes', () => {
  it('rejects busy work and in-flight writes, then commits one accepted request after delivery', async () => {
    const f = await fixture(); f.state.busy = true;
    expect((await f.restart()).body.error).toBe('service-busy'); expect(f.prepare).not.toHaveBeenCalled();
    f.state.busy = false; const hold = deferred(); f.state.hold = hold.promise; f.state.started = deferred();
    const write = f.call('/api/v1/fixture', { method: 'POST' }); await f.state.started.promise;
    expect((await f.restart()).body.error).toBe('request-in-flight');
    hold.resolve(); await write; f.state.hold = null;
    expect((await f.restart()).status).toBe(202); expect(f.stop).toHaveBeenCalledOnce();
    expect((await f.restart()).body.error).toBe('restart-pending'); expect(f.prepare).toHaveBeenCalledOnce();
    expect((await f.call('/api/v1/fixture', { method: 'POST' })).body.error).toBe('restart-pending');
  });
  it('blocks HTTP and WebSocket activity during preparation without swallowing a submitted frame', async () => {
    const f = await fixture(); const ws = await opened(f.launcher.url);
    const echoed = new Promise((resolve) => ws.once('message', (data) => resolve(String(data))));
    ws.send('before-restart'); expect(await echoed).toBe('before-restart');
    const pending = deferred(); f.prepare.mockImplementationOnce(() => pending.promise);
    const task = f.restart(); await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledOnce());
    expect((await f.call('/api/v1/fixture', { method: 'POST' })).status).toBe(409);
    const closed = new Promise((resolve) => ws.once('close', (code) => resolve(code)));
    ws.send('must-not-forward'); expect(await closed).toBe(1013); expect(f.state.frames).toEqual(['before-restart']);
    const attempt = new WebSocket(f.launcher.url.replace(/^http/, 'ws') + '/api/v1/ws');
    const rejected = new Promise((resolve) => attempt.once('unexpected-response', (_req, res) => {
      res.resume(); attempt.terminate(); resolve(res.statusCode);
    })); attempt.on('error', () => {}); expect(await rejected).toBe(503);
    pending.resolve(f.reservation); expect((await task).status).toBe(202);
  });
  it('cancels a prepared worker when its requesting client disconnected while preparation was pending', async () => {
    const f = await fixture(); const current = await f.status(); const pending = deferred();
    f.prepare.mockImplementationOnce(() => pending.promise);
    const request = httpRequest(f.launcher.url, { path: PREFIX + 'restart', method: 'POST',
      headers: { authorization: AUTH, 'content-type': 'application/json' } });
    request.on('error', () => {}); request.end(JSON.stringify({ instance: current.body.instance }));
    await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledOnce()); request.destroy();
    await new Promise((resolve) => request.once('close', resolve));
    pending.resolve(f.reservation); await vi.waitFor(() => expect(f.reservation.cancel).toHaveBeenCalledOnce());
    expect(f.stop).not.toHaveBeenCalled(); expect(f.control.blocked()).toBe(false);
  });
  it('cancels a failed preparation and does not stop a service if worker commit fails', async () => {
    const f = await fixture(); f.prepare.mockRejectedValueOnce(new Error('fictional-private-error'));
    expect((await f.restart()).body.error).toBe('restart-prepare-failed');
    expect(f.control.blocked()).toBe(false); f.reservation.commit.mockResolvedValueOnce(false);
    expect((await f.restart()).status).toBe(202); expect(f.stop).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(f.reservation.cancel).toHaveBeenCalledOnce()); expect(f.control.blocked()).toBe(false);
  });
});
