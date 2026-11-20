import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createRestartController } from '../src/restart/controller.mjs';

const AUTH = 'Bearer fictional-restart-token';
const response = (data) => Response.json({ code: 0, data });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function fixture({ version = '2.7.2', outcome = true, exited = true } = {}) {
  const events = [];
  const reservation = { commit: vi.fn(async () => { events.push('ack'); return true; }),
    cancel: vi.fn(), release: vi.fn() };
  const backend = { address: { pid: 123456, port: 1234, host: '127.0.0.1' }, alive: vi.fn(() => true),
    waitForExit: vi.fn(async () => { events.push('exit'); return exited; }) };
  const quiesce = vi.fn(async () => { events.push('quiesce'); });
  const prepare = vi.fn(async () => { events.push('prepare'); return reservation; });
  const stop = vi.fn();
  const fetchImpl = vi.fn(async (url, init) => {
    if (url.pathname === '/api/v1/meta') {
      if (events.includes('exit') && exited) throw new Error('fixture backend exited');
      return response({ server_version: version });
    }
    if (url.pathname === '/api/v1/shutdown') {
      expect(url.search).toBe('?if_idle=true'); expect(init.method).toBe('POST');
      events.push('shutdown'); return response({ ok: outcome });
    }
    expect(url.pathname).toBe('/api/v1/sessions');
    expect(url.searchParams.get('busy')).toBe('true');
    expect(url.searchParams.get('archived')).toBe('all');
    expect(url.searchParams.get('fields')).toBe('id,archived');
    return response({ items: [], total: 0, has_more: false });
  });
  const control = createRestartController({ prepare, stop, fetchImpl });
  control.configure('http://127.0.0.1:1234'); control.manageBackend(backend); control.transport({ quiesce });
  const reserve = async (signal) => {
    const state = await control.status(AUTH);
    return control.reserve(AUTH, async () => ({ instance: state.instance }), signal);
  };
  return { events, control, reservation, prepare, stop, fetchImpl, backend, quiesce, reserve };
}

function shutdownWith(f, handle) {
  const original = f.fetchImpl.getMockImplementation();
  f.fetchImpl.mockImplementation((url, init) => url.pathname === '/api/v1/shutdown'
    ? handle(url, init) : original(url, init));
}

