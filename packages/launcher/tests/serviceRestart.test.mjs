import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRestartController } from '../src/restart/controller.mjs';
import { checkRestartOrigin, readRestartBody } from '../src/restart/http.mjs';

const AUTH = 'Bearer fictional-restart-token';
const response = (data, status = 200) => new Response(JSON.stringify({ code: 0, data }), {
  status, headers: { 'content-type': 'application/json' },
});
function fixture(extra = {}) {
  const reservation = { cancel: vi.fn(), commit: vi.fn(async () => true) };
  const prepare = vi.fn(async () => reservation);
  const stop = vi.fn();
  const fetchImpl = vi.fn(async (url) => response(String(url).includes('/meta')
    ? { server_version: '2.5.2' } : { items: [], total: 0, has_more: false }));
  const service = createRestartController({ prepare, stop, fetchImpl, ...extra });
  service.configure('http://127.0.0.1:1234');
  const reserve = async (body) => {
    const state = await service.status(AUTH);
    return service.reserve(AUTH, async () => body ?? { instance: state.instance });
  };
  return { service, reservation, prepare, stop, fetchImpl, reserve };
}
const req = (headers = {}) => Object.assign(new EventEmitter(), { headers, socket: {}, pause: vi.fn() });
afterEach(() => vi.useRealTimers());

