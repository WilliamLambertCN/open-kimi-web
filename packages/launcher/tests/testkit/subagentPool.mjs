import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, vi } from 'vitest';
import { markup, response, tick } from './mobileSubagentModel.mjs';

export { markup, response, tick };

const read = (name) => readFileSync(resolve(`packages/launcher/src/mobile/${name}`), 'utf8');
export const sources = ['effortOrder.js', 'mobileSubagentModelApi.js', 'mobileSubagentModelView.js',
  'mobileSubagentModel.js', 'subagentPoolApi.js', 'subagentPoolView.js', 'subagentPool.js'].map(read);
const localeSource = read('locale.js');

const dialogShell = '<div class="ui-dialog" role="dialog"><div class="sd">';
export const desktopMarkup = (tab = 'Agent & Sessions', section = true, hidden = false) => `${dialogShell}
  <nav class="settings-tabs"><button type="button" role="tab">General</button>
  <button type="button" role="tab">Account</button><button type="button" role="tab">${tab}</button></nav>
  <div class="panels"><div class="panel" style="display: none"><div class="sec">Appearance</div></div>
  <div class="panel" style="display: none"></div><div class="panel"${hidden ? ' hidden' : ''}>
  <div class="sec"><div class="sec-title">${section ? 'Subagents' : 'Appearance'}</div>
  <div class="card">Native subagent control</div></div></div></div></div></div>`;

export const fixtureConfig = (section) => ({
  providers: {}, default_model: 'fixture/main', hooks: ['fixture'], thinking: true,
  models: {
    'fixture/fast': { provider: 'Provider-A', displayName: 'Fast', capabilities: ['thinking'],
      supportEfforts: ['low', 'medium', 'high'] },
    'fixture/always': { provider: 'Provider-B', capabilities: ['always_thinking'],
      supportEfforts: ['medium', 'high'] },
    'fixture/under_score': { provider: 'Provider-B', displayName: 'Under score', capabilities: ['thinking'],
      supportEfforts: ['low', 'medium', 'high'] },
  },
  secondary_model: section,
});

const deepMerge = (base, patch) => {
  const output = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const previous = typeof output[key] === 'object' && output[key] !== null ? output[key] : {};
    output[key] = typeof value === 'object' && value !== null && !Array.isArray(value)
      ? deepMerge(previous, value) : value;
  }
  return output;
};
const hasNull = (value) => typeof value !== 'object' || value === null
  ? value === null : Object.values(value).some(hasNull);

const mockBackend = (initial, version, items) => {
  let config = structuredClone(initial);
  const posts = [];
  const invalid = [];
  const nativeFetch = vi.fn(async (path, options) => {
    if (path === '/api/v1/meta') return response({ server_version: version });
    if (path === '/api/v1/models') return response({ items });
    if (path === '/api/v1/config' && options?.method === 'POST') {
      const body = JSON.parse(options.body);
      posts.push(body);
      if (hasNull(body.secondary_model)) invalid.push(body);
      else if (body.secondary_model === null) config = { ...config, secondary_model: undefined };
      else if (body.secondary_model) {
        config = { ...config, secondary_model: deepMerge(config.secondary_model ?? {}, body.secondary_model) };
      }
    }
    return response(config);
  });
  return { nativeFetch, posts, invalid, getConfig: () => config, setConfig: (value) => { config = structuredClone(value); } };
};

const polyfillDialogs = (view) => {
  const proto = view.document.createElement('dialog').constructor.prototype;
  proto.showModal = function okwPoolShowModal() { this.setAttribute('open', ''); };
  proto.close = function okwPoolClose(returnValue) {
    const wasOpen = this.hasAttribute('open');
    this.returnValue = returnValue ?? '';
    this.removeAttribute('open');
    if (wasOpen) this.dispatchEvent(new view.Event('close'));
  };
};

const mediaRegistry = (view, touch, mobile) => {
  const registry = new Map();
  view.matchMedia = (query) => {
    if (!registry.has(query)) {
      const matches = query === '(hover: none)' ? touch : query === '(max-width: 640px)' ? mobile : false;
      const entry = { matches, listeners: [] };
      entry.addEventListener = (_name, listener) => entry.listeners.push(listener);
      entry.removeEventListener = (_name, listener) => entry.listeners.splice(entry.listeners.indexOf(listener), 1);
      registry.set(query, entry);
    }
    return registry.get(query);
  };
  return {
    setBreakpoint: (value) => {
      const entry = registry.get('(max-width: 640px)');
      entry.matches = value;
      entry.listeners.forEach((listener) => listener({ matches: value }));
    },
  };
};

