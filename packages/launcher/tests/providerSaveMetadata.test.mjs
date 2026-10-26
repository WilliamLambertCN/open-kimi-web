/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import {
  change, checksOf, cleanupProviderSave, installProviderSave, loadConfig, manualModel,
  moveFirstToEnd, reopen, rowsOf, save, saveBody, tick,
} from './testkit/providerSave.mjs';

afterEach(cleanupProviderSave);
const configured = {
  provider: 'provider-fixture', model: 'fixture-model', capabilities: ['tool_use', 'thinking', 'future_capability'],
  supportEfforts: ['low', 'future_effort'], adaptiveThinking: false,
};
const configuredWire = {
  ...manualModel(), capabilities: [...configured.capabilities], support_efforts: [...configured.supportEfforts],
  adaptive_thinking: false, display_name: 'Fixture display', max_output_size: 8192,
};

describe('provider native metadata preservation', () => {
  it.each(['POST', 'PUT'])('retains untouched native catalog metadata in %s without filling every checkbox', async (method) => {
    const ui = installProviderSave();
    await loadConfig(ui);
    const row = rowsOf(ui.forms[0])[0];
    expect(checksOf(row)).toEqual(['tool_use', 'thinking', 'adaptive_thinking']);
    expect(row.querySelector('fieldset').title).toContain('No confirmed configuration');
    const model = { ...manualModel(), capabilities: ['image_in', 'future_capability'], support_efforts: ['native_effort'],
      adaptive_thinking: false, display_name: 'Catalog fixture', max_output_size: 4096 };
    const body = saveBody([model]);
    const saved = await save(ui, body, { method, path: method === 'PUT' ? '/api/v1/providers/provider-fixture' :
      '/api/v1/providers' });
    expect(saved).toEqual(body);
  });

  it('does not invent absent metadata for an unknown model', async () => {
    const ui = installProviderSave(); await loadConfig(ui);
    const body = saveBody([{ model: 'fixture-model', max_context_size: 131072 }]);
    expect(await save(ui, body)).toEqual(body);
  });

  it('restores omitted explicit saved lists and false without replacing fields already present in native body', async () => {
    const ui = installProviderSave({ config: { known: configured } }); await loadConfig(ui);
    const model = { model: 'fixture-model', max_context_size: 131072 };
    expect((await save(ui, saveBody([model]))).models[0]).toEqual({ ...model,
      capabilities: configured.capabilities, support_efforts: configured.supportEfforts, adaptive_thinking: false });
    const native = { ...model, capabilities: [], support_efforts: [], adaptive_thinking: true };
    expect((await save(ui, saveBody([native]))).models[0]).toEqual(native);
  });

  it('updates only the explicitly changed capability and retains native unknown values, efforts and adaptive false', async () => {
    const ui = installProviderSave({ config: { known: configured } }); await loadConfig(ui);
    change(ui, rowsOf(ui.forms[0])[0], 'thinking', false);
    const native = { ...configuredWire, capabilities: ['tool_use', 'thinking', 'native_extra'] };
    expect((await save(ui, saveBody([native]))).models[0]).toEqual({ ...native,
      capabilities: ['tool_use', 'native_extra'] });
  });

  it('uses native catalog capabilities as the base for a single unknown-model change, not manual defaults', async () => {
    const ui = installProviderSave(); await loadConfig(ui);
    change(ui, rowsOf(ui.forms[0])[0], 'thinking', false);
    const native = { ...manualModel(), capabilities: ['image_in', 'thinking', 'catalog_extra'] };
    expect((await save(ui, saveBody([native]))).models[0]).toEqual({ ...native,
      capabilities: ['image_in', 'catalog_extra'] });
  });

  it('updates only efforts and preserves existing capabilities and adaptive false', async () => {
    const ui = installProviderSave({ config: { known: configured } }); await loadConfig(ui);
    const row = rowsOf(ui.forms[0])[0];
    change(ui, row, 'low', false); change(ui, row, 'high', true);
    expect((await save(ui, saveBody([configuredWire]))).models[0]).toEqual({ ...configuredWire,
      support_efforts: ['future_effort', 'high'] });
  });

  it('updates adaptive thinking alone without changing either list', async () => {
    const ui = installProviderSave({ config: { known: configured } }); await loadConfig(ui);
    change(ui, rowsOf(ui.forms[0])[0], 'adaptive_thinking', true);
    expect((await save(ui, saveBody([configuredWire]))).models[0]).toEqual({ ...configuredWire, adaptive_thinking: true });
  });

  it('shows retained unlisted efforts and preserves them through an unrelated capability change and reopen', async () => {
    const ui = installProviderSave({ config: { known: configured } }); await loadConfig(ui);
    const row = rowsOf(ui.forms[0])[0];
    expect(row.querySelector('.okw-model-options .pf-hint-inline').textContent)
      .toBe('Retained unlisted efforts: future_effort');
    change(ui, row, 'image_in', true);
    const body = await save(ui, saveBody([configuredWire]));
    expect(body.models[0].support_efforts).toEqual(['low', 'future_effort']);
    expect(body.models[0].capabilities).toEqual([...configured.capabilities, 'image_in']);
    const form = await reopen(ui, body);
    expect(rowsOf(form)[0].querySelector('.okw-model-options .pf-hint-inline').textContent).toContain('future_effort');
    expect(checksOf(rowsOf(form)[0])).toEqual(['image_in', 'tool_use', 'thinking', 'low']);
  });

  it('retains capability drafts through a later config/models read while unedited fields follow the native body', async () => {
    const ui = installProviderSave({ config: { known: configured } }); await loadConfig(ui);
    const row = rowsOf(ui.forms[0])[0]; change(ui, row, 'thinking', false);
    await loadConfig(ui, { known: { ...configured, supportEfforts: ['medium'], adaptiveThinking: true } });
    await ui.view.fetch('/api/v1/models'); await tick();
    expect(row.querySelector('input[value="thinking"]').checked).toBe(false);
    const native = { ...configuredWire, support_efforts: ['medium'], adaptive_thinking: true };
    expect((await save(ui, saveBody([native]))).models[0]).toEqual({ ...native,
      capabilities: ['tool_use', 'future_capability'] });
    expect(ui.state.exceededLimit).toBe(false);
  });
});

