import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const apiSource = readFileSync(new URL('../src/mobile/mobileSubagentModelApi.js', import.meta.url), 'utf8');
const poolSource = readFileSync(new URL('../src/mobile/subagentPoolApi.js', import.meta.url), 'utf8');
const envelope = (data) => new Response(JSON.stringify({
  code: 0, msg: 'success', data, request_id: 'fixture',
}), { status: 200 });
const wireConfig = (section) => ({
  default_model: 'fixture/main', default_permission_mode: 'manual', hooks: ['fixture'],
  providers: {}, secondary_model: section,
});
const catalogItem = (alias, extra = {}) => ({
  model: alias, capabilities: ['thinking'], support_efforts: ['low', 'medium', 'high'], ...extra,
});
const modelInfo = (alias, extra = {}) => ({
  id: alias, capabilities: ['thinking'], supportEfforts: ['low', 'medium', 'high'], ...extra,
});
const poolCatalog = (...aliases) => aliases.map((alias) => modelInfo(alias));
const requestMethods = (nativeFetch) => nativeFetch.mock.calls
  .map(([path, options]) => `${options?.method ?? 'GET'} ${path}`);
const postBodies = (nativeFetch) => nativeFetch.mock.calls
  .filter(([, options]) => options?.method === 'POST')
  .map(([, options]) => JSON.parse(options.body));

function install() {
  const queue = [];
  const nativeFetch = vi.fn(async (resource, options) => {
    if (options?.signal?.aborted) throw new Error('fixture aborted');
    return queue.length ? queue.shift() : envelope({});
  });
  class XHR {}
  XHR.prototype.open = vi.fn();
  XHR.prototype.setRequestHeader = vi.fn();
  const window = { fetch: nativeFetch, XMLHttpRequest: XHR };
  const context = {
    window, URL, Request, Headers, Response, Symbol,
    location: { href: 'https://example.test/', origin: 'https://example.test' },
    localStorage: { getItem: vi.fn(), setItem: vi.fn() }, console: { log: vi.fn(), error: vi.fn() },
  };
  runInNewContext(apiSource, context);
  runInNewContext(poolSource, context);
  const authorize = () => window.fetch('/api/v1/meta', { headers: { authorization: 'Bearer fixture-token' } });
  const serve = (section, ...aliases) => {
    queue.push(envelope(wireConfig(section)), envelope({ items: aliases.map((alias) => catalogItem(alias)) }));
  };
  return {
    ...context, nativeFetch, queue, authorize, serve,
    api: window.__okwSubagentPoolApi, subagent: window.__okwMobileSubagentApi,
  };
}

async function mismatchRun(mutate) {
  const ui = install();
  await ui.authorize();
  const base = { defaultModel: 'a', defaultEffort: 'medium', models: { a: 'A', b: 'B' } };
  ui.serve(base, 'a', 'b');
  ui.queue.push(envelope(wireConfig({ defaultModel: 'bogus', models: { bogus: 'echo' } })));
  const readBack = structuredClone(base);
  mutate(readBack);
  ui.serve(readBack, 'a', 'b');
  const draft = ui.api.draftFor(base);
  draft.entries.set('a', 'A new');
  await expect(ui.api.save(draft)).rejects.toThrow('saveMismatch');
}

