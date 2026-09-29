import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const apiLogic = readFileSync(new URL('../src/mobile/usageApi.js', import.meta.url), 'utf8');
const view = readFileSync(new URL('../src/mobile/usageView.js', import.meta.url), 'utf8');
const trend = readFileSync(new URL('../src/mobile/usageTrend.js', import.meta.url), 'utf8');
const controllers = readFileSync(new URL('../src/mobile/usageControllers.js', import.meta.url), 'utf8');
const logic = readFileSync(new URL('../src/mobile/usage.js', import.meta.url), 'utf8');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.style = {};
    this.hidden = false;
    this.inert = false;
    this.disabled = false;
    this.checked = false;
    this.value = '';
    this.textContent = '';
    this.isConnected = true;
    this.classList = {
      toggle: (name, enabled) => { this.toggled = { name, enabled }; },
      contains: (name) => this.className?.split(' ').includes(name) ?? false,
      add: () => {}, remove: () => {},
    };
  }

  append(...items) {
    for (const item of items) { item.parentElement = this; this.children.push(item); }
  }

  prepend(item) { item.parentElement = this; this.children.unshift(item); }
  before(item) {
    const siblings = this.parentElement.children;
    item.parentElement = this.parentElement;
    siblings.splice(siblings.indexOf(this), 0, item);
  }
  remove() {
    const siblings = this.parentElement?.children;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.isConnected = false;
  }
  get nextElementSibling() {
    const siblings = this.parentElement?.children ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); }
  dispatch(type) {
    for (const callback of this.listeners[type] ?? []) callback({ target: this, currentTarget: this });
  }
  focus() { Element.active = this; Element.activeDoc.activeElement = this; }
  get options() { return this.children.filter((child) => child.tagName === 'OPTION'); }
  get childElementCount() { return this.children.length; }
  contains(target) { return this === target || this.children.some((child) => child.contains(target)); }

  querySelectorAll(selector) {
    const found = [];
    const match = (item) => {
      if (selector === '[data-preset]') return item.dataset.preset !== undefined;
      if (selector === ':scope > .newrow') return item.parentElement === this && item.className === 'newrow';
      if (selector === 'button, input, select, summary, [tabindex]') {
        return ['BUTTON', 'INPUT', 'SELECT', 'SUMMARY'].includes(item.tagName);
      }
      const usage = selector.match(/^\[data-usage="([^"]+)"\]$/);
      return usage && item.dataset.usage === usage[1];
    };
    const walk = (parent) => {
      for (const item of parent.children) {
        if (match(item)) found.push(item);
        walk(item);
      }
    };
    walk(this);
    return found;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

const summary = (model = 'custom-long-model-name') => ({
  input: 400, cacheRead: 600, cacheWrite: 100, output: 200,
  totalInput: 1100, totalTokens: 1300, requests: 2,
  cacheHitRate: 600 / 1100, costUsd: 0.002, costComplete: false,
  unpricedRequests: 1, unpricedTokens: 200,
  id: `model:${model}`, model, modelId: model, aliases: ['friendly-alias'],
});

const usageResponse = (model = 'custom-long-model-name') => ({
  available: true,
  totals: summary(model),
  models: [{ ...summary(model), price: null }],
  buckets: [{ ...summary(model), time: Date.now() - 3600000 }],
  modelOptions: [{ id: `model:${model}`, label: model, modelId: model }],
  workspaces: [{ id: 'ws_demo', label: 'Demo workspace' }],
  quality: { notes: [] }, pricing: {},
});

const pricingResponse = () => ({
  catalog: [], mappings: {}, identityVersion: 1, legacyMappingsIgnored: 0,
  updatedAt: null, source: 'built-in', lastRefreshError: null,
});

const manyModels = (count = 48) => {
  const ids = Array.from({ length: count }, (_, index) =>
    index === count - 1 ? 'vendor/very-long-model-id-with-a-distinct-tail-marker-and-another-long-segment'
      : `vendor/model-${String(index).padStart(2, '0')}`);
  const models = ids.map((id) => ({ ...summary(id), aliases: ['shared-alias'] }));
  models.push({ ...summary('模型 ID 未确认'), id: 'unresolved', modelId: null, aliases: ['shared-alias'] });
  return {
    ...usageResponse(), models,
    modelOptions: [
      ...ids.map((id) => ({ id: `model:${id}`, label: id, modelId: id })),
      { id: 'unresolved', label: '模型 ID 未确认', modelId: null },
    ],
  };
};

const manyPrices = () => ({
  ...pricingResponse(), legacyMappingsIgnored: 3,
  catalog: Array.from({ length: 260 }, (_, index) => ({
    key: index === 259 ? 'test/tail-special-model' : `test/model-${index}`,
    providerId: 'test', providerName: 'Test provider',
    modelId: index === 259 ? 'tail-special-model' : `model-${index}`,
    name: index === 259 ? 'Tail special model' : `Model ${index}`,
    rates: { input: 1, cacheRead: 0, cacheWrite: 2, output: 3 },
  })),
});

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function install(respond, { mobile = false } = {}) {
  const footer = new Element();
  const sidebar = new Element();
  sidebar.append(footer);
  const app = new Element();
  const actions = new Element();
  actions.className = 'actions';
  actions.append(Object.assign(new Element('button'), { className: 'newrow' }));
  const tabs = new Element();
  tabs.className = 'view-tabs';
  const sheetBody = new Element();
  sheetBody.append(actions, tabs);
  const body = new Element();
  const root = new Element();
  const listeners = {};
  const document = {
    body, documentElement: root,
    createElement: (tag) => new Element(tag),
    createElementNS: (_, tag) => new Element(tag),
    querySelector: (selector) => {
      if (selector === '.side .side-footer') return footer;
      if (selector === '.sheet-panel .sheet-body > .actions') return mobile ? actions : null;
      if (selector === '#app') return app;
      return body.querySelector(selector);
    },
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    addEventListener: (type, callback) => { listeners[type] = callback; },
  };
  Element.activeDoc = document;
  const calls = [];
  const nativeFetch = vi.fn(async (resource, options) => {
    calls.push({ url: String(resource), options });
    return respond(resource, options);
  });
  const window = { fetch: nativeFetch };
  class MutationObserver { observe() {} }
  const context = { window, document, location: { href: 'http://localhost/', origin: 'http://localhost' },
    MutationObserver, URL, URLSearchParams, Request, Headers, Date, Intl, Number, String, Math };
  runInNewContext(apiLogic, context);
  runInNewContext(view, context);
  runInNewContext(trend, context);
  runInNewContext(controllers, context);
  runInNewContext(logic, context);
  const get = (name) => body.querySelector(`[data-usage="${name}"]`);
  return { actions, app, body, calls, context, footer, sidebar, get, window, listeners };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('usage UI', () => {
  it('loads the seven-day preset with page authorization and renders incomplete cost honestly', async () => {
    const ui = install((url) => json(String(url).includes('/pricing') ? pricingResponse() : usageResponse()));
    await ui.window.fetch('/api/v1/meta', { headers: { authorization: 'Bearer demo-token' } });
    ui.sidebar.children[0].dispatch('click');
    await flush();
    const request = ui.calls.find(({ url }) => url.startsWith('/__open-kimi-mobile/usage?'));
    const query = new URL(request.url, 'http://localhost').searchParams;
    expect(Number(query.get('to')) - Number(query.get('from'))).toBe(7 * 86400000);
    expect(request.options.headers.authorization).toBe('Bearer demo-token');
    expect(ui.get('total').textContent).toBe('1,300');
    expect(ui.get('cost-sub').textContent).toContain('已知部分小计');
    expect(ui.get('table-body').children[0].children[0].textContent).toBe('custom-long-model-name');
    expect(ui.get('trend').children[0].tagName).toBe('SVG');
    expect(ui.get('distribution-count').hidden).toBe(true);
    expect(ui.get('table-count').hidden).toBe(true);
  });

  it('keeps the latest filter response when an older request finishes later', async () => {
    const first = deferred();
    const second = deferred();
    let count = 0;
    const ui = install((url) => {
      if (String(url).includes('/pricing')) return json(pricingResponse());
      if (String(url).startsWith('/__open-kimi-mobile/usage?')) return ++count === 1 ? first.promise : second.promise;
      return json({});
    });
    await ui.window.fetch('/api/v1/meta', { headers: { authorization: 'Bearer demo-token' } });
    ui.sidebar.children[0].dispatch('click');
    ui.get('model').value = 'model:new-model';
    ui.get('model').dispatch('change');
    second.resolve(json(usageResponse('new-model')));
    await flush();
    first.resolve(json(usageResponse('old-model')));
    await flush();
    expect(ui.get('table-body').children[0].children[0].textContent).toBe('new-model');
  });

  it('saves a catalog-free manual price with explicit zero and restores entry focus on Escape', async () => {
    const ui = install((url, options) => {
      if (options?.method === 'PUT') return json({ ...pricingResponse(), mappings: {
        'custom-long-model-name': { catalogKey: null, rates: { input: 0, output: 2 } },
      } });
      return json(String(url).includes('/pricing') ? pricingResponse() : usageResponse());
    });
    await ui.window.fetch('/api/v1/meta', { headers: { authorization: 'Bearer demo-token' } });
    ui.sidebar.children[0].dispatch('click');
    await flush();
    ui.get('edit-model').value = 'custom-long-model-name';
    ui.get('rate-input').value = '0';
    ui.get('rate-output').value = '2';
    ui.get('save').dispatch('click');
    await flush();
    const put = ui.calls.find(({ options }) => options?.method === 'PUT');
    expect(JSON.parse(put.options.body)).toEqual({
      model: 'custom-long-model-name', catalogKey: null, rates: { input: 0, output: 2 },
    });
    ui.listeners.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
    expect(Element.active).toBe(ui.sidebar.children[0]);
    expect(ui.body.children[0].hidden).toBe(true);
    expect(ui.app.inert).toBe(false);
  });

  it('installs once and traps Tab across the visible trend disclosure', async () => {
    const ui = install((url) => json(String(url).includes('/pricing') ? pricingResponse() : usageResponse()));
    const wrappedFetch = ui.window.fetch;
    runInNewContext(logic, ui.context);
    expect(ui.window.fetch).toBe(wrappedFetch);
    expect(ui.sidebar.children).toHaveLength(2);
    await ui.window.fetch('/api/v1/meta', { headers: { authorization: 'Bearer demo-token' } });
    ui.sidebar.children[0].dispatch('click');
    await flush();
    expect(ui.app.inert).toBe(true);
    const summary = ui.get('trend').children[3].children[0];
    const focusables = ui.body.querySelectorAll('button, input, select, summary, [tabindex]');
    focusables.forEach((item) => { item.disabled = item !== focusables[0] && item !== summary; });
    focusables[0].focus();
    let prevented = false;
    ui.listeners.keydown({ key: 'Tab', shiftKey: true, preventDefault() { prevented = true; } });
    expect(prevented).toBe(true);
    expect(Element.active).toBe(summary);
  });
});

describe('mobile usage UI', () => {
  it('adds a visible mobile sheet entry and returns focus to it after closing', async () => {
    const ui = install((url) => json(String(url).includes('/pricing') ? pricingResponse() : usageResponse()),
      { mobile: true });
    await ui.window.fetch('/api/v1/meta', { headers: { authorization: 'Bearer demo-token' } });
    expect(ui.actions.children[1].getAttribute('aria-label')).toBe('使用统计');
    ui.actions.children[1].dispatch('click');
    await flush();
    ui.listeners.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
    expect(Element.active).toBe(ui.actions.children[1]);
  });
});

describe('usage API authorization capture', () => {
  it('keeps one fetch wrapper when the injected resource runs twice', async () => {
    const ui = install(() => json({ code: 0 }));
    const wrappedFetch = ui.window.fetch;
    runInNewContext(apiLogic, ui.context);
    expect(ui.window.fetch).toBe(wrappedFetch);
    await ui.window.fetch('/api/v1/meta', { headers: { authorization: 'bearer demo-token' } });
    await ui.window.__okwUsageCreateApi()('/__open-kimi-mobile/usage/pricing');
    expect(ui.calls.at(-1).options.headers.authorization).toBe('bearer demo-token');
  });
});

describe('many model identities', () => {
  it('progressively renders rows and finds a tail ID without using its shared alias', async () => {
    const data = manyModels();
    const prices = manyPrices();
    const tail = data.modelOptions[47];
    const ui = install((url, options) => {
      if (options?.method === 'PUT') return json(prices);
      if (String(url).includes('/pricing')) return json(prices);
      return json(new URL(String(url), 'http://localhost').searchParams.has('model')
        ? usageResponse(tail.modelId) : data);
    });
    await ui.window.fetch('/api/v1/meta', { headers: { authorization: 'Bearer demo-token' } });
    ui.sidebar.children[0].dispatch('click');
    await flush();
    expect(ui.get('table-body').children).toHaveLength(40);
    expect(ui.get('distribution').children).toHaveLength(40);
    expect(ui.get('distribution-count').textContent).toBe('已显示 40 / 49 项，可继续加载');
    expect(ui.get('distribution-count').hidden).toBe(false);
    expect(ui.get('table-count').textContent).toBe('已显示 40 / 49 项，可继续加载');
    expect(ui.get('table-count').hidden).toBe(false);
    ui.get('models-more').dispatch('click');
    expect(ui.get('table-body').children).toHaveLength(49);
    expect(ui.get('distribution').children).toHaveLength(49);
    expect(ui.get('legacy-warning').textContent).toContain('3 项已隔离');
    ui.get('model-search').value = 'distinct-tail-marker';
    ui.get('model-search').dispatch('input');
    expect(ui.get('model').options.map((option) => option.value)).toContain(tail.id);
    ui.get('model').value = tail.id;
    ui.get('model').dispatch('change');
    await flush();
    expect(ui.get('table-body').children).toHaveLength(1);
    expect(ui.get('distribution').children).toHaveLength(1);
    expect(ui.get('distribution-count').hidden).toBe(true);
    expect(ui.get('table-count').hidden).toBe(true);
    const filtered = ui.calls.filter(({ url }) => url.startsWith('/__open-kimi-mobile/usage?')).at(-1);
    expect(new URL(filtered.url, 'http://localhost').searchParams.get('model')).toBe(tail.id);
    ui.get('edit-model-search').value = 'distinct-tail-marker';
    ui.get('edit-model-search').dispatch('input');
    expect(ui.get('edit-model').options.map((option) => option.value)).toContain(tail.modelId);
    expect(ui.get('edit-model').options.map((option) => option.value)).not.toContain('unresolved');
    ui.get('edit-model').value = tail.modelId;
    ui.get('edit-model').dispatch('change');
    ui.get('catalog-search').value = 'tail-special';
    ui.get('catalog-search').dispatch('input');
    expect(ui.get('catalog').options.map((option) => option.value)).toContain('test/tail-special-model');
    ui.get('catalog').value = 'test/tail-special-model';
    ui.get('rate-input').value = '0';
    ui.get('save').dispatch('click');
    await flush();
    const put = ui.calls.find(({ options }) => options?.method === 'PUT');
    expect(JSON.parse(put.options.body)).toEqual({
      model: tail.modelId, catalogKey: 'test/tail-special-model', rates: { input: 0 },
    });
  });

  it.each([200, 500])('bounds the initial DOM for %i model IDs and expands it in fixed batches', async (count) => {
    const data = manyModels(count);
    const ui = install((url) => json(String(url).includes('/pricing') ? pricingResponse() : data));
    await ui.window.fetch('/api/v1/meta', { headers: { authorization: 'Bearer demo-token' } });
    ui.sidebar.children[0].dispatch('click');
    await flush();
    expect(ui.get('table-body').children).toHaveLength(40);
    expect(ui.get('distribution').children).toHaveLength(40);
    expect(ui.get('table-count').textContent).toBe(`已显示 40 / ${count + 1} 项，可继续加载`);
    ui.get('models-more').dispatch('click');
    expect(ui.get('table-body').children).toHaveLength(80);
    expect(ui.get('distribution').children).toHaveLength(80);
  });
});

describe('automatic pricing suggestions', () => {
  it('renders a 500-model review list in fixed batches', async () => {
    const data = manyModels(500);
    for (const model of data.models.filter((item) => item.modelId)) {
      model.suggestion = {
        catalogKey: `openrouter:${model.modelId}`,
        provider: 'OpenRouter',
        modelId: model.modelId,
        name: model.modelId,
        rates: { input: 1, cacheRead: 0.1, cacheWrite: null, output: 3 },
        matchKind: 'exact',
        confidence: 1,
      };
    }
    const ui = install((url) => json(String(url).includes('/pricing') ? pricingResponse() : data));
    await ui.window.fetch('/api/v1/meta', { headers: { authorization: 'Bearer demo-token' } });
    ui.sidebar.children[0].dispatch('click');
    await flush();
    expect(ui.get('suggestions-list').children).toHaveLength(40);
    expect(ui.get('suggestions-summary').textContent).toContain('500 个真实模型 ID');
    const suggestionChildren = ui.get('suggestions').children;
    expect(suggestionChildren.indexOf(ui.get('suggestions-save').parentElement)).toBeLessThan(
      suggestionChildren.indexOf(ui.get('suggestions-list')),
    );
    ui.get('suggestions-more').dispatch('click');
    expect(ui.get('suggestions-list').children).toHaveLength(80);
  });

  it('confirms selected model matches in one batch request', async () => {
    const data = usageResponse();
    data.models[0].suggestion = {
      catalogKey: 'openrouter:test/custom-long-model-name',
      provider: 'OpenRouter',
      providerId: 'openrouter',
      modelId: 'test/custom-long-model-name',
      name: 'Custom long model',
      source: 'OpenRouter',
      rates: { input: 1, cacheRead: 0.1, cacheWrite: null, output: 3 },
      matchKind: 'provider-normalized',
      confidence: 0.94,
    };
    const prices = pricingResponse();
    const ui = install((url, options) => {
      if (options?.method === 'PUT') return json({
        ...prices,
        mappings: { 'custom-long-model-name': { catalogKey: data.models[0].suggestion.catalogKey } },
      });
      return json(String(url).includes('/pricing') ? prices : data);
    });
    await ui.window.fetch('/api/v1/meta', { headers: { authorization: 'Bearer demo-token' } });
    ui.sidebar.children[0].dispatch('click');
    await flush();
    expect(ui.get('suggestions-summary').textContent).toContain('1 个真实模型 ID');
    expect(ui.get('suggestions-list').children).toHaveLength(1);
    ui.get('suggestions-save').dispatch('click');
    await flush();
    const put = ui.calls.find(({ options }) => options?.method === 'PUT');
    expect(JSON.parse(put.options.body)).toEqual({ mappings: [{
      model: 'custom-long-model-name',
      catalogKey: 'openrouter:test/custom-long-model-name',
    }] });
  });
});

describe('searchable pricing choices', () => {
  it('shows a small built-in catalog directly and preserves a selected model while searching', async () => {
    const catalog = manyPrices().catalog.slice(0, 13);
    const prices = { ...pricingResponse(), catalog };
    const ui = install((url) => json(String(url).includes('/pricing') ? prices : manyModels()));
    await ui.window.fetch('/api/v1/meta', { headers: { authorization: 'Bearer demo-token' } });
    ui.sidebar.children[0].dispatch('click');
    await flush();
    expect(ui.get('catalog').options).toHaveLength(14);
    const chosen = manyModels().modelOptions[47].modelId;
    ui.get('edit-model').value = chosen;
    ui.get('edit-model').dispatch('change');
    ui.get('edit-model-search').value = 'model-00';
    ui.get('edit-model-search').dispatch('input');
    expect(ui.get('edit-model').value).toBe(chosen);
    expect(ui.get('edit-model').options.map((option) => option.value)).toContain(chosen);
  });
});
