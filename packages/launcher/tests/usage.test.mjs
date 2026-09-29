import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { aggregateUsage, parseUsageQuery } from '../src/usage/aggregate.mjs';
import { costForRecord, createPricingStore, resolvedPrice } from '../src/usage/pricing.mjs';
import { createUsageService, serveUsage } from '../src/usage/routes.mjs';
import { createUsageScanner } from '../src/usage/scanner.mjs';

let root;
beforeAll(async () => {
  const base = join(process.cwd(), '.tmp', 'usage-statistics');
  await mkdir(base, { recursive: true });
  root = await mkdtemp(join(base, 'unit-'));
});
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

function usage(time, model, counts, agentId = 'main') {
  return {
    type: 'usage.record', agentId, model,
    usage: {
      inputOther: counts[0], inputCacheRead: counts[1],
      inputCacheCreation: counts[2], output: counts[3],
    },
    usageScope: 'turn', time,
  };
}

function llmRequest(time, alias, modelId = alias, agentId = 'main', kind = 'loop') {
  return { type: 'llm.request', agentId, modelAlias: alias, model: modelId, provider: 'openai', kind, time };
}

function tracked(time, alias, counts, agentId = 'main', modelId = alias) {
  return [llmRequest(time - 1, alias, modelId, agentId), usage(time, alias, counts, agentId)];
}

async function wire(home, workspace, session, agent, lines) {
  const dir = join(home, 'sessions', workspace, session, 'agents', agent);
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'wire.jsonl');
  await writeFile(path, `${lines.map((line) => typeof line === 'string' ? line : JSON.stringify(line)).join('\n')}\n`);
  return path;
}

function fakeResponse() {
  return {
    status: null, body: '',
    writeHead(status) { this.status = status; return this; },
    end(value = '') { this.body = Buffer.isBuffer(value) ? value.toString('utf8') : String(value); },
  };
}

function fakeRequest(method, url, body, authorization = 'Bearer demo-token') {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  req.method = method;
  req.url = url;
  req.headers = authorization ? { authorization } : {};
  return req;
}