describe('exact 2.7.2 conditional restart', () => {
  it('arms the replacement before quiescing and releases it only after owned backend exit', async () => {
    const f = fixture();
    expect(await f.control.status(AUTH)).toMatchObject({ available: true, phase: 'ready' });
    expect(await f.reserve()).toMatchObject({ phase: 'restarting' });
    expect(f.events).toEqual(['prepare', 'ack', 'quiesce', 'shutdown', 'exit']);
    expect(f.prepare).toHaveBeenCalledWith({ backend: f.backend.address });
    expect(f.reservation.release).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    expect(f.control.blockedReads()).toBe(true);
    await f.control.commit(); await f.control.commit();
    expect(f.reservation.commit).toHaveBeenCalledOnce(); expect(f.reservation.release).toHaveBeenCalledOnce();
    expect(f.stop).toHaveBeenCalledExactlyOnceWith({ backendExited: true });
  });

  it.each(['turn', 'background', 'compacting', 'subtask'])('rejects visible %s work before disturbing connections', async () => {
    const f = fixture(); const original = f.fetchImpl.getMockImplementation();
    f.fetchImpl.mockImplementation((url, init) => url.pathname === '/api/v1/sessions'
      ? response({ items: [{ id: 'fictional', archived: false }], total: 1, has_more: false }) : original(url, init));
    await expect(f.reserve()).rejects.toMatchObject({ code: 'service-busy', status: 409 });
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.quiesce).not.toHaveBeenCalled();
    expect(f.control.blocked()).toBe(false); expect(f.stop).not.toHaveBeenCalled();
  });

  it.each(['approval', 'question', 'cron', 'other-client', 'new-background'])('obeys official refusal for %s', async () => {
    const f = fixture({ outcome: false });
    await expect(f.reserve()).rejects.toMatchObject({ code: 'service-busy', status: 409 });
    expect(f.reservation.cancel).toHaveBeenCalledOnce(); expect(f.reservation.release).not.toHaveBeenCalled();
    expect(f.backend.waitForExit).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    expect(f.control.blocked()).toBe(false); expect(f.control.blockedReads()).toBe(false);
    expect(await f.control.status(AUTH)).toMatchObject({ phase: 'ready', lastError: 'service-busy' });
  });

  it.each([undefined, null, 'true', 1, {}])('treats non-boolean shutdown ok=%j as unknown, never as permission', async (ok) => {
    const f = fixture({ outcome: ok, exited: false });
    shutdownWith(f, async () => response({ ok }));
    await expect(f.reserve()).rejects.toMatchObject({ code: 'restart-outcome-unknown', status: 503 });
    expect(f.backend.waitForExit).toHaveBeenCalledOnce(); expect(f.stop).not.toHaveBeenCalled();
    expect(f.reservation.cancel).toHaveBeenCalledOnce(); expect(f.control.blocked()).toBe(false);
    expect(await f.control.status(AUTH)).toMatchObject({ lastError: 'restart-outcome-unknown' });
  });

  it('cancels a replacement when an ok response is not followed by owned backend exit', async () => {
    const f = fixture({ exited: false });
    await expect(f.reserve()).rejects.toMatchObject({ code: 'restart-exit-unconfirmed', status: 503 });
    expect(f.reservation.cancel).toHaveBeenCalledOnce(); expect(f.stop).not.toHaveBeenCalled();
    expect(f.control.blocked()).toBe(false);
  });

  it.each([true, false])('resolves a lost shutdown reply from actual owned exit=%s without another POST', async (exited) => {
    const f = fixture({ exited });
    const send = vi.fn(async () => { throw new Error('fictional response lost'); }); shutdownWith(f, send);
    if (exited) {
      await f.reserve(); await f.control.commit(); expect(f.stop).toHaveBeenCalledWith({ backendExited: true });
    } else {
      await expect(f.reserve()).rejects.toMatchObject({ code: 'restart-outcome-unknown' });
      expect(f.stop).not.toHaveBeenCalled();
    }
    expect(send).toHaveBeenCalledOnce();
  });
});

