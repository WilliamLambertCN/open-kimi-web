import { createServer } from 'node:http';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createLauncher } from '../../packages/launcher/src/serve.mjs';

let root;
let upstream;
let upstreamUrl;
let lastMetaAuth;

beforeAll(async () => {
  const base = join(process.cwd(), '.tmp', 'usage-statistics');
  await mkdir(base, { recursive: true });
  root = await mkdtemp(join(base, 'launcher-it-'));
  upstream = createServer((req, res) => {
    if (req.url !== '/api/v1/meta') return res.writeHead(404).end();
    lastMetaAuth = req.headers.authorization ?? null;
    if (lastMetaAuth !== 'Bearer local-test-token') return res.writeHead(401).end();
    return res.writeHead(200, { 'content-type': 'application/json' }).end('{"code":0,"data":{}}');
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
});

afterAll(async () => {
  if (upstream) await new Promise((resolve) => upstream.close(resolve));
  if (root) await rm(root, { recursive: true, force: true });
});

function localFetch(url, init) {
  if (new URL(url).origin !== upstreamUrl) throw new Error('offline catalog fixture');
  return fetch(url, init);
}

async function launch({
  usageHome = null, officialPresentation = true,
  usageStorageDir = join(root, 'pricing'), usageFetch = localFetch,
} = {}) {
  const publicDir = join(root, 'web');
  await mkdir(publicDir, { recursive: true });
  await writeFile(join(publicDir, 'index.html'), '<html><body>custom web fixture</body></html>');
  return createLauncher({
    target: upstreamUrl, publicDir, officialPresentation,
    usageHome, usageStorageDir, usageFetch,
    host: '127.0.0.1', port: 0,
  });
}

function request(base, path, method = 'GET', body, token = 'local-test-token') {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function writeWire(home, workspace, session, agent, lines) {
  const dir = join(home, 'sessions', workspace, session, 'agents', agent);
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'wire.jsonl');
  await writeFile(path, `${lines.map((line) => typeof line === 'string' ? line : JSON.stringify(line)).join('\n')}\n`);
  return path;
}

function usage(time, model, inputOther, output, agentId = 'main') {
  return {
    type: 'usage.record', agentId, model, time,
    usageScope: 'turn',
    usage: { inputOther, inputCacheRead: 0, inputCacheCreation: 0, output },
  };
}

function llmRequest(time, alias, modelId = alias, agentId = 'main') {
  return {
    type: 'llm.request', agentId, modelAlias: alias,
    model: modelId, provider: 'openai', kind: 'loop', time,
  };
}

function tracked(time, alias, inputOther, output, { agentId = 'main', modelId = alias } = {}) {
  return [llmRequest(time - 1, alias, modelId, agentId), usage(time, alias, inputOther, output, agentId)];
}

function catalogFetch(mode) {
  return (url, init) => {
    const address = String(url);
    if (new URL(address).origin === upstreamUrl) return fetch(url, init);
    if (mode.status === 'offline') throw new Error('private backend detail');
    if (address === 'https://models.dev/api.json') {
      return Response.json({ test: { name: 'Test Provider', models: {
        alpha: { name: 'Alpha', cost: { input: 1, output: 2, tiers: [
          { input: 3, output: 4, tier: { type: 'context', size: 100 } },
        ] } },
      } } });
    }
    if (address === 'https://openrouter.ai/api/v1/models') {
      return Response.json({ data: [{ id: 'test/alpha', name: 'Alpha Router', pricing: {
        prompt: '0.000001', completion: '0.000002',
        overrides: [{ min_prompt_tokens: 100, prompt: '0.000004' }],
      } }] });
    }
    throw new Error('unexpected catalog URL');
  };
}

describe('launcher usage HTTP routes', () => {
  it('authenticates, serves isolated usage, and persists manual pricing through the launcher', async () => {
    const home = join(root, 'kimi-home');
    const agentDir = join(home, 'sessions', 'workspace-id', 'session-id', 'agents', 'main');
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, 'wire.jsonl'), [
      JSON.stringify(llmRequest(999, 'private-alias', 'private-model')),
      JSON.stringify({
        ...usage(1000, 'private-alias', 3, 4),
        usage: { inputOther: 3, inputCacheRead: 2, inputCacheCreation: 1, output: 4 },
        prompt: 'do not return this',
      }),
      '',
    ].join('\n'));
    const launcher = await launch({ usageHome: home });
    const usagePath = '/__open-kimi-mobile/usage?from=1000&to=2000&bucket=hour';
    try {
      expect((await request(launcher.url, usagePath, 'GET', undefined, null)).status).toBe(401);
      expect((await request(launcher.url, usagePath, 'GET', undefined, 'wrong')).status).toBe(401);
      const usage = await request(launcher.url, usagePath);
      expect(usage.status).toBe(200);
      expect(usage.headers.get('cache-control')).toBe('no-store');
      const body = await usage.text();
      expect(JSON.parse(body).totals).toMatchObject({ requests: 1, totalInput: 6, output: 4 });
      expect(body).not.toContain(home);
      expect(body).not.toContain('do not return this');
      expect(lastMetaAuth).toBe('Bearer local-test-token');

      const pricePath = '/__open-kimi-mobile/usage/pricing';
      const saved = await request(launcher.url, pricePath, 'PUT', {
        model: 'private-model', catalogKey: null, rates: { input: 0, output: 2 },
      });
      expect(saved.status).toBe(200);
      expect((await saved.json()).mappings['private-model'].rates).toEqual({ input: 0, output: 2 });
      const restored = await request(launcher.url, pricePath);
      expect((await restored.json()).mappings['private-model'].rates.output).toBe(2);
      expect(await readFile(join(root, 'pricing', 'usage-pricing.json'), 'utf8')).toContain('private-model');
    } finally {
      await launcher.close();
    }
  });

  it('returns unavailable for an authenticated unmanaged target', async () => {
    const launcher = await launch();
    try {
      const response = await request(launcher.url, '/__open-kimi-mobile/usage?from=1000&to=2000');
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ available: false, reason: 'unmanaged_target' });
    } finally {
      await launcher.close();
    }
  });

  it('keeps usage routes out of a custom web directory', async () => {
    const launcher = await launch({ usageHome: join(root, 'kimi-home'), officialPresentation: false });
    try {
      const response = await request(launcher.url, '/__open-kimi-mobile/usage?from=1000&to=2000');
      expect(response.headers.get('content-type')).toContain('text/html');
      const body = await response.text();
      expect(body).toContain('custom web fixture');
      expect(body).not.toContain('private-model');
    } finally {
      await launcher.close();
    }
  });
});