describe('subagent pool drafts', () => {
  it('snapshots explicit pools with underscore aliases and multiline descriptions without touching input', () => {
    const { api } = install();
    const section = {
      defaultModel: 'fixture/under_score_9',
      defaultEffort: 'medium',
      models: { 'fixture/under_score_9': 'line one\nline two', 'fixture/blank': '' },
    };
    const snapshot = structuredClone(section);
    const draft = api.draftFor(section);
    expect(draft.base).toBe(section);
    expect(draft.defaultModel).toBe('fixture/under_score_9');
    expect([...draft.entries]).toEqual([['fixture/under_score_9', 'line one\nline two'], ['fixture/blank', '']]);
    expect(api.changed(draft)).toBe(false);
    expect(section).toEqual(snapshot);
  });
  it('exposes the legacy single model and implicit default as one retained candidate', () => {
    const { api } = install();
    for (const section of [{ model: 'fixture/legacy_pool' }, { defaultModel: 'fixture/implicit_pool' }]) {
      const draft = api.draftFor(section);
      const alias = section.model ?? section.defaultModel;
      expect([...draft.entries]).toEqual([[alias, '']]);
      expect(draft.defaultModel).toBe(alias);
      expect(api.changed(draft)).toBe(false);
    }
    const following = api.draftFor(undefined);
    expect(following.entries.size).toBe(0);
    expect(following.defaultModel).toBe('');
    expect(api.changed(following)).toBe(false);
  });
  it('accepts the whole authenticated payload as the draft base', () => {
    const { api } = install();
    const payload = { section: { defaultModel: 'a', models: { a: 'A' } }, models: [modelInfo('a')] };
    const draft = api.draftFor(payload);
    expect(draft.base).toBe(payload);
    expect(draft.defaultModel).toBe('a');
    expect([...draft.entries]).toEqual([['a', 'A']]);
    expect(api.changed(draft)).toBe(false);
  });
  it('reports changed only against the base effective pool and default', () => {
    const { api } = install();
    const draft = api.draftFor({ defaultModel: 'a', models: { a: 'A', b: 'B' } });
    expect(api.changed(draft)).toBe(false);
    draft.entries.set('a', 'edited');
    expect(api.changed(draft)).toBe(true);
    draft.entries.set('a', 'A');
    expect(api.changed(draft)).toBe(false);
    draft.entries.set('c', '');
    expect(api.changed(draft)).toBe(true);
    draft.entries.delete('c');
    draft.defaultModel = 'b';
    expect(api.changed(draft)).toBe(true);
    draft.defaultModel = 'a';
    expect(api.changed(draft)).toBe(false);
  });
});

describe('subagent pool patches', () => {
  it('emits an inner camel-case models patch without resending defaultEffort or defaultModel', () => {
    const { api } = install();
    const section = { defaultModel: 'a', defaultEffort: 'medium', models: { a: 'first', b: 'second' } };
    const draft = api.draftFor(section);
    draft.entries.set('a', 'keep me\nand more');
    expect(api.patchFor(draft, { section, models: poolCatalog('a', 'b') }))
      .toEqual({ models: { a: 'keep me\nand more' } });
  });
  it('keeps underscore aliases verbatim with blank or multiline descriptions', () => {
    const { api } = install();
    const section = { defaultModel: 'fixture/under_score_9', models: { 'fixture/under_score_9': '' } };
    const draft = api.draftFor(section);
    draft.entries.set('fixture/second_alias', 'multi\nline');
    draft.entries.set('fixture/blank_alias', '');
    const latest = {
      section,
      models: poolCatalog('fixture/under_score_9', 'fixture/second_alias', 'fixture/blank_alias'),
    };
    expect(api.patchFor(draft, latest)).toEqual({
      models: { 'fixture/second_alias': 'multi\nline', 'fixture/blank_alias': '' },
    });
  });
  it('keeps the implicit default candidate when an implicit or legacy section turns explicit', () => {
    const { api } = install();
    const legacy = { model: 'fixture/under_score' };
    const draft = api.draftFor(legacy);
    draft.entries.set('fixture/second', '');
    const models = poolCatalog('fixture/under_score', 'fixture/second');
    expect(api.patchFor(draft, { section: legacy, models })).toEqual({
      defaultModel: 'fixture/under_score',
      models: { 'fixture/second': '', 'fixture/under_score': '' },
    });
    const implicit = { defaultModel: 'fixture/under_score' };
    const implicitDraft = api.draftFor(implicit);
    implicitDraft.entries.set('fixture/second', '');
    expect(api.patchFor(implicitDraft, { section: implicit, models }))
      .toEqual({ models: { 'fixture/second': '', 'fixture/under_score': '' } });
    const gone = { model: 'fixture/gone_alias' };
    const goneDraft = api.draftFor(gone);
    goneDraft.entries.set('fixture/second', '');
    expect(() => api.patchFor(goneDraft, { section: gone, models: poolCatalog('fixture/second') }))
      .toThrow('modelMissing');
  });
  it('sends defaultModel only when the draft default moved and converges silently', () => {
    const { api } = install();
    const base = { defaultModel: 'a', models: { a: '', b: '' } };
    const draft = api.draftFor(base);
    draft.defaultModel = 'b';
    expect(api.patchFor(draft, { section: base, models: poolCatalog('a', 'b') })).toEqual({ defaultModel: 'b' });
    const moved = { defaultModel: 'b', models: { a: '', b: '' } };
    expect(api.patchFor(draft, { section: moved, models: poolCatalog('a', 'b') })).toBeNull();
  });
  it('treats a concurrent same-value description as already applied', () => {
    const { api } = install();
    const base = { defaultModel: 'a', models: { a: 'raw' } };
    const draft = api.draftFor(base);
    draft.entries.set('a', 'same');
    expect(api.changed(draft)).toBe(true);
    const arrived = { defaultModel: 'a', models: { a: 'same' } };
    expect(api.patchFor(draft, { section: arrived, models: poolCatalog('a') })).toBeNull();
  });
  it('handles pools larger than twenty-one candidates with incremental patches only', () => {
    const { api } = install();
    const aliases = Array.from({ length: 21 }, (unused, index) => `fixture/pool_${index}`);
    const models = {};
    aliases.forEach((alias, index) => { models[alias] = `description ${index}`; });
    const section = { defaultModel: aliases[0], models };
    const draft = api.draftFor(section);
    expect(draft.entries.size).toBe(21);
    draft.entries.set('fixture/pool_21', '');
    draft.entries.set(aliases[4], 'edited');
    expect(api.patchFor(draft, { section, models: poolCatalog(...aliases, 'fixture/pool_21') })).toEqual({
      models: { 'fixture/pool_21': '', 'fixture/pool_4': 'edited' },
    });
  });
});

