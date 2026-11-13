/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import {
  change, checksOf, cleanupProviderSave, defaultMetadata, installProviderSave, loadConfig, manualModel,
  moveFirstToEnd, rowsOf, saveBody, tick,
} from './testkit/providerSave.mjs';

afterEach(cleanupProviderSave);

const catalogMismatch = {
  en: 'Catalog import cannot save these model options; nothing was saved. Switch to manual add and try again.',
  zh: '目录导入无法保存当前模型选项，本次未保存。请切换到手动添加后重试。',
};

function preset(ui, form = ui.forms[0]) {
  const state = { dirty: false, inputs: [], pending: undefined };
  const footer = ui.doc.createElement('div');
  footer.className = 'pf-foot';
  footer.innerHTML = '<button type="button">Cancel</button><button type="button"><span>Save</span></button>';
  form.append(footer);
  const [cancel, button] = footer.querySelectorAll('button');
  const error = ui.doc.createElement('div');
  error.setAttribute('role', 'alert'); form.prepend(error);
  const base = form.querySelector('.pf-field:has(input[value^="https"]) input');
  base.addEventListener('input', () => { state.dirty = true; state.inputs.push(base.value); });
  button.addEventListener('click', () => {
    const models = ui.view.OpenKimiProviderSorting.reconcile(form).officialRows.map((row) =>
      manualModel(row.querySelector('input:not([type=checkbox])').value));
    const body = state.dirty ? saveBody(models) : { catalog_id: 'provider-fixture', api_key: 'fixture-key' };
    const path = state.dirty ? '/api/v1/providers' : '/api/v1/providers:import_catalog';
    state.pending = ui.view.fetch(path, { method: 'POST', body: JSON.stringify(body) })
      .catch((failure) => { error.textContent = failure.message; });
  });
  const submit = async (target = button) => {
    target.click(); await state.pending; await tick();
    const [input, init] = ui.nativeFetch.mock.calls.at(-1);
    return { path: String(input), body: JSON.parse(init.body) };
  };
  return { state, base, button, cancel, error, submit };
}

describe('official preset Save routing', () => {
  it('saves untouched displayed defaults instead of importing only the API key', async () => {
    const ui = installProviderSave(); const native = preset(ui); await loadConfig(ui);
    expect(native.state.dirty).toBe(false); expect(native.state.inputs).toEqual([]);
    const saved = await native.submit(native.button.querySelector('span'));
    expect(saved.path).toBe('/api/v1/providers');
    expect(saved.body.models).toEqual([{ ...manualModel(), ...defaultMetadata }]);
    expect(native.state.inputs).toEqual(['https://example.invalid/v1']);
    expect(native.base.value).toBe('https://example.invalid/v1');
    expect(native.error.textContent).toBe('');
  });

  it('routes changed capabilities, efforts and adaptive thinking through the native full-model save', async () => {
    const ui = installProviderSave(); const native = preset(ui); await loadConfig(ui);
    const row = rowsOf(ui.forms[0])[0];
    change(ui, row, 'thinking', false); change(ui, row, 'xhigh', false); change(ui, row, 'adaptive_thinking', false);
    const checks = checksOf(row);
    const saved = await native.submit();
    expect(saved.path).toBe('/api/v1/providers');
    expect(saved.body.models[0]).toEqual({ ...manualModel(), ...defaultMetadata,
      capabilities: ['image_in', 'tool_use', 'always_thinking'],
      support_efforts: ['none', 'low', 'medium', 'high', 'max'], adaptive_thinking: false });
    expect(checksOf(row)).toEqual(checks);
  });

  it('saves visual ordering even when no metadata checkbox was touched', async () => {
    const ui = installProviderSave({ forms: [{ models: [manualModel(), manualModel('second-model')] }] });
    const native = preset(ui); await loadConfig(ui); moveFirstToEnd(ui, ui.forms[0]);
    const saved = await native.submit();
    expect(saved.path).toBe('/api/v1/providers');
    expect(saved.body.models.map((model) => model.model)).toEqual(['second-model', 'fixture-model']);
    expect(saved.body.models.every((model) => model.support_efforts.length === 6)).toBe(true);
  });

  it('does not mark a form dirty on mount, catalog rendering, option changes or cancel', async () => {
    const ui = installProviderSave(); const native = preset(ui); await loadConfig(ui);
    const row = rowsOf(ui.forms[0])[0];
    row.querySelector('input:not([type=checkbox])').value = 'late-catalog-model';
    const marker = ui.doc.createElement('span'); row.append(marker); await tick();
    change(ui, row, 'thinking', false); native.cancel.click(); await tick();
    expect(native.state.dirty).toBe(false); expect(native.state.inputs).toEqual([]);
    expect(ui.nativeFetch.mock.calls).toHaveLength(1);
    const callbacks = ui.state.callbacks; await tick();
    expect(ui.state.exceededLimit).toBe(false); expect(ui.state.callbacks).toBe(callbacks);
  });

  it('does not dispatch synthetic input for a hidden, disabled or ambiguous form', async () => {
    const ui = installProviderSave({ forms: [{}, {}] });
    const native = preset(ui); await loadConfig(ui);
    native.button.click(); await native.state.pending;
    expect(native.state.inputs).toEqual([]);
    ui.forms[1].parentElement.hidden = true; ui.forms[0].parentElement.hidden = true;
    native.button.click(); await native.state.pending;
    expect(native.state.inputs).toEqual([]);
    ui.forms[0].parentElement.hidden = false; native.base.disabled = true;
    native.button.click(); await native.state.pending;
    expect(native.state.inputs).toEqual([]);
  });

  it('notifies the native form only once the config is loaded and Save is enabled', async () => {
    const ui = installProviderSave({ forms: [{ models: [manualModel('')] }] });
    expect(rowsOf(ui.forms[0])[0].querySelector('.okw-model-options')).toBeTruthy();
    const native = preset(ui);
    native.button.click(); await native.state.pending;
    expect(native.state.inputs).toEqual([]);
    native.button.disabled = true; await loadConfig(ui);
    native.button.dispatchEvent(new ui.view.Event('click', { bubbles: true, cancelable: true }));
    await native.state.pending;
    expect(native.state.inputs).toEqual([]);
    native.button.disabled = false;
    expect((await native.submit()).path).toBe('/api/v1/providers');
    expect(native.state.inputs).toEqual(['https://example.invalid/v1']);
  });
});