describe('service restart ownership and busy gate', () => {
  it('authorizes status without reading sessions or preparing a restart', async () => {
    const f = fixture();
    expect(await f.service.status(AUTH)).toMatchObject({ available: true, phase: 'ready' });
    expect(f.fetchImpl).toHaveBeenCalledExactlyOnceWith(new URL('http://127.0.0.1:1234/api/v1/meta'),
      expect.objectContaining({ headers: expect.objectContaining({ authorization: AUTH }), redirect: 'manual' }));
    expect(f.prepare).not.toHaveBeenCalled();
  });
  it.each([undefined, '', 'Basic test', 'Bearer two values'])('rejects invalid auth %s before backend calls', async (auth) => {
    const f = fixture();
    await expect(f.service.status(auth)).rejects.toMatchObject({ code: 'unauthorized', status: 401 });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it('rejects expired authorization and masks backend failures', async () => {
    const f = fixture({ fetchImpl: async () => response({}, 401) });
    await expect(f.service.status(AUTH)).rejects.toMatchObject({ code: 'unauthorized' });
    const broken = fixture({ fetchImpl: async () => { throw new Error('private fixture data'); } });
    await expect(broken.service.status(AUTH)).rejects.toMatchObject({ code: 'backend-unavailable' });
  });
  it('reports unmanaged and unsupported instances without allowing restart', async () => {
    const f = fixture({ prepare: undefined });
    expect(await f.service.status(AUTH)).toMatchObject({ available: false });
    await expect(f.reserve()).rejects.toMatchObject({ code: 'unmanaged-or-unsupported' });
    const newer = fixture({ fetchImpl: async () => response({ server_version: '9.0.0' }) });
    await expect(newer.reserve()).rejects.toMatchObject({ code: 'unmanaged-or-unsupported' });
  });
  it('reserves once, blocks writes, and stops only after worker acknowledgement', async () => {
    const f = fixture();
    expect(await f.reserve()).toMatchObject({ phase: 'restarting' });
    expect(f.service.blocked()).toBe(true);
    expect(f.stop).not.toHaveBeenCalled();
    await expect(f.reserve()).rejects.toMatchObject({ code: 'restart-pending' });
    await f.service.commit(); await f.service.commit();
    expect(f.stop).toHaveBeenCalledOnce();
    expect(f.reservation.commit).toHaveBeenCalledOnce();
    const url = f.fetchImpl.mock.calls.find(([url]) => String(url).includes('/sessions'))[0];
    expect(url.searchParams.getAll('activity.status')).toEqual(['running', 'approval', 'question']);
    expect(url.searchParams.get('fields')).toBe('id,archived');
  });
});

describe('service restart failure boundaries', () => {
  it.each([null, {}, { instance: 'old' }, { instance: 'old', command: 'forbidden' }])('rejects stale input %j', async (body) => {
    const f = fixture(); const state = await f.service.status(AUTH);
    await expect(f.service.reserve(AUTH, async () => body)).rejects.toMatchObject({ code: 'stale-page' });
    expect(f.prepare).not.toHaveBeenCalled();
    expect((await f.service.status(AUTH)).instance).toBe(state.instance);
    expect(f.service.blocked()).toBe(false);
  });
  it.each([
    { items: [{ id: 'fictional' }], total: 1, has_more: false },
    { items: [], total: 0, has_more: true }, { items: [], total: -1, has_more: false }, {},
  ])('refuses non-idle or malformed state %j', async (data) => {
    const f = fixture({ fetchImpl: async (url) => response(String(url).includes('/meta')
      ? { server_version: '2.5.2' } : data) });
    await expect(f.reserve()).rejects.toMatchObject({ code: expect.stringMatching(/service-busy|idle-check-failed/) });
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.service.blocked()).toBe(false);
  });
  it('tracks writes until finish or close exactly once and leaves reads alone', async () => {
    const f = fixture(); const res = new EventEmitter();
    f.service.track({ method: 'POST' }, res);
    await expect(f.reserve()).rejects.toMatchObject({ code: 'request-in-flight' });
    res.emit('finish'); res.emit('close');
    f.service.track({ method: 'GET' }, new EventEmitter());
    await f.reserve(); expect(f.prepare).toHaveBeenCalledOnce();
  });
  it('cancels on response failure and keeps serving after preparation failure', async () => {
    const f = fixture(); await f.reserve(); f.service.cancel();
    expect(f.reservation.cancel).toHaveBeenCalledOnce(); expect(f.service.blocked()).toBe(false);
    f.prepare.mockRejectedValueOnce(new Error('private fixture text'));
    await expect(f.reserve()).rejects.toMatchObject({ code: 'restart-prepare-failed' });
    expect(f.stop).not.toHaveBeenCalled();
  });
  it('does not shut down when commit fails and rate limits the next attempt', async () => {
    const f = fixture(); await f.reserve(); f.reservation.commit.mockResolvedValue(false);
    await f.service.commit(); expect(f.stop).not.toHaveBeenCalled(); expect(f.service.blocked()).toBe(false);
    await expect(f.reserve()).rejects.toMatchObject({ code: 'restart-pending' });
  });
  it('disables closed controllers and cancels uncommitted workers', async () => {
    const f = fixture(); await f.reserve(); f.service.close();
    expect(f.reservation.cancel).toHaveBeenCalledOnce();
    expect(await f.service.status(AUTH)).toMatchObject({ available: false });
    await expect(f.reserve()).rejects.toMatchObject({ code: 'unmanaged-or-unsupported' });
  });
});

describe('restart last idle check', () => {
  it('cancels a prepared worker if native background work starts during preparation', async () => {
    const f = fixture();
    f.prepare.mockImplementationOnce(async () => {
      f.fetchImpl.mockImplementation(async (url) => response(String(url).includes('/meta')
        ? { server_version: '2.5.2' } : { items: [{ id: 'fictional' }], total: 1, has_more: false }));
      return f.reservation;
    });
    await expect(f.reserve()).rejects.toMatchObject({ code: 'service-busy' });
    expect(f.reservation.cancel).toHaveBeenCalledOnce(); expect(f.stop).not.toHaveBeenCalled();
    expect(f.service.blocked()).toBe(false);
  });
  it('refuses to stop if the idle check fails or the controller closes during preparation', async () => {
    const broken = fixture();
    broken.fetchImpl.mockImplementation(async (url) => {
      if (!String(url).includes('/meta')) throw new Error('fictional private detail');
      return response({ server_version: '2.5.2' });
    });
    await expect(broken.reserve()).rejects.toMatchObject({ code: 'idle-check-failed' });
    const closed = fixture();
    closed.prepare.mockImplementationOnce(async () => { closed.service.close(); return closed.reservation; });
    await expect(closed.reserve()).rejects.toMatchObject({ code: 'request-in-flight' });
    expect(closed.reservation.cancel).toHaveBeenCalledOnce(); expect(closed.stop).not.toHaveBeenCalled();
  });
});

describe('restart HTTP boundaries', () => {
  it('permits same origin and terminal clients but rejects cross-site and opaque origins', () => {
    expect(() => checkRestartOrigin(req())).not.toThrow();
    expect(() => checkRestartOrigin(req({ host: 'example.test', origin: 'http://example.test',
      'sec-fetch-site': 'same-origin' }))).not.toThrow();
    for (const headers of [{ 'sec-fetch-site': 'cross-site' }, { origin: 'null', host: 'example.test' },
      { origin: 'https://other.test', host: 'example.test' }]) {
      expect(() => checkRestartOrigin(req(headers))).toThrow('cross-origin');
    }
  });
  it('accepts a small JSON body and removes all stream listeners', async () => {
    const r = req({ 'content-type': 'application/json' }); const task = readRestartBody(r);
    r.emit('data', Buffer.from('{"instance":"fixture"}')); r.emit('end');
    expect(await task).toEqual({ instance: 'fixture' }); expect(r.listenerCount('data')).toBe(0);
  });
  it('rejects unknown media, oversized declarations, invalid JSON and aborted streams', async () => {
    await expect(readRestartBody(req())).rejects.toMatchObject({ status: 415 });
    await expect(readRestartBody(req({ 'content-type': 'application/json', 'content-length': '257' })))
      .rejects.toMatchObject({ status: 400 });
    for (const [event, chunk] of [['data', Buffer.alloc(257)], ['end', undefined], ['aborted', undefined]]) {
      const r = req({ 'content-type': 'application/json' }); const task = readRestartBody(r);
      r.emit(event, chunk); await expect(task).rejects.toMatchObject({ code: 'invalid-body' });
    }
  });
  it('bounds slow JSON bodies without consuming their data indefinitely', async () => {
    vi.useFakeTimers(); const r = req({ 'content-type': 'application/json' });
    const task = readRestartBody(r); const failed = expect(task).rejects.toMatchObject({ code: 'body-timeout' });
    await vi.advanceTimersByTimeAsync(3000); await failed;
    expect(r.pause).toHaveBeenCalledOnce(); expect(r.listenerCount('data')).toBe(0);
  });
});
