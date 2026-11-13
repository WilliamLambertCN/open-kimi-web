import { safeCronPathId } from '../cron/journal.mjs';
import { authorizedWorkspace } from '../sessionSize.mjs';
import { createRequestMetricsReader } from './journal.mjs';

const PATH = '/__open-kimi-mobile/request-metrics';
const MAX_BODY = 32 * 1024;

function send(res, status, data) {
  const bytes = Buffer.from(JSON.stringify(data));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': bytes.length,
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(status === 405 ? { allow: 'POST' } : {}) }).end(bytes);
}

function validIdentity(item) {
  return typeof item?.turn === 'string' && /^t_[a-f0-9]{12}$/.test(item.turn) &&
    typeof item.item === 'string' && item.item.length > 0 && item.item.length <= 256 &&
    !/[\x00-\x1f\x7f]/.test(item.item);
}

function validItem(item) {
  return validIdentity(item) && Number.isSafeInteger(item.index) && item.index > 0 &&
    ['tool_call', 'assistant_message', 'reasoning'].includes(item.type) &&
    typeof item.ended === 'string' && Number.isFinite(Date.parse(item.ended));
}

function project(data) {
  if (!safeCronPathId(data?.session) || !safeCronPathId(data?.agent) || !Array.isArray(data?.requests)) throw Error('invalid');
  if (data.requests.length === 0 || data.requests.length > 32 || !data.requests.every(validItem)) throw Error('invalid');
  return { session: data.session, agent: data.agent, requests: data.requests.map((item) => ({
    turn: item.turn, item: item.item, type: item.type, index: item.index, ended: item.ended,
    id: JSON.stringify([item.turn, item.index, item.item]),
  })) };
}

async function body(req) {
  let size = 0;
  const chunks = [];
  const timer = setTimeout(() => req.destroy(), 3000);
  timer.unref();
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw Error('invalid-body');
      chunks.push(chunk);
    }
    return project(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } finally { clearTimeout(timer); }
}

export function createRequestMetricsService(home) {
  return typeof home === 'string' && home.length > 0 ? createRequestMetricsReader(home) : null;
}

function rejection(req) {
  if (typeof req.headers.authorization !== 'string' || !/^Bearer\s+\S+$/i.test(req.headers.authorization)) {
    return [401, 'Unauthorized'];
  }
  const origin = `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`;
  if (req.headers.origin && req.headers.origin !== origin) return [403, 'Forbidden'];
  return req.method === 'POST' ? null : [405, 'Method Not Allowed'];
}

async function authorizedResult(data, req, context) {
  const workspace = await authorizedWorkspace(data.session, req.headers.authorization, context.target, context.fetchImpl);
  if (workspace === null) return { status: 404, body: { error: 'Not Found' } };
  const result = context.requestMetricsService === null
    ? { available: false, reason: 'unmanaged_target', items: [], pending: false }
    : await context.requestMetricsService.read(workspace, data.session, data.agent, data.requests);
  return { status: 200, body: result };
}

export async function serveRequestMetrics(req, res, context) {
  if ((req.url ?? '').split('?')[0] !== PATH) return false;
  const denied = rejection(req);
  if (denied) { send(res, denied[0], { error: denied[1] }); return true; }
  let data;
  try { data = await body(req); } catch { send(res, 400, { error: 'Invalid metrics request' }); return true; }
  try {
    const result = await authorizedResult(data, req, context);
    send(res, result.status, result.body);
  } catch (error) {
    send(res, error.status ?? 503, { error: 'Request metrics unavailable' });
  }
  return true;
}
