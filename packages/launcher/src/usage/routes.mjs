import { join } from 'node:path';

import { aggregateUsage, parseUsageQuery } from './aggregate.mjs';
import { PricingError, createPricingStore } from './pricing.mjs';
import { createUsageScanner } from './scanner.mjs';

const PREFIX = '/__open-kimi-mobile/usage';
const MAX_REQUEST_BYTES = 1024 * 1024;
const AUTH_TIMEOUT_MS = 3_000;

function sendJson(res, status, body) {
  const bytes = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': bytes.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  }).end(bytes);
}

async function authorized(header, target, fetchImpl) {
  if (typeof header !== 'string' || !/^Bearer\s+\S+$/i.test(header)) return false;
  try {
    const response = await fetchImpl(new URL('/api/v1/meta', target), {
      headers: { authorization: header },
      redirect: 'manual',
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
    void response.body?.cancel().catch(() => undefined);
    return response.ok;
  } catch {
    return false;
  }
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw new PricingError(413, '请求内容过大');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new PricingError(400, '请求不是有效 JSON');
  }
}

export function createUsageService({ usageHome, usageStorageDir, fetchImpl = fetch } = {}) {
  if (typeof usageHome !== 'string' || usageHome.length === 0) return null;
  const scanner = createUsageScanner(usageHome);
  const pricing = createPricingStore(usageStorageDir ?? join(usageHome, 'open-kimi-web'), fetchImpl);
  return { scanner, pricing };
}

function routeKind(pathname) {
  if (pathname === PREFIX) return { allow: 'GET', kind: 'usage' };
  if (pathname === `${PREFIX}/pricing`) return { allow: 'GET, PUT', kind: 'pricing' };
  if (pathname === `${PREFIX}/pricing:refresh`) return { allow: 'POST', kind: 'refresh' };
  return null;
}

async function operate(req, service, kind) {
  if (service === null) {
    return {
      available: false,
      reason: 'unmanaged_target',
      message: '当前目标不是受管本机 Kimi 后端，无法确认本机历史数据属于该服务。',
    };
  }
  switch (kind) {
    case 'usage': {
      const query = parseUsageQuery(req.url);
      const [scan, pricing] = await Promise.all([service.scanner.scan(), service.pricing.get()]);
      return aggregateUsage(scan, pricing, query);
    }
    case 'refresh': return service.pricing.refresh();
    default: return req.method === 'PUT'
      ? service.pricing.put(await readBody(req)) : service.pricing.get();
  }
}

export async function serveUsage(req, res, target, service, fetchImpl = fetch) {
  const pathname = (req.url ?? '/').split('?')[0];
  const route = routeKind(pathname);
  if (route === null) return false;
  if (!route.allow.split(', ').includes(req.method)) {
    res.writeHead(405, { allow: route.allow }).end('Method Not Allowed');
    return true;
  }
  if (!await authorized(req.headers.authorization, target, fetchImpl)) {
    sendJson(res, 401, { error: '页面授权无效或已过期' });
    return true;
  }
  try {
    sendJson(res, 200, await operate(req, service, route.kind));
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    sendJson(res, status, { error: status === 500 ? '使用统计暂时不可用' : error.message });
  }
  return true;
}
