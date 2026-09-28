import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const FAILED_REFRESH_RETRY_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_CATALOG_BYTES = 12 * 1024 * 1024;
const RATE_FIELDS = ['input', 'cacheRead', 'cacheWrite', 'output'];
const EMPTY_RATES = { input: null, cacheRead: null, cacheWrite: null, output: null };
const SNAPSHOT_AT = '2026-09-28';
const IDENTITY_VERSION = 1;
const SNAPSHOT = [
  ['openai', 'OpenAI', 'gpt-6-astra', 10, 1, 12.5, 50],
  ['openai', 'OpenAI', 'gpt-6-sol', 2, 0.2, 2.5, 10],
  ['openai', 'OpenAI', 'gpt-6-luna', 0.1, 0.01, 0.125, 0.5],
  ['anthropic', 'Anthropic', 'claude-sonnet-4-6', 3, 0.3, 3.75, 15],
  ['deepseek', 'DeepSeek', 'deepseek-v4-pro', 0.435, 0.003625, null, 0.87],
  ['deepseek', 'DeepSeek', 'deepseek-v4-flash', 0.15, 0.003, null, 0.6],
  ['moonshotai', 'Moonshot AI', 'kimi-k2.7-code', 0.95, 0.19, null, 4],
  ['moonshotai', 'Moonshot AI', 'kimi-k2.6', 0.95, 0.16, null, 4],
  ['openai', 'OpenAI', 'gpt-5.4', 2.5, 0.25, null, 15],
  ['openai', 'OpenAI', 'gpt-5.1', 1.25, 0.125, null, 10],
  ['anthropic', 'Anthropic', 'claude-sonnet-4-5', 3, 0.3, 3.75, 15],
  ['anthropic', 'Anthropic', 'claude-opus-4-5', 5, 0.5, 6.25, 25],
  ['google', 'Google', 'gemini-3.1-pro-preview', 2, 0.2, null, 12],
];
const SNAPSHOT_TIERS = {
  'openai/gpt-6-astra': { threshold: 272_000, rates: { input: 20, cacheRead: 2, cacheWrite: 25, output: 75 } },
  'openai/gpt-6-sol': { threshold: 272_000, rates: { input: 4, cacheRead: 0.4, cacheWrite: 5, output: 15 } },
  'openai/gpt-6-luna': { threshold: 272_000, rates: { input: 0.2, cacheRead: 0.02, cacheWrite: 0.25, output: 0.75 } },
  'openai/gpt-5.4': { threshold: 272_000, rates: { input: 5, cacheRead: 0.5, cacheWrite: null, output: 22.5 } },
  'google/gemini-3.1-pro-preview': {
    threshold: 200_000, rates: { input: 4, cacheRead: 0.4, cacheWrite: null, output: 18 },
  },
};

export class PricingError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function numberOrNull(value) {
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
  })).sort((a, b) => a.threshold - b.threshold);
  return tiers.length > 0 ? tiers : undefined;
}

function modelsDevEntry(providerId, provider, modelId, model) {
  if (!model?.cost || modelId.length > 256 || modelId.length === 0) return null;
  return {
    key: `${providerId}/${modelId}`,
    providerId,
    providerName: String(provider.name ?? providerId).slice(0, 120),
    modelId,
    name: String(model.name ?? modelId).slice(0, 256),
    rates: ratesOf(model.cost),
    tiers: contextTiers(model.cost),
  };
}

function providerModels(providerId, provider) {
  if (providerId === 'openrouter' || !/^[\w.-]{1,80}$/.test(providerId)) return [];
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
    .sort((a, b) => a.threshold - b.threshold);
  return tiers.length > 0 ? tiers : undefined;
}

function openRouterEntry(model) {
  const modelId = model?.id;
  if (typeof modelId !== 'string' || modelId.length === 0 || modelId.length > 256) return null;
  const pricing = model.pricing;
  if (pricing === null || typeof pricing !== 'object') return null;
  return {
    key: `openrouter:${modelId}`, providerId: 'openrouter',
    providerName: 'OpenRouter', modelId,
    name: String(model.name ?? modelId).slice(0, 256),
    rates: openRouterRates(pricing), tiers: openRouterTiers(pricing),
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

function snapshotCatalog() {
  return SNAPSHOT.map(([providerId, providerName, modelId, input, cacheRead, cacheWrite, output]) => {
    const key = `${providerId}/${modelId}`;
    return {
      key, providerId, providerName, modelId, name: modelId,
      rates: { input, cacheRead, cacheWrite, output },
      tiers: SNAPSHOT_TIERS[key] ? [SNAPSHOT_TIERS[key]] : undefined,
    };
  });
}

function validModel(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\0\r\n]/.test(value);
}

function validateRates(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PricingError(400, '单价格式无效');
  }
  const rates = {};
  for (const key of Object.keys(value)) {
    if (!RATE_FIELDS.includes(key) || numberOrNull(value[key]) === null) {
      throw new PricingError(400, '单价格式无效');
    }
    rates[key] = value[key];
  }
  return rates;
}