describe('official wire usage scan', () => {
  it('counts physical increments including inactive usage and excludes nested fork prefixes', async () => {
    const home = join(root, 'fork-home');
    const original = [
      { type: 'metadata', protocol_version: '1.4', created_at: 100 },
      ...tracked(1000, 'model/a', [10, 20, 30, 40]),
      { type: 'context.undo', agentId: 'main', count: 1, time: 1100 },
      ...tracked(1200, 'model/a', [5, 0, 0, 5]),
    ];
    await wire(home, 'workspace-a', 'original', 'main', original);
    await wire(home, 'workspace-a', 'fork', 'main', [
      ...original, { type: 'forked', agentId: 'main', time: 1300 },
      ...tracked(1400, 'model/b', [3, 2, 1, 4]),
    ]);
    await wire(home, 'workspace-a', 'fork-again', 'main', [
      ...original, { type: 'forked', agentId: 'main', time: 1300 },
      ...tracked(1400, 'model/b', [3, 2, 1, 4]),
      { type: 'forked', agentId: 'main', time: 1500 },
      ...tracked(1600, 'model/c', [2, 1, 0, 3]),
    ]);
    await wire(home, 'workspace-b', 'second', 'side-agent', [
      ...tracked(1700, 'model/a', [6, 0, 0, 7], 'side-agent'),
    ]);
    await writeFile(join(home, 'sessions', 'workspace-a', 'fork', 'state.json'), JSON.stringify({
      forkedFrom: 'original', cwd: 'C:\\Fiction\\demo-workspace',
    }));
    await writeFile(join(home, 'sessions', 'workspace-a', 'fork-again', 'state.json'), JSON.stringify({
      forkedFrom: 'fork', cwd: 'C:\\Fiction\\demo-workspace',
    }));
    const scanner = createUsageScanner(home);
    const scan = await scanner.scan();
    expect(scan.facts).toHaveLength(5);
    expect(scan.quality.inheritedRecords).toBe(5);
    const pricing = { catalog: [], mappings: {}, updatedAt: '2026-09-28', source: 'test' };
    const query = { from: 1000, to: 1800, model: null, workspace: null, bucket: 'hour' };
    const result = aggregateUsage(scan, pricing, query);
    expect(result.totals).toMatchObject({
      input: 26, cacheRead: 23, cacheWrite: 31, output: 59,
      totalInput: 80, totalTokens: 139, requests: 5,
      cacheHitRate: 23 / 80, costUsd: null, costComplete: false,
    });
    expect(result.models.map((item) => item.model)).toEqual(['model/a', 'model/b', 'model/c']);
    expect(result.workspaces).toEqual([
      { id: 'workspace-a', label: 'demo-workspace' },
      { id: 'workspace-b', label: 'workspace-b' },
    ]);
    const filtered = aggregateUsage(scan, pricing, { ...query, model: 'model:model/a', workspace: 'workspace-b' });
    expect(filtered.totals.requests).toBe(1);
    expect(filtered.totals.output).toBe(7);
    expect((await scanner.scan()).facts).toHaveLength(5);
  });

  it('updates on append and removal while counting bad and truncated lines without exposing content', async () => {
    const home = join(root, 'change-home');
    const path = await wire(home, 'workspace', 'session', 'main', [
      ...tracked(1000, 'model', [1, 0, 0, 1]), '{invalid json',
    ]);
    const scanner = createUsageScanner(home);
    expect((await scanner.scan()).quality.badLines).toBe(1);
    await writeFile(path, `${tracked(2000, 'model', [2, 0, 0, 2]).map(JSON.stringify).join('\n')}\n{incomplete`);
    const changed = await scanner.scan();
    expect(changed.facts).toHaveLength(1);
    expect(changed.quality.truncatedTail).toBe(1);
    await rm(path);
    expect((await scanner.scan()).facts).toHaveLength(0);
  });
});

describe('fork source quality', () => {
  it('marks a missing fork source without recharging its copied prefix', async () => {
    const home = join(root, 'missing-source-home');
    await wire(home, 'workspace', 'fork', 'main', [
      ...tracked(1000, 'inherited', [10, 0, 0, 0]),
      { type: 'forked', agentId: 'main', time: 1100 },
      ...tracked(1200, 'new', [2, 0, 0, 1]),
    ]);
    await writeFile(join(home, 'sessions', 'workspace', 'fork', 'state.json'), JSON.stringify({
      forkedFrom: 'deleted-source', cwd: 'C:\\Fiction\\demo',
    }));
    const scan = await createUsageScanner(home).scan();
    expect(scan.facts.map((fact) => fact.modelId)).toEqual(['new']);
    expect(scan.quality.missingForkSources).toBe(1);
  });

  it('marks an unknown fork source while excluding inherited records', async () => {
    const home = join(root, 'unknown-source-home');
    await wire(home, 'workspace', 'fork', 'main', [
      ...tracked(1000, 'inherited', [10, 0, 0, 0]),
      { type: 'forked', agentId: 'main', time: 1100 },
      ...tracked(1200, 'new', [2, 0, 0, 1]),
    ]);
    const scan = await createUsageScanner(home).scan();
    expect(scan.facts.map((fact) => fact.modelId)).toEqual(['new']);
    expect(scan.quality.unknownForkSources).toBe(1);
    expect(scan.quality.inheritedRecords).toBe(1);
  });
});

