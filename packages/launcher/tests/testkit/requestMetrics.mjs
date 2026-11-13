import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, vi } from 'vitest';

const names = ['requestMetricsModel.js', 'requestMetricsTransport.js', 'requestMetrics.js'];
const sources = names.map((name) => readFileSync(resolve(`packages/launcher/src/mobile/${name}`), 'utf8'));
const frames = [];
const observers = [];
export const turn = (extra = {}) => ({ kind: 'turn', turnId: 't0', ordinal: 0, state: 'completed',
  origin: { kind: 'user' }, prompt: 'Fictional question', steps: [step()], ...extra });
export const step = (extra = {}) => ({ kind: 'step', stepId: 's0', turnId: 't0', ordinal: 0, state: 'completed',
  usage: { output: 100, inputOther: 10, inputCacheRead: 30, inputCacheCreation: 0 },
  llmTiming: { llmFirstTokenLatencyMs: 1200, llmStreamDurationMs: 2000 },
  frames: [{ kind: 'text', frameId: 'f0', role: 'assistant', text: 'Fictional reply' }], ...extra });
export const envelope = (items = [turn()], extra = {}) => ({ code: 0, data: { agent_id: 'main', items, ...extra } });
export const response = (body = envelope(), extra) => new Response(JSON.stringify(body), extra);
export const timingSlot = (id = 's0', state = 'completed') =>
  `<div class="step-timing" data-okw-step-id="${id}" data-okw-step-state="${state}">` +
  '<button class="st-head">Native debug summary</button></div>';
export const assistant = (id = 'f0', slot = timingSlot()) =>
  `<div class="a-msg" data-turn-id="${id}"><div class="msg">Fictional reply</div>${slot}` +
  '<div class="a-msg-ft"><button>Copy</button><span class="a-time">08:00</span></div></div>';
export const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { resolve, promise };
};
export const flush = async () => {
  for (let i = 0; i < 6; i += 1) { await Promise.resolve(); await vi.advanceTimersByTimeAsync(1); }
};
const observe = (view) => {
  const Native = view.MutationObserver;
  const state = { calls: 0, stopped: false };
  view.MutationObserver = class extends Native {
    constructor(callback) {
      super((records, observer) => {
        state.calls += 1;
        if (state.calls > 120) { state.stopped = true; observer.disconnect(); return; }
        callback(records, observer);
      });
      observers.push(this);
    }
  };
  return state;
};
export function setup(native = vi.fn(async () => response()),
  { html = assistant(), view: display = true, conversationApi } = {}) {
  vi.useFakeTimers();
  const iframe = document.createElement('iframe'); document.body.append(iframe); frames.push(iframe);
  const view = iframe.contentWindow;
  const doc = view.document;
  const location = { origin: 'https://example.test', href: 'https://example.test/sessions/A', pathname: '/sessions/A' };
  for (const method of ['pushState', 'replaceState']) view.history[method] = (state, title, path) => {
    const url = new URL(path, location.href); location.pathname = url.pathname; location.href = url.href; return state;
  };
  class Socket extends view.EventTarget {
    static OPEN = 1;
    constructor(...args) { super(); this.args = args; }
    send() {}
  }
  let language = 'en';
  const localeListeners = [];
  view.__okwLocale = { current: () => language, observe: (listener) => localeListeners.push(listener) };
  Object.assign(view, { Request, Headers, Response, WebSocket: Socket, fetch: native, __fixtureLocation: location });
  doc.body.innerHTML = `<div class="panes chat-scroll"><div class="chat">${html}</div></div>`;
  const state = observe(view);
  if (conversationApi) view.__okwUsageCreateApi = () => conversationApi;
  const activeSources = [...sources.slice(0, 2),
    readFileSync(resolve('packages/launcher/src/mobile/requestMetricsConversation.js'), 'utf8'), sources[2]];
  const install = () => activeSources.slice(0, display ? 4 : 2).forEach((source) =>
    view.eval(`((location) => { ${source}\n})(window.__fixtureLocation)`));
  install();
  const load = async (path = '/api/v1/sessions/A/transcript?agent_id=main', reader = 'json', options) => {
    const result = await view.fetch(path, options); const data = await result[reader](); await flush(); return data;
  };
  const socket = (url = 'wss://example.test/api/v1/ws') => new view.WebSocket(url);
  const emit = (ws, type, payload, extra = {}) => ws.dispatchEvent(new view.MessageEvent('message', {
    data: JSON.stringify({ type, session_id: 'A', payload: { type, agent_id: 'main', ...payload }, ...extra }),
  }));
  const settle = async () => {
    await flush(); const previous = state.calls; await flush(); expect(state.calls).toBe(previous);
    expect(state.stopped).toBe(false);
  };
  return { view, doc, state, native, location, load, install, socket, emit, settle, metrics: view.__okwRequestMetrics,
    route: (id) => view.history.pushState(null, '', `/sessions/${id}`),
    locale: (value) => { language = value; localeListeners.forEach((listener) => listener()); },
  };
}
export const cleanup = () => {
  observers.splice(0).forEach((observer) => observer.disconnect()); frames.splice(0).forEach((frame) => frame.remove());
  vi.restoreAllMocks(); vi.useRealTimers();
};
