import { randomUUID } from 'node:crypto';
import { requestJson } from '../cron/transport.mjs';
import { conditionalShutdown } from './conditional.mjs';
import { RestartError } from './http.mjs';

const SUPPORTED = new Set(['2.3.1', '2.4.1', '2.5.2', '2.6.0', '2.6.1', '2.7.2']);
const BUSY_QUERY = '/api/v2/sessions?activity.status=running&activity.status=approval&activity.status=question' +
  '&meta.archived=all&page_size=1&fields=id,archived';
const BUSY_QUERY_272 = '/api/v1/sessions?busy=true&archived=all&page_size=1&fields=id,archived';

async function authorized(state, header) {
  if (typeof header !== 'string' || !/^Bearer\s+\S+$/i.test(header)) throw new RestartError('unauthorized', 401);
  try { return await requestJson(state.fetchImpl, new URL('/api/v1/meta', state.target), header); }
  catch (error) {
    if (error.code === 'unauthorized') throw new RestartError('unauthorized', 401);
    throw new RestartError('backend-unavailable', 502);
  }
}

function validatePage(data) {
  if (!Array.isArray(data?.items) || !Number.isSafeInteger(data.total) || data.total < 0 ||
      typeof data.has_more !== 'boolean') throw new RestartError('idle-check-failed', 502);
}

async function assertIdle(state, header) {
  let data;
  const path = state.conditional ? BUSY_QUERY_272 : BUSY_QUERY;
  try { data = await requestJson(state.fetchImpl, new URL(path, state.target), header); }
  catch { throw new RestartError('idle-check-failed', 502); }
  validatePage(data);
  if (data.total || data.items.length || data.has_more) throw new RestartError('service-busy');
}

function unavailableReason(state, version) {
  if (state.closed || typeof state.prepare !== 'function' || typeof state.stop !== 'function') return 'unmanaged-or-unsupported';
  if (!SUPPORTED.has(version)) return 'unmanaged-or-unsupported';
  if (version === '2.7.2' && (!state.backend || !state.quiesce)) return 'atomic-restart-unavailable';
}

function finishOperation(state) {
  state.operation = false;
  state.finish?.();
  state.finish = undefined;
}

function cancel(state, code) {
  state.reservation?.cancel();
  state.reservation = undefined;
  state.phase = 'ready';
  state.lastError = code;
  finishOperation(state);
}

function assertNoWrites(state) {
  if (state.writes || state.closed) throw new RestartError('request-in-flight');
}

function validateBody(body, instance) {
  if (!body || Object.keys(body).length !== 1 || body.instance !== instance) throw new RestartError('stale-page');
}

async function prepare(state, header) {
  assertNoWrites(state);
  await assertIdle(state, header);
  assertNoWrites(state);
  state.phase = 'checking';
  const details = state.conditional ? { backend: state.backend.address } : {};
  state.reservation = await state.prepare(details);
  assertNoWrites(state);
  await assertIdle(state, header);
  assertNoWrites(state);
}

function assertRequest(state, signal) {
  assertNoWrites(state);
  if (signal?.aborted) throw new RestartError('restart-canceled');
}

async function stopIdleBackend(state, header, signal) {
  assertRequest(state, signal);
  if (!await state.reservation.commit()) throw new RestartError('restart-prepare-failed', 503);
  assertRequest(state, signal);
  state.phase = 'quiescing';
  await state.quiesce();
  assertRequest(state, signal);
  if (!state.backend.alive()) throw new RestartError('backend-unavailable', 502);
  state.phase = 'stopping';
  state.shutdownSent = true;
  state.retryAfter = Date.now() + 30_000;
  await conditionalShutdown(state, header);
  state.backendExited = true;
}

async function prepared(state, signal) {
  state.phase = 'prepared';
  if (state.backendExited && (state.closed || signal?.aborted)) await commit(state);
  return { instance: state.instance, phase: 'restarting' };
}

async function reserve(state, header, readBody, signal) {
  const meta = await authorized(state, header);
  const reason = unavailableReason(state, meta.server_version);
  if (reason) throw new RestartError(reason);
  if (state.operation || Date.now() < state.retryAfter) throw new RestartError('restart-pending');
  state.operation = true;
  state.settled = new Promise((resolve) => { state.finish = resolve; });
  state.conditional = meta.server_version === '2.7.2';
  state.shutdownSent = false; state.backendExited = false; state.lastError = undefined;
  try {
    validateBody(await readBody(), state.instance);
    await prepare(state, header);
    if (state.conditional) await stopIdleBackend(state, header, signal);
    return await prepared(state, signal);
  } catch (error) {
    const failure = error instanceof RestartError ? error : new RestartError('restart-prepare-failed', 503);
    cancel(state, failure.code);
    throw failure;
  }
}

async function commit(state) {
  if (state.phase !== 'prepared') return;
  state.phase = 'restarting';
  state.retryAfter = Date.now() + 30_000;
  try {
    if (!state.conditional && !await state.reservation.commit()) { cancel(state, 'restart-prepare-failed'); return; }
    state.reservation.release?.();
    finishOperation(state);
    state.stop({ backendExited: state.backendExited });
  } catch { cancel(state, 'restart-prepare-failed'); }
}

function cancelRequest(state) {
  if (state.backendExited) return commit(state);
  if (state.shutdownSent) return;
  if (state.phase === 'prepared') cancel(state);
}

function close(state) {
  state.closed = true;
  if (state.phase === 'restarting') return;
  if (state.backendExited) return commit(state);
  if (state.phase === 'prepared') cancel(state);
  else if (!state.shutdownSent) state.reservation?.cancel();
  return state.settled;
}

function track(state, req, res) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.url?.startsWith('/api/')) return;
  state.writes += 1;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    state.writes -= 1;
    res.removeListener('finish', finish);
    res.removeListener('close', finish);
  };
  res.once('finish', finish); res.once('close', finish);
}

export function createRestartController({ prepare, stop, fetchImpl = fetch } = {}) {
  const state = { instance: randomUUID(), phase: 'ready', writes: 0, operation: false,
    closed: false, reservation: undefined, retryAfter: 0, prepare, stop, fetchImpl };
  return {
    configure(target) { state.target = target; },
    manageBackend(backend) { state.backend = backend; },
    transport({ quiesce }) { state.quiesce = quiesce; },
    async status(header) {
      const meta = await authorized(state, header);
      const reason = unavailableReason(state, meta.server_version);
      return { available: !reason, instance: state.instance, phase: state.phase, reason, lastError: state.lastError };
    },
    reserve: (header, readBody, signal) => reserve(state, header, readBody, signal),
    commit: () => commit(state),
    cancel: () => cancelRequest(state),
    blocked: () => state.phase !== 'ready',
    blockedReads: () => state.conditional && ['quiescing', 'stopping', 'prepared', 'restarting'].includes(state.phase),
    track: (req, res) => track(state, req, res),
    ownsShutdown: () => state.conditional && state.shutdownSent && state.operation,
    settled: () => state.settled,
    close: () => close(state),
  };
}
