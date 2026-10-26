/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import {
  change, checksOf, cleanupProviderSave, defaultChecks, defaultMetadata, installProviderSave, loadConfig, manualModel,
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

describe('provider new-model defaults', () => {
  it('selects every option except video input and image output for a new row', async () => {
    const ui = installProviderSave(); await loadConfig(ui);
    const row = rowsOf(ui.forms[0])[0];
    expect(checksOf(row)).toEqual(defaultChecks);
    expect(row.querySelector('fieldset').title).toContain('not guaranteed');
  });

  it.each(['POST', 'PUT'])('saves untouched new defaults in the actual %s body and reopens them', async (method) => {
    const ui = installProviderSave(); await loadConfig(ui);
    const body = saveBody([manualModel()]);
    const saved = await save(ui, body, { method, path: method === 'PUT' ? '/api/v1/providers/provider-fixture' :
      '/api/v1/providers' });
    expect(saved).toEqual({ ...body, models: [{ ...body.models[0], ...defaultMetadata }] });
    const form = await reopen(ui, saved);
    expect(checksOf(rowsOf(form)[0])).toEqual(defaultChecks);
    expect(rowsOf(form)[0].querySelector('fieldset').title).toBe('');
    expect(await save(ui, saved, { method: 'PUT', path: '/api/v1/providers/provider-fixture' })).toEqual(saved);
  });

  it('writes the displayed defaults when the native new-model body omits all metadata', async () => {
    const ui = installProviderSave(); await loadConfig(ui);
    const body = saveBody([{ model: 'fixture-model', max_context_size: 131072 }]);
    expect((await save(ui, body)).models[0]).toEqual({ ...body.models[0], ...defaultMetadata });
  });

  it.each(defaultChecks)('preserves cancellation of the default %s in save and reopen', async (value) => {
    const ui = installProviderSave(); await loadConfig(ui);
    const row = rowsOf(ui.forms[0])[0]; change(ui, row, value, false);
    const expected = defaultChecks.filter((item) => item !== value);
    expect(checksOf(row)).toEqual(expected);
    const saved = await save(ui, saveBody([manualModel()]));
    const actual = saved.models[0];
    expect(actual.capabilities).toEqual(defaultMetadata.capabilities.filter((item) => item !== value));
    expect(actual.support_efforts).toEqual(defaultMetadata.support_efforts.filter((item) => item !== value));
    expect(actual.adaptive_thinking).toBe(value !== 'adaptive_thinking');
    const form = await reopen(ui, saved);
    expect(checksOf(rowsOf(form)[0])).toEqual(expected);
  });

  it.each(['image_out', 'video_in'])('saves an explicitly selected %s with the other new defaults', async (value) => {
    const ui = installProviderSave(); await loadConfig(ui);
    change(ui, rowsOf(ui.forms[0])[0], value, true);
    const saved = await save(ui, saveBody([manualModel()]));
    expect(saved.models[0]).toEqual({ ...manualModel(), ...defaultMetadata,
      capabilities: [...defaultMetadata.capabilities, value] });
    const form = await reopen(ui, saved);
    expect(checksOf(rowsOf(form)[0])).toContain(value);
  });

  it('keeps unknown catalog metadata while applying the selected defaults to every known option', async () => {
    const ui = installProviderSave(); await loadConfig(ui);
    const native = { ...manualModel(), capabilities: ['image_out', 'video_in', 'future_capability'],
      support_efforts: ['future_effort'], adaptive_thinking: false, display_name: 'Catalog fixture', max_output_size: 8192 };
    const saved = await save(ui, saveBody([native]));
    expect(saved.models[0]).toEqual({ ...native, ...defaultMetadata,
      capabilities: [...defaultMetadata.capabilities, 'future_capability'],
      support_efforts: [...defaultMetadata.support_efforts, 'future_effort'] });
    const form = await reopen(ui, saved);
    expect(checksOf(rowsOf(form)[0])).toEqual(defaultChecks);
    expect(rowsOf(form)[0].querySelector('.okw-model-options .pf-hint-inline').textContent).toContain('future_effort');
  });

  it('keeps all cancelled options empty and false even when the native catalog declares them supported', async () => {
    const ui = installProviderSave(); await loadConfig(ui);
    const row = rowsOf(ui.forms[0])[0];
    defaultChecks.forEach((value) => change(ui, row, value, false));
    const native = { ...manualModel(), capabilities: [...defaultMetadata.capabilities, 'image_out', 'video_in'],
      support_efforts: [...defaultMetadata.support_efforts] };
    const saved = await save(ui, saveBody([native]));
    expect(saved.models[0]).toEqual({ ...native, capabilities: [], support_efforts: [], adaptive_thinking: false });
    const form = await reopen(ui, saved);
    expect(checksOf(rowsOf(form)[0])).toEqual([]);
  });
});

describe('provider native metadata preservation', () => {
  it.each(['POST', 'PUT'])('retains untouched catalog metadata for a saved model with missing fields in %s', async (method) => {
    const ui = installProviderSave({ config: { known: { provider: 'provider-fixture', model: 'fixture-model' } } });
    await loadConfig(ui);
    const model = { ...manualModel(), capabilities: ['image_in', 'future_capability'], support_efforts: ['native_effort'],
      adaptive_thinking: false, display_name: 'Catalog fixture', max_output_size: 4096 };
    const body = saveBody([model]);
    expect(await save(ui, body, { method, path: method === 'PUT' ? '/api/v1/providers/provider-fixture' :
      '/api/v1/providers' })).toEqual(body);
  });

  it('does not fill missing fields of an existing model when the native body also omits them', async () => {
    const ui = installProviderSave({ config: { known: { provider: 'provider-fixture', model: 'fixture-model' } } });
    await loadConfig(ui);
    const body = saveBody([{ model: 'fixture-model', max_context_size: 131072 }]);
    expect(await save(ui, body)).toEqual(body);
  });

  it('keeps explicitly empty saved arrays and adaptive false through save and reopen', async () => {
    const ui = installProviderSave({ config: { known: { ...configured,
      capabilities: [], supportEfforts: [], adaptiveThinking: false } } });
    await loadConfig(ui);
    expect(checksOf(rowsOf(ui.forms[0])[0])).toEqual([]);
    const saved = await save(ui, saveBody([{ model: 'fixture-model', max_context_size: 131072 }]));
    expect(saved.models[0]).toEqual({ model: 'fixture-model', max_context_size: 131072,
      capabilities: [], support_efforts: [], adaptive_thinking: false });
    const form = await reopen(ui, saved);
    expect(checksOf(rowsOf(form)[0])).toEqual([]);
  });

  it('uses listed explicit model metadata instead of replacing it with new-model defaults', async () => {
    const ui = installProviderSave({ listed: [{ ...configured, supportEfforts: undefined,
      support_efforts: ['low', 'listed_effort'], adaptiveThinking: undefined, adaptive_thinking: false }] });
    await ui.view.fetch('/api/v1/models'); await tick();
    expect(checksOf(rowsOf(ui.forms[0])[0])).toEqual(['tool_use', 'thinking', 'low']);
    const saved = await save(ui, saveBody([{ model: 'fixture-model' }]));
    expect(saved.models[0]).toEqual({ model: 'fixture-model', capabilities: configured.capabilities,
      support_efforts: ['low', 'listed_effort'], adaptive_thinking: false });
  });

  it('restores omitted explicit saved lists and false without replacing fields already present in native body', async () => {
    const ui = installProviderSave({ config: { known: configured } }); await loadConfig(ui);
    const model = { model: 'fixture-model', max_context_size: 131072 };
    expect((await save(ui, saveBody([model]))).models[0]).toEqual({ ...model,
      capabilities: configured.capabilities, support_efforts: configured.supportEfforts, adaptive_thinking: false });
    const native = { ...model, capabilities: [], support_efforts: [], adaptive_thinking: true };
    expect((await save(ui, saveBody([native]))).models[0]).toEqual(native);
  });
});

describe('provider saved-model option deltas', () => {
  it('updates only the explicitly changed capability and retains native unknown values, efforts and adaptive false', async () => {
    const ui = installProviderSave({ config: { known: configured } }); await loadConfig(ui);
    change(ui, rowsOf(ui.forms[0])[0], 'thinking', false);
    const native = { ...configuredWire, capabilities: ['tool_use', 'thinking', 'native_extra'] };
    expect((await save(ui, saveBody([native]))).models[0]).toEqual({ ...native,
      capabilities: ['tool_use', 'native_extra'] });
  });

  it('uses catalog capabilities as the edit base for an existing model with no saved capabilities', async () => {
    const ui = installProviderSave({ config: { known: { provider: 'provider-fixture', model: 'fixture-model' } } });
    await loadConfig(ui); change(ui, rowsOf(ui.forms[0])[0], 'thinking', false);
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

  it('preserves late-loaded saved metadata while applying only the existing row edit', async () => {
    const ui = installProviderSave(); await loadConfig(ui);
    const row = rowsOf(ui.forms[0])[0]; change(ui, row, 'thinking', false);
    await loadConfig(ui, { known: configured });
    expect(row.querySelector('input[value="thinking"]').checked).toBe(false);
    const saved = await save(ui, saveBody([configuredWire]));
    expect(saved.models[0]).toEqual({ ...configuredWire, capabilities: ['tool_use', 'future_capability'] });
    expect(ui.state.exceededLimit).toBe(false);
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

  it('keeps existing empty settings separate from edited new defaults after sorting and reopen', async () => {
    const first = { ...manualModel(), capabilities: [], support_efforts: [], adaptive_thinking: false };
    const second = { ...manualModel('new-model'), display_name: 'New fixture', max_output_size: 4096 };
    const ui = installProviderSave({ forms: [{ models: [first, second] }], config: {
      known: { ...configured, capabilities: [], supportEfforts: [], adaptiveThinking: false },
    } });
    await loadConfig(ui);
    const [a, b] = rowsOf(ui.forms[0]);
    expect(checksOf(a)).toEqual([]); expect(checksOf(b)).toEqual(defaultChecks);
    change(ui, b, 'xhigh', false); change(ui, b, 'adaptive_thinking', false);
    moveFirstToEnd(ui, ui.forms[0]);
    const saved = await save(ui, saveBody([first, second]));
    expect(saved.models).toEqual([{ ...second, ...defaultMetadata,
      support_efforts: ['none', 'low', 'medium', 'high', 'max'], adaptive_thinking: false }, first]);
    const form = await reopen(ui, saved);
    const rows = rowsOf(form);
    expect(rows.map((row) => row.querySelector('input:not([type="checkbox"])').value)).toEqual(['new-model', 'fixture-model']);
    expect(checksOf(rows[0])).toEqual(defaultChecks.filter((value) => value !== 'xhigh' && value !== 'adaptive_thinking'));
    expect(checksOf(rows[1])).toEqual([]);
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
    expect(saved).toEqual({ ...body, models: [{ ...body.models[0], ...defaultMetadata,
      capabilities: ['image_in', 'tool_use', 'always_thinking'] }] });
    const [request, options] = ui.nativeFetch.mock.calls.at(-1);
    expect(request).toBeInstanceOf(Request); expect(options).toBeUndefined();
    expect(request.method).toBe('PUT'); expect(request.headers.get('content-type')).toBe('application/json');
  });
});