describe('subagent pool patch rejections', () => {
  it('requires a pool default when writing the first candidates over a following config', () => {
    const { api } = install();
    const draft = api.draftFor(undefined);
    draft.entries.set('a', '');
    expect(() => api.patchFor(draft, { section: undefined, models: poolCatalog('a') })).toThrow('modelMissing');
    draft.defaultModel = 'a';
    expect(api.patchFor(draft, { section: undefined, models: poolCatalog('a') }))
      .toEqual({ defaultModel: 'a', models: { a: '' } });
  });
  it('rejects drafts that drop an original candidate including implicit ones', () => {
    const { api } = install();
    const section = { defaultModel: 'a', models: { a: 'A', b: 'B' } };
    const dropped = api.draftFor(section);
    dropped.entries.delete('a');
    expect(() => api.patchFor(dropped, { section, models: poolCatalog('a', 'b') })).toThrow('cannotRemove');
    const legacyDraft = api.draftFor({ model: 'fixture/legacy_pool' });
    legacyDraft.entries.delete('fixture/legacy_pool');
    expect(() => api.patchFor(legacyDraft, { section: { model: 'fixture/legacy_pool' }, models: [] }))
      .toThrow('cannotRemove');
  });
  it('rejects a new alias or a moved default that the latest catalog cannot resolve', () => {
    const { api } = install();
    const section = { defaultModel: 'a', models: { a: '', ghost: 'keep' } };
    const draft = api.draftFor(section);
    draft.entries.set('ghost2', '');
    expect(() => api.patchFor(draft, { section, models: poolCatalog('a') })).toThrow('modelMissing');
    draft.entries.delete('ghost2');
    draft.defaultModel = 'ghost';
    expect(() => api.patchFor(draft, { section, models: poolCatalog('a') })).toThrow('modelMissing');
    draft.defaultModel = 'a';
    expect(api.patchFor(draft, { section, models: poolCatalog('a') })).toBeNull();
  });
  it('rejects new candidates that cannot carry the retained default effort', () => {
    const { api } = install();
    const section = { defaultModel: 'a', defaultEffort: 'medium', models: { a: '' } };
    const draft = api.draftFor(section);
    draft.entries.set('strict', '');
    const strict = [...poolCatalog('a'), modelInfo('strict', { supportEfforts: ['low'] })];
    expect(() => api.patchFor(draft, { section, models: strict })).toThrow('effortUnsupported');
    draft.entries.delete('strict');
    draft.entries.set('wide', '');
    const wide = [...poolCatalog('a'), modelInfo('wide', { supportEfforts: ['medium', 'high'] })];
    expect(api.patchFor(draft, { section, models: wide })).toEqual({ models: { wide: '' } });
    draft.entries.set('open_ended', '');
    const open = [...poolCatalog('a', 'wide'), modelInfo('open_ended', { supportEfforts: [] })];
    expect(api.patchFor(draft, { section, models: open })).toEqual({ models: { wide: '', open_ended: '' } });
  });
  it('reports configChanged for concurrent same-item, same-alias and default changes', () => {
    const { api } = install();
    const base = { defaultModel: 'a', models: { a: 'base', b: 'keep' } };
    const edited = api.draftFor(base);
    edited.entries.set('a', 'mine');
    const rival = { defaultModel: 'a', models: { a: 'theirs', b: 'keep' } };
    expect(() => api.patchFor(edited, { section: rival, models: poolCatalog('a', 'b') })).toThrow('configChanged');
    const added = api.draftFor(base);
    added.entries.set('c', 'mine');
    const rivalAdded = { defaultModel: 'a', models: { a: 'base', b: 'keep', c: 'theirs' } };
    const rivalModels = poolCatalog('a', 'b', 'c');
    expect(() => api.patchFor(added, { section: rivalAdded, models: rivalModels })).toThrow('configChanged');
    const moved = api.draftFor(base);
    moved.defaultModel = 'b';
    const rivalDefault = { defaultModel: 'c', models: { a: 'base', b: 'keep', c: 'theirs' } };
    expect(() => api.patchFor(moved, { section: rivalDefault, models: rivalModels })).toThrow('configChanged');
    expect(api.patchFor(moved, { section: rivalAdded, models: rivalModels })).toEqual({ defaultModel: 'b' });
    const converged = { defaultModel: 'b', models: { a: 'base', b: 'keep' } };
    expect(api.patchFor(moved, { section: converged, models: poolCatalog('a', 'b') })).toBeNull();
  });
  it('reports configChanged instead of reviving candidates removed since the draft', () => {
    const { api } = install();
    const base = { defaultModel: 'a', models: { a: 'A', b: 'B' } };
    const cleared = { defaultModel: 'c', models: { c: 'theirs' } };
    const draft = api.draftFor(base);
    draft.entries.set('a', 'edited');
    expect(() => api.patchFor(draft, { section: cleared, models: poolCatalog('c') })).toThrow('configChanged');
    expect(() => api.patchFor(api.draftFor(base), { section: undefined, models: [] })).toThrow('configChanged');
  });
});

