/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockProviderLayout } from './testkit/providerLayout.mjs';

const source = (name) => readFileSync(resolve(`packages/launcher/src/mobile/${name}`), 'utf8');
const frames = [];
const observers = [];
const tick = () => new Promise((done) => setTimeout(done, 0));
const modelIds = Array.from({ length: 22 }, (_, index) => `fixture-model-${String(index).padStart(2, '0')}`);
modelIds[21] = 'fixture/long-provider-model-with-a-distinct-long-identifier-2026';
const rowMarkup = (id = '') => `<div class="pmt-grid"><input class="ui-input" value="${id}">
  <input class="ui-input" value="131072"><input class="ui-input" value=""><button type="button">Delete</button></div>`;
const formCopy = {
  zh: { name: '名称', protocol: 'API 协议', models: '模型', count: '1 个模型', fetch: '获取模型列表', add: '添加模型' },
  en: { name: 'Name', protocol: 'API Protocol', models: 'Models', count: '1 model', fetch: 'Fetch model list', add: 'Add model' },
};
const formMarkup = (locale, { disabled = false, empty = false } = {}) => {
  const text = formCopy[locale];
  return `<div class="pf">
    <div class="pf-field"><label class="pf-label">${text.name} <span>*</span></label>
      <input value="provider-fixture"></div>
    <div class="pf-field"><label class="pf-label">${text.protocol} <span>*</span></label>
      <button type="button" role="combobox">OpenAI</button></div>
    <div class="pf-field"><label class="pf-label">API Key <span>*</span></label><input value="fixture-key"></div>
    <div class="pf-field"><label class="pf-label">Base URL <span>*</span></label>
      <input value="https://example.invalid/v1" ${disabled ? 'disabled' : ''}></div>
    <div class="pf-field"><div class="pf-label">${text.models} <span class="req">*</span>
      <span class="pf-hint-inline">${text.count}</span><span class="spacer"></span>
      <button type="button">${text.fetch}</button></div>
      <div class="pmt"><div class="pmt-grid pmt-head">Model ID / Context / Display name</div>
        ${empty ? rowMarkup() : rowMarkup('existing-model')}
        <div class="pmt-foot"><button type="button">${text.add}</button></div>
      </div></div></div>`;
};
const savedModel = {
  provider: 'provider-fixture', model: 'existing-model', capabilities: ['tool_use'],
  supportEfforts: ['low'], adaptiveThinking: false,
};

function install(options = {}) {
  const frame = document.createElement('iframe');
  document.body.append(frame); frames.push(frame);
  const view = frame.contentWindow;
  mockProviderLayout(view);
  const doc = view.document;
  const locale = options.locale ?? 'en';
  doc.documentElement.lang = locale;
  doc.body.innerHTML = formMarkup(locale, options);
  view.Request = Request; view.Response = Response; view.Headers = Headers;
  const values = new Map([['kimi-locale', locale]]);
  Object.defineProperty(view, 'localStorage', { value: {
    getItem: (key) => values.get(key) ?? null,
    setItem: vi.fn((key, value) => values.set(key, value)),
  } });
  const nativeFetch = vi.fn(async (input) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path === '/api/v1/config') return Response.json({ code: 0, data: { models: { existing: savedModel } } });
    if (path === '/__open-kimi-mobile/models:discover') return Response.json({ models: modelIds });
    return Response.json({ code: 0, data: {} });
  });
  view.fetch = nativeFetch;
  const NativeObserver = view.MutationObserver;
  const state = { callbacks: 0, stopped: false };
  view.MutationObserver = class extends NativeObserver {
    constructor(callback) {
      super((records, observer) => {
        if (++state.callbacks > 150) { state.stopped = true; observer.disconnect(); return; }
        callback(records, observer);
      });
      observers.push(this);
    }
  };
  const form = doc.querySelector('.pf');
  const inputs = [];
  form.addEventListener('input', (event) => inputs.push({ node: event.target, value: event.target.value }));
  form.querySelector('.pmt-foot button').addEventListener('click', () => {
    const template = doc.createElement('template'); template.innerHTML = rowMarkup();
    form.querySelector('.pmt-foot').before(template.content.firstElementChild);
  });
  const scripts = ['locale.js', 'providerLocale.js', 'providerSorting.js', 'providerModelState.js', 'providerEnhancements.js']
    .map(source).join('\n');
  view.eval(`((location) => { ${scripts}\n})({ href: 'http://localhost/settings', origin: 'http://localhost' })`);
  const query = (selector) => form.querySelector(selector);
  const writes = () => nativeFetch.mock.calls.filter(([input]) => /\/api\/v1\/providers/.test(String(input)));
  return { view, doc, form, query, state, inputs, nativeFetch, writes, values };
}
async function authorize(ui) {
  await ui.view.fetch('/api/v1/config', { headers: { authorization: 'Bearer fixture-page-token' } });
  await tick();
}
async function discover(ui) {
  ui.query('.okw-discovery-button').click(); await tick();
}
async function select(ui, id) {
  const control = ui.query('.okw-discovery-select');
  control.value = id; control.dispatchEvent(new ui.view.Event('change', { bubbles: true }));
  ui.query('.okw-discovery-add').click(); await tick();
}
async function settled(ui) {
  await tick(); const callbacks = ui.state.callbacks; await tick();
  expect(ui.state.stopped).toBe(false); expect(ui.state.callbacks).toBe(callbacks);
}
afterEach(() => {
  observers.splice(0).forEach((observer) => observer.disconnect());
  frames.splice(0).forEach((frame) => frame.remove());
});

