import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';
import { mockProviderLayout } from './providerLayout.mjs';

const frames = [];
const observers = [];
const source = (name) => readFileSync(resolve(`packages/launcher/src/mobile/${name}`), 'utf8');
export const tick = () => new Promise((done) => setTimeout(done, 0));
export const defaultMetadata = {
  capabilities: ['image_in', 'tool_use', 'thinking', 'always_thinking'],
  support_efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], adaptive_thinking: true,
};
export const defaultChecks = [...defaultMetadata.capabilities, ...defaultMetadata.support_efforts, 'adaptive_thinking'];
export const manualModel = (model = 'fixture-model') => ({
  model, max_context_size: 131072, capabilities: ['tool_use', 'thinking'], adaptive_thinking: true,
});
const html = (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const rowMarkup = (model, disabled) => `<div class="pmt-grid">
  <input value="${html(model.model)}" ${disabled}><input value="${model.max_context_size ?? 131072}" ${disabled}>
  <input value="${html(model.display_name ?? '')}" ${disabled}><button type="button" ${disabled}>Delete</button></div>`;
const formMarkup = ({ id = 'provider-fixture', models = [manualModel()], hidden = '', managed = false } = {}) => {
  const disabled = managed ? 'disabled' : '';
  return `<section ${hidden}><div class="pf">
    <div class="pf-field"><label class="pf-label">Name <span>*</span></label><input value="${html(id)}" ${disabled}></div>
    <div class="pf-field"><label class="pf-label">API Protocol <span>*</span></label><button>OpenAI</button></div>
    <div class="pf-field"><label class="pf-label">API Key <span>*</span></label><input value="fixture-key" ${disabled}></div>
    <div class="pf-field"><label class="pf-label">Base URL <span>*</span></label>
      <input value="https://example.invalid/v1" ${disabled}></div>
    <div class="pf-field"><div class="pf-label">Models <span>*</span><span class="pf-hint-inline">${models.length} models</span>
      <button>Fetch model list</button></div><div class="pmt"><div class="pmt-grid pmt-head"></div>
      ${models.map((model) => rowMarkup(model, disabled)).join('')}
      <div class="pmt-foot"><button>Add model</button></div></div></div></div></section>`;
};

export function cleanupProviderSave() {
  observers.splice(0).forEach((observer) => observer.disconnect());
  frames.splice(0).forEach((frame) => frame.remove());
}

export function installProviderSave({ forms = [{}], config = {}, listed = [] } = {}) {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const view = frame.contentWindow;
  const doc = view.document;
  mockProviderLayout(view);
  view.Request = Request; view.Response = Response; view.Headers = Headers;
  doc.documentElement.lang = 'en';
  doc.body.innerHTML = forms.map(formMarkup).join('');
  const state = { config, listed, callbacks: 0, exceededLimit: false };
  const NativeObserver = view.MutationObserver;
  view.MutationObserver = class extends NativeObserver {
    constructor(callback) {
      super((records, observer) => {
        if (++state.callbacks > 150) { state.exceededLimit = true; observer.disconnect(); return; }
        callback(records, observer);
      });
      observers.push(this);
    }
  };
  const nativeFetch = vi.fn(async (input, init) => {
    const path = new URL(input instanceof Request ? input.url : String(input), 'http://localhost').pathname;
    if (path === '/api/v1/config') return Response.json({ code: 0, data: { models: state.config } });
    if (path === '/api/v1/models') return Response.json({ code: 0, data: { items: state.listed } });
    if (path.startsWith('/api/v1/providers')) {
      const text = init?.body ?? await input.clone().text();
      const body = JSON.parse(text);
      return Response.json({ code: 0, data: { id: body.id ?? 'provider-fixture', type: body.type, models: body.models } });
    }
    return Response.json({ code: 0 });
  });
  view.fetch = nativeFetch;
  const scripts = ['providerLocale.js', 'providerSorting.js', 'providerModelState.js', 'providerEnhancements.js']
    .map(source).join('\n');
  view.eval(`((location) => { ${scripts}\n})({ href: 'http://localhost/settings', origin: 'http://localhost' })`);
  return { view, doc, nativeFetch, state, forms: [...doc.querySelectorAll('.pf')] };
}

export async function loadConfig(ui, config) {
  if (config) ui.state.config = config;
  await ui.view.fetch('/api/v1/config');
  await tick();
}

export function change(ui, row, value, checked) {
  const input = row.querySelector(`.okw-model-options input[value="${value}"]`);
  input.checked = checked;
  input.dispatchEvent(new ui.view.Event('change', { bubbles: true }));
}

export const rowsOf = (form) => [...form.querySelectorAll('.pmt-grid:not(.pmt-head)')];
export const checksOf = (row) => [...row.querySelectorAll('.okw-model-options input:checked')].map((input) => input.value);

export function saveBody(models, id = 'provider-fixture') {
  return { id, type: 'openai', models, api_key: 'fixture-key', base_url: 'https://example.invalid/v1' };
}

export async function save(ui, body, { method = 'POST', path = '/api/v1/providers', request = false } = {}) {
  const init = { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  if (request) await ui.view.fetch(new Request(`http://localhost${path}`, init));
  else await ui.view.fetch(path, init);
  const [input, options] = ui.nativeFetch.mock.calls.at(-1);
  return JSON.parse(options?.body ?? await input.clone().text());
}

export async function reopen(ui, body) {
  const models = Object.fromEntries(body.models.map((model, index) => [`saved-${index}`, {
    provider: body.id, model: model.model, capabilities: model.capabilities ?? [],
    supportEfforts: model.support_efforts ?? [], adaptiveThinking: model.adaptive_thinking,
  }]));
  ui.doc.body.innerHTML = formMarkup({ id: body.id, models: body.models });
  await loadConfig(ui, models);
  return ui.doc.querySelector('.pf');
}

export function moveFirstToEnd(ui, form) {
  const handle = rowsOf(form)[0].querySelector('.okw-model-drag-handle');
  const event = (type, clientY) => {
    const result = new ui.view.Event(type, { bubbles: true, cancelable: true });
    Object.assign(result, { clientY, pointerId: 1, pointerType: 'touch', button: 0 });
    return result;
  };
  handle.dispatchEvent(event('pointerdown', 0));
  ui.doc.dispatchEvent(event('pointermove', 1000));
  ui.doc.dispatchEvent(event('pointerup', 1000));
}
