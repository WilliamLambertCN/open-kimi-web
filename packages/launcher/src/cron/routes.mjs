import { createCronClient } from './client.mjs';
import { assertCronWriteVersion, CRON_READ_VERSIONS, CRON_WRITE_VERSIONS } from './compatibility.mjs';
import { CronClientError } from './errors.mjs';
import { assertCronBackend } from './guard.mjs';
import { createCronInventory } from './inventory.mjs';
import { createCronTransport, loopbackOrigin } from './transport.mjs';
import { strictRecord, validateCronInit, validateOperation, validateTaskId } from './validation.mjs';

export const CRON_PREFIX = '/__open-kimi-mobile/cron';
export const CRON_BODY_TIMEOUT_MS = 3000;
export const CRON_MAX_BODY_BYTES = 16 * 1024;
export const CRON_MAX_CONCURRENT = 8;
const services = new WeakMap();
const STATUS = {
  'invalid-input': 400, 'invalid-path': 400, 'no-future-fire': 400, 'one-shot-too-far': 400,
  unauthorized: 401, 'cross-origin': 403, 'method-not-allowed': 405, 'body-timeout': 408,
  'not-loaded': 409, 'task-limit': 409, disabled: 409, 'read-only-version': 409, 'body-too-large': 413,
  'unsupported-media-type': 415, busy: 429,
};
const KNOWN_REJECTIONS = ['unauthorized', 'not-loaded'];

function configuredOrigin(target, enabled) {
  if (enabled) return loopbackOrigin(target);
  let url;
  try {
    url = new URL(target);
  } catch {
    throw new CronClientError('unsafe-target');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' ||
      [url.username, url.password, url.search, url.hash].some(Boolean)) throw new CronClientError('unsafe-target');
  return url.origin;
}

function validateServiceOptions({ enabled, home, fetchImpl, onUnsafeBackend }) {
  if (typeof enabled !== 'boolean' || typeof fetchImpl !== 'function') throw new CronClientError('invalid-input');
  if (home !== null && (typeof home !== 'string' || home.length === 0)) throw new CronClientError('invalid-input');
  if (onUnsafeBackend !== undefined && typeof onUnsafeBackend !== 'function') throw new CronClientError('invalid-input');
}

export function createCronRouteService({ target, enabled = false, home = null, fetchImpl = fetch, onUnsafeBackend } = {}) {
  validateServiceOptions({ enabled, home, fetchImpl, onUnsafeBackend });
  const origin = configuredOrigin(target, enabled);
  const service = Object.freeze({});
  const inventory = enabled && home ? createCronInventory({ home, target: origin, fetchImpl }) : null;
  services.set(service, { origin, enabled, inventory, fetchImpl, onUnsafeBackend, active: 0 });
  return service;
}

function inventoryRoute(raw, method) {
  const [pathname] = raw.split('?');
  if (pathname !== CRON_PREFIX + '/sessions') return null;
  if (method !== 'GET') throw new CronClientError('method-not-allowed');
  if (raw === pathname) return { kind: 'inventory' };
  const match = /^\?cursor=([^&]+)$/.exec(raw.slice(pathname.length));
  if (!match) throw new CronClientError('invalid-path');
  let cursor;
  try {
    cursor = decodeURIComponent(match[1].replace(/\+/g, ' '));
  } catch {
    throw new CronClientError('invalid-path');
  }
  if (Buffer.byteLength(cursor, 'utf8') > 4096 || /[\0\r\n]/.test(cursor)) throw new CronClientError('invalid-path');
  return { kind: 'inventory', cursor };
}

function taskRoute(raw, method) {
  const match = /^\/__open-kimi-mobile\/cron\/sessions\/([A-Za-z0-9_-]+)\/tasks(?:\/([^/]+):delete)?$/.exec(raw);
  if (!match) return { kind: 'missing' };
  const [, sessionId, id] = match;
  if (id !== undefined) {
    validateTaskId(id);
    if (method !== 'POST') throw new CronClientError('method-not-allowed');
    return { kind: 'remove', sessionId, id };
  }
  if (!['GET', 'POST'].includes(method)) throw new CronClientError('method-not-allowed');
  return { kind: method === 'GET' ? 'list' : 'create', sessionId };
}