describe('official 2.3.1 provider discovery markup', () => {
  it.each(['en', 'zh'])('mounts selectable candidates beside the %s native div heading', async (locale) => {
    const ui = install({ locale });
    const field = ui.form.querySelector('.pf-field:has(.pmt)');
    const heading = field.querySelector('.pf-label');
    const nativeButton = heading.querySelector('button');
    expect(heading.tagName).toBe('DIV');
    expect(field.querySelector('label')).toBeNull();
    expect(ui.query('.okw-model-discovery').nextElementSibling).toBe(field);
    expect(ui.query('.okw-discovery-select').disabled).toBe(true);
    await authorize(ui); await discover(ui);
    const control = ui.query('.okw-discovery-select');
    expect(control.options).toHaveLength(23);
    expect([...control.options].slice(1).map((option) => option.value)).toEqual(modelIds);
    expect(control.getAttribute('aria-label')).toBe(locale === 'zh' ? '选择已发现的模型' : 'Choose a discovered model');
    expect(control.disabled).toBe(false); expect(ui.query('.okw-discovery-add').disabled).toBe(true);
    expect(ui.query('.okw-discovery-status').textContent).toBe(locale === 'zh' ? '已发现 22 个模型' : 'Found 22 models');
    expect(heading.querySelector('button')).toBe(nativeButton);
    expect(ui.form.querySelectorAll('.pmt-grid:not(.pmt-head)')).toHaveLength(1);
    expect(ui.writes()).toEqual([]);
    const call = ui.nativeFetch.mock.calls.find(([input]) => String(input).includes('models:discover'));
    expect(JSON.parse(call[1].body)).toEqual({
      base_url: 'https://example.invalid/v1', api_key: 'fixture-key', type: 'openai',
    });
    expect(call[1].headers.authorization).toBe('Bearer fixture-page-token');
    await settled(ui);
  });
  it('adds only the selected ID through native input and preserves existing model configuration in the save', async () => {
    const ui = install(); await authorize(ui); await discover(ui);
    await select(ui, modelIds[21]);
    const rows = [...ui.form.querySelectorAll('.pmt-grid:not(.pmt-head)')];
    expect(rows.map((row) => row.querySelector('input').value)).toEqual(['existing-model', modelIds[21]]);
    expect(ui.inputs).toEqual([{ node: rows[1].querySelector('input'), value: modelIds[21] }]);
    expect(ui.writes()).toEqual([]);
    const body = { type: 'openai', models: rows.map((row) => ({
      model: row.querySelector('input').value, max_context_size: 131072,
    })) };
    await ui.view.fetch('/api/v1/providers/provider-fixture', { method: 'PUT', body: JSON.stringify(body) });
    const saved = JSON.parse(ui.writes()[0][1].body);
    expect(saved.models.map(({ model }) => model)).toEqual(['existing-model', modelIds[21]]);
    expect(saved.models[0]).toMatchObject({ capabilities: ['tool_use'], support_efforts: ['low'], adaptive_thinking: false });
    expect([...rows[1].querySelectorAll('.okw-model-options input:checked')].map((input) => input.value))
      .toEqual(['image_in', 'tool_use', 'thinking', 'always_thinking', 'none', 'low', 'medium', 'high', 'xhigh', 'max',
        'adaptive_thinking']);
    expect(saved.models[1]).toEqual({ ...body.models[1], capabilities: ['image_in', 'tool_use', 'thinking', 'always_thinking'],
      support_efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], adaptive_thinking: true });
    expect(ui.view.localStorage.setItem).not.toHaveBeenCalled();
    await settled(ui);
  });
  it('fills an existing empty row and rejects a duplicate without appending or persisting anything', async () => {
    const ui = install({ empty: true }); await authorize(ui); await discover(ui);
    await select(ui, modelIds[0]); await select(ui, modelIds[0]);
    expect(ui.form.querySelectorAll('.pmt-grid:not(.pmt-head)')).toHaveLength(1);
    expect(ui.query('.okw-discovery-status').dataset.state).toBe('error');
    expect(ui.query('.okw-discovery-status').textContent).toBe('That model is already in the list');
    expect(ui.writes()).toEqual([]); await settled(ui);
  });
});

