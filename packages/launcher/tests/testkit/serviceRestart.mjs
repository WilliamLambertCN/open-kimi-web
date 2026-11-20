import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, vi } from 'vitest';

const apiSource = readFileSync(resolve('packages/launcher/src/mobile/usageApi.js'), 'utf8');
const sources = ['serviceRestartView.js', 'serviceRestart.js'].map((name) =>
  readFileSync(resolve('packages/launcher/src/mobile', name), 'utf8'));
const frames = [];
const observers = [];
export const flush = async () => {
  for (let i = 0; i < 8; i += 1) { await Promise.resolve(); await vi.advanceTimersByTimeAsync(1); }
};
export const replyAfter = (ms, body, signal, status = 200) => new Promise((resolve, reject) => {
  const aborted = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => {
    signal.removeEventListener('abort', aborted); resolve(Response.json(body, { status }));
  }, ms);
  signal.addEventListener('abort', aborted, { once: true });
});
export function setup({ mobile = true, request, fetchImpl } = {}) {
  vi.useFakeTimers();
  const frame = document.body.appendChild(document.createElement('iframe')); frames.push(frame);
  const view = frame.contentWindow; const doc = view.document;
  const native = view.MutationObserver; const mutations = { count: 0, storm: false };
  view.MutationObserver = class extends native {
    constructor(fn) {
      super((records, observer) => {
        if (++mutations.count > 100) { mutations.storm = true; observer.disconnect(); return; }
        fn(records, observer);
      }); observers.push(this);
    }
  };
  view.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  view.HTMLDialogElement.prototype.close = function close() { this.open = false; };
  let instance = 'original';
  let phase = 'ready';
  let language = 'en';
  const locales = [];
  const location = { href: 'https://restart.example.test/', origin: 'https://restart.example.test', reload: vi.fn() };
  const timeout = vi.fn((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('The operation timed out', 'TimeoutError')), ms);
    return controller.signal;
  });
  const fetch = vi.fn(async (path, init) => {
    if (path.endsWith('/meta')) return Response.json({ code: 0, data: { server_version: '2.6.1' } });
    if (fetchImpl) return fetchImpl(path, init);
    if (init.method === 'POST') { phase = 'restarting'; return Response.json({ instance, phase }, { status: 202 }); }
    return Response.json({ instance, phase, available: true });
  });
  Object.assign(view, { __fixtureLocation: location, fetch, AbortSignal: { timeout }, Date, Request, Headers,
    __okwLocale: { text: (zh, en) => language === 'en' ? en : zh, observe: (fn) => locales.push(fn) } });
  view.eval(`((location) => { ${apiSource}\n})(window.__fixtureLocation)`);
  void view.fetch('/api/v1/meta', { headers: { authorization: 'Bearer fictional-restart-token' } });
  const api = request ?? vi.fn(view.__okwUsageCreateApi());
  view.__okwUsageCreateApi = () => api;
  const mount = () => {
    doc.body.innerHTML = '<textarea class="draft">Fictional unsent draft</textarea>' + (mobile
      ? '<section class="sheet-panel" role="dialog"><h2 class="sheet-title">Session settings</h2>' +
        '<div class="sheet-body"><div class="cache-note">Official version</div></div></section>'
      : '<section class="ui-dialog" role="dialog"><div class="sd"><nav class="settings-tabs">' +
        '<button role="tab" aria-selected="true">General</button>' +
        '<button role="tab" aria-selected="false">Agent & Sessions</button></nav>' +
        '<section class="panel">General</section><section class="panel" style="display:none">Agents</section>' +
        '</div></section>');
  };
  const install = () => sources.forEach((source) => view.eval(`((location) => { ${source}\n})(window.__fixtureLocation)`));
  const settle = async () => {
    await flush(); const count = mutations.count; await flush();
    expect(mutations.count).toBe(count); expect(mutations.storm).toBe(false);
  };
  mount(); install();
  return { doc, view, api, fetch, timeout, location, mutations, mount, install, settle,
    instance: (value) => { instance = value; phase = 'ready'; }, phase: (value) => { phase = value; },
    locale: (value) => { language = value; locales.forEach((fn) => fn()); },
    open: async () => { await flush(); doc.querySelector('.okw-service-trigger').click(); await flush(); },
    confirm: () => doc.querySelector('.okw-service-actions button:last-child').click(),
    cancel: () => doc.querySelector('.okw-service-actions button:first-child').click(),
    status: () => doc.querySelector('.okw-service-status')?.textContent,
  };
}
export function cleanup() {
  observers.splice(0).forEach((observer) => observer.disconnect()); frames.splice(0).forEach((frame) => frame.remove());
  vi.restoreAllMocks(); vi.useRealTimers();
}
