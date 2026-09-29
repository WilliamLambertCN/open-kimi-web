const FETCH_TIMEOUT_MS = 10_000;
const MAX_CATALOG_BYTES = 12 * 1024 * 1024;

export const RATE_FIELDS = ['input', 'cacheRead', 'cacheWrite', 'output'];

export class PricingError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100_000
    ? value : null;
}

function millionRate(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 && amount <= 0.1 ? amount * 1_000_000 : null;
}

function ratesOf(cost) {
  return {
    input: numberOrNull(cost?.input),
    cacheRead: numberOrNull(cost?.cache_read),
    cacheWrite: numberOrNull(cost?.cache_write),
    output: numberOrNull(cost?.output),
  };
}

function contextTiers(cost) {
  if (!Array.isArray(cost?.tiers)) return undefined;
  const tiers = cost.tiers.filter((item) => item?.tier?.type === 'context' &&
    Number.isSafeInteger(item.tier.size) && item.tier.size > 0).map((item) => ({
    threshold: item.tier.size,
    rates: ratesOf(item),
  })).sort((left, right) => left.threshold - right.threshold);
  return tiers.length > 0 ? tiers : undefined;
}

function modelsDevEntry(providerId, provider, modelId, model) {
  if (!model?.cost || modelId.length > 256 || modelId.length === 0) return null;
  const rates = ratesOf(model.cost);
  if (!RATE_FIELDS.some((field) => rates[field] !== null)) return null;
  return {
    key: `${providerId}/${modelId}`,
    providerId,
    providerName: String(provider.name ?? providerId).slice(0, 120),
    modelId,
    name: String(model.name ?? modelId).slice(0, 256),
    rates,
    tiers: contextTiers(model.cost),
  };
}

function providerModels(providerId, provider) {
  if (providerId === 'openrouter' || !/^[\w.-]{1,80}$/u.test(providerId)) return [];
  if (provider?.models === null || typeof provider?.models !== 'object') return [];
  return Object.entries(provider.models).map(([modelId, model]) =>
    modelsDevEntry(providerId, provider, modelId, model)).filter(Boolean);
}

function fromModelsDev(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new PricingError(502, 'models.dev 目录格式无效');
  }
  const entries = Object.entries(payload).flatMap(([providerId, provider]) =>
    providerModels(providerId, provider)).slice(0, 10_000);
  if (entries.length === 0) throw new PricingError(502, 'models.dev 目录为空');
  return entries;
}

function openRouterRates(pricing) {
  return {
    input: millionRate(pricing.prompt),
    cacheRead: millionRate(pricing.input_cache_read),
    cacheWrite: millionRate(pricing.input_cache_write),
    output: millionRate(pricing.completion),
  };
}

function openRouterTiers(pricing) {
  if (!Array.isArray(pricing.overrides)) return undefined;
  const tiers = pricing.overrides
    .filter((tier) => Number.isSafeInteger(tier?.min_prompt_tokens) && tier.min_prompt_tokens > 0)
    .map((tier) => ({ threshold: tier.min_prompt_tokens, rates: openRouterRates(tier) }))
    .sort((left, right) => left.threshold - right.threshold);
  return tiers.length > 0 ? tiers : undefined;
}

function openRouterEntry(model) {
  const modelId = model?.id;
  if (typeof modelId !== 'string' || modelId.length === 0 || modelId.length > 256) return null;
  const pricing = model.pricing;
  if (pricing === null || typeof pricing !== 'object') return null;
  const rates = openRouterRates(pricing);
  if (!RATE_FIELDS.some((field) => rates[field] !== null)) return null;
  return {
    key: `openrouter:${modelId}`,
    providerId: 'openrouter',
    providerName: 'OpenRouter',
    modelId,
    name: String(model.name ?? modelId).slice(0, 256),
    rates,
    tiers: openRouterTiers(pricing),
  };
}

function fromOpenRouter(payload) {
  if (!Array.isArray(payload?.data)) throw new PricingError(502, 'OpenRouter 目录格式无效');
  const entries = payload.data.map(openRouterEntry).filter(Boolean);
  if (entries.length === 0) throw new PricingError(502, 'OpenRouter 目录为空');
  return entries;
}

async function fetchJson(url, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new PricingError(502, '公开价格目录暂时无法连接');
  }
  if (!response.ok) throw new PricingError(502, `公开价格目录返回 HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > MAX_CATALOG_BYTES) {
    throw new PricingError(502, '公开价格目录响应过大');
  }
  if (response.body === null) throw new PricingError(502, '公开价格目录响应为空');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_CATALOG_BYTES) throw new PricingError(502, '公开价格目录响应过大');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new PricingError(502, '公开价格目录 JSON 格式无效');
  }
}

export async function fetchPublicCatalog(fetchImpl) {
  const [modelsDev, openRouter] = await Promise.all([
    fetchJson('https://models.dev/api.json', fetchImpl),
    fetchJson('https://openrouter.ai/api/v1/models', fetchImpl),
  ]);
  return [...fromModelsDev(modelsDev), ...fromOpenRouter(openRouter)];
}