describe('request model identity', () => {
  it('merges aliases by actual ID, separates a rebound alias, and keeps unknown usage unpriced', async () => {
    const home = join(root, 'identity-home');
    await wire(home, 'workspace', 'session', 'main', [
      ...tracked(1000, 'alias-a', [10, 0, 0, 1], 'main', 'actual-one'),
      ...tracked(1100, 'alias-b', [20, 0, 0, 2], 'main', 'actual-one'),
      ...tracked(1200, 'alias-a', [30, 0, 0, 3], 'main', 'actual-two'),
      usage(1300, 'orphan-alias', [40, 0, 0, 4]),
      ...tracked(1400, 'named-unresolved', [5, 0, 0, 1], 'main', 'unresolved'),
    ]);
    const scan = await createUsageScanner(home).scan();
    expect(scan.facts.map((fact) => fact.modelId))
      .toEqual(['actual-one', 'actual-one', 'actual-two', null, 'unresolved']);
    expect(scan.quality.unresolvedModels).toBe(1);
    const pricing = {
      catalog: [], mappings: { 'actual-one': { catalogKey: null, rates: { input: 1, output: 2 } } },
      source: 'test',
    };
    const query = { from: 1000, to: 1500, model: null, workspace: null, bucket: 'hour' };
    const data = aggregateUsage(scan, pricing, query);
    expect(data.models.map((model) => [model.id, model.aliases])).toEqual([
      ['unresolved', ['orphan-alias']],
      ['model:actual-one', ['alias-a', 'alias-b']],
      ['model:actual-two', ['alias-a']],
      ['model:unresolved', ['named-unresolved']],
    ]);
    expect(data.models.find((model) => model.id === 'model:actual-one').costUsd).toBe(36 / 1_000_000);
    expect(data.models.find((model) => model.id === 'unresolved').price).toBeNull();
    expect(aggregateUsage(scan, pricing, { ...query, model: 'model:actual-two' }).totals.requests).toBe(1);
    expect(aggregateUsage(scan, pricing, { ...query, model: 'unresolved' }).totals.requests).toBe(1);
    expect(data.modelOptions).toContainEqual({ id: 'model:unresolved', label: 'unresolved', modelId: 'unresolved' });
  });

  it('keeps a conflicted lane tainted until a step boundary', async () => {
    const home = join(root, 'taint-home');
    await wire(home, 'workspace', 'session', 'main', [
      llmRequest(999, 'same', 'first'), llmRequest(1000, 'same', 'second'),
      usage(1001, 'same', [1, 0, 0, 1]),
      ...tracked(1002, 'same', [2, 0, 0, 2], 'main', 'third'),
      { type: 'context.append_loop_event', agentId: 'main', event: { type: 'step.end' } },
      ...tracked(1003, 'same', [3, 0, 0, 3], 'main', 'third'),
    ]);
    const scan = await createUsageScanner(home).scan();
    expect(scan.facts.map((fact) => fact.modelId)).toEqual([null, null, 'third']);
    expect(scan.quality.unresolvedModels).toBe(2);
  });

  it('does not assign a second usage from leftover same-ID retry requests', async () => {
    const home = join(root, 'retry-identity-home');
    await wire(home, 'workspace', 'session', 'main', [
      llmRequest(999, 'alias', 'same-id'), llmRequest(1000, 'alias', 'same-id'),
      usage(1001, 'alias', [1, 0, 0, 1]), usage(1002, 'alias', [2, 0, 0, 2]),
      llmRequest(1003, 'alias', 'new-id'), usage(1004, 'alias', [3, 0, 0, 3]),
      { type: 'context.append_loop_event', agentId: 'main', event: { type: 'step.end' } },
      ...tracked(1005, 'alias', [4, 0, 0, 4], 'main', 'new-id'),
    ]);
    expect((await createUsageScanner(home).scan()).facts.map((fact) => fact.modelId))
      .toEqual(['same-id', null, null, 'new-id']);
  });

  it('accepts same-ID retries but taints after a bad line and resets at fork', async () => {
    const home = join(root, 'barrier-home');
    await wire(home, 'workspace', 'session', 'main', [
      llmRequest(999, 'alias', 'one'), llmRequest(1000, 'alias', 'one'),
      usage(1001, 'alias', [1, 0, 0, 1]),
      '{bad json', ...tracked(1002, 'alias', [2, 0, 0, 2], 'main', 'two'),
      { type: 'forked', agentId: 'main', time: 1003 },
      usage(1004, 'alias', [3, 0, 0, 3]),
      ...tracked(1005, 'alias', [4, 0, 0, 4], 'main', 'three'),
    ]);
    const wireData = await createUsageScanner(home).scan();
    expect(wireData.facts.map((fact) => fact.modelId)).toEqual([null, 'three']);
    expect(wireData.quality).toMatchObject({ badLines: 1, inheritedRecords: 2, unresolvedModels: 1 });
  });
});

