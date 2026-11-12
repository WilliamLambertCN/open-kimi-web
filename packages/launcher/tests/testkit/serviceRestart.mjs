import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, vi } from 'vitest';

const sources = ['serviceRestartView.js', 'serviceRestart.js'].map((name) =>
  readFileSync(resolve('packages/launcher/src/mobile', name), 'utf8'));
const frames = [];
const observers = [];
export const flush = async () => {
  for (let i = 0; i < 8; i += 1) { await Promise.resolve(); await vi.advanceTimersByTimeAsync(1); }
};
export function setup({ mobile = true, request } = {}) {
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
  let language = 'en';
  const locales = [];
  const api = request ?? vi.fn(async () => ({ instance, phase: 'ready', available: true }));
  const location = { reload: vi.fn() };
  Object.assign(view, { __fixtureLocation: location, __okwUsageCreateApi: () => api, AbortSignal, Date,
    __okwLocale: { text: (zh, en) => language === 'en' ? en : zh, observe: (fn) => locales.push(fn) } });
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
  return { doc, view, api, location, mutations, mount, install, settle,
    instance: (value) => { instance = value; }, locale: (value) => { language = value; locales.forEach((fn) => fn()); },
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
