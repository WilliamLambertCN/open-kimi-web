import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPricingStore } from '../src/usage/pricing.mjs';

let root;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'open-kimi-pricing-store-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('pricing batch persistence', () => {
  it('starts with the bundled OpenRouter price catalog while offline', async () => {
    const store = createPricingStore(root, vi.fn(), () => Date.parse('2026-09-29T00:00:00Z'));
    const pricing = await store.get();
    const openRouter = pricing.catalog.filter((entry) => entry.providerId === 'openrouter');
    expect(openRouter.length).toBeGreaterThan(400);
    expect(pricing.source).toContain('OpenRouter built-in snapshot');
  });

  it('validates every mapping before atomically saving the batch', async () => {
    const now = () => Date.parse('2026-09-29T00:00:00Z');
    const store = createPricingStore(root, vi.fn(), now);
    const saved = await store.put({ mappings: [
      { model: 'first-model', catalogKey: null, rates: { input: 1 } },
      { model: 'second-model', catalogKey: null, rates: { output: 2 } },
    ] });
    expect(Object.keys(saved.mappings)).toEqual(['first-model', 'second-model']);
    await expect(store.put({ mappings: [
      { model: 'third-model', catalogKey: null, rates: { input: 3 } },
      { model: 'invalid-model', catalogKey: 'missing/catalog-entry' },
    ] })).rejects.toThrow('目录模型不存在');
    expect((await store.get()).mappings).not.toHaveProperty('third-model');
    await expect(store.put({ mappings: [
      { model: 'duplicate-model', catalogKey: null, rates: { input: 1 } },
      { model: 'duplicate-model', catalogKey: null, rates: { output: 2 } },
    ] })).rejects.toThrow('重复模型 ID');
  });
});
