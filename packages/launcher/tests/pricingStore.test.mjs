import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { costForRecord, createPricingStore, resolvedPrice, suggestedPrice } from '../src/usage/pricing.mjs';

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

  it('recovers all curated original keys from an r4 ambiguous cache without choosing a new channel', async () => {
    const now = () => Date.parse('2026-09-29T00:00:00Z');
    const store = createPricingStore(root, vi.fn(), now);
    const original = await store.get();
    const catalog = original.catalog.map((entry) => ({ ...entry }));
    for (const entry of catalog.slice(0, 13)) {
      catalog.push({ ...entry, key: `alternate/${entry.modelId}`, providerId: 'alternate' });
    }
    const gpt = catalog.find((entry) => entry.key === 'openai/gpt-6-sol');
    catalog.splice(catalog.indexOf(gpt), 1);
    catalog.push({ ...original.catalog[0], key: 'other/ambiguous', modelId: 'new-ambiguous' });
    catalog.push({ ...original.catalog[0], key: 'another/ambiguous', modelId: 'new-ambiguous' });
    await writeFile(join(root, 'usage-pricing.json'), JSON.stringify({
      identityVersion: 1, catalog,
      mappings: { 'alias-id': { catalogKey: 'openai/gpt-6-sol' } },
      updatedAt: new Date(now()).toISOString(), source: 'r4 catalog',
    }));
    const restored = await createPricingStore(root, vi.fn(), now).get();
    for (const entry of original.catalog.slice(0, 13)) {
      expect(restored.automaticDefaults[entry.modelId]).toBe(entry.key);
      expect(resolvedPrice(entry.modelId, restored).catalogKey).toBe(entry.key);
    }
    expect(restored.mappings['alias-id'].catalogKey).toBe('openai/gpt-6-sol');
    expect(resolvedPrice('alias-id', restored).catalogKey).toBe('openai/gpt-6-sol');
    expect(resolvedPrice('alias-id', restored).source).toContain('旧目录价格');
    expect(resolvedPrice('gpt-6-sol', restored).source).toContain('旧目录价格');
    expect(resolvedPrice('new-ambiguous', restored)).toBeNull();
    expect(suggestedPrice('new-ambiguous', restored)).not.toBeNull();
    const persisted = await createPricingStore(root, vi.fn(), now);
    await persisted.put({ model: 'manual', catalogKey: null, rates: { input: 1 } });
    expect(JSON.parse(await readFile(join(root, 'usage-pricing.json'), 'utf8')).automaticDefaults)
      .toMatchObject({ 'gpt-6-sol': 'openai/gpt-6-sol' });
  });

  it('rejects corrupted continuity and never exposes unselected retained entries', async () => {
    const now = () => Date.parse('2026-09-29T00:00:00Z');
    const original = await createPricingStore(root, vi.fn(), now).get();
    const path = join(root, 'usage-pricing.json');
    await writeFile(path, JSON.stringify({
      ...original, automaticDefaults: { alpha: 'test/missing' },
    }));
    expect((await createPricingStore(root, vi.fn(), now).get()).source).toContain('built-in snapshot');
    await writeFile(path, JSON.stringify({
      ...original, retainedEntries: {
        unused: { entry: original.catalog[0], source: 'malicious' },
      },
    }));
    expect((await createPricingStore(root, vi.fn(), now).get()).retainedEntries).toEqual({});
    await writeFile(path, JSON.stringify({
      ...original, retainedEntries: {
        [original.catalog[0].key]: { entry: original.catalog[0], source: 'forged' },
      },
    }));
    expect((await createPricingStore(root, vi.fn(), now).get()).retainedEntries).toEqual({});
  });

});