const frames = [];
const observers = [];
export const cleanup = () => {
  observers.splice(0).forEach((observer) => observer.disconnect());
  frames.splice(0).forEach((frame) => frame.remove());
};
const observe = (view) => {
  const NativeObserver = view.MutationObserver;
  const state = { calls: 0, stopped: false };
  view.MutationObserver = class {
    constructor(callback) {
      const observer = new NativeObserver((records) => {
        state.calls += 1;
        if (state.calls > 100) { state.stopped = true; observer.disconnect(); return; }
        callback(records);
      });
      observers.push(observer);
      return observer;
    }
  };
  return state;
};

const interact = (view, doc, settled) => {
  const dialog = () => doc.querySelector('.okw-pool-dialog');
  const open = async (node) => { node.click(); await settled(); return dialog(); };
  const button = (name) => dialog()?.querySelector(`.okw-pool-${name}`);
  const click = (name) => { button(name).click(); return dialog(); };
  const entries = () => [...doc.querySelectorAll('.okw-pool-entry')];
  const triggers = () => [...doc.querySelectorAll('.okw-pool-trigger')];
  const cards = () => [...dialog().querySelectorAll('.okw-pool-card')];
  const cardFor = (alias) => cards().find((card) => card.dataset.model === alias);
  const description = (alias) => cardFor(alias)?.querySelector('.okw-pool-description');
  const write = (alias, value) => {
    const field = description(alias);
    field.value = value;
    field.dispatchEvent(new view.Event('input', { bubbles: true }));
  };
  const radioFor = (alias) => cardFor(alias).querySelector('input[type="radio"]');
  const searchInput = () => doc.getElementById('okw-pool-search');
  const typeSearch = (value) => {
    searchInput().value = value;
    searchInput().dispatchEvent(new view.Event('input', { bubbles: true }));
  };
  const key = (value, node = searchInput(), options = {}) => {
    const event = new view.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options });
    node.dispatchEvent(event);
    return event;
  };
  return {
    dialog, open, button, click, entries, triggers, cards, cardFor, description, write, radioFor,
    searchInput, typeSearch, key,
    pickerRows: () => [...dialog().querySelectorAll('.okw-pool-chooser .model-row')],
    chips: () => [...dialog().querySelectorAll('.chip')],
    count: () => dialog().querySelector('.okw-pool-heading .okw-pool-note').textContent,
    status: () => dialog().querySelector('.okw-pool-status').textContent,
    notes: () => [...dialog().querySelectorAll('.okw-pool-note')].map((node) => node.textContent),
    copy: () => view.__okwSubagentPoolView.copy(),
  };
};

const installDefaults = {
  mobile: true, touch: true, locale: 'en', version: '2.6.1', items: [], title: 'Settings',
  scoped: true, desktop: true, desktopTab: 'Agent & Sessions', desktopSection: true, hiddenPanel: false,
};

export async function install(options = {}) {
  const { mobile, touch, locale, version, items, section, config,
    title, scoped, desktop, desktopTab, desktopSection, hiddenPanel } = { ...installDefaults, ...options };
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const view = frame.contentWindow;
  const doc = view.document;
  doc.documentElement.lang = 'en';
  doc.body.innerHTML = `<div class="app${mobile ? ' mobile' : ''}"><div class="chat-scroll"></div>
    <div class="sc-body"></div></div>` + markup(title, scoped)
    + (desktop ? desktopMarkup(desktopTab, desktopSection, hiddenPanel) : '');
  polyfillDialogs(view);
  const state = observe(view);
  const media = mediaRegistry(view, touch, mobile);
  Object.assign(view, { Request, Headers, Response, AbortController });
  const backend = mockBackend(config ?? fixtureConfig(section), version, items);
  view.fetch = backend.nativeFetch;
  const storage = new Map([['kimi-locale', locale]]);
  Object.defineProperty(view, 'localStorage', { value: {
    getItem: vi.fn((key) => storage.get(key) ?? null), setItem: vi.fn((key, value) => storage.set(key, value)),
  } });
  view.__fixtureLocation = { href: 'https://example.test/', origin: 'https://example.test' };
  [localeSource, ...sources].forEach((source) => view.eval(`((location) => { ${source}\n})(window.__fixtureLocation)`));
  await view.fetch('/api/v1/meta', { headers: { authorization: 'Bearer fixture-token' } });
  const settled = async () => {
    await tick();
    const calls = state.calls;
    await tick();
    expect(state.stopped).toBe(false);
    expect(state.calls).toBe(calls);
  };
  await settled();
  return { view, doc, state, media, settled, storage: view.localStorage,
    root: doc.querySelector('.sheet-root'), panel: doc.querySelector('.sheet-panel'),
    ...backend, ...interact(view, doc, settled) };
}

export const switchLocale = async (ui, locale) => {
  ui.storage.setItem('kimi-locale', locale);
  ui.doc.querySelector('.app').append(ui.doc.createTextNode(locale === 'zh' ? '官方中文界面' : 'Official English UI'));
  await ui.settled();
};
export const requestLog = (ui) => ui.nativeFetch.mock.calls
  .map(([path, options]) => `${options?.method ?? 'GET'} ${path}`);