describe('subagent pool save round trips', () => {
  it('re-reads twice, posts one outer secondary_model patch and ignores the POST echo', async () => {
    const ui = install();
    await ui.authorize();
    const section = { defaultModel: 'a', defaultEffort: 'medium', models: { a: 'A', b: 'B' } };
    ui.serve(section, 'a', 'b');
    ui.queue.push(envelope(wireConfig({ defaultModel: 'bogus', models: { bogus: 'echo' } })));
    const readBack = { defaultModel: 'a', defaultEffort: 'medium', models: { a: 'A\nnew', b: 'B' } };
    ui.serve(readBack, 'a', 'b');
    const draft = ui.api.draftFor(section);
    draft.entries.set('a', 'A\nnew');
    const result = await ui.api.save(draft);
    expect(requestMethods(ui.nativeFetch)).toEqual([
      'GET /api/v1/meta', 'GET /api/v1/config', 'GET /api/v1/models',
      'POST /api/v1/config', 'GET /api/v1/config', 'GET /api/v1/models',
    ]);
    expect(postBodies(ui.nativeFetch)).toEqual([{ secondary_model: { models: { a: 'A\nnew' } } }]);
    expect(result.section).toEqual(readBack);
  });
  it('does not post an unchanged draft even after the pool changed underneath', async () => {
    const ui = install();
    await ui.authorize();
    const section = { defaultModel: 'a', models: { a: 'A', b: 'B' } };
    ui.serve(section, 'a', 'b');
    ui.serve({ defaultModel: 'c', models: { c: 'theirs' } }, 'c');
    const result = await ui.api.save(ui.api.draftFor(section));
    expect(requestMethods(ui.nativeFetch)).toEqual(['GET /api/v1/meta', 'GET /api/v1/config', 'GET /api/v1/models']);
    expect(result.section).toEqual(section);
    expect(ui.queue.length).toBe(2);
  });
  it('rejects read-back drift in description, default, effort or a lost candidate', async () => {
    await mismatchRun((readBack) => { readBack.models.a = 'A'; });
    await mismatchRun((readBack) => { readBack.defaultModel = 'b'; });
    await mismatchRun((readBack) => { readBack.defaultEffort = 'high'; });
    await mismatchRun((readBack) => { delete readBack.models.b; });
  });
  it('rejects a server rewrite of a description the draft never touched', async () => {
    await mismatchRun((readBack) => {
      readBack.models.a = 'A new';
      readBack.models.b = 'rewritten by server';
    });
  });
});

