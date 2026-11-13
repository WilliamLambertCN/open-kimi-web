/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import {
  change, checksOf, cleanupProviderSave, defaultMetadata, installProviderSave, loadConfig, manualModel,
  rowsOf, save, saveBody,
} from './testkit/providerSave.mjs';

afterEach(cleanupProviderSave);

const modelMismatch = {
  en: 'The model list changed; save was cancelled. Reopen the provider form and try again.',
  zh: '模型列表已变化，本次未保存。请重新打开供应商表单后重试。',
};

const jsonPost = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body) });

describe('provider metadata mapping fails before a write', () => {
  it.each([
    ['model identity', (body) => ({ ...body, models: [manualModel('different-model')] })],
    ['row count', (body) => ({ ...body, models: [...body.models, manualModel('another-model')] })],
  ])('rejects %s and keeps the draft available for a successful retry', async (_name, transform) => {
    const ui = installProviderSave(); await loadConfig(ui);
    const row = rowsOf(ui.forms[0])[0]; change(ui, row, 'thinking', false);
    const checks = checksOf(row); const body = saveBody([manualModel()]);
    const before = ui.nativeFetch.mock.calls.length;
    const failed = await ui.view.fetch('/api/v1/providers', jsonPost(transform(body)));
    expect([failed.status, failed.ok]).toEqual([409, false]);
    expect(await failed.json()).toEqual({ code: 409, msg: modelMismatch.en, data: null });
    expect(ui.nativeFetch.mock.calls).toHaveLength(before);
    expect(checksOf(row)).toEqual(checks);
    const saved = await save(ui, body);
    expect(saved.models[0]).toEqual({ ...manualModel(), ...defaultMetadata,
      capabilities: ['image_in', 'tool_use', 'always_thinking'] });
  });

  it('reports the same failure in Chinese for a same-origin Request', async () => {
    const ui = installProviderSave(); ui.doc.documentElement.lang = 'zh'; await loadConfig(ui);
    const body = saveBody([manualModel(), manualModel('another-model')]);
    const before = ui.nativeFetch.mock.calls.length;
    const failed = await ui.view.fetch(new Request('http://localhost/api/v1/providers', jsonPost(body)));
    expect([failed.status, failed.ok]).toEqual([409, false]);
    expect(await failed.json()).toEqual({ code: 409, msg: modelMismatch.zh, data: null });
    expect(ui.nativeFetch.mock.calls).toHaveLength(before);
  });
});
