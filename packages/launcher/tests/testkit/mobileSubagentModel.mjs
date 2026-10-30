import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, vi } from 'vitest';

export const sources = ['effortOrder.js', 'mobileSubagentModelApi.js', 'mobileSubagentModelView.js', 'mobileSubagentModel.js']
  .map((name) => readFileSync(resolve(`packages/launcher/src/mobile/${name}`), 'utf8'));
const localeSource = readFileSync(resolve('packages/launcher/src/mobile/locale.js'), 'utf8');
export const tick = async () => { await new Promise((done) => setTimeout(done, 0)); };
export const response = (data) => new Response(JSON.stringify({
  code: 0, msg: 'success', data, request_id: 'fixture',
}));
export const fixtureConfig = (section) => ({
  providers: {}, default_model: 'fixture/main', hooks: ['fixture'], thinking: true,
  models: { 'fixture/fast': { displayName: 'Fast', capabilities: ['thinking'], supportEfforts: ['low', 'medium', 'high'] },
    'fixture/always': { capabilities: ['always_thinking'], supportEfforts: ['medium', 'high'] } },
  secondary_model: section,
});
export const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
export const markup = (title = 'Settings', scoped = true) => `<div class="sheet-root"><div class="sheet-scrim"></div>
  <div class="sheet-panel" role="dialog" aria-label="${title}"><div class="sheet-head">
  <span class="sheet-title">${title}</span></div><div class="sheet-body"><div class="group-title">Session</div>
  <div class="card"><button class="srow"><span class="srow-main"><span class="srow-label">Model</span></span></button></div>
  ${scoped ? '<div class="cache-note">Cache note</div>' : ''}<div class="group-title">App</div>
  <div class="card">App settings</div></div></div></div>`;
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
const mockBackend = (initial) => {
  let config = initial;
  const posts = [];
  const nativeFetch = vi.fn(async (path, options) => {
    if (path === '/api/v1/models') return response({ items: [] });
    if (path === '/api/v1/config') {
      if (options?.method === 'POST') {
        const patch = JSON.parse(options.body);
        posts.push(patch);
        config = { ...config, secondary_model: { ...config.secondary_model, ...patch.secondary_model } };
      }
      return response(config);
    }
    return response({});
  });
  return { nativeFetch, posts, getConfig: () => config, setConfig: (value) => { config = value; } };
};
const interact = (view, doc) => {
  const query = (name) => doc.querySelector(`.okw-subagent-${name}`);
  const rows = () => [...doc.querySelectorAll('.okw-subagent-overlay .model-row')];
  const select = (id) => rows().find((row) => row.dataset.model === id)?.click();
  const effort = (value) => [...query('effort').children].find((node) => node.dataset.effort === value)?.click();
  const search = (value) => {
    query('search').value = value;
    query('search').dispatchEvent(new view.Event('input', { bubbles: true }));
  };
  const key = (value, node = query('search'), options = {}) => {
    const event = new view.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options });
    node.dispatchEvent(event);
    return event;
  };
  return { query, rows, select, effort, search, key };
};
const configFor = ({ config, section, noModels }) => config ??
  (noModels ? { providers: {}, models: {}, secondary_model: section } : fixtureConfig(section));
export async function install(options = {}) {
  const { mobile = true, touch = true, title = 'Settings', scoped = true, locale = 'en' } = options;
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const view = frame.contentWindow;
  const doc = view.document;
  doc.documentElement.lang = 'en';
  doc.body.innerHTML = `<div class="app${mobile ? ' mobile' : ''}"><div class="chat-scroll"></div>
    <div class="sc-body"></div></div>` + markup(title, scoped);
  const state = observe(view);
  const media = { matches: mobile, addEventListener: (_name, listener) => { media.change = listener; } };
  view.matchMedia = (query) => query === '(hover: none)' ? { matches: touch } : media;
  Object.assign(view, { Request, Headers, Response, AbortController });
  const backend = mockBackend(configFor(options));
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
  return { view, doc, state, media, settled, storage: view.localStorage, ...backend, ...interact(view, doc),
    root: doc.querySelector('.sheet-root'), panel: doc.querySelector('.sheet-panel'), body: doc.querySelector('.sheet-body') };
}
