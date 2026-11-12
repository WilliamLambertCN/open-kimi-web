/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, deferred, flush, models, setup } from './testkit/sideChatModel.mjs';

afterEach(cleanup);
const prepare = async () => {
  const env = setup();
  env.tabs(['side-1', 'side-2']);
  await env.auth();
  await flush();
  return env;
};
const open = async (env) => { env.doc.querySelector('.okw-sidechat-model-trigger').click(); await flush(); };
const choose = (env, id) => [...env.doc.querySelectorAll('.model-row')].find((node) => node.dataset.model === id).click();
const action = (env, text) => [...env.doc.querySelectorAll('dialog button')].find((node) => node.textContent === text).click();
const input = (env, value) => {
  const search = env.doc.querySelector('dialog input'); search.value = value; search.dispatchEvent(new env.view.Event('input'));
};
const keyboard = (env, key) => env.doc.querySelector('dialog input').dispatchEvent(
  new env.view.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

describe('side chat model picker', () => {
  it('adds one entry and applies a page-only choice with focus restoration', async () => {
    const env = await prepare(); await open(env); choose(env, 'fast'); action(env, 'Use model'); await flush();
    expect(env.api.choice('A', 'side-1')).toEqual({ model: 'fast', effort: '' });
    const entry = env.doc.querySelector('.okw-sidechat-model-trigger'); expect(entry.textContent).toContain('Fast');
    expect(env.doc.activeElement).toBe(entry); expect(env.doc.querySelector('dialog')).toBeNull();
    expect(env.doc.querySelectorAll('.okw-sidechat-model-trigger')).toHaveLength(1); await env.settle();
  });
  it('cancels changes via button or Escape without writes or losing a draft', async () => {
    const env = await prepare(); env.doc.querySelector('.sc-body').textContent = 'Fictional retained draft';
    await open(env); choose(env, 'fast'); action(env, 'Cancel'); await open(env); choose(env, 'plain'); keyboard(env, 'Escape');
    expect(env.api.choice('A', 'side-1').model).toBe('');
    expect(env.doc.querySelector('.sc-body').textContent).toBe('Fictional retained draft');
    expect(env.fetch.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true); await env.settle();
  });
  it('searches labels, aliases and providers and filters provider chips', async () => {
    const env = await prepare(); await open(env); input(env, 'beta');
    expect(env.doc.querySelectorAll('.model-row')).toHaveLength(2); input(env, 'no such model');
    expect(env.doc.querySelector('.okw-sidechat-empty').hidden).toBe(false); input(env, '');
    [...env.doc.querySelectorAll('.chip')].find((node) => node.textContent === 'alpha').click();
    expect(env.doc.querySelectorAll('.model-row')).toHaveLength(1);
    expect(env.doc.querySelector('.model-name').textContent).toBe('Balanced');
    [...env.doc.querySelectorAll('.chip')].find((node) => node.textContent === 'All').click();
    expect(env.doc.querySelectorAll('.model-row')).toHaveLength(4); await env.settle();
  });
  it('supports keyboard model navigation, explicit effort and locale changes', async () => {
    const env = await prepare(); await open(env); input(env, 'fast'); keyboard(env, 'End'); keyboard(env, 'Enter');
    const effort = env.doc.querySelector('dialog select'); effort.value = 'low';
    effort.dispatchEvent(new env.view.Event('change'));
    env.locale('zh'); expect(env.doc.querySelector('dialog h2').textContent).toBe('侧聊模型');
    expect(env.doc.querySelector('dialog input').placeholder).toBe('搜索模型或供应商…');
    action(env, '使用'); expect(env.api.choice('A', 'side-1')).toEqual({ model: 'fast', effort: 'low' }); await env.settle();
  });
  it('keeps separate choices across native tab remounts and returns to following', async () => {
    const env = await prepare(); await open(env); choose(env, 'fast'); action(env, 'Use model');
    env.tabs(['side-1', 'side-2'], 1); await flush(); await open(env); choose(env, 'plain'); action(env, 'Use model');
    expect(env.api.choice('A', 'side-2').model).toBe('plain'); expect(env.api.choice('A', 'side-1').model).toBe('fast');
    env.tabs(['side-1', 'side-2'], 0); await flush(); await open(env); choose(env, ''); action(env, 'Use model');
    expect(env.api.choice('A', 'side-1').model).toBe(''); expect(env.api.choice('A', 'side-2').model).toBe('plain');
    await env.settle();
  });
  it('closes and aborts catalog loading when the side identity changes', async () => {
    const env = await prepare(); const pending = deferred(); const api = env.view.__okwMobileSubagentApi;
    api.load = () => pending.promise; env.doc.querySelector('.okw-sidechat-model-trigger').click();
    env.route('B'); await flush(); expect(env.doc.querySelector('dialog')).toBeNull();
    pending.resolve({ models: Object.entries(models).map(([id, value]) => ({ id, ...value })) }); await flush();
    expect(env.doc.querySelector('dialog')).toBeNull(); await env.settle();
  });
  it('shows retryable errors and lets a later successful catalog recover', async () => {
    const env = await prepare(); const load = env.view.__okwMobileSubagentApi.load;
    env.view.__okwMobileSubagentApi.load = async () => { throw new Error('requestFailed'); }; await open(env);
    expect(env.doc.querySelector('.okw-sidechat-status').textContent).toContain('Could not load');
    expect(env.doc.querySelector('.okw-sidechat-actions button:last-child').disabled).toBe(true);
    env.view.__okwMobileSubagentApi.load = load; action(env, 'Retry'); await flush();
    choose(env, 'fast'); action(env, 'Use model');
    expect(env.api.choice('A', 'side-1').model).toBe('fast'); await env.settle();
  });
  it('allows following with zero or one configured model and marks a stale choice', async () => {
    const env = await prepare(); env.config({ models: {} }); await open(env);
    expect(env.doc.querySelectorAll('.model-row')).toHaveLength(1); choose(env, ''); action(env, 'Use model');
    env.config({ models: { fast: models.fast } }); await open(env);
    expect(env.doc.querySelectorAll('.model-row')).toHaveLength(2);
    choose(env, 'fast'); action(env, 'Use model'); env.config({ models: {} }); await open(env);
    expect(env.doc.querySelector('.okw-sidechat-status').textContent).toContain('unavailable');
    choose(env, ''); action(env, 'Use model'); expect(env.api.choice('A', 'side-1').model).toBe(''); await env.settle();
  });
});
