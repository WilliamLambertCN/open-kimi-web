const DISCOVERY_PATH = '/__open-kimi-mobile/models:discover';
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const AUTH_TIMEOUT_MS = 3_000;
const DISCOVERY_TIMEOUT_MS = 8_000;

class DiscoveryError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': data.length,
    'cache-control': 'no-store',
  });
  res.end(data);
}

async function readLimitedBody(stream, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) throw new DiscoveryError(413, '请求内容过大');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function modelsUrl(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new DiscoveryError(400, 'Base URL 格式无效');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new DiscoveryError(400, 'Base URL 仅支持 http 或 https');
  }
  if (url.username || url.password) throw new DiscoveryError(400, 'Base URL 不能包含凭据');
  url.hash = '';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/models`;
  return url;
}

function providerHeaders(type, apiKey) {
  const headers = { accept: 'application/json' };
  if (!apiKey) return headers;
  if (type === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (type === 'google-genai') {
    headers['x-goog-api-key'] = apiKey;
  } else {
    headers.authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function modelId(item) {
  if (typeof item === 'string') return item;
  if (item === null || typeof item !== 'object') return null;
  if (typeof item.id === 'string') return item.id;
  if (typeof item.name === 'string') return item.name;
  return null;
}

export function parseModelIds(payload) {
  const candidates = modelCandidates(payload);
  if (candidates === null) throw new DiscoveryError(502, '模型端点返回了无法识别的格式');

  const seen = new Set();
  const models = [];
  for (const item of candidates) {
    const id = modelId(item)?.trim();
    if (!id || id.length > 256 || seen.has(id)) continue;
    seen.add(id);
    models.push(id);
    if (models.length >= 1_000) break;
  }
  return models;
}

function modelCandidates(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.models)) return payload.models;
  return null;
}

async function readModelResponse(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new DiscoveryError(502, '模型端点响应过大');
  }
  if (response.body === null) throw new DiscoveryError(502, '模型端点返回了空响应');
  const text = await readLimitedBody(response.body, MAX_RESPONSE_BYTES);
  try {
    return parseModelIds(JSON.parse(text));
  } catch (error) {
    if (error instanceof DiscoveryError) throw error;
    throw new DiscoveryError(502, '模型端点未返回有效 JSON');
  }
}

async function verifyPageAuthorization(authorization, target, fetchImpl) {
  if (typeof authorization !== 'string' || authorization.trim() === '') return false;
  try {
    const response = await fetchImpl(new URL('/api/v1/meta', target), {
      headers: { authorization },
      redirect: 'manual',
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function discoverModels({ baseUrl, apiKey = '', type = 'openai', fetchImpl = fetch }) {
  const url = modelsUrl(baseUrl);
  let response;
  try {
    response = await fetchImpl(url, {
      headers: providerHeaders(type, apiKey),
      redirect: 'manual',
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
  } catch {
    throw new DiscoveryError(502, '无法连接模型端点');
  }
  if (response.status >= 300 && response.status < 400) {
    throw new DiscoveryError(502, '模型端点返回重定向，请直接填写最终 Base URL');
  }
  if (!response.ok) throw new DiscoveryError(502, `模型端点请求失败（HTTP ${response.status}）`);
  return readModelResponse(response);
}

export async function serveModelDiscovery(req, res, target, fetchImpl = fetch) {
  const pathname = (req.url ?? '/').split('?')[0];
  if (pathname !== DISCOVERY_PATH) return false;
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST' }).end('Method Not Allowed');
    return true;
  }

  if (!await verifyPageAuthorization(req.headers.authorization, target, fetchImpl)) {
    sendJson(res, 401, { error: '页面授权无效或已过期' });
    return true;
  }

  try {
    const body = validateDiscoveryBody(JSON.parse(await readLimitedBody(req, MAX_REQUEST_BYTES)));
    const models = await discoverModels({
      baseUrl: body.base_url.trim(),
      apiKey: body.api_key?.trim() ?? '',
      type: body.type ?? 'openai',
      fetchImpl,
    });
    sendJson(res, 200, { models });
  } catch (error) {
    sendDiscoveryError(res, error);
  }
  return true;
}

function sendDiscoveryError(res, error) {
  if (error instanceof SyntaxError) {
    sendJson(res, 400, { error: '请求不是有效 JSON' });
    return;
  }
  sendJson(res, error instanceof DiscoveryError ? error.status : 500, {
    error: error instanceof DiscoveryError ? error.message : '模型拉取失败',
  });
}

function validateDiscoveryBody(body) {
  if (typeof body?.base_url !== 'string' || body.base_url.trim() === '') {
    throw new DiscoveryError(400, '请先填写 Base URL');
  }
  if (body.api_key !== undefined && typeof body.api_key !== 'string') {
    throw new DiscoveryError(400, 'API Key 格式无效');
  }
  if (body.type !== undefined && typeof body.type !== 'string') {
    throw new DiscoveryError(400, 'API 协议格式无效');
  }
  return body;
}
