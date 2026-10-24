import { assertCronReadVersion, assertCronWriteVersion } from './compatibility.mjs';
import { CronClientError } from './errors.mjs';

export const REQUEST_TIMEOUT_MS = 3000;
export const MAX_REQUEST_BYTES = 64 * 1024;
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const META_PATH = '/api/v1/meta';
const CRON_PATH = '/api/v1/debug/session/';

export function loopbackOrigin(target) {
  let url;
  try {
    if (typeof target !== 'string') throw new Error();
    url = new URL(target);
  } catch {
    throw new CronClientError('unsafe-target');
  }
  if (!['127.0.0.1', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) {
    throw new CronClientError('unsafe-target');
  }
  validateOriginOnly(url);
  return url.origin;
}

function validateOriginOnly(url) {
  if ([url.username, url.password, url.search, url.hash].some(Boolean) || url.pathname !== '/' || url.port === '0') {
    throw new CronClientError('unsafe-target');
  }
}

function cancelBody(response) {
  void response.body?.cancel().catch(() => {});
}

function checkResponse(response) {
  if (response.redirected || (response.status >= 300 && response.status < 400)) {
    cancelBody(response);
    throw new CronClientError('redirect');
  }
  if (response.status === 401 || response.status === 403) {
    cancelBody(response);
    throw new CronClientError('unauthorized');
  }
  if (!response.ok) {
    cancelBody(response);
    throw new CronClientError('upstream-http');
  }
  checkResponseBody(response);
}

function checkResponseBody(response) {
  const size = Number(response.headers.get('content-length'));
  if (size > MAX_RESPONSE_BYTES) {
    cancelBody(response);
    throw new CronClientError('response-too-large');
  }
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || response.body === null) {
    cancelBody(response);
    throw new CronClientError('invalid-response');
  }
}

async function readLimitedResponse(response, signal) {
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new CronClientError('response-too-large');
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

async function readEnvelope(response, signal) {
  checkResponse(response);
  const bytes = await readLimitedResponse(response, signal);
  let envelope;
  try {
    envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new CronClientError('invalid-response');
  }
  if (envelope === null || typeof envelope !== 'object' || !Number.isSafeInteger(envelope.code)) {
    throw new CronClientError('invalid-response');
  }
  if (envelope.code === 40101) throw new CronClientError('unauthorized');
  if (envelope.code === 40401) throw new CronClientError('not-loaded');
  if (envelope.code !== 0) throw new CronClientError('upstream-business');
  if (!Object.hasOwn(envelope, 'data')) throw new CronClientError('invalid-response');
  return envelope.data;
}

function bodyFor(args) {
  if (args === undefined) return undefined;
  const body = JSON.stringify(args);
  if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) throw new CronClientError('request-too-large');
  return body;
}

export async function requestJson(fetchImpl, url, authorization, args) {
  const body = bodyFor(args);
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CronClientError('timeout'));
    }, REQUEST_TIMEOUT_MS);
    timer.unref?.();
  });
  try {
    const operation = (async () => {
      const response = await fetchImpl(new URL(url), {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization, accept: 'application/json', 'content-type': 'application/json' },
        body,
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        cancelBody(response);
        throw new CronClientError('timeout');
      }
      const abort = () => cancelBody(response);
      controller.signal.addEventListener('abort', abort, { once: true });
      try {
        return await readEnvelope(response, controller.signal);
      } finally {
        controller.signal.removeEventListener('abort', abort);
      }
    })();
    return await Promise.race([operation, timeout]);
  } catch (error) {
    if (controller.signal.aborted) throw new CronClientError('timeout');
    if (error instanceof CronClientError) throw error;
    throw new CronClientError('upstream-unavailable');
  } finally {
    clearTimeout(timer);
  }
}

export function createCronTransport(origin, fetchImpl) {
  const rpcUrl = (sessionId, method) => `${origin}${CRON_PATH}${sessionId}/agent/main/agentCronService/${method}`;
  const read = (sessionId, authorization, method) => requestJson(fetchImpl, rpcUrl(sessionId, method), authorization);
  const authorize = async (authorization) =>
    assertCronReadVersion(await requestJson(fetchImpl, origin + META_PATH, authorization));
  const write = async (sessionId, authorization, method, args) => {
    assertCronWriteVersion(await authorize(authorization));
    return requestJson(fetchImpl, rpcUrl(sessionId, method), authorization, args);
  };
  return Object.freeze({
    authorize,
    list: (sessionId, authorization) => read(sessionId, authorization, 'list'),
    isDisabled: (sessionId, authorization) => read(sessionId, authorization, 'isDisabled'),
    now: (sessionId, authorization) => read(sessionId, authorization, 'now'),
    addTask: (sessionId, authorization, init) => write(sessionId, authorization, 'addTask', [init]),
    removeTask: (sessionId, authorization, id) => write(sessionId, authorization, 'removeTasks', [[id]]),
  });
}