describe('launcher pricing catalog lifecycle', () => {
  it('refreshes a fixed catalog and applies models.dev and OpenRouter tiers to recorded requests', async () => {
    const home = join(root, 'catalog-home');
    const storage = join(root, 'catalog-pricing');
    await writeWire(home, 'workspace', 'session', 'main', [
      ...tracked(1000, 'alias-alpha', 50, 10, { modelId: 'alpha' }),
      ...tracked(2000, 'alias-alpha', 101, 10, { modelId: 'alpha' }),
    ]);
    const mode = { status: 'online' };
    const launcher = await launch({ usageHome: home, usageStorageDir: storage, usageFetch: catalogFetch(mode) });
    const pricePath = '/__open-kimi-mobile/usage/pricing';
    const usagePath = '/__open-kimi-mobile/usage?from=1000&to=3000&bucket=hour';
    try {
      const refreshed = await request(launcher.url, `${pricePath}:refresh`, 'POST');
      expect(refreshed.status).toBe(200);
      const catalog = await refreshed.json();
      expect(catalog.source).toBe('models.dev + OpenRouter');
      expect(catalog.catalog.map((item) => item.key)).toEqual(['test/alpha', 'openrouter:test/alpha']);

      const mapped = await request(launcher.url, pricePath, 'PUT', {
        model: 'alpha', catalogKey: 'test/alpha', rates: {},
      });
      expect(mapped.status).toBe(200);
      const direct = await (await request(launcher.url, usagePath)).json();
      expect(direct.totals.requests).toBe(2);
      expect(direct.totals.costUsd).toBeCloseTo(413 / 1_000_000);
      expect(direct.models[0].price.source).toBe('models.dev + OpenRouter');

      const routerMapping = await request(launcher.url, pricePath, 'PUT', {
        model: 'alpha', catalogKey: 'openrouter:test/alpha', rates: {},
      });
      expect(routerMapping.status).toBe(200);
      const routed = await (await request(launcher.url, usagePath)).json();
      expect(routed.totals.costUsd).toBeCloseTo(494 / 1_000_000);
      expect(routed.models[0].price.source).toBe('OpenRouter');

      mode.status = 'offline';
      const failed = await (await request(launcher.url, `${pricePath}:refresh`, 'POST')).json();
      expect(failed.lastRefreshError).toContain('暂时无法连接');
      expect(failed.catalog.map((item) => item.key)).toEqual(catalog.catalog.map((item) => item.key));
      expect(failed.mappings.alpha.catalogKey).toBe('openrouter:test/alpha');
      expect(JSON.stringify(failed)).not.toContain('private backend detail');
    } finally {
      await launcher.close();
    }

    const restarted = await launch({ usageHome: home, usageStorageDir: storage, usageFetch: catalogFetch(mode) });
    try {
      const restored = await (await request(restarted.url, pricePath)).json();
      expect(restored.lastRefreshError).toContain('暂时无法连接');
      expect(restored.mappings.alpha.catalogKey).toBe('openrouter:test/alpha');
      expect(restored.catalog.map((item) => item.key)).toEqual(['test/alpha', 'openrouter:test/alpha']);
      const usageResult = await (await request(restarted.url, usagePath)).json();
      expect(usageResult.totals.costUsd).toBeCloseTo(494 / 1_000_000);
    } finally {
      await restarted.close();
    }
  });
});