function validateCatalogKey(key, catalog) {
  if (key !== null && key !== undefined && typeof key !== 'string') {
    throw new PricingError(400, '目录模型无效');
  }
  if (key && !catalog.some((entry) => entry.key === key)) {
    throw new PricingError(400, '目录模型不存在');
  }
  return key ?? null;
}

function validateMapping(input, catalog) {
  if (input === null || typeof input !== 'object' || !validModel(input.model)) {
    throw new PricingError(400, '模型 ID 无效');
  }
  if (input.remove === true) return { model: input.model, remove: true };
  const catalogKey = validateCatalogKey(input.catalogKey, catalog);
  const rates = validateRates(input.rates);
  if (!catalogKey && !hasRates(rates)) {
    throw new PricingError(400, '请选择目录模型或填写单价');
  }
  return { model: input.model, catalogKey, rates: hasRates(rates) ? rates : undefined };
}

function hasRates(rates) {
  return rates !== undefined && Object.keys(rates).length > 0;
}

async function saveState(path, serialized) {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, serialized, { mode: 0o600 });
  await rename(temporary, path);
}

function validRates(value) {
  return value !== null && typeof value === 'object' && RATE_FIELDS.every((key) =>
    value[key] === null || numberOrNull(value[key]) !== null);
}

function validTier(tier) {
  return Number.isSafeInteger(tier?.threshold) && tier.threshold > 0 && validRates(tier.rates);
}

function validTiers(tiers) {
  return tiers === undefined || Array.isArray(tiers) && tiers.length <= 20 && tiers.every(validTier);
}

function validCatalogEntry(entry) {
  if (entry === null || typeof entry !== 'object') return false;
  return ['key', 'providerId', 'modelId', 'name', 'providerName'].every((key) =>
    validModel(entry[key])) && validRates(entry.rates) && validTiers(entry.tiers);
}

function projectRates(rates) {
  return Object.fromEntries(RATE_FIELDS.map((key) => [key, rates[key]]));
}

function projectCatalogEntry(entry) {
  return {
    key: entry.key, providerId: entry.providerId,
    providerName: entry.providerName, modelId: entry.modelId, name: entry.name,
    rates: projectRates(entry.rates),
    tiers: entry.tiers?.map((tier) => ({ threshold: tier.threshold, rates: projectRates(tier.rates) })),
  };
}

function sanitizedMapping(alias, mapping) {
  if (!validModel(alias) || mapping === null || typeof mapping !== 'object') return null;
  if (mapping.catalogKey !== null && !validModel(mapping.catalogKey)) return null;
  try {
    return { catalogKey: mapping.catalogKey, rates: validateRates(mapping.rates) };
  } catch {
    return null;
  }
}

function sanitizedMappings(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const mappings = Object.create(null);
  for (const [alias, mapping] of Object.entries(value)) {
    const cleaned = sanitizedMapping(alias, mapping);
    if (cleaned === null) return null;
    mappings[alias] = cleaned;
  }
  return mappings;
}

function validStoredCatalog(parsed) {
  if (!Array.isArray(parsed?.catalog) || parsed.catalog.length === 0 || parsed.catalog.length > 11_000 ||
      !parsed.catalog.every(validCatalogEntry)) return false;
  return true;
}

function sanitizedLegacyMappings(value) {
  const mappings = Object.create(null);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return mappings;
  for (const [alias, mapping] of Object.entries(value)) {
    const cleaned = sanitizedMapping(alias, mapping);
    if (cleaned !== null) mappings[alias] = cleaned;
  }
  return mappings;
}

function sanitizedState(parsed) {
  if (!validStoredCatalog(parsed)) return null;
  const currentIdentity = parsed.identityVersion === IDENTITY_VERSION;
  const mappings = currentIdentity ? sanitizedMappings(parsed.mappings) : Object.create(null);
  const legacyAliasMappings = sanitizedLegacyMappings(
    currentIdentity ? parsed.legacyAliasMappings : parsed.mappings,
  );
  if (mappings === null || !Number.isFinite(Date.parse(parsed.updatedAt)) ||
      typeof parsed.source !== 'string' || parsed.source.length > 120) return null;
  const lastRefreshError = typeof parsed.lastRefreshError === 'string'
    ? parsed.lastRefreshError.slice(0, 200) : null;
  return {
    catalog: parsed.catalog.map(projectCatalogEntry), mappings, legacyAliasMappings,
    identityVersion: IDENTITY_VERSION,
    legacyMappingsIgnored: Object.keys(legacyAliasMappings).length,
    updatedAt: parsed.updatedAt, source: parsed.source, lastRefreshError,
  };
}

