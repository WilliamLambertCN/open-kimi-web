import { writeFile } from 'node:fs/promises';

const SOURCE_URL = 'https://openrouter.ai/api/v1/models';
const OUTPUT = new URL('../packages/launcher/src/usage/openrouter-pricing-snapshot.json', import.meta.url);
const RATE_FIELDS = ['input', 'cacheRead', 'cacheWrite', 'output'];

function millionRate(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 && amount <= 0.1 ? amount * 1_000_000 : null;
}

function ratesOf(pricing) {
  return {
    input: millionRate(pricing?.prompt),
    cacheRead: millionRate(pricing?.input_cache_read),
    cacheWrite: millionRate(pricing?.input_cache_write),
    output: millionRate(pricing?.completion),
  };
}

function tiersOf(pricing) {
  if (!Array.isArray(pricing?.overrides)) return undefined;
  const tiers = pricing.overrides
    .filter((tier) => Number.isSafeInteger(tier?.min_prompt_tokens) && tier.min_prompt_tokens > 0)
    .map((tier) => ({ threshold: tier.min_prompt_tokens, rates: ratesOf(tier) }))
    .sort((left, right) => left.threshold - right.threshold);
  return tiers.length ? tiers : undefined;
}

function entryOf(model) {
  const modelId = model?.id;
  if (typeof modelId !== 'string' || !modelId || modelId.length > 256) return null;
  if (model.pricing === null || typeof model.pricing !== 'object') return null;
  const rates = ratesOf(model.pricing);
  if (!RATE_FIELDS.some((field) => rates[field] !== null)) return null;
  const entry = {
    key: `openrouter:${modelId}`,
    providerId: 'openrouter',
    providerName: 'OpenRouter',
    modelId,
    name: String(model.name ?? modelId).slice(0, 256),
    rates,
  };
  const tiers = tiersOf(model.pricing);
  if (tiers) entry.tiers = tiers;
  return entry;
}

function validatePayload(payload) {
  if (!Array.isArray(payload?.data)) throw new Error('OpenRouter returned an invalid model catalog.');
  const catalog = payload.data.map(entryOf).filter(Boolean)
    .sort((left, right) => left.key.localeCompare(right.key));
  if (!catalog.length) throw new Error('OpenRouter returned an empty model catalog.');
  return catalog;
}

const response = await fetch(SOURCE_URL, {
  headers: { accept: 'application/json' },
  redirect: 'error',
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`OpenRouter returned HTTP ${response.status}.`);
const catalog = validatePayload(await response.json());
const snapshot = {
  source: 'OpenRouter',
  sourceUrl: SOURCE_URL,
  fetchedAt: new Date().toISOString(),
  catalog,
};
await writeFile(OUTPUT, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
process.stdout.write(`Saved ${catalog.length} OpenRouter prices to ${OUTPUT.pathname}\n`);