describe('discovery failure and mounted language boundaries', () => {
  it.each([
    ['missing base URL', 'Enter a Base URL first'],
    ['missing authorization', 'Page authorization is not ready; try again shortly'],
  ])('does not request discovery for %s', async (reason, message) => {
    const ui = install();
    if (reason === 'missing base URL') ui.form.querySelector('.pf-field:has(label) input[value^="https"]').value = '';
    await discover(ui);
    expect(ui.nativeFetch).not.toHaveBeenCalled();
    expect(ui.query('.okw-discovery-status').textContent).toBe(message); await settled(ui);
  });
  it.each([
    ['empty models', () => Response.json({ models: [] }), 'The endpoint returned no usable models'],
    ['request failure', () => Response.json({ error: '模型拉取失败' }, { status: 502 }), 'Could not fetch models'],
  ])('keeps selection disabled for %s', async (_name, response, message) => {
    const ui = install(); await authorize(ui);
    ui.nativeFetch.mockResolvedValueOnce(response()); await discover(ui);
    expect(ui.query('.okw-discovery-select').disabled).toBe(true);
    expect(ui.query('.okw-discovery-add').disabled).toBe(true);
    expect(ui.query('.okw-discovery-button').disabled).toBe(false);
    expect(ui.query('.okw-discovery-status').textContent).toBe(message);
    expect(ui.writes()).toEqual([]); await settled(ui);
  });
  it('does not enable discovery for a managed provider', async () => {
    const ui = install({ disabled: true }); await authorize(ui); await discover(ui);
    expect(ui.query('.okw-discovery-button').disabled).toBe(true);
    expect(ui.nativeFetch).toHaveBeenCalledTimes(1); expect(ui.writes()).toEqual([]); await settled(ui);
  });
  it('refreshes mounted candidate labels without losing selection or adding a request', async () => {
    const ui = install(); await authorize(ui); await discover(ui);
    const control = ui.query('.okw-discovery-select'); control.value = modelIds[21];
    const requests = ui.nativeFetch.mock.calls.length;
    ui.values.set('kimi-locale', 'zh'); ui.doc.body.append(ui.doc.createElement('div')); await tick();
    expect(control.value).toBe(modelIds[21]);
    expect(control.getAttribute('aria-label')).toBe('选择已发现的模型');
    expect(ui.query('.okw-discovery-button').textContent).toBe('拉取模型');
    expect(ui.query('.okw-discovery-status').textContent).toBe('已发现 22 个模型');
    expect(ui.nativeFetch).toHaveBeenCalledTimes(requests); await settled(ui);
  });
});
