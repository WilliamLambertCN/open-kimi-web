import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { createLauncher } from '../../packages/launcher/src/serve.mjs';
import { availableHttpPort, listenHttp } from '../testkit/httpPort.mjs';
import { createRestartController } from '../../packages/launcher/src/restart/controller.mjs';

const AUTH = 'Bearer fictional-restart-token';
const PREFIX = '/__open-kimi-mobile/service/';
const cleanups = [];
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const json = (res, data) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 0, data }));
async function shutdown(req, res, state, wss) {
  expect(req.url).toBe('/api/v1/shutdown?if_idle=true'); expect(req.method).toBe('POST');
  state.shutdownStarted.resolve();
  if (state.shutdownHold) await state.shutdownHold;
  const ok = state.shutdown === true && wss.clients.size === 0;
  state.exited = ok && state.exit;
  if (state.shutdown === 'lost') { state.exited = state.exit; res.destroy(); return; }
  json(res, { ok });
}
async function fixture({ managed = true, enhanced = true, version = '2.5.2' } = {}) {
  const publicDir = await mkdtemp(join(tmpdir(), 'okw-restart-'));
  await writeFile(join(publicDir, 'index.html'), '<html><head></head><body>Fictional app</body></html>');
  cleanups.push(() => rm(publicDir, { recursive: true, force: true }));
  const state = { busy: false, calls: [], frames: [], hold: null, started: null,
    shutdown: true, exit: true, exited: false, shutdownStarted: deferred(), shutdownHold: null };
  const upstream = createServer(async (req, res) => {
    state.calls.push(req.url);
    if (req.headers.authorization !== AUTH) { res.writeHead(401).end(); return; }
    if (req.url === '/api/v1/meta') {
      if (state.exited) { res.destroy(); return; }
      json(res, { server_version: version });
    }
    else if (/^\/api\/v[12]\/sessions\?/.test(req.url)) json(res, {
      items: state.busy ? [{ id: 'fictional' }] : [], total: state.busy ? 1 : 0, has_more: false,
    });
    else if (req.url.startsWith('/api/v1/shutdown')) await shutdown(req, res, state, wss);
    else {
      state.started?.resolve(); if (state.hold) await state.hold;
      json(res, { written: true });
    }
  });
  const wss = new WebSocketServer({ server: upstream });
  wss.on('connection', (ws) => ws.on('message', (data) => { state.frames.push(String(data)); ws.send(data); }));
  await listenHttp(upstream);
  cleanups.push(async () => {
    for (const ws of wss.clients) ws.terminate();
    await new Promise((resolve) => wss.close(resolve)); upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
  });
  const reservation = { commit: vi.fn(async () => true), cancel: vi.fn(), release: vi.fn() };
  const prepare = vi.fn(async () => reservation); const stop = vi.fn();
  const control = createRestartController({ prepare: managed ? prepare : undefined, stop });
  control.manageBackend({ address: { pid: 123456, host: '127.0.0.1', port: upstream.address().port },
    alive: () => !state.exited, waitForExit: async () => state.exited });
  const launcher = await createLauncher({ target: `http://127.0.0.1:${upstream.address().port}`,
    publicDir, host: '127.0.0.1', port: await availableHttpPort(), officialPresentation: enhanced,
    officialWebVersion: version, restartControl: control });
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
  return { state, launcher, control, prepare, stop, reservation, call, status, restart,
    target: `http://127.0.0.1:${upstream.address().port}` };
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
  it('keeps exact 2.7.2 available and rejects visible work without disconnecting its proxy client', async () => {
    const f = await fixture({ version: '2.7.2' }); const ws = await opened(f.launcher.url);
    expect((await f.status()).body).toMatchObject({ available: true, phase: 'ready' }); f.state.busy = true;
    expect(await f.restart()).toMatchObject({ status: 409, body: { error: 'service-busy' } });
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    const echoed = new Promise((resolve) => ws.once('message', (data) => resolve(String(data))));
    ws.send('still-connected'); expect(await echoed).toBe('still-connected');
    expect((await f.call('/api/v1/fixture', { method: 'POST' })).body.data).toEqual({ written: true });
    expect(f.state.calls.some((path) => path.includes('/shutdown'))).toBe(false);
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


describe('2.7.2 official conditional shutdown through real HTTP and WS proxies', () => {
  it('closes only this launcher proxy WS before a single conditional POST and waits for owned exit', async () => {
    const f = await fixture({ version: '2.7.2' }); const ws = await opened(f.launcher.url);
    const closed = new Promise((resolve) => ws.once('close', resolve));
    expect((await f.restart()).status).toBe(202); expect(await closed).toBe(1013);
    expect(f.reservation.commit).toHaveBeenCalledOnce(); expect(f.reservation.release).toHaveBeenCalledOnce();
    expect(f.stop).toHaveBeenCalledExactlyOnceWith({ backendExited: true });
    expect(f.state.calls.filter((path) => path.includes('/shutdown'))).toEqual(['/api/v1/shutdown?if_idle=true']);
    expect(f.state.exited).toBe(true);
  });

  it('leaves direct and other-launcher clients connected when the official endpoint refuses shutdown', async () => {
    const f = await fixture({ version: '2.7.2' }); const own = await opened(f.launcher.url);
    const direct = await opened(f.target); const other = await opened(f.target);
    const closed = new Promise((resolve) => own.once('close', resolve));
    expect(await f.restart()).toMatchObject({ status: 409, body: { error: 'service-busy' } });
    expect(await closed).toBe(1013); expect(f.stop).not.toHaveBeenCalled();
    expect(f.reservation.cancel).toHaveBeenCalledOnce(); expect(f.control.blocked()).toBe(false);
    for (const ws of [direct, other]) {
      const echoed = new Promise((resolve) => ws.once('message', (data) => resolve(String(data))));
      ws.send('uninterrupted'); expect(await echoed).toBe('uninterrupted');
    }
    const reconnected = await opened(f.launcher.url); expect(reconnected.readyState).toBe(WebSocket.OPEN);
    expect((await f.call('/api/v1/fixture', { method: 'POST' })).status).toBe(200);
    expect((await f.status()).body).toMatchObject({ phase: 'ready', lastError: 'service-busy' });
  });

  it('blocks reads that can restore sessions, writes and reconnects while the final decision is pending', async () => {
    const f = await fixture({ version: '2.7.2' }); const hold = deferred(); f.state.shutdownHold = hold.promise;
    const restart = f.restart(); await f.state.shutdownStarted.promise;
    for (const method of ['GET', 'POST']) expect((await f.call('/api/v1/fixture', { method })).status).toBe(409);
    const attempt = new WebSocket(f.launcher.url.replace(/^http/, 'ws') + '/api/v1/ws'); attempt.on('error', () => {});
    const rejected = new Promise((resolve) => attempt.once('unexpected-response', (_req, res) => {
      res.resume(); attempt.terminate(); resolve(res.statusCode);
    }));
    expect(await rejected).toBe(503);
    expect((await f.status()).body.phase).toBe('stopping');
    hold.resolve(); expect((await restart).status).toBe(202);
  });

  it.each([true, false])('handles an actual dropped shutdown HTTP response with owned exit=%s', async (exited) => {
    const f = await fixture({ version: '2.7.2' }); f.state.shutdown = 'lost'; f.state.exit = exited;
    const result = await f.restart();
    if (exited) {
      expect(result.status).toBe(202); expect(f.stop).toHaveBeenCalledWith({ backendExited: true });
    } else {
      expect(result).toMatchObject({ status: 503, body: { error: 'restart-outcome-unknown' } });
      expect(f.stop).not.toHaveBeenCalled(); expect(f.control.blocked()).toBe(false);
      expect((await f.call('/api/v1/fixture', { method: 'POST' })).status).toBe(200);
    }
    expect(f.state.calls.filter((path) => path.includes('/shutdown'))).toHaveLength(1);
  });

  it('completes after a real HTTP client disconnect once conditional shutdown is in flight', async () => {
    const f = await fixture({ version: '2.7.2' }); const current = await f.status(); const hold = deferred();
    f.state.shutdownHold = hold.promise;
    const request = httpRequest(f.launcher.url, { path: PREFIX + 'restart', method: 'POST',
      headers: { authorization: AUTH, 'content-type': 'application/json' } });
    request.on('error', () => {}); request.end(JSON.stringify({ instance: current.body.instance }));
    await f.state.shutdownStarted.promise; request.destroy();
    await new Promise((resolve) => request.once('close', resolve)); hold.resolve();
    await vi.waitFor(() => expect(f.stop).toHaveBeenCalledExactlyOnceWith({ backendExited: true }));
    expect(f.reservation.cancel).not.toHaveBeenCalled(); expect(f.reservation.release).toHaveBeenCalledOnce();
  });
});
