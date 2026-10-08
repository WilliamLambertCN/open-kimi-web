import { lstat, opendir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const SESSION_SIZE_PATH = '/__open-kimi-mobile/session-size';
const MAX_AGENTS = 512;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const AUTH_TIMEOUT_MS = 3_000;
const filesystem = { lstat, opendir };

class SessionSizeError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function safeSegment(value) {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > 255) return false;
  if (!value.isWellFormed() || value.trim() !== value || value === '.' || value === '..') return false;
  if (/[<>:"/\\|?*%\x00-\x1f\x7f]/.test(value) || /[ .]$/.test(value)) return false;
  return !/^(con|conin\$|conout\$|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]) *(?:\.|$)/i.test(value);
}

function unavailable(reason) {
  return { available: false, reason };
}

async function requireDirectory(path, fsImpl) {
  const stat = await fsImpl.lstat(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Unsafe directory');
}

async function agentsDirectory(home, workspaceId, sessionId, fsImpl) {
  let path = resolve(home);
  await requireDirectory(path, fsImpl);
  for (const segment of ['sessions', workspaceId, sessionId, 'agents']) {
    path = join(path, segment);
    await requireDirectory(path, fsImpl);
  }
  return path;
}

async function agentBytes(path, fsImpl) {
  await requireDirectory(path, fsImpl);
  const stat = await fsImpl.lstat(join(path, 'wire.jsonl'));
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Unsafe wire');
  if (!Number.isSafeInteger(stat.size) || stat.size < 0) throw new Error('Invalid wire size');
  return stat.size;
}

async function sumAgentBytes(path, fsImpl) {
  let count = 0;
  let bytes = 0;
  let hasMain = false;
  const directory = await fsImpl.opendir(path);
  for await (const entry of directory) {
    count += 1;
    if (count > MAX_AGENTS || !safeSegment(entry.name)) throw new Error('Unsafe agent listing');
    bytes += await agentBytes(join(path, entry.name), fsImpl);
    if (!Number.isSafeInteger(bytes)) throw new Error('Invalid session size');
    if (entry.name === 'main') hasMain = true;
  }
  if (!hasMain) throw new Error('Missing main agent');
  return bytes;
}

export async function readSessionSize(usageHome, workspaceId, sessionId, fsImpl = filesystem) {
  if (typeof usageHome !== 'string' || usageHome.length === 0) return unavailable('unmanaged_target');
  if (!safeSegment(workspaceId) || !safeSegment(sessionId)) return unavailable('invalid_session');
  try {
    const path = await agentsDirectory(usageHome, workspaceId, sessionId, fsImpl);
    return { available: true, bytes: await sumAgentBytes(path, fsImpl) };
  } catch {
    return unavailable('unreadable');
  }
}

function sendJson(res, status, body) {
  const bytes = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': bytes.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...(status === 405 ? { allow: 'GET' } : {}),
  }).end(bytes);
}

function requestSessionId(url) {
  const parsed = new URL(url, 'http://launcher.invalid');
  try {
    decodeURIComponent(parsed.search);
  } catch {
    throw new SessionSizeError(400, '会话 ID 无效');
  }
  const query = parsed.searchParams;
  const ids = query.getAll('session_id');
  if (ids.length !== 1 || !safeSegment(ids[0])) throw new SessionSizeError(400, '会话 ID 无效');
  for (const key of query.keys()) {
    if (key !== 'session_id') throw new SessionSizeError(400, '请求包含不支持的参数');
  }
  return ids[0];
}

function checkUpstreamStatus(response) {
  if (response.status === 401) throw new SessionSizeError(401, '页面授权无效或已过期');
  if (response.status === 403) throw new SessionSizeError(403, '没有访问此会话的权限');
  if (response.status === 404) return false;
  if (!response.ok) throw new SessionSizeError(502, '官方会话服务暂时不可用');
  return true;
}

async function sessionPayload(response) {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    throw new SessionSizeError(502, '官方会话响应过大');
  }
  if (response.body === null) throw new SessionSizeError(502, '官方会话响应无效');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_RESPONSE_BYTES) throw new SessionSizeError(502, '官方会话响应过大');
    chunks.push(Buffer.from(chunk));
  }
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (payload?.code !== 0) throw new SessionSizeError(502, '官方会话响应无效');
  return payload.data;
}

async function authorizedWorkspace(sessionId, authorization, target, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(new URL(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, target), {
      method: 'GET',
      headers: { authorization, accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
    if (!checkUpstreamStatus(response)) return null;
    const data = await sessionPayload(response);
    if (data?.id !== sessionId || !safeSegment(data?.workspace_id)) return null;
    return data.workspace_id;
  } catch (error) {
    if (error instanceof SessionSizeError) throw error;
    throw new SessionSizeError(502, '无法验证官方会话');
  } finally {
    void response?.body?.cancel().catch(() => undefined);
  }
}

async function authorizedSize(req, { target, usageHome, fetchImpl = fetch }) {
  const sessionId = requestSessionId(req.url);
  const workspaceId = await authorizedWorkspace(sessionId, req.headers.authorization, target, fetchImpl);
  return workspaceId === null ? unavailable('invalid_session')
    : readSessionSize(usageHome, workspaceId, sessionId);
}

export async function serveSessionSize(req, res, context) {
  if ((req.url ?? '/').split('?')[0] !== SESSION_SIZE_PATH) return false;
  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string' || !/^Bearer\s+\S+$/i.test(authorization)) {
    sendJson(res, 401, { error: '页面授权无效或已过期' });
    return true;
  }
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: '此接口仅支持 GET 请求' });
    return true;
  }
  try {
    sendJson(res, 200, await authorizedSize(req, context));
  } catch (error) {
    const known = error instanceof SessionSizeError;
    sendJson(res, known ? error.status : 500, { error: known ? error.message : '会话体积暂时不可用' });
  }
  return true;
}