describe('wire file boundaries', () => {
  it('does not follow a symlinked wire file', async (context) => {
    const home = join(root, 'link-home');
    const outside = join(root, 'outside-wire.jsonl');
    await writeFile(outside, `${JSON.stringify(usage(1000, 'secret-model', [8, 0, 0, 8]))}\n`);
    const dir = join(home, 'sessions', 'workspace', 'session', 'agents', 'main');
    await mkdir(dir, { recursive: true });
    try {
      await symlink(outside, join(dir, 'wire.jsonl'), 'file');
    } catch (error) {
      if (error.code === 'EPERM') context.skip();
      throw error;
    }
    expect((await createUsageScanner(home).scan()).facts).toEqual([]);
  });

  it('does not follow a linked agent directory', async () => {
    const home = join(root, 'agent-link-home');
    const source = join(root, 'outside-agent');
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'wire.jsonl'),
      `${JSON.stringify(usage(1000, 'secret-model', [8, 0, 0, 8]))}\n`);
    const dir = join(home, 'sessions', 'workspace', 'session', 'agents');
    await mkdir(dir, { recursive: true });
    await symlink(source, join(dir, 'linked-agent'), 'junction');
    expect((await createUsageScanner(home).scan()).facts).toEqual([]);
  });

  it('does not follow a symlinked agents container', async () => {
    const home = join(root, 'container-link-home');
    const source = join(root, 'outside-agents');
    await mkdir(join(source, 'main'), { recursive: true });
    await writeFile(join(source, 'main', 'wire.jsonl'),
      `${JSON.stringify(usage(1000, 'hidden', [1, 0, 0, 1]))}\n`);
    const sessionDir = join(home, 'sessions', 'workspace', 'session');
    await mkdir(sessionDir, { recursive: true });
    await symlink(source, join(sessionDir, 'agents'), 'junction');
    expect((await createUsageScanner(home).scan()).facts).toEqual([]);
  });
});

