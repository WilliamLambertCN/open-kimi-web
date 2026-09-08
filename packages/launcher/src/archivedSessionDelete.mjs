const ENDPOINT = '/__open-kimi-mobile/sessions:delete';
const MAX_BODY_BYTES = 8 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;

class DeleteError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

function requestOrigin(req) {
  const host = req.headers.host;
  if (typeof host !== 'string' || host === '') return null;
  return `${req.socket?.encrypted ? 'https' : 'http'}://${host}`;
}

async function readJson(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > MAX_BODY_BYTES) throw new DeleteError(413, 'request body is too large');
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new DeleteError(400, 'request body must be valid JSON');
  }
}

async function readUpstreamJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function upstreamHeaders(authorization, withBody = false) {
  return {
    authorization,
    ...(withBody ? { 'content-type': 'application/json' } : {}),
  };
}

function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  return fetchImpl(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function validateRequest(req, body) {
  const origin = requestOrigin(req);
  if (origin === null || req.headers.origin !== origin) {
    throw new DeleteError(403, 'This request must come from the open-kimi-web page.');
  }
  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string' || !/^Bearer\s+\S+$/.test(authorization)) {
    throw new DeleteError(401, 'Page authorization is not ready. Refresh and try again.');
  }
  const sessionId = body?.sessionId;
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId) || Object.keys(body).length !== 1) {
    throw new DeleteError(400, 'A valid archived session is required.');
  }
  return { authorization, sessionId };
}

function authorizationError(response) {
  if (response.status !== 401 && response.status !== 403) return null;
  return new DeleteError(response.status, 'Page authorization was rejected. Refresh and try again.');
}

async function requireArchivedSession(ctx) {
  const response = await fetchWithTimeout(
    ctx.fetchImpl,
    new URL(`/api/v1/sessions/${encodeURIComponent(ctx.sessionId)}`, ctx.target),
    { headers: upstreamHeaders(ctx.authorization), redirect: 'manual' },
    ctx.timeoutMs,
  );
  const body = await readUpstreamJson(response);
  const authError = authorizationError(response);
  if (authError) throw authError;
  if (!response.ok || body?.code !== 0) {
    throw new DeleteError(404, 'This session no longer exists. Refresh the archived list.');
  }
  if (body?.data?.archived !== true) {
    throw new DeleteError(409, 'Only archived sessions can be permanently deleted.');
  }
}

async function requestOfficialDelete(ctx) {
  const response = await fetchWithTimeout(
    ctx.fetchImpl,
    new URL('/api/v1/debug/sessionManager/delete', ctx.target),
    {
      method: 'POST',
      headers: upstreamHeaders(ctx.authorization, true),
      body: JSON.stringify(ctx.sessionId),
      redirect: 'manual',
    },
    ctx.timeoutMs,
  );
  const body = await readUpstreamJson(response);
  const authError = authorizationError(response);
  if (authError) throw authError;
  if (response.status === 404 || body === null) {
    throw new DeleteError(501, 'Permanent deletion is unavailable on this Kimi backend. Start it through the managed open-kimi-web integration.');
  }
  if (!response.ok || body?.code !== 0) {
    throw new DeleteError(502, 'Kimi could not permanently delete this session. Refresh and try again.');
  }
}

async function deleteArchivedSession(ctx) {
  await requireArchivedSession(ctx);
  await requestOfficialDelete(ctx);
}

function sendDeleteError(res, error) {
  if (error instanceof DeleteError) {
    sendJson(res, error.status, { error: error.message });
    return;
  }
  const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
  sendJson(res, timedOut ? 504 : 502, {
    error: timedOut
      ? 'Kimi did not finish deleting this session in time. Refresh the archived list before retrying.'
      : 'Kimi is unreachable. The archived session was not removed from the page.',
  });
}

export async function serveArchivedSessionDelete(
  req,
  res,
  targetBase,
  { fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {},
) {
  const pathname = (req.url ?? '/').split('?')[0];
  if (pathname !== ENDPOINT) return false;

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed' }, { allow: 'POST' });
    return true;
  }

  try {
    const { authorization, sessionId } = validateRequest(req, await readJson(req));
    await deleteArchivedSession({
      authorization,
      sessionId,
      target: new URL(targetBase),
      fetchImpl,
      timeoutMs,
    });
    sendJson(res, 200, { deleted: true });
  } catch (error) {
    sendDeleteError(res, error);
  }
  return true;
}

export const archivedSessionDeletePath = ENDPOINT;