describe('2.8.0 subagent pool preservation', () => {
  it('keeps ordinary primary, all candidates and thinking effort after an incremental real-shape edit', async () => {
    const ui = install();
    ui.queue.push(envelope({ server_version: '2.8.0' }));
    await ui.authorize();
    const section = { defaultModel: 'primary', defaultEffort: 'high', models: { primary: 'Primary alias', fast: 'Keep fast' } };
    ui.serve(section, 'primary', 'fast', 'extra');
    const readBack = { defaultModel: 'fast', defaultEffort: 'high',
      models: { primary: 'Primary alias', fast: 'Updated fast', extra: 'Extra candidate' } };
    ui.queue.push(envelope(wireConfig(readBack)));
    ui.serve(readBack, 'primary', 'fast', 'extra');
    const draft = ui.api.draftFor(section);
    draft.defaultModel = 'fast';
    draft.entries.set('fast', 'Updated fast');
    draft.entries.set('extra', 'Extra candidate');
    await expect(ui.api.save(draft)).resolves.toMatchObject({ section: readBack });
    expect(postBodies(ui.nativeFetch)).toEqual([{ secondary_model: { defaultModel: 'fast',
      models: { fast: 'Updated fast', extra: 'Extra candidate' } } }]);
    expect(ui.localStorage.setItem).not.toHaveBeenCalled();
  });
});

describe('subagent pool concurrent preservation', () => {
  it('preserves concurrently added candidates and the latest effort without resending them', async () => {
    const ui = install();
    await ui.authorize();
    const base = { defaultModel: 'a', defaultEffort: 'high', models: { a: '', b: '' } };
    ui.serve(base, 'a', 'b');
    ui.queue.push(envelope(wireConfig({ defaultModel: 'bogus' })));
    const readBack = { defaultModel: 'a', defaultEffort: 'high', models: { a: '', b: 'mine', z: 'theirs' } };
    ui.serve(readBack, 'a', 'b', 'z');
    const draft = ui.api.draftFor(base);
    draft.entries.set('b', 'mine');
    const result = await ui.api.save(draft);
    expect(postBodies(ui.nativeFetch)).toEqual([{ secondary_model: { models: { b: 'mine' } } }]);
    expect(result.section.models.z).toBe('theirs');
    expect(result.section.defaultEffort).toBe('high');
  });
  it('keeps unknown existing candidates untouched in the patch and intact in the read-back', async () => {
    const ui = install();
    await ui.authorize();
    const section = { defaultModel: 'a', models: { a: '', gone_alias: 'still here' } };
    ui.serve(section, 'a');
    ui.queue.push(envelope(wireConfig(section)));
    ui.serve({ defaultModel: 'a', models: { a: 'edited', gone_alias: 'still here' } }, 'a');
    const draft = ui.api.draftFor(section);
    draft.entries.set('a', 'edited');
    const result = await ui.api.save(draft);
    expect(postBodies(ui.nativeFetch)).toEqual([{ secondary_model: { models: { a: 'edited' } } }]);
    expect(result.section.models.gone_alias).toBe('still here');
  });
});

