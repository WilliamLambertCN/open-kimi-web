import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, vi } from 'vitest';

const sources = ['effortOrder.js', 'mobileSubagentModelApi.js', 'sideChatModelIdentity.js', 'sideChatModelApi.js',
  'sideChatModelView.js', 'sideChatModel.js'].map((name) =>
  readFileSync(resolve(`packages/launcher/src/mobile/${name}`), 'utf8'));
const frames = [];
const observers = [];
export const models = {
  main: { provider: 'alpha', model: 'main', displayName: 'Balanced', capabilities: ['thinking'],
    supportEfforts: ['low', 'high'] },
  fast: { provider: 'beta', model: 'fast', displayName: 'Fast', capabilities: ['thinking'], supportEfforts: ['low'] },
  plain: { provider: 'beta', model: 'plain', displayName: 'Plain', capabilities: [] },
};
export const envelope = (data, extra) => new Response(JSON.stringify({ code: 0, data }), extra);
export const flush = async () => {
  for (let i = 0; i < 8; i += 1) { await Promise.resolve(); await vi.advanceTimersByTimeAsync(1); }
};
export const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { resolve, promise };
};
export function setup({ native, display = true } = {}) {
  vi.useFakeTimers();
  const frame = document.createElement('iframe'); document.body.append(frame); frames.push(frame);
  const view = frame.contentWindow;
  const doc = view.document;
  let config = { models, secondary_model: { defaultModel: 'plain' } };
  const fetch = native ?? vi.fn(async (resource) => {
    const path = String(resource instanceof Request ? resource.url : resource);
    return envelope(path.endsWith('/config') ? config : path.endsWith('/models') ? { items: [] } : {});
  });
  const location = { origin: 'https://example.test', href: 'https://example.test/sessions/A', pathname: '/sessions/A' };
  for (const method of ['pushState', 'replaceState']) view.history[method] = (state, title, path) => {
    const url = new URL(path, location.href); location.pathname = url.pathname; location.href = url.href; return state;
  };
  const Native = view.MutationObserver;
  const mutation = { calls: 0, stopped: false };
  view.MutationObserver = class extends Native {
    constructor(callback) {
      super((records, observer) => {
        if (++mutation.calls > 150) { mutation.stopped = true; observer.disconnect(); return; }
        callback(records, observer);
      }); observers.push(this);
    }
  };
  view.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  view.HTMLDialogElement.prototype.close = function close() { this.open = false; };
  view.HTMLElement.prototype.scrollIntoView = vi.fn();
  const locales = [];
  let language = 'en';
  view.__okwLocale = { current: () => language, observe: (fn) => locales.push(fn) };
  Object.assign(view, { Request, Headers, Response, TextDecoder, fetch, __fixtureLocation: location });
  const install = () => sources.slice(0, display ? sources.length : 4).forEach((source) =>
    view.eval(`((location) => { ${source}\n})(window.__fixtureLocation)`));
  install();
  const tabs = (agents = ['side-1'], active = 0, session = 'A') => {
    const root = doc.querySelector('.pt') ?? doc.body.appendChild(doc.createElement('section'));
    root.className = 'pt';
    root.innerHTML = '<div class="panel-tab-bar">' + agents.map((agent, index) =>
      `<div class="ptb-tab${index === active ? ' on' : ''}" data-panel-tab-id="tab-${agent}"></div>`).join('') +
      '</div><div class="pt-body"><div class="sc"><div class="sc-body"></div><div class="sc-composer">' +
      '<div class="toolbar-right"><button class="send">Send</button></div></div></div></div>';
    view.localStorage.setItem(`kimi-web.panel-tabs.v1:${session}`, JSON.stringify({ visible: true, activeIndex: active,
      tabs: agents.map((agentId, index) => ({ type: 'btw', payload: { parentId: session, agentId, seq: index + 1 } })) }));
    return root.querySelector('.sc');
  };
  const auth = () => view.fetch('/api/v1/sessions/A', { headers: { authorization: 'Bearer fictional-test-token' } });
  const prompt = (body = {}, init = {}) => view.fetch('/api/v1/sessions/A/prompts', {
    method: 'POST', body: JSON.stringify({ content: [{ type: 'text', text: 'Fictional question' }],
      agent_id: 'side-1', model: 'main', thinking: 'high', ...body }), ...init,
  });
  const settle = async () => {
    await flush(); const previous = mutation.calls; await flush(); expect(mutation.calls).toBe(previous);
    expect(mutation.stopped).toBe(false);
  };
  return { view, doc, fetch, location, tabs, auth, prompt, mutation, install, settle,
    api: view.__okwSideChatModelApi, identity: view.__okwSideChatIdentity,
    config: (value) => { config = value; },
    locale: (value) => { language = value; locales.forEach((fn) => fn()); },
    route: (id) => view.history.pushState(null, '', `/sessions/${id}`) };
}
export function cleanup() {
  observers.splice(0).forEach((observer) => observer.disconnect()); frames.splice(0).forEach((frame) => frame.remove());
  vi.restoreAllMocks(); vi.useRealTimers();
}