describe('pricing continuity', () => {
  it('preserves the selected key, tiers and manual precedence through repeated refresh and restart', async () => {
    let phase = 0;
    const fetchImpl = async (url) => {
      if (phase === 3) throw new Error('offline');
      if (String(url).includes('models.dev')) {
        return Response.json({ demo: { name: 'Demo', models: {
          'gpt-6-sol': { cost: { input: 5, output: 10 } },
          ...(phase < 2 ? { alpha: { cost: { input: phase === 1 ? 3 : 1, output: 2,
            tiers: [{ input: phase === 1 ? 6 : 4, output: 8, tier: { type: 'context', size: 100 } }],
          } } } : {}),
        } } });
      }
      return Response.json({ data: [{ id: 'vendor/alpha', pricing: {
        prompt: '0.000009', completion: '0.000010',
      } }, ...(phase === 1 ? [{ id: 'alpha', pricing: {
        prompt: '0.000009', completion: '0.000010',
      } }] : [])] });
    };
    const now = () => Date.parse('2026-09-28T01:00:00Z');
    const store = createPricingStore(root, fetchImpl, now);
    expect(resolvedPrice('gpt-6-sol', await store.get()).catalogKey).toBe('openai/gpt-6-sol');
    await store.refresh();
    expect(resolvedPrice('alpha', await store.get()).catalogKey).toBe('demo/alpha');
    phase = 1;
    await store.refresh();
    expect(resolvedPrice('alpha', await store.get()).rates.input).toBe(3);
    expect(resolvedPrice('gpt-6-sol', await store.get()).catalogKey).toBe('openai/gpt-6-sol');
    await store.put({ model: 'alpha', catalogKey: null, rates: { input: 0 } });
    expect(resolvedPrice('alpha', await store.get()).rates.input).toBe(0);
    await store.put({ model: 'alpha', catalogKey: 'openrouter:vendor/alpha', rates: {} });
    expect(resolvedPrice('alpha', await store.get()).catalogKey).toBe('openrouter:vendor/alpha');
    await store.put({ model: 'alpha', remove: true });
    phase = 2;
    await store.refresh();
    const stale = resolvedPrice('alpha', await store.get());
    expect(stale.catalogKey).toBe('demo/alpha');
    expect(stale.source).toContain('旧目录价格');
    expect(stale.tiers[0].rates.input).toBe(6);
    await store.put({ model: 'alpha', catalogKey: 'demo/alpha', rates: { input: 0 } });
    const mixed = resolvedPrice('alpha', await store.get());
    expect(mixed.source).toContain('手动单价');
    expect(mixed.source).toContain('旧目录价格');
    expect(mixed.rates.input).toBe(0);
    expect(costForRecord({ inputOther: 101, inputCacheRead: 0, inputCacheCreation: 0, output: 10 }, mixed))
      .toEqual({ costUsd: 80 / 1_000_000, unpricedTokens: 0 });
    await store.put({ model: 'alpha', catalogKey: 'demo/alpha', rates: {} });
    expect(resolvedPrice('alpha', await store.get()).source).toContain('旧目录价格');
    await store.put({ model: 'alpha', remove: true });
    phase = 3;
    expect((await store.refresh()).lastRefreshError).toContain('暂时无法连接');
    const restored = await createPricingStore(root, fetchImpl, now).get();
    expect(resolvedPrice('alpha', restored).source).toContain('旧目录价格');
    expect(restored.mappings).toEqual({});
    phase = 1;
    await store.refresh();
    expect(resolvedPrice('alpha', await store.get()).rates.input).toBe(3);
    expect(resolvedPrice('alpha', await store.get()).source).not.toContain('旧目录价格');
  });
});

describe('retained mapping cleanup', () => {
  it('removes orphaned old entries on mapping deletion and replacement without losing other manual rates', async () => {
    const now = () => Date.parse('2026-09-29T00:00:00Z');
    const entry = (await createPricingStore(root, vi.fn(), now).get()).catalog[0];
    const orphan = { ...entry, key: 'retired/model', modelId: 'retired' };
    const path = join(root, 'usage-pricing.json');
    await writeFile(path, JSON.stringify({
      catalog: [entry], identityVersion: 1, source: 'catalog', updatedAt: new Date(now()).toISOString(),
      mappings: {
        'first-alias': { catalogKey: orphan.key },
        'second-alias': { catalogKey: orphan.key },
        keep: { catalogKey: null, rates: { input: 7 } },
      },
      automaticDefaults: {}, retainedEntries: { [orphan.key]: { entry: orphan, source: 'catalog' } },
    }));
    const store = createPricingStore(root, vi.fn(), now);
    await store.put({ model: 'first-alias', remove: true });
    expect((await store.get()).retainedEntries).toHaveProperty(orphan.key);
    await store.put({ model: 'second-alias', catalogKey: null, rates: { output: 2 } });
    expect((await store.get()).retainedEntries).not.toHaveProperty(orphan.key);
    const restored = await createPricingStore(root, vi.fn(), now).get();
    expect(restored.source).toBe('catalog');
    expect(restored.mappings.keep.rates.input).toBe(7);
    expect(restored.mappings['second-alias'].rates.output).toBe(2);
    expect(restored.retainedEntries).not.toHaveProperty(orphan.key);
  });
});

describe('pricing batch validation', () => {
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
