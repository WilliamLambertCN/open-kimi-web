import { costForRecord, resolvedPrice, suggestedPrice } from './pricing.mjs';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_BUCKETS = 2_000;

export class UsageQueryError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function boundedText(value, label, pathSafe = false, maxLength = 256) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength ||
      /[\0\r\n]/.test(value) || pathSafe && /[\\/]/.test(value)) {
    throw new UsageQueryError(`${label} 格式无效`);
  }
  return value;
}

export function parseUsageQuery(url, now = Date.now()) {
  const params = new URL(url, 'http://localhost').searchParams;
  validateParamKeys(params);
  const { from, to } = parseInterval(params, now);
  const bucket = params.get('bucket') ?? 'day';
  if (bucket !== 'hour' && bucket !== 'day') throw new UsageQueryError('时间分组无效');
  const step = bucket === 'hour' ? HOUR_MS : DAY_MS;
  if (Math.floor((to - 1) / step) - Math.floor(from / step) + 1 > MAX_BUCKETS) {
    throw new UsageQueryError('时间分组过多');
  }
  return {
    from, to, bucket,
    model: boundedText(params.get('model'), '模型', false, 262),
    workspace: boundedText(params.get('workspace'), '工作区', true),
  };
}

function validateParamKeys(params) {
  const allowed = new Set(['from', 'to', 'model', 'workspace', 'bucket']);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) throw new UsageQueryError('查询参数无效');
  }
}

function parseInterval(params, now) {
  if (!params.has('from') || !params.has('to')) throw new UsageQueryError('时间范围无效');
  const from = Number(params.get('from'));
  const to = Number(params.get('to'));
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) ||
      from < 0 || from >= to || to > now + DAY_MS) throw new UsageQueryError('时间范围无效');
  return { from, to };
}

function emptySummary() {
  return {
    input: 0, cacheRead: 0, cacheWrite: 0, output: 0, totalInput: 0,
    totalTokens: 0, requests: 0, cacheHitRate: null, costUsd: null,
    costComplete: true, unpricedRequests: 0, unpricedTokens: 0,
  };
}

function add(summary, record, cost) {
  summary.input += record.inputOther;
  summary.cacheRead += record.inputCacheRead;
  summary.cacheWrite += record.inputCacheCreation;
  summary.output += record.output;
  summary.requests += 1;
  if (cost.costUsd !== null) summary.costUsd = (summary.costUsd ?? 0) + cost.costUsd;
  if (cost.unpricedTokens > 0) {
    summary.unpricedRequests += 1;
    summary.unpricedTokens += cost.unpricedTokens;
    summary.costComplete = false;
  }
}

function finish(summary) {
  summary.totalInput = summary.input + summary.cacheRead + summary.cacheWrite;
  summary.totalTokens = summary.totalInput + summary.output;
  summary.cacheHitRate = summary.totalInput === 0 ? null : summary.cacheRead / summary.totalInput;
  return summary;
}

function publicPrice(price) {
  if (price === null) return null;
  const { catalogKey, provider, modelId, source, rates, custom } = price;
  return { catalogKey, provider, modelId, source, rates, custom };
}

function publicSuggestion(suggestion) {
  if (suggestion === null) return null;
  const {
    catalogKey, provider, providerId, modelId, name, source, rates,
    matchKind, confidence,
  } = suggestion;
  return {
    catalogKey, provider, providerId, modelId, name, source, rates,
    matchKind, confidence,
  };
}

function matchesQuery(record, query) {
  return record.time >= query.from && record.time < query.to &&
    (query.model === null || identityOf(record).id === query.model) &&
    (query.workspace === null || record.workspace === query.workspace);
}

function identityOf(record) {
  return record.modelId === null
    ? { id: 'unresolved', model: '模型 ID 未确认', modelId: null }
    : { id: `model:${record.modelId}`, model: record.modelId, modelId: record.modelId };
}

function modelGroup(identity, price, suggestion) {
  return {
    ...identity, aliases: new Set(), ...emptySummary(),
    price: publicPrice(price),
    suggestion: publicSuggestion(suggestion),
  };
}

function finishModel(group) {
  return { ...finish(group), aliases: [...group.aliases].sort() };
}

export function aggregateUsage(scan, pricing, query) {
  const models = new Map();
  const buckets = new Map();
  const modelOptions = new Map();
  const totals = emptySummary();
  const prices = new Map();
  const suggestions = new Map();
  const priceFor = (modelId) => {
    if (!prices.has(modelId)) prices.set(modelId, resolvedPrice(modelId, pricing));
    return prices.get(modelId);
  };
  const suggestionFor = (modelId) => {
    if (!suggestions.has(modelId)) suggestions.set(modelId, suggestedPrice(modelId, pricing));
    return suggestions.get(modelId);
  };
  const step = query.bucket === 'hour' ? HOUR_MS : DAY_MS;
  const firstBucket = Math.floor(query.from / step) * step;
  const lastBucket = Math.floor((query.to - 1) / step) * step;
  for (let time = firstBucket; time <= lastBucket; time += step) {
    buckets.set(time, { time, ...emptySummary() });
  }
  for (const record of scan.facts) {
    const identity = identityOf(record);
    modelOptions.set(identity.id, {
      id: identity.id, label: identity.model, modelId: identity.modelId,
    });
    if (!matchesQuery(record, query)) continue;
    let group = models.get(identity.id);
    if (group === undefined) {
      group = modelGroup(identity, priceFor(identity.modelId), suggestionFor(identity.modelId));
      models.set(identity.id, group);
    }
    group.aliases.add(record.alias);
    const time = Math.floor(record.time / step) * step;
    const bucket = buckets.get(time);
    const price = priceFor(record.modelId);
    const cost = costForRecord(record, price);
    add(totals, record, cost);
    add(group, record, cost);
    add(bucket, record, cost);
  }
  const resultModels = [...models.values()].map(finishModel)
    .sort((a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model));
  const resultBuckets = [...buckets.values()].map(finish).sort((a, b) => a.time - b.time);
  return {
    available: true,
    range: { from: query.from, to: query.to, bucket: query.bucket },
    totals: finish(totals),
    models: resultModels,
    buckets: resultBuckets,
    modelOptions: [...modelOptions.values()].sort((a, b) => a.label.localeCompare(b.label)),
    workspaces: scan.workspaces,
    quality: scan.quality,
    pricing: {
      updatedAt: pricing.updatedAt,
      source: pricing.source,
      lastRefreshError: pricing.lastRefreshError,
      legacyMappingsIgnored: pricing.legacyMappingsIgnored ?? 0,
    },
  };
}