describe('provider row and save boundaries', () => {
  it('pairs each native model and per-field edit after visual sorting', async () => {
    const first = configuredWire;
    const second = { ...manualModel('second-model'), support_efforts: ['medium'], display_name: 'Second' };
    const ui = installProviderSave({ forms: [{ models: [first, second] }], config: { first: configured,
      second: { provider: 'provider-fixture', model: 'second-model', capabilities: ['tool_use', 'thinking'],
        supportEfforts: ['medium'], adaptiveThinking: true } } });
    await loadConfig(ui);
    const [a, b] = rowsOf(ui.forms[0]);
    change(ui, a, 'thinking', false); change(ui, b, 'high', true);
    moveFirstToEnd(ui, ui.forms[0]);
    const body = await save(ui, saveBody([first, second]));
    expect(body.models).toEqual([{ ...second, support_efforts: ['medium', 'high'] },
      { ...first, capabilities: ['tool_use', 'future_capability'] }]);
  });

  it('preserves managed rows even if an unexpected change event is dispatched', async () => {
    const ui = installProviderSave({ forms: [{ managed: true }], config: { known: configured } }); await loadConfig(ui);
    const row = rowsOf(ui.forms[0])[0];
    expect([...row.querySelectorAll('.okw-model-options input')].every((input) => input.disabled)).toBe(true);
    change(ui, row, 'thinking', false);
    const body = saveBody([manualModel()]);
    expect(await save(ui, body)).toEqual(body);
  });

  it('leaves the original request untouched until configuration is loaded', async () => {
    const ui = installProviderSave();
    expect(rowsOf(ui.forms[0])[0].querySelector('.okw-model-options')).toBeNull();
    const body = saveBody([manualModel()]);
    expect(await save(ui, body)).toEqual(body);
    expect(ui.nativeFetch.mock.calls.at(-1)[1].body).toBe(JSON.stringify(body));
  });

  it('merges a same-origin Request while preserving its method, headers and all unrelated body fields', async () => {
    const ui = installProviderSave(); await loadConfig(ui);
    change(ui, rowsOf(ui.forms[0])[0], 'thinking', false);
    const body = saveBody([manualModel()]);
    const saved = await save(ui, body, { method: 'PUT', path: '/api/v1/providers/provider-fixture', request: true });
    expect(saved).toEqual({ ...body, models: [{ ...body.models[0], capabilities: ['tool_use'] }] });
    const [request, options] = ui.nativeFetch.mock.calls.at(-1);
    expect(request).toBeInstanceOf(Request); expect(options).toBeUndefined();
    expect(request.method).toBe('PUT'); expect(request.headers.get('content-type')).toBe('application/json');
  });
});