describe('subagent pool cancellation and metadata gate', () => {
  it('never posts when the signal aborts before or during the write', async () => {
    const ui = install();
    await ui.authorize();
    const section = { defaultModel: 'a', models: { a: '' } };
    const draft = ui.api.draftFor(section);
    draft.entries.set('b', '');
    const early = new AbortController();
    early.abort();
    await expect(ui.api.save(draft, early.signal)).rejects.toThrow('requestFailed');
    expect(postBodies(ui.nativeFetch)).toEqual([]);
    const late = install();
    await late.authorize();
    const controller = new AbortController();
    late.serve(section, 'a', 'b');
    late.nativeFetch.mockImplementation(async (resource, options) => {
      if (options?.signal?.aborted) throw new Error('fixture aborted');
      if (options?.method === 'POST') controller.abort();
      return late.queue.length ? late.queue.shift() : envelope({});
    });
    late.queue.push(envelope(wireConfig(section)));
    await expect(late.api.save(draft, controller.signal)).rejects.toThrow('requestFailed');
    expect(postBodies(late.nativeFetch)).toHaveLength(1);
  });
  it.each(['2.6.1', '2.7.2', '2.8.0'])('allows ordinary primary candidates on verified %s', async (version) => {
    const ui = install();
    ui.queue.push(envelope({ server_version: version }));
    await ui.authorize();
    const draft = ui.api.draftFor(undefined);
    draft.entries.set('primary', '');
    draft.defaultModel = 'primary';
    ui.serve(undefined, 'primary');
    ui.queue.push(envelope(wireConfig({ defaultModel: 'primary' })));
    const readBack = { defaultModel: 'primary', models: { primary: '' } };
    ui.serve(readBack, 'primary');
    await expect(ui.api.save(draft)).resolves.toMatchObject({ section: readBack });
    expect(postBodies(ui.nativeFetch)).toEqual([{ secondary_model: { defaultModel: 'primary', models: { primary: '' } } }]);
    const locked = install();
    await locked.authorize();
    await expect(locked.api.save(draft)).rejects.toThrow('modelMissing');
    expect(postBodies(locked.nativeFetch)).toEqual([]);
  });
});

describe('subagent pool proto safety and interface surface', () => {
  it('carries a __proto__ candidate through the draft, the POST body and the read-back', async () => {
    const ui = install();
    await ui.authorize();
    const base = JSON.parse('{"defaultModel":"__proto__","models":{"__proto__":"legacy","a":"A"}}');
    ui.serve(base, 'a');
    ui.queue.push(envelope(wireConfig(base)));
    const readBack = JSON.parse('{"defaultModel":"__proto__","models":{"__proto__":"legacy","a":"new"}}');
    ui.serve(readBack, 'a');
    const draft = ui.api.draftFor(base);
    expect(draft.defaultModel).toBe('__proto__');
    expect(draft.entries.get('__proto__')).toBe('legacy');
    draft.entries.set('a', 'new');
    const result = await ui.api.save(draft);
    expect(postBodies(ui.nativeFetch)).toEqual([{ secondary_model: { models: { a: 'new' } } }]);
    expect(result.section.models.__proto__).toBe('legacy');
    const implicitOnly = JSON.parse('{"defaultModel":"__proto__"}');
    const protoDraft = ui.api.draftFor(implicitOnly);
    protoDraft.entries.set('b', '');
    const body = ui.api.patchFor(protoDraft, { section: implicitOnly, models: poolCatalog('__proto__', 'b') });
    expect(body).toEqual({ models: { b: '', ['__proto__']: '' } });
    expect(Object.keys(JSON.parse(JSON.stringify(body)).models)).toEqual(['b', '__proto__']);
  });
  it('locks the public surface and reuses the shared helpers by reference', () => {
    const ui = install();
    expect(Object.keys(ui.api)).toEqual(['load', 'draftFor', 'changed', 'patchFor', 'save']);
    expect(ui.api.load).toBe(ui.subagent.load);
    expect(ui.subagent.supportedEffort).toBeTypeOf('function');
    expect(ui.window[Symbol.for('open-kimi-web.subagent-pool-api')]).toBe(true);
  });
});