describe('launcher usage input errors', () => {
  it('rejects invalid queries, methods, JSON, prices, and unauthorized writes before persistence', async () => {
    const storage = join(root, 'errors-pricing');
    const launcher = await launch({ usageHome: join(root, 'catalog-home'), usageStorageDir: storage });
    const prefix = '/__open-kimi-mobile/usage';
    try {
      expect((await request(launcher.url, `${prefix}?from=2000&to=1000`)).status).toBe(400);
      expect((await request(launcher.url, `${prefix}?from=1000&to=2000&workspace=../other`)).status).toBe(400);
      expect((await request(launcher.url, `${prefix}?from=1000&to=2000`, 'POST')).status).toBe(405);
      const denied = await request(launcher.url, `${prefix}/pricing`, 'PUT', {
        model: 'denied', catalogKey: null, rates: { input: 1 },
      }, null);
      expect(denied.status).toBe(401);
      const malformed = await fetch(`${launcher.url}${prefix}/pricing`, {
        method: 'PUT', headers: { authorization: 'Bearer local-test-token' }, body: '{broken',
      });
      expect(malformed.status).toBe(400);
      const invalid = await request(launcher.url, `${prefix}/pricing`, 'PUT', {
        model: 'bad', catalogKey: null, rates: { input: -1 },
      });
      expect(invalid.status).toBe(400);
      const large = await fetch(`${launcher.url}${prefix}/pricing`, {
        method: 'PUT',
        headers: { authorization: 'Bearer local-test-token' },
        body: 'x'.repeat(1024 * 1024 + 1),
      });
      expect(large.status).toBe(413);
      const pricing = await (await request(launcher.url, `${prefix}/pricing`)).json();
      expect(pricing.mappings).toEqual({});
    } finally {
      await launcher.close();
    }
  });
});