describe('conditional restart cancellation and concurrency', () => {
  it('rejects an in-flight API read that may restore a session, without quiescing any WS', async () => {
    const f = fixture(); const res = new EventEmitter();
    f.control.track({ method: 'GET', url: '/api/v1/sessions/fictional' }, res);
    await expect(f.reserve()).rejects.toMatchObject({ code: 'request-in-flight' });
    expect(f.quiesce).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled();
    res.emit('finish'); expect(res.listenerCount('close')).toBe(0);
  });

  it('does not quiesce or shut down when worker acknowledgement is absent', async () => {
    const f = fixture(); f.reservation.commit.mockResolvedValue(false);
    await expect(f.reserve()).rejects.toMatchObject({ code: 'restart-prepare-failed' });
    expect(f.quiesce).not.toHaveBeenCalled(); expect(f.reservation.cancel).toHaveBeenCalledOnce();
    expect(f.control.blocked()).toBe(false);
  });

  it('cancels during preparation without submitting shutdown or quiescing clients', async () => {
    const f = fixture(); const pending = deferred(); f.prepare.mockImplementationOnce(() => pending.promise);
    const attempted = f.reserve(); const failure = expect(attempted).rejects.toMatchObject({ code: 'restart-canceled' });
    await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledOnce()); await f.control.cancel();
    pending.resolve(f.reservation); await failure;
    expect(f.quiesce).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    expect(f.reservation.cancel).toHaveBeenCalledOnce(); expect(f.control.blocked()).toBe(false);
  });

  it('does not submit shutdown when the armed worker dies while proxy WS are closing', async () => {
    const f = fixture(); f.reservation.ready = vi.fn(() => false);
    await expect(f.reserve()).rejects.toMatchObject({ code: 'restart-prepare-failed' });
    expect(f.fetchImpl.mock.calls.some(([url]) => url.pathname === '/api/v1/shutdown')).toBe(false);
    expect(f.reservation.cancel).toHaveBeenCalledOnce(); expect(f.stop).not.toHaveBeenCalled();
  });

  it('cancels a disconnected caller before the official POST, including after worker ACK', async () => {
    const f = fixture(); const abort = new AbortController();
    f.quiesce.mockImplementationOnce(async () => { abort.abort(); });
    await expect(f.reserve(abort.signal)).rejects.toMatchObject({ code: 'restart-canceled' });
    expect(f.fetchImpl.mock.calls.some(([url]) => url.pathname === '/api/v1/shutdown')).toBe(false);
    expect(f.reservation.cancel).toHaveBeenCalledOnce(); expect(f.stop).not.toHaveBeenCalled();
  });

  it('finishes the handoff even when the HTTP caller disconnects after shutdown was sent', async () => {
    const f = fixture(); const abort = new AbortController();
    shutdownWith(f, async () => { abort.abort(); return response({ ok: true }); });
    await f.reserve(abort.signal);
    expect(f.stop).toHaveBeenCalledExactlyOnceWith({ backendExited: true });
    expect(f.reservation.cancel).not.toHaveBeenCalled(); await f.control.cancel();
    expect(f.stop).toHaveBeenCalledOnce();
  });

  it('waits for an in-flight shutdown during launcher close rather than canceling or escalating it', async () => {
    const f = fixture(); const pending = deferred(); const started = deferred();
    shutdownWith(f, () => { started.resolve(); return pending.promise; });
    const reserved = f.reserve(); await started.promise;
    const closing = f.control.close(); let closed = false; void closing.then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false); expect(f.reservation.cancel).not.toHaveBeenCalled();
    pending.resolve(response({ ok: true })); await reserved; await closing;
    expect(f.stop).toHaveBeenCalledWith({ backendExited: true });
  });

  it('rejects concurrent restart while resolving an unknown result and restores normal traffic on failure', async () => {
    const f = fixture({ exited: false }); const pending = deferred(); const started = deferred();
    shutdownWith(f, () => { started.resolve(); return pending.promise; });
    const first = f.reserve(); const failure = expect(first).rejects.toMatchObject({ code: 'restart-outcome-unknown' });
    await started.promise;
    await expect(f.reserve()).rejects.toMatchObject({ code: 'restart-pending' });
    expect(f.control.blocked()).toBe(true);
    pending.resolve(response({ unexpected: true })); await failure;
    expect(f.control.blocked()).toBe(false); expect(f.reservation.cancel).toHaveBeenCalledOnce();
  });

  it('refuses unsupported and unmanaged versions without reserving a worker', async () => {
    for (const version of ['2.7.3', '2.7.2-rc.1']) {
      const f = fixture({ version });
      await expect(f.reserve()).rejects.toMatchObject({ code: 'unmanaged-or-unsupported' });
      expect(f.prepare).not.toHaveBeenCalled();
    }
    const f = fixture(); f.control.manageBackend(undefined);
    expect(await f.control.status(AUTH)).toMatchObject({ available: false, reason: 'atomic-restart-unavailable' });
  });
});


it('does not infer a lost shutdown succeeded when the same backend address still answers', async () => {
  const f = fixture({ exited: true }); const original = f.fetchImpl.getMockImplementation();
  f.fetchImpl.mockImplementation((url, init) => url.pathname === '/api/v1/meta'
    ? response({ server_version: '2.7.2' }) : original(url, init));
  shutdownWith(f, async () => { throw new Error('reply lost'); });
  await expect(f.reserve()).rejects.toMatchObject({ code: 'restart-outcome-unknown' });
  expect(f.stop).not.toHaveBeenCalled(); expect(f.reservation.cancel).toHaveBeenCalledOnce();
});
