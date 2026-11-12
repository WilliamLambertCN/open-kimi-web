import { randomUUID } from 'node:crypto';
import { requestJson } from '../cron/transport.mjs';
import { RestartError } from './http.mjs';

const SUPPORTED = new Set(['2.3.1', '2.4.1', '2.5.2']);
const BUSY_QUERY = '/api/v2/sessions?activity.status=running&activity.status=approval&activity.status=question' +
  '&meta.archived=all&page_size=1&fields=id,archived';

async function authorized(state, header) {
  if (typeof header !== 'string' || !/^Bearer\s+\S+$/i.test(header)) throw new RestartError('unauthorized', 401);
  try { return await requestJson(state.fetchImpl, new URL('/api/v1/meta', state.target), header); }
  catch (error) {
    if (error.code === 'unauthorized') throw new RestartError('unauthorized', 401);
    throw new RestartError('backend-unavailable', 502);
  }
}

async function assertIdle(state, header) {
  let data;
  try { data = await requestJson(state.fetchImpl, new URL(BUSY_QUERY, state.target), header); }
  catch { throw new RestartError('idle-check-failed', 502); }
  if (!Array.isArray(data?.items) || !Number.isSafeInteger(data.total) || data.total < 0 ||
      typeof data.has_more !== 'boolean') throw new RestartError('idle-check-failed', 502);
  if (data.total || data.items.length || data.has_more) throw new RestartError('service-busy');
}

function available(state, version) {
  return !state.closed && typeof state.prepare === 'function' && typeof state.stop === 'function' && SUPPORTED.has(version);
}

function release(state) { state.operation = false; state.phase = 'ready'; state.reservation = undefined; }
function cancel(state) { state.reservation?.cancel(); release(state); }
function assertNoWrites(state) {
  if (state.writes || state.closed) throw new RestartError('request-in-flight');
}
function validateBody(body, instance) {
  if (!body || Object.keys(body).length !== 1 || body.instance !== instance) throw new RestartError('stale-page');
}

async function reserve(state, header, readBody) {
  const meta = await authorized(state, header);
  if (!available(state, meta.server_version)) throw new RestartError('unmanaged-or-unsupported');
  if (state.operation || Date.now() < state.retryAfter) throw new RestartError('restart-pending');
  state.operation = true;
  try {
    validateBody(await readBody(), state.instance);
    state.phase = 'checking';
    assertNoWrites(state);
    await assertIdle(state, header);
    assertNoWrites(state);
    state.reservation = await state.prepare();
    assertNoWrites(state);
    await assertIdle(state, header);
    assertNoWrites(state);
    state.phase = 'prepared';
    return { instance: state.instance, phase: 'restarting' };
  } catch (error) {
    cancel(state);
    if (error instanceof RestartError) throw error;
    throw new RestartError('restart-prepare-failed', 503);
  }
}

async function commit(state) {
  if (state.phase !== 'prepared') return;
  state.phase = 'restarting';
  state.retryAfter = Date.now() + 30_000;
  try {
    if (!await state.reservation.commit()) { cancel(state); return; }
    state.stop();
  } catch { cancel(state); }
}

function track(state, req, res) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  state.writes += 1;
  let done = false;
  const finish = () => { if (!done) { done = true; state.writes -= 1; } };
  res.once('finish', finish); res.once('close', finish);
}

export function createRestartController({ prepare, stop, fetchImpl = fetch } = {}) {
  const state = { instance: randomUUID(), phase: 'ready', writes: 0, operation: false,
    closed: false, reservation: undefined, retryAfter: 0, prepare, stop, fetchImpl };
  return {
    configure(target) { state.target = target; },
    async status(header) {
      const meta = await authorized(state, header);
      const supported = available(state, meta.server_version);
      return { available: supported, instance: state.instance, phase: state.phase,
        reason: supported ? undefined : 'unmanaged-or-unsupported' };
    },
    reserve: (header, readBody) => reserve(state, header, readBody),
    commit: () => commit(state),
    cancel() { if (state.phase === 'prepared') cancel(state); },
    blocked: () => state.phase !== 'ready',
    track: (req, res) => track(state, req, res),
    close() { state.closed = true; if (state.phase !== 'restarting') state.reservation?.cancel(); },
  };
}