export function createPricingStore(storageDir, fetchImpl = fetch, now = Date.now) {
  const path = join(storageDir, 'usage-pricing.json');
  let state = {
    catalog: snapshotCatalog(), mappings: {}, legacyAliasMappings: {}, updatedAt: SNAPSHOT_AT,
    identityVersion: IDENTITY_VERSION, legacyMappingsIgnored: 0,
    source: 'models.dev built-in snapshot', lastRefreshError: null,
  };
  let loadPromise, refreshing;
  let writeQueue = Promise.resolve();
  let lastAttempt = 0;
  function load() {
    loadPromise ??= (async () => {
      try {
        const stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CATALOG_BYTES) return;
        const parsed = sanitizedState(JSON.parse(await readFile(path, 'utf8')));
        if (parsed !== null) state = parsed;
      } catch {
        // The public built-in snapshot remains available on a fresh or invalid cache.
      }
    })();
    return loadPromise;
  }
  function persist() {
    const serialized = JSON.stringify(state);
    writeQueue = writeQueue.catch(() => undefined).then(() => saveState(path, serialized));
    return writeQueue;
  }
  async function refresh() {
    await load();
    if (refreshing !== undefined) return refreshing;
    lastAttempt = now();
    refreshing = (async () => {
      try {
        const [modelsDev, openRouter] = await Promise.all([
          fetchJson('https://models.dev/api.json', fetchImpl),
          fetchJson('https://openrouter.ai/api/v1/models', fetchImpl),
        ]);
        const catalog = [...fromModelsDev(modelsDev), ...fromOpenRouter(openRouter)];
        state = {
          ...state, catalog, updatedAt: new Date(now()).toISOString(),
          source: 'models.dev + OpenRouter', lastRefreshError: null,
        };
        await persist();
      } catch (error) {
        state = {
          ...state,
          lastRefreshError: error instanceof PricingError ? error.message : '公开价格目录刷新失败',
        };
        await persist().catch(() => undefined);
      }
      return publicState();
    })().finally(() => { refreshing = undefined; });
    return refreshing;
  }
  function publicState() {
    return {
      catalog: state.catalog, mappings: state.mappings,
      identityVersion: state.identityVersion, legacyMappingsIgnored: state.legacyMappingsIgnored,
      updatedAt: state.updatedAt, source: state.source, lastRefreshError: state.lastRefreshError,
    };
  }
  async function get() {
    await load();
    const updated = Date.parse(state.updatedAt);
    const stale = !Number.isFinite(updated) || now() - updated > CATALOG_TTL_MS;
    if (stale && now() - lastAttempt > FAILED_REFRESH_RETRY_MS) void refresh();
    return publicState();
  }
  async function put(input) {
    await load();
    const value = validateMapping(input, state.catalog);
    const mappings = Object.assign(Object.create(null), state.mappings);
    if (value.remove) delete mappings[value.model];
    else mappings[value.model] = { catalogKey: value.catalogKey, rates: value.rates };
    state = { ...state, mappings };
    await persist();
    return publicState();
  }
  return { get, put, refresh };
}

function mappedEntry(modelId, pricing, mapping) {
  if (mapping !== undefined) {
    return pricing.catalog.find((item) => item.key === mapping.catalogKey);
  }
  const matches = pricing.catalog.filter((item) => item.modelId === modelId);
  return matches.length === 1 ? matches[0] : undefined;
}

function sourceForPrice(pricing, entry, mapping) {
  if (mapping?.rates !== undefined) return 'manual';
  if (entry?.providerId === 'openrouter') return 'OpenRouter';
  return pricing.source;
}

function priceDescriptor(alias, pricing, entry, mapping) {
  const base = entry ?? {};
  const override = mapping ?? {};
  return {
    catalogKey: base.key ?? null,
    provider: base.providerName ?? null,
    modelId: base.modelId ?? alias,
    source: sourceForPrice(pricing, entry, mapping),
    providerId: base.providerId,
    rates: { ...EMPTY_RATES, ...base.rates, ...override.rates },
    tiers: base.tiers,
    manualRates: override.rates,
    custom: override.rates !== undefined,
  };
}

export function resolvedPrice(modelId, pricing) {
  if (modelId === null) return null;
  const mapping = Object.hasOwn(pricing.mappings, modelId) ? pricing.mappings[modelId] : undefined;
  const entry = mappedEntry(modelId, pricing, mapping);
  if (entry === undefined && mapping?.rates === undefined) return null;
  return priceDescriptor(modelId, pricing, entry, mapping);
}

function requestRates(record, price) {
  let rates = price?.rates ?? EMPTY_RATES;
  const totalInput = record.inputOther + record.inputCacheRead + record.inputCacheCreation;
  for (const tier of price?.tiers ?? []) {
    if (totalInput > tier.threshold) {
      rates = price?.providerId === 'openrouter'
        ? Object.fromEntries(RATE_FIELDS.map((key) => [key, tier.rates[key] ?? rates[key]]))
        : tier.rates;
    }
  }
  return { ...rates, ...price?.manualRates };
}

export function costForRecord(record, price) {
  const tokenCounts = {
    input: record.inputOther, cacheRead: record.inputCacheRead,
    cacheWrite: record.inputCacheCreation, output: record.output,
  };
  const rates = requestRates(record, price);
  let cost = 0;
  let priced = false;
  let unpricedTokens = 0;
  for (const key of RATE_FIELDS) {
    const count = tokenCounts[key];
    if (count === 0) continue;
    if (rates[key] === null || rates[key] === undefined) unpricedTokens += count;
    else {
      cost += count * rates[key] / 1_000_000;
      priced = true;
    }
  }
  return { costUsd: priced ? cost : null, unpricedTokens };
}