describe('pricing and query boundaries', () => {
  it('uses a per-request context tier and lets explicit zero or manual prices override it', () => {
    const pricing = {
      catalog: [{
        key: 'test/alpha', providerId: 'test', providerName: 'Test', modelId: 'alpha',
        rates: { input: 1, cacheRead: 0.1, cacheWrite: null, output: 2 },
        tiers: [{ threshold: 100, rates: { input: 3, cacheRead: null, cacheWrite: null, output: 4 } }],
      }],
      mappings: { alpha: { catalogKey: 'test/alpha', rates: { input: 0, cacheWrite: 5 } } },
      source: 'test',
    };
    const price = resolvedPrice('alpha', pricing);
    const short = costForRecord({ inputOther: 50, inputCacheRead: 0, inputCacheCreation: 0, output: 10 }, price);
    const long = costForRecord({ inputOther: 101, inputCacheRead: 0, inputCacheCreation: 2, output: 10 }, price);
    expect(short).toEqual({ costUsd: 20 / 1_000_000, unpricedTokens: 0 });
    expect(long).toEqual({ costUsd: 50 / 1_000_000, unpricedTokens: 0 });
  });

  it('persists manual-only mappings and distinguishes zero price from no price', async () => {
    const dir = join(root, 'pricing-home');
    const store = createPricingStore(dir, vi.fn(), () => Date.parse('2026-09-28T00:00:00Z'));
    await store.put({ model: 'custom/alias', catalogKey: null, rates: { input: 0, output: 2 } });
    const restored = createPricingStore(dir, vi.fn(), () => Date.parse('2026-09-28T00:00:00Z'));
    const pricing = await restored.get();
    const price = resolvedPrice('custom/alias', pricing);
    expect(price.rates.input).toBe(0);
    expect(price.rates.cacheRead).toBeNull();
    expect(costForRecord({ inputOther: 1, inputCacheRead: 1, inputCacheCreation: 0, output: 1 }, price))
      .toEqual({ costUsd: 2 / 1_000_000, unpricedTokens: 1 });
    expect((await readFile(join(dir, 'usage-pricing.json'), 'utf8'))).not.toContain('demo-token');
  });

  it('restores catalog pricing when an explicit manual mapping becomes empty', async () => {
    const dir = join(root, 'empty-rates-home');
    const store = createPricingStore(dir, vi.fn(), () => Date.parse('2026-09-28T00:00:00Z'));
    await store.put({ model: 'gpt-6-sol', catalogKey: 'openai/gpt-6-sol', rates: { input: 0 } });
    const pricing = await store.put({ model: 'gpt-6-sol', catalogKey: 'openai/gpt-6-sol', rates: {} });
    const price = resolvedPrice('gpt-6-sol', pricing);
    expect(price.rates.input).toBe(2);
    expect(price.custom).toBe(false);
    expect(price.source).toBe('OpenRouter built-in snapshot + models.dev curated snapshot');
    await expect(store.put({ model: 'gpt-6-sol', catalogKey: {}, rates: {} }))
      .rejects.toThrow('目录模型无效');
  });
});
describe('catalog refresh behavior', () => {
  it('keeps a concurrent manual mapping after one shared directory refresh', async () => {
    const dir = join(root, 'refresh-home');
    const seen = [];
    const fetchImpl = vi.fn(async (url, init) => {
      seen.push({ url, init });
      if (String(url).includes('models.dev')) {
        return Response.json({ test: { name: 'Test', models: {
          alpha: { cost: { input: 1, output: 2, cache_read: 0.1, tiers: [
            { input: 3, output: 4, tier: { type: 'context', size: 100 } },
          ] } },
        } } });
      }
      return Response.json({ data: [{ id: 'test/alpha', pricing: {
        prompt: '-1', completion: '0.000003', input_cache_read: '',
        overrides: [{ min_prompt_tokens: 100, prompt: '0.000004' }],
      } }] });
    });
    const store = createPricingStore(dir, fetchImpl, () => Date.parse('2026-09-28T01:00:00Z'));
    const [one, two] = await Promise.all([
      store.refresh(), store.refresh(),
      store.put({ model: 'manual-only', catalogKey: null, rates: { input: 0 } }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(one.mappings['manual-only']).toMatchObject({ catalogKey: null, rates: { input: 0 } });
    expect(two.catalog.find((item) => item.key === 'test/alpha').tiers[0].threshold).toBe(100);
    const restored = await createPricingStore(dir, vi.fn(), () => Date.parse('2026-09-28T01:00:00Z')).get();
    expect(restored.mappings['manual-only'].rates.input).toBe(0);
    const router = restored.catalog.find((item) => item.key === 'openrouter:test/alpha');
    expect(router.rates.input).toBeNull();
    expect(router.rates.cacheRead).toBeNull();
    expect(router.rates.output).toBe(3);
    const modelsDev = restored.catalog.find((item) => item.key === 'test/alpha');
    expect(modelsDev.tiers[0].rates.cacheRead).toBeNull();
    const routerPrice = resolvedPrice('test/alpha', {
      ...restored, mappings: { 'test/alpha': { catalogKey: router.key } },
    });
    const routerCost = costForRecord({
      inputOther: 101, inputCacheRead: 0, inputCacheCreation: 0, output: 10,
    }, routerPrice);
    expect(routerCost.costUsd).toBeCloseTo(434 / 1_000_000);
    expect(routerCost.unpricedTokens).toBe(0);
    expect(seen.every(({ init }) => init.headers.authorization === undefined)).toBe(true);
  });

  it('backs off automatic refresh retries for stale catalogs', async () => {
    const dir = join(root, 'retry-home');
    let now = Date.parse('2026-10-02T01:00:00Z');
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); });
    const store = createPricingStore(dir, fetchImpl, () => now);
    await store.get();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => expect((await store.get()).lastRefreshError).toContain('暂时无法连接'));
    await store.get();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    now += 30 * 60 * 1000 + 1;
    await store.get();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(4));
  });

});

