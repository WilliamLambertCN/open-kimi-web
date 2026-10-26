/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import {
  change, checksOf, cleanupProviderSave, installProviderSave, loadConfig, manualModel,
  reopen, rowsOf, save, saveBody, tick,
} from './testkit/providerSave.mjs';

afterEach(cleanupProviderSave);
const hide = (form, mode) => {
  if (mode === 'form v-show') form.style.display = 'none';
  else if (mode === 'hidden ancestor') form.parentElement.hidden = true;
  else if (mode === 'ancestor v-show') form.parentElement.style.display = 'none';
  else form.parentElement.style.visibility = 'hidden';
};

describe('unique visible native provider form', () => {
  it.each(['form v-show', 'hidden ancestor', 'ancestor v-show', 'ancestor visibility'])
  ('saves and reopens the visible manual draft instead of the preset under %s', async (mode) => {
    const ui = installProviderSave({ forms: [
      { id: 'preset-fixture', models: [manualModel('preset-model')] }, {},
    ] });
    hide(ui.forms[0], mode); await loadConfig(ui);
    const [preset, manual] = ui.forms;
    const presetRow = rowsOf(preset)[0]; const manualRow = rowsOf(manual)[0];
    change(ui, presetRow, 'image_in', true); change(ui, presetRow, 'xhigh', true);
    change(ui, manualRow, 'thinking', false);
    const native = saveBody([manualModel()]);
    const saved = await save(ui, native);
    expect(saved).toEqual({ ...native, models: [{ ...native.models[0], capabilities: ['tool_use'] }] });
    expect(saved.models[0]).not.toHaveProperty('support_efforts');
    const form = await reopen(ui, saved);
    expect(checksOf(rowsOf(form)[0])).toEqual(['tool_use', 'adaptive_thinking']);
    const callbacks = ui.state.callbacks; await tick();
    expect(ui.state.exceededLimit).toBe(false); expect(ui.state.callbacks).toBe(callbacks);
  });

  it('does not guess between two visible forms even when only one provider name matches', async () => {
    const ui = installProviderSave({ forms: [{ id: 'unrelated-fixture' }, {}] }); await loadConfig(ui);
    change(ui, rowsOf(ui.forms[1])[0], 'thinking', false);
    const body = saveBody([manualModel()]);
    expect(await save(ui, body)).toEqual(body);
    expect(ui.nativeFetch.mock.calls.at(-1)[1].body).toBe(JSON.stringify(body));
  });

  it.each([
    ['POST identity', (body) => ({ ...body, id: 'different-fixture' }), {}],
    ['model identity', (body) => ({ ...body, models: [manualModel('different-model')] }), {}],
    ['row count', (body) => ({ ...body, models: [...body.models, manualModel('another-model')] }), {}],
    ['PUT path', (body) => body, { method: 'PUT', path: '/api/v1/providers/different-fixture' }],
    ['PUT rename', (body) => ({ ...body, new_id: 'different-fixture' }),
      { method: 'PUT', path: '/api/v1/providers/provider-fixture' }],
  ])('preserves an unmatched %s body without applying edits', async (_name, transform, options) => {
    const ui = installProviderSave(); await loadConfig(ui);
    change(ui, rowsOf(ui.forms[0])[0], 'thinking', false);
    const body = transform(saveBody([manualModel()]));
    expect(await save(ui, body, options)).toEqual(body);
    expect(ui.nativeFetch.mock.calls.at(-1)[1].body).toBe(JSON.stringify(body));
  });

  it('does not merge a hidden form or a detached form', async () => {
    const ui = installProviderSave(); await loadConfig(ui);
    change(ui, rowsOf(ui.forms[0])[0], 'thinking', false);
    ui.forms[0].parentElement.hidden = true;
    const body = saveBody([manualModel()]);
    expect(await save(ui, body)).toEqual(body);
    ui.forms[0].remove();
    expect(await save(ui, body)).toEqual(body);
  });

  it('does not change a cross-origin provider write', async () => {
    const ui = installProviderSave(); await loadConfig(ui);
    change(ui, rowsOf(ui.forms[0])[0], 'thinking', false);
    const body = saveBody([manualModel()]); const init = { method: 'POST', body: JSON.stringify(body) };
    await ui.view.fetch('https://other.invalid/api/v1/providers', init);
    expect(ui.nativeFetch.mock.calls.at(-1)).toEqual(['https://other.invalid/api/v1/providers', init]);
  });

  it('accepts an explicit rename only when new_id matches the visible form', async () => {
    const ui = installProviderSave({ forms: [{ id: 'renamed-fixture' }] }); await loadConfig(ui);
    change(ui, rowsOf(ui.forms[0])[0], 'thinking', false);
    const body = { ...saveBody([manualModel()], 'renamed-fixture'), new_id: 'renamed-fixture' };
    expect((await save(ui, body, { method: 'PUT', path: '/api/v1/providers/old-fixture' })).models[0].capabilities)
      .toEqual(['tool_use']);
  });
});