function routeFor(raw, method) {
  const inventory = inventoryRoute(raw, method);
  if (inventory) return inventory;
  if (raw.includes('?')) throw new CronClientError('invalid-path');
  if (raw === CRON_PREFIX) {
    if (method !== 'GET') throw new CronClientError('method-not-allowed');
    return { kind: 'availability' };
  }
  const history = /^\/__open-kimi-mobile\/cron\/sessions\/([A-Za-z0-9_-]+)\/history$/.exec(raw);
  if (history) {
    if (method !== 'GET') throw new CronClientError('method-not-allowed');
    return { kind: 'history', sessionId: history[1] };
  }
  return taskRoute(raw, method);
}

function checkOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && !['same-origin', 'none'].includes(site)) throw new CronClientError('cross-origin');
  const origin = req.headers.origin;
  if (origin === undefined) return;
  const scheme = req.socket?.encrypted ? 'https:' : 'http:';
  let expected;
  try {
    expected = new URL(`${scheme}//${req.headers.host}`).origin;
  } catch {
    throw new CronClientError('cross-origin');
  }
  if (origin !== expected) throw new CronClientError('cross-origin');
}

function checkBodyHeaders(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
    throw new CronClientError('unsupported-media-type');
  }
  const declared = req.headers['content-length'];
  if (declared === undefined) return;
  if (!/^\d+$/.test(declared)) throw new CronClientError('invalid-input');
  if (Number(declared) > CRON_MAX_BODY_BYTES) throw new CronClientError('body-too-large');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.off('data', data);
      req.off('end', end);
      req.off('error', aborted);
      req.off('aborted', aborted);
      if (error) {
        req.pause();
        reject(error);
      } else resolve(Buffer.concat(chunks, size));
    };
    const data = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > CRON_MAX_BODY_BYTES) finish(new CronClientError('body-too-large'));
      else chunks.push(bytes);
    };
    const end = () => finish();
    const aborted = () => finish(new CronClientError('invalid-input'));
    const timer = setTimeout(() => finish(new CronClientError('body-timeout')), CRON_BODY_TIMEOUT_MS);
    timer.unref?.();
    req.on('data', data);
    req.on('end', end);
    req.on('error', aborted);
    req.on('aborted', aborted);
  });
}

async function jsonBody(req) {
  checkBodyHeaders(req);
  const body = await readBody(req);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    throw new CronClientError('invalid-input');
  }
}

async function availability(state, authorization) {
  if (!state.enabled) {
    const version = await createCronTransport(state.origin, state.fetchImpl).authorize(authorization);
    return capabilities(state, false, version, 'not-enabled');
  }
  try {
    const version = await assertCronBackend({ target: state.origin, authorization, fetchImpl: state.fetchImpl,
      onUnsafeBackend: state.onUnsafeBackend });
    return capabilities(state, true, version);
  } catch (error) {
    if (error.code === 'unsafe-backend') return capabilities(state, false, undefined, error.code);
    throw error;
  }
}

function capabilities(state, available, version, reason) {
  const inventory = available && state.inventory !== null;
  const writable = available && CRON_WRITE_VERSIONS.includes(version);
  const result = { available, version, versions: [...CRON_READ_VERSIONS], writeVersions: [...CRON_WRITE_VERSIONS],
    capabilities: { list: available, create: writable, remove: writable, inventory, history: inventory } };
  if (available && !writable) {
    result.reason = 'read-only-version';
    result.message = new CronClientError(result.reason).message;
  } else if (reason) result.reason = reason;
  return result;
}