describe('persisted pricing data', () => {
  it('isolates old alias mappings through save and restart without applying them', async () => {
    const dir = join(root, 'legacy-home');
    const path = join(dir, 'usage-pricing.json');
    await mkdir(dir, { recursive: true });
    const builtIn = await createPricingStore(join(root, 'snapshot-only'), vi.fn(),
      () => Date.parse('2026-09-28T00:00:00Z')).get();
    await writeFile(path, JSON.stringify({
      catalog: builtIn.catalog, mappings: {
        'gpt-6-sol': { catalogKey: null, rates: { input: 99 }, secret: 'do-not-persist' },
      }, updatedAt: '2026-09-28', source: 'old snapshot',
    }));
    const store = createPricingStore(dir, vi.fn(), () => Date.parse('2026-09-28T00:00:00Z'));
    expect(await store.get()).toMatchObject({ identityVersion: 1, legacyMappingsIgnored: 1, mappings: {} });
    expect(resolvedPrice('gpt-6-sol', await store.get()).rates.input).toBe(2);
    await store.refresh(); await store.put({ model: 'new-id', catalogKey: null, rates: { input: 1 } });
    const persisted = JSON.parse(await readFile(path, 'utf8'));
    expect(persisted.legacyAliasMappings['gpt-6-sol'].rates.input).toBe(99);
    expect(JSON.stringify(persisted)).not.toContain('do-not-persist');
    const restored = await createPricingStore(dir, vi.fn(), () => Date.parse('2026-09-28T00:00:00Z')).get();
    expect(restored).toMatchObject({ identityVersion: 1, legacyMappingsIgnored: 1 });
    expect(JSON.stringify(restored)).not.toContain('legacyAliasMappings');
    expect(restored.mappings).toHaveProperty('new-id');
    expect(restored.mappings).not.toHaveProperty('gpt-6-sol');
  });
  it('projects persisted catalog fields before returning or saving them', async () => {
    const dir = join(root, 'projection-home');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'usage-pricing.json'), JSON.stringify({
      catalog: [{
        key: 'test/alpha', providerId: 'test', providerName: 'Test', modelId: 'alpha', name: 'Alpha',
        rates: { input: 1, cacheRead: null, cacheWrite: null, output: 2, secret: 'private-value' },
        tiers: [{ threshold: 100, rates: {
          input: 3, cacheRead: null, cacheWrite: null, output: 4, secret: 'private-value',
        }, secret: 'private-value' }],
        secret: 'private-value',
      }],
      mappings: {}, updatedAt: '2026-09-28T00:00:00Z', source: 'test', secret: 'private-value',
    }));
    const store = createPricingStore(dir, vi.fn(), () => Date.parse('2026-09-28T01:00:00Z'));
    const data = await store.get();
    expect(JSON.stringify(data)).not.toContain('private-value');
    await store.put({ model: 'alpha', catalogKey: 'test/alpha', rates: {} });
    expect(await readFile(join(dir, 'usage-pricing.json'), 'utf8')).not.toContain('private-value');
  });

  it('retains the last successful catalog after refresh failure and rejects bad cache data', async () => {
    const dir = join(root, 'failure-home');
    const fetchImpl = vi.fn(async () => { throw new Error('offline with secret text'); });
    const store = createPricingStore(dir, fetchImpl, () => Date.parse('2026-09-28T01:00:00Z'));
    const failed = await store.refresh();
    expect(failed.catalog.some((item) => item.key === 'openai/gpt-6-sol')).toBe(true);
    expect(failed.lastRefreshError).toContain('暂时无法连接');
    expect(JSON.stringify(failed)).not.toContain('secret text');
    await writeFile(join(dir, 'usage-pricing.json'), JSON.stringify({
      catalog: [{ key: '__proto__' }], mappings: {}, updatedAt: '2026-09-28', source: 'spoof',
    }));
    const restored = await createPricingStore(dir, vi.fn(), () => Date.parse('2026-09-28T01:00:00Z')).get();
    expect(restored.source).toBe('OpenRouter built-in snapshot + models.dev curated snapshot');
  });
});

