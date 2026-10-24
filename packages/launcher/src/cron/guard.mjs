import { CronClientError } from './errors.mjs';
import { createCronTransport, loopbackOrigin, requestJson } from './transport.mjs';
import { validateOperation } from './validation.mjs';

const unsafeCallbacks = new WeakSet();

function notifyUnsafe(callback) {
  if (typeof callback !== 'function' || unsafeCallbacks.has(callback)) return;
  unsafeCallbacks.add(callback);
  void Promise.resolve().then(() => callback()).catch(() => {});
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function validateRemoteIdentifiers(data) {
  for (const key of ['url', 'device_id']) {
    if (data[key] !== undefined && typeof data[key] !== 'string') throw new CronClientError('invalid-response');
  }
}

function validateRemoteControl(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data) || typeof data.enabled !== 'boolean' ||
      !['off', 'starting', 'on', 'stopping', 'conflict'].includes(data.state)) {
    throw new CronClientError('invalid-response');
  }
  validateRemoteIdentifiers(data);
  if (data.enabled !== false || data.state !== 'off' ||
      ['conflict', 'url', 'device_id'].some((key) => hasValue(data[key]))) {
    throw new CronClientError('unsafe-backend');
  }
}

export async function assertCronBackend({ target, authorization, fetchImpl = fetch, onUnsafeBackend }) {
  const origin = loopbackOrigin(target);
  validateOperation({ sessionId: 'cron-guard', authorization });
  if (typeof fetchImpl !== 'function') throw new CronClientError('invalid-input');
  const version = await createCronTransport(origin, fetchImpl).authorize(authorization);
  const data = await requestJson(fetchImpl, origin + '/api/v1/remote-control', authorization);
  try {
    validateRemoteControl(data);
  } catch (error) {
    if (error.code === 'unsafe-backend') notifyUnsafe(onUnsafeBackend);
    throw error;
  }
  return version;
}
