import { describe, expect, it } from 'vitest';

import { createCatalogMatcher } from '../src/usage/pricingMatch.mjs';
import { suggestedPrice } from '../src/usage/pricing.mjs';

const rates = { input: 1, cacheRead: 0.1, cacheWrite: null, output: 3 };
const catalog = [
  {
    key: 'anthropic/claude-3-5-sonnet',
    providerId: 'anthropic',
    providerName: 'Anthropic',
    modelId: 'claude-3-5-sonnet',
    name: 'Claude 3.5 Sonnet',
    rates,
  },
  {
    key: 'openrouter:anthropic/claude-3.5-sonnet',
    providerId: 'openrouter',
    providerName: 'OpenRouter',
    modelId: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    rates,
  },
  {
    key: 'openrouter:openai/gpt-5.4',
    providerId: 'openrouter',
    providerName: 'OpenRouter',
    modelId: 'openai/gpt-5.4',
    name: 'GPT 5.4',
    rates,
  },
];

describe('pricing catalog matching', () => {
  it('prefers an OpenRouter candidate while normalizing provider and separators', () => {
    const match = createCatalogMatcher(catalog)('CLAUDE.3_5.SONNET');
    expect(match.entry.key).toBe('openrouter:anthropic/claude-3.5-sonnet');
    expect(match.matchKind).toBe('provider-normalized');
    expect(match.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('recognizes channel and date suffixes without presenting them as exact matches', () => {
    const match = createCatalogMatcher(catalog)('anthropic/claude-3_5-sonnet-preview-20260929');
    expect(match.entry.key).toBe('openrouter:anthropic/claude-3.5-sonnet');
    expect(match.matchKind).toBe('version-normalized');
    expect(match.confidence).toBeLessThan(1);
  });

  it('always returns one stable low-confidence candidate for an unknown real ID', () => {
    const matcher = createCatalogMatcher(catalog);
    const first = matcher('unknown-labs/new-reasoning-model');
    const second = matcher('unknown-labs/new-reasoning-model');
    expect(first).toBe(second);
    expect(first.entry.key).toBeTruthy();
    expect(first.matchKind).toBe('fuzzy');
    expect(first.confidence).toBeGreaterThanOrEqual(0.2);
  });

  it('returns no candidate for an empty catalog', () => {
    expect(createCatalogMatcher([])('model-id')).toBeNull();
  });

  it('does not replace a saved manual model mapping with an automatic suggestion', () => {
    const pricing = { catalog, mappings: {}, source: 'test' };
    expect(suggestedPrice('claude-3_5-sonnet', pricing)).toMatchObject({
      catalogKey: 'openrouter:anthropic/claude-3.5-sonnet',
      matchKind: 'provider-normalized',
    });
    pricing.mappings['claude-3_5-sonnet'] = {
      catalogKey: null,
      rates: { input: 9 },
    };
    expect(suggestedPrice('claude-3_5-sonnet', pricing)).toBeNull();
  });
});
