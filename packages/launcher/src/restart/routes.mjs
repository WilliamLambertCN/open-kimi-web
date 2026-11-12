import { checkRestartOrigin, readRestartBody, RestartError, sendRestartJson } from './http.mjs';

const PREFIX = '/__open-kimi-mobile/service/';
const STATUS = PREFIX + 'status';
const RESTART = PREFIX + 'restart';

function isServicePath(raw) {
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch { decoded = ''; }
  return raw.startsWith(PREFIX) || decoded.startsWith(PREFIX);
}

function restartFailure(res, error) {
  const known = error instanceof RestartError;
  sendRestartJson(res, known ? error.status : 503, { error: known ? error.code : 'restart-unavailable' });
}

async function restartResponse(req, res, controller) {
  let disconnected = false;
  let responding = false;
  const onClose = () => {
    disconnected = true;
    if (responding && !res.writableFinished) controller.cancel();
  };
  res.once('close', onClose);
  try {
    const body = await controller.reserve(req.headers.authorization, () => readRestartBody(req));
    if (disconnected || req.aborted || res.destroyed) { controller.cancel(); return; }
    res.once('finish', () => {
      res.off('close', onClose);
      void controller.commit().catch(() => controller.cancel());
    });
    responding = true;
    sendRestartJson(res, 202, body);
  } finally { if (!responding) res.off('close', onClose); }
}

export async function serveRestart(req, res, controller) {
  const raw = req.url ?? '/';
  if (!isServicePath(raw)) return false;
  try {
    if (![STATUS, RESTART].includes(raw)) throw new RestartError('not-found', 404);
    if (!controller) throw new RestartError('unmanaged-or-unsupported', 409);
    checkRestartOrigin(req);
    const method = raw === STATUS ? 'GET' : 'POST';
    if (req.method !== method) throw new RestartError('method-not-allowed', 405);
    if (method === 'GET') {
      sendRestartJson(res, 200, await controller.status(req.headers.authorization));
      return true;
    }
    await restartResponse(req, res, controller);
  } catch (error) { restartFailure(res, error); }
  return true;
}

export function guardRestartWrites(req, res, controller) {
  if (!controller || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return false;
  if (controller.blocked()) {
    sendRestartJson(res, 409, { error: 'restart-pending' });
    return true;
  }
  controller.track(req, res);
  return false;
}
