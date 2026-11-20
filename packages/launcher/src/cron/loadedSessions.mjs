import { safeCronPathId } from './journal.mjs';
import { loopbackOrigin, requestJson } from './transport.mjs';

function isSessionHandle(handle) {
  const accessor = handle?.accessor;
  return handle?.kind === 'session' && safeCronPathId(handle.id) && accessor !== null && typeof accessor === 'object' &&
    !Array.isArray(accessor) && Object.keys(accessor).length === 0;
}

export async function readLoadedSessions(fetchImpl, target, authorization) {
  const url = new URL('/api/v1/debug/sessionManager/list', loopbackOrigin(String(target)));
  const data = await requestJson(fetchImpl, url, authorization);
  if (!Array.isArray(data)) return null;
  const ids = new Set();
  for (const handle of data) {
    if (!isSessionHandle(handle) || ids.has(handle.id)) return null;
    ids.add(handle.id);
  }
  return ids;
}