describe('pricing alias and query boundaries', () => {
  it('supports reserved model alias keys without changing mapping prototypes', async () => {
    const dir = join(root, 'reserved-home');
    const store = createPricingStore(dir, vi.fn(), () => Date.parse('2026-09-28T01:00:00Z'));
    const data = await store.put({ model: '__proto__', catalogKey: null, rates: { input: 0 } });
    expect(Object.hasOwn(data.mappings, '__proto__')).toBe(true);
    expect(resolvedPrice('__proto__', data).rates.input).toBe(0);
    expect(resolvedPrice('constructor', data)).toBeNull();
  });

  it('validates time ranges and retains half-open boundaries', () => {
    expect(parseUsageQuery('/?from=1000&to=2000&bucket=hour', 2000)).toMatchObject({
      from: 1000, to: 2000, bucket: 'hour',
    });
    expect(() => parseUsageQuery('/?from=2000&to=1000', 2000)).toThrow('时间范围');
    expect(() => parseUsageQuery('/?from=1000&to=2000&workspace=../bad', 2000)).toThrow('工作区');
    expect(() => parseUsageQuery('/?from=1000&to=2000&path=x', 2000)).toThrow('查询参数');
    const twoYears = 2 * 365 * 24 * 60 * 60 * 1000;
    expect(parseUsageQuery(`/?from=1000&to=${twoYears}&bucket=day`, twoYears))
      .toMatchObject({ from: 1000, to: twoYears, bucket: 'day' });
  });
});

describe('usage route', () => {
  it('requires target authentication and returns unavailable for untrusted targets', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const denied = fakeResponse();
    await serveUsage(fakeRequest('GET', '/__open-kimi-mobile/usage?from=1&to=2', undefined, ''),
      denied, 'http://127.0.0.1:1', null, fetchImpl);
    expect(denied.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
    const unavailable = fakeResponse();
    await serveUsage(fakeRequest('GET', '/__open-kimi-mobile/usage?from=1&to=2'),
      unavailable, 'http://127.0.0.1:1', null, fetchImpl);
    expect(JSON.parse(unavailable.body)).toMatchObject({ available: false, reason: 'unmanaged_target' });
    expect(fetchImpl.mock.calls[0][0].pathname).toBe('/api/v1/meta');
  });

  it('serves isolated official wire data after auth and does not echo token or contents', async () => {
    const home = join(root, 'route-home');
    await wire(home, 'workspace', 'session', 'main', tracked(1000, 'model', [5, 5, 0, 1]));
    const service = createUsageService({ usageHome: home, usageStorageDir: join(home, 'private-pricing') });
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const res = fakeResponse();
    await serveUsage(fakeRequest('GET', '/__open-kimi-mobile/usage?from=1000&to=2000&bucket=hour'),
      res, 'http://127.0.0.1:1', service, fetchImpl);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).totals).toMatchObject({ requests: 1, totalInput: 10, output: 1 });
    expect(res.body).not.toContain('demo-token');
    expect(res.body).not.toContain(home);
  });
});