describe('launcher identity confidence', () => {
  it('keeps incomplete and oversized request boundaries unresolved until a durable step end', async () => {
    const home = join(root, 'identity-errors-home');
    const longId = 'm'.repeat(256);
    await writeWire(home, 'workspace', 'session', 'main', [
      llmRequest(999, 'alias', 'before-bad-request'),
      { ...llmRequest(1000, 'alias', 'invalid'), model: null },
      usage(1001, 'alias', 1, 1),
      { type: 'context.append_loop_event', agentId: 'main', event: { type: 'step.end' } },
      llmRequest(1002, 'alias', 'before-bad-line'), '{bad json', usage(1003, 'alias', 2, 2),
      { type: 'context.append_loop_event', agentId: 'main', event: { type: 'step.end' } },
      llmRequest(1004, 'alias', 'before-oversized'), 'x'.repeat(1024 * 1024 + 1),
      usage(1005, 'alias', 3, 3),
      { type: 'context.append_loop_event', agentId: 'main', event: { type: 'step.end' } },
      ...tracked(1006, 'alias', 4, 4, { modelId: longId }),
    ]);
    const launcher = await launch({ usageHome: home, usageStorageDir: join(root, 'identity-errors-pricing') });
    const path = '/__open-kimi-mobile/usage?from=1000&to=2000&bucket=hour';
    try {
      const data = await (await request(launcher.url, path)).json();
      expect(data.totals.requests).toBe(4);
      expect(data.quality).toMatchObject({ unresolvedModels: 3, badLines: 1, oversizedLines: 1 });
      expect(data.models.find((model) => model.id === 'unresolved').aliases).toEqual(['alias']);
      const filtered = await (await request(launcher.url, `${path}&model=model%3A${longId}`)).json();
      expect(filtered.totals).toMatchObject({ requests: 1, input: 4, output: 4 });
      expect(filtered.models[0].modelId).toBe(longId);
    } finally {
      await launcher.close();
    }
  });

  it('matches session usage only to compaction requests and never borrows loop identity', async () => {
    const home = join(root, 'compaction-home');
    await writeWire(home, 'workspace', 'session', 'main', [
      { ...llmRequest(999, 'alias', 'compaction-id'), kind: 'compaction' },
      { ...usage(1000, 'alias', 2, 1), usageScope: 'session' },
      llmRequest(1001, 'alias', 'loop-id'),
      { ...usage(1002, 'alias', 3, 1), usageScope: 'session' },
    ]);
    const launcher = await launch({ usageHome: home, usageStorageDir: join(root, 'compaction-pricing') });
    try {
      const data = await (await request(launcher.url,
        '/__open-kimi-mobile/usage?from=1000&to=2000&bucket=hour')).json();
      expect(data.models.map((model) => model.id)).toEqual(['unresolved', 'model:compaction-id']);
      expect(data.quality.unresolvedModels).toBe(1);
    } finally {
      await launcher.close();
    }
  });
});

describe('launcher wire lifecycle', () => {
  it('shows fork deduplication and parse quality, then observes append and source removal', async () => {
    const home = join(root, 'lifecycle-home');
    const original = tracked(1000, 'alpha', 10, 2);
    await writeWire(home, 'workspace', 'original', 'main', [...original, '{bad json']);
    await writeWire(home, 'workspace', 'fork', 'main', [
      ...original, { type: 'forked', agentId: 'main', time: 1100 }, ...tracked(1200, 'beta', 3, 4),
    ]);
    const sidePath = await writeWire(home, 'workspace', 'fork', 'side',
      tracked(1300, 'gamma', 2, 1, { agentId: 'side' }));
    await writeFile(join(home, 'sessions', 'workspace', 'fork', 'state.json'), JSON.stringify({
      forkedFrom: 'original', cwd: 'C:\\Fiction\\private-workspace',
    }));
    const launcher = await launch({ usageHome: home, usageStorageDir: join(root, 'lifecycle-pricing') });
    const path = '/__open-kimi-mobile/usage?from=1000&to=2000&bucket=hour';
    try {
      const first = await (await request(launcher.url, path)).json();
      expect(first.totals).toMatchObject({ requests: 3, input: 15, output: 7 });
      expect(first.quality).toMatchObject({ inheritedRecords: 1, badLines: 1, missingForkSources: 0 });
      expect(first.workspaces).toEqual([{ id: 'workspace', label: 'private-workspace' }]);
      expect(JSON.stringify(first)).not.toContain('C:\\Fiction');
      const added = tracked(1400, 'gamma', 4, 2, { agentId: 'side' });
      await appendFile(sidePath, `${added.map((line) => JSON.stringify(line)).join('\n')}\n`);
      const appended = await (await request(launcher.url, path)).json();
      expect(appended.totals).toMatchObject({ requests: 4, input: 19, output: 9 });
      await rm(join(home, 'sessions', 'workspace', 'original'), { recursive: true, force: true });
      const removed = await (await request(launcher.url, path)).json();
      expect(removed.totals).toMatchObject({ requests: 3, input: 9, output: 7 });
      expect(removed.quality).toMatchObject({ badLines: 0, inheritedRecords: 1, missingForkSources: 1 });
    } finally {
      await launcher.close();
    }
  });
});