async function taskOperation(state, context) {
  const { route, authorization, body } = context;
  const fetchImpl = (url, options) => {
    if (options.method === 'POST' && /\/(?:addTask|removeTasks)$/.test(url.pathname)) context.mutationSent = true;
    return state.fetchImpl(url, options);
  };
  const client = createCronClient({ target: state.origin, fetchImpl });
  const args = { sessionId: route.sessionId, authorization };
  if (route.kind === 'list') return { tasks: await client.list(args), source: 'live' };
  if (route.kind === 'create') return { task: await client.create({ ...args, init: body }) };
  return { removed: await client.remove({ ...args, id: route.id }) };
}

async function guardedOperation(state, context) {
  const { route, authorization } = context;
  const version = await assertCronBackend({ target: state.origin, authorization, fetchImpl: state.fetchImpl,
    onUnsafeBackend: state.onUnsafeBackend });
  if (['create', 'remove'].includes(route.kind)) assertCronWriteVersion(version);
  if (!['inventory', 'history'].includes(route.kind)) return taskOperation(state, context);
  if (!state.inventory) throw new CronClientError('inventory-unavailable');
  if (route.kind === 'history') return state.inventory.history({ authorization, sessionId: route.sessionId });
  return state.inventory.sessions({ authorization, ...(route.cursor === undefined ? {} : { cursor: route.cursor }) });
}

async function mutationBody(req, state, context) {
  await createCronTransport(state.origin, state.fetchImpl).authorize(context.authorization);
  const body = await jsonBody(req);
  if (context.route.kind === 'create') context.body = validateCronInit(body);
  else strictRecord(body, []);
}

async function dispatch(req, state, context) {
  const { route } = context;
  checkOrigin(req);
  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string') throw new CronClientError('unauthorized');
  validateOperation({ sessionId: route.sessionId ?? 'cron-availability', authorization });
  context.authorization = authorization;
  if (route.kind === 'availability') return availability(state, authorization);
  if (route.kind === 'missing') {
    await createCronTransport(state.origin, state.fetchImpl).authorize(authorization);
    return null;
  }
  if (!state.enabled) {
    await createCronTransport(state.origin, state.fetchImpl).authorize(authorization);
    throw new CronClientError('not-enabled');
  }
  if (['create', 'remove'].includes(route.kind)) await mutationBody(req, state, context);
  return guardedOperation(state, context);
}

function sendJson(res, status, body, close = false) {
  if (res.destroyed || res.writableEnded) return;
  const data = Buffer.from(JSON.stringify(body));
  const headers = { 'content-type': 'application/json; charset=utf-8', 'content-length': data.length,
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (close) headers.connection = 'close';
  res.writeHead(status, headers);
  res.end(data);
}

function sendError(res, error, context) {
  const safe = error instanceof CronClientError ? error : new CronClientError('upstream-unavailable');
  const body = { error: { code: safe.code, message: safe.message } };
  if (context.mutationSent && !KNOWN_REJECTIONS.includes(safe.code)) body.outcomeUnknown = true;
  sendJson(res, STATUS[safe.code] ?? 503, body, true);
}

function ownsCronPath(raw) {
  if (typeof raw !== 'string') return false;
  return raw === CRON_PREFIX || raw.startsWith(CRON_PREFIX + '/') || raw.startsWith(CRON_PREFIX + '?');
}

export async function serveCron(req, res, service) {
  if (!ownsCronPath(req.url)) return false;
  const state = services.get(service);
  const context = { mutationSent: false };
  if (!state) {
    sendError(res, new CronClientError('not-enabled'), context);
    return true;
  }
  if (state.active >= CRON_MAX_CONCURRENT) {
    sendError(res, new CronClientError('busy'), context);
    return true;
  }
  state.active += 1;
  try {
    context.route = routeFor(req.url, req.method);
    const result = await dispatch(req, state, context);
    if (result === null) sendJson(res, 404, { error: { code: 'not-found', message: 'Cron management route not found.' } }, true);
    else sendJson(res, context.route.kind === 'create' ? 201 : 200, result);
  } catch (error) {
    sendError(res, error, context);
  } finally {
    state.active -= 1;
  }
  return true;
}