describe('catalog request safety when native routing does not change', () => {
  it.each(['en', 'zh'])('rejects a matching import before mutation with a readable %s error', async (locale) => {
    const ui = installProviderSave(); ui.doc.documentElement.lang = locale; await loadConfig(ui);
    const row = rowsOf(ui.forms[0])[0]; change(ui, row, 'thinking', false);
    const before = ui.nativeFetch.mock.calls.length;
    const failed = await ui.view.fetch('/api/v1/providers:import_catalog', {
      method: 'POST', body: JSON.stringify({ catalog_id: 'provider-fixture', api_key: 'fixture-key' }),
    });
    expect([failed.status, failed.ok]).toEqual([409, false]);
    expect(await failed.json()).toEqual({ code: 409, msg: catalogMismatch[locale], data: null });
    expect(ui.nativeFetch.mock.calls).toHaveLength(before);
    expect(checksOf(row)).not.toContain('thinking');
  });

  it('leaves unrelated and cross-origin imports unchanged', async () => {
    const ui = installProviderSave(); await loadConfig(ui);
    for (const [path, id] of [
      ['/api/v1/providers:import_catalog', 'other-provider'],
      ['https://other.invalid/api/v1/providers:import_catalog', 'provider-fixture'],
    ]) {
      const init = { method: 'POST', body: JSON.stringify({ catalog_id: id, api_key: 'fixture-key' }) };
      await ui.view.fetch(path, init);
      expect(ui.nativeFetch.mock.calls.at(-1)).toEqual([path, init]);
    }
  });

  it('blocks a matching Request import when no option was touched, without echoing credentials', async () => {
    const ui = installProviderSave(); await loadConfig(ui);
    const url = 'http://localhost/api/v1/providers:import_catalog';
    const init = { method: 'POST', headers: { authorization: 'Bearer fixture-token' },
      body: JSON.stringify({ id: 'provider-fixture', api_key: 'fixture-key' }) };
    const before = ui.nativeFetch.mock.calls.length;
    const failed = await ui.view.fetch(new ui.view.Request(url, init));
    expect([failed.status, failed.ok]).toEqual([409, false]);
    const rejection = await failed.json();
    expect(rejection).toEqual({ code: 409, msg: catalogMismatch.en, data: null });
    expect(JSON.stringify(rejection)).not.toMatch(/fixture-key|fixture-token/);
    expect(ui.nativeFetch.mock.calls).toHaveLength(before);
  });

  it('leaves a real catalog tab import untouched while the enhanced form is hidden', async () => {
    const ui = installProviderSave(); await loadConfig(ui);
    const row = rowsOf(ui.forms[0])[0]; change(ui, row, 'thinking', false);
    ui.doc.body.insertAdjacentHTML('beforeend', '<section class="ap-import"><div class="pmt">' +
      '<div class="pmt-grid pmt-head"></div><div class="pmt-grid"><input value="catalog-model"></div></section>');
    ui.forms[0].parentElement.hidden = true; await tick();
    const init = { method: 'POST', body: JSON.stringify({ catalog_id: 'provider-fixture', api_key: 'fixture-key' }) };
    await ui.view.fetch('/api/v1/providers:import_catalog', init);
    expect(ui.nativeFetch.mock.calls.at(-1)).toEqual(['/api/v1/providers:import_catalog', init]);
    expect(checksOf(row)).not.toContain('thinking');
  });
});
