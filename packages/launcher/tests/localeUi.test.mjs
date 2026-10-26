/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = (name) => readFileSync(resolve(`packages/launcher/src/mobile/${name}.js`), 'utf8');
const instances = [];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const han = /\p{Script=Han}/u;
const native = `<div id="app"><div class="app mobile">
  <div class="topbar"><div class="tb-main"><span class="dir">用户工作区</span></div><span class="st">Idle</span></div>
  <div class="composer"><div class="ph" contenteditable="true">用户草稿</div>
    <div class="toolbar-right"><button class="stop">Stop</button><button class="send">Send</button></div></div>
  <aside class="side"><footer class="side-footer">Account</footer></aside></div></div>
  <div class="sheet-panel" aria-label="Settings"><h2 class="sheet-title">Settings</h2>
    <div class="sheet-body"><div class="card">Official settings</div></div></div>`;
const model = (id = 'vendor/model') => ({ id: `model:${id}`, model: id, modelId: id, aliases: ['用户别名'],
  input: 12, cacheRead: 3, cacheWrite: 2, output: 4, totalTokens: 21, totalInput: 17, requests: 1,
  costUsd: 0.002, costComplete: false, unpricedTokens: 1, unpricedRequests: 1,
  suggestion: { catalogKey: 'public/model', provider: 'Public', name: 'Model', matchKind: 'exact', confidence: 1,
    rates: { input: 1, cacheRead: 0, cacheWrite: 2, output: 3 } } });
const data = () => ({ available: true, totals: model(), models: [model(), { ...model(),
  id: 'unresolved', model: '模型 ID 未确认', modelId: null, suggestion: null }],
  modelOptions: [{ id: 'model:vendor/model', label: 'vendor/model', modelId: 'vendor/model' },
    { id: 'unresolved', label: '模型 ID 未确认', modelId: null }], workspaces: [],
  buckets: [{ ...model(), time: Date.now() }], quality: { notes: [{ code: 'badLines', message: '部分记录格式无效', count: 2 }] } });
const pricing = { catalog: [], mappings: {}, legacyMappingsIgnored: 2, updatedAt: null, source: 'built-in' };

function install(locale = 'en', language = 'zh-CN') {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const view = frame.contentWindow;
  const doc = view.document;
  doc.body.innerHTML = native;
  doc.documentElement.lang = 'zh';
  view.localStorage.clear();
  if (locale !== null) view.localStorage.setItem('kimi-locale', locale);
  Object.defineProperty(view.navigator, 'language', { configurable: true, value: language });
  Object.assign(view, { Request, Response, Headers });
  view.matchMedia = () => ({ matches: true, addEventListener() {} });
  view.requestAnimationFrame = (callback) => callback();
  const fetch = vi.fn(async (url) => new Response(JSON.stringify(String(url).includes('/pricing') ? pricing : data())));
  view.fetch = fetch;
  const observers = [];
  const state = { calls: 0, exceeded: false };
  const Native = view.MutationObserver;
  view.MutationObserver = class extends Native {
    constructor(callback) {
      super((records, observer) => {
        state.calls += 1;
        if (state.calls > 120) { state.exceeded = true; observers.forEach((item) => item.disconnect()); return; }
        callback(records, observer);
      });
      observers.push(this);
    }
  };
  const evaluate = (name) => view.eval(`((location) => { ${source(name)} })({
    href:'http://localhost/',origin:'http://localhost',pathname:'/'});`);
  evaluate('locale');
  instances.push({ frame, observers });
  return { view, doc, state, evaluate, fetch };
}
async function settled(ui) {
  await tick();
  const calls = ui.state.calls;
  await tick();
  expect(ui.state.calls).toBe(calls);
  expect(ui.state.exceeded).toBe(false);
}
function systemText(root) {
  return [...root.querySelectorAll('*')].flatMap((node) => [
    ...[...node.childNodes].filter((child) => child.nodeType === 3).map((child) => child.textContent),
    ...['title', 'aria-label', 'placeholder', 'data-label'].map((key) => node.getAttribute(key) ?? ''),
  ]).filter(han.test.bind(han));
}
afterEach(() => {
  instances.splice(0).forEach(({ frame, observers }) => { observers.forEach((item) => item.disconnect()); frame.remove(); });
});

describe('official locale semantics', () => {
  it.each([['en', 'zh-CN', 'en'], ['zh', 'en-US', 'zh'], ['invalid', 'zh-CN', 'zh'], [null, 'en-US', 'en']])(
    'uses stored %s before browser %s', (stored, language, expected) => {
      expect(install(stored, language).view.__okwLocale.current()).toBe(expected);
    },
  );
  it('falls back to browser language when storage is unavailable and ignores root language', () => {
    const ui = install('zh', 'en-US');
    vi.spyOn(ui.view.Storage.prototype, 'getItem').mockImplementation(() => { throw Error('blocked'); });
    expect(ui.view.__okwLocale.current()).toBe('en');
  });
  it('updates mounted theme and priority controls from same-tab official UI mutations without storageevent', async () => {
    const ui = install('zh');
    ui.evaluate('themes');
    ui.evaluate('presentation');
    await settled(ui);
    const trigger = ui.doc.querySelector('.okw-theme-trigger');
    trigger.click();
    const option = ui.doc.querySelector('[data-theme="ember"]');
    const count = ui.fetch.mock.calls.length;
    ui.view.localStorage.setItem('kimi-locale', 'en');
    ui.doc.querySelector('.sheet-title').firstChild.data = 'Settings';
    ui.doc.querySelector('.st').firstChild.data = 'Idle';
    await settled(ui);
    expect(systemText(ui.doc.querySelector('.okw-theme-section'))).toEqual([]);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(ui.doc.querySelector('[data-theme="ember"]')).toBe(option);
    expect(ui.doc.querySelector('.okw-steer-button').textContent).toBe('Send now');
    expect(ui.doc.querySelector('.okw-steer-button').title).not.toMatch(han);
    expect(ui.doc.querySelector('.dir').textContent).toBe('用户工作区');
    expect(ui.doc.querySelector('.ph').textContent).toBe('用户草稿');
    expect(ui.fetch.mock.calls).toHaveLength(count);
  });
  it('updates the cloned official cache note after the native source is translated', async () => {
    const ui = install('zh');
    const panel = ui.doc.querySelector('.sheet-panel');
    panel.setAttribute('aria-label', '设置');
    const root = ui.doc.createElement('div');
    root.className = 'sheet-root';
    panel.before(root);
    root.append(panel);
    panel.querySelector('.sheet-body').innerHTML = '<h3 class="group-title">当前会话</h3><div class="card">' +
      '<div class="srow"><span class="srow-label">思考强度</span></div></div><p class="cache-note">中文缓存提示</p>';
    ui.evaluate('presentation');
    await settled(ui);
    const copy = panel.querySelector('.okw-cache-note-inline');
    expect(copy.textContent).toBe('中文缓存提示');
    ui.view.localStorage.setItem('kimi-locale', 'en');
    panel.setAttribute('aria-label', 'Settings');
    panel.querySelector('.cache-note').textContent = 'Official English cache note';
    await settled(ui);
    expect(panel.querySelector('.okw-cache-note-inline')).toBe(copy);
    expect(copy.textContent).toBe('Official English cache note');
  });
});

describe('localized provider controls', () => {
  it('updates mounted provider controls and async status without losing user edits or refetching', async () => {
    const ui = install('zh');
    ui.doc.body.insertAdjacentHTML('beforeend', `<div class="pf">
      <div class="pf-field"><label>Name *</label><input value="用户供应商"></div>
      <div class="pf-field"><label>Base URL *</label><input value="https://example.invalid/v1"></div>
      <div class="pf-field"><label>Models *</label><div class="pmt">
        <div class="pmt-grid pmt-head"></div><div class="pmt-grid"><input value=""><input value="131072"></div>
      </div></div><button>Add model</button></div>`);
    vi.spyOn(ui.view.Element.prototype, 'getClientRects').mockReturnValue([{ width: 640, height: 400 }]);
    ['providerLocale', 'providerSorting', 'providerModelState', 'providerEnhancements'].forEach(ui.evaluate);
    ui.fetch.mockResolvedValueOnce(Response.json({ code: 0, data: { models: {} } }));
    await ui.view.fetch('/api/v1/config');
    await settled(ui);
    const form = ui.doc.querySelector('.pf');
    const input = form.querySelector('.pmt-grid:not(.pmt-head) > input');
    input.value = '用户模型';
    const checkbox = form.querySelector('input[value="thinking"]');
    expect(checkbox.checked).toBe(true);
    checkbox.click();
    const fetchButton = form.querySelector('.okw-discovery-button');
    fetchButton.click();
    expect(form.querySelector('.okw-discovery-status').textContent).toContain('授权');
    const requests = ui.fetch.mock.calls.length;
    ui.view.localStorage.setItem('kimi-locale', 'en');
    ui.doc.querySelector('.st').textContent = 'Idle';
    await settled(ui);
    expect(systemText(form)).toEqual([]);
    expect(form.querySelector('input[value="thinking"]')).toBe(checkbox);
    expect(checkbox.checked).toBe(false);
    expect(input.value).toBe('用户模型');
    expect(ui.fetch.mock.calls).toHaveLength(requests);
    await ui.view.fetch('/api/v1/meta', { headers: { authorization: 'Bearer fictional' } });
    let resolveDiscovery;
    ui.fetch.mockImplementationOnce(() => new Promise((resolve) => { resolveDiscovery = resolve; }));
    fetchButton.click();
    await tick();
    expect(fetchButton.textContent).toBe('Fetching…');
    ui.view.localStorage.setItem('kimi-locale', 'zh');
    ui.doc.querySelector('.st').textContent = '空闲';
    await settled(ui);
    expect(fetchButton.textContent).toBe('正在拉取…');
    resolveDiscovery(new Response(JSON.stringify({ models: ['用户远端模型'] })));
    await settled(ui);
    const select = form.querySelector('.okw-discovery-select');
    select.value = '用户远端模型';
    select.dispatchEvent(new ui.view.Event('change'));
    ui.view.localStorage.setItem('kimi-locale', 'en');
    ui.doc.querySelector('.st').textContent = 'Idle';
    await settled(ui);
    expect(select.value).toBe('用户远端模型');
    expect(select.options[1].textContent).toBe('用户远端模型');
    expect(form.querySelector('.okw-discovery-status').textContent).toBe('Found 1 models');
    ui.fetch.mockImplementationOnce(async () => new Response(JSON.stringify({
      error: '模型端点请求失败（HTTP 503）',
    }), { status: 502 }));
    fetchButton.click();
    await settled(ui);
    expect(form.querySelector('.okw-discovery-status').textContent).toBe('Model endpoint request failed (HTTP 503)');
    ui.view.localStorage.setItem('kimi-locale', 'zh');
    ui.doc.querySelector('.st').textContent = '空闲';
    await settled(ui);
    expect(form.querySelector('.okw-discovery-status').textContent).toBe('模型端点请求失败（HTTP 503）');
    await ui.view.fetch('/api/v1/providers', {
      method: 'POST', body: JSON.stringify({ id: '用户供应商', models: [{ model: '用户模型',
        capabilities: ['tool_use', 'thinking'], adaptive_thinking: true }] }),
    });
    const saved = JSON.parse(ui.fetch.mock.calls.at(-1)[1].body).models[0];
    expect(saved).toEqual({ model: '用户模型', capabilities: ['tool_use'], adaptive_thinking: true });
    expect(saved).not.toHaveProperty('support_efforts');
  });
});

describe('localized session size', () => {
  it('updates unavailable session size notes without a second API request', async () => {
    const ui = install('zh');
    ui.doc.querySelector('.tb-main').insertAdjacentHTML('beforeend', '<span class="okw-workspace-status"></span>');
    ui.view.__okwUsageCreateApi = () => vi.fn(async () => ({ available: false, reason: 'unmanaged_target' }));
    const api = ui.view.__okwUsageCreateApi();
    ui.view.__okwUsageCreateApi = () => api;
    ui.view.eval(`((location) => { ${source('sessionSize')} })({pathname:'/sessions/A'});`);
    await settled(ui);
    ui.view.localStorage.setItem('kimi-locale', 'en');
    ui.doc.documentElement.lang = 'en';
    await settled(ui);
    const node = ui.doc.querySelector('.okw-session-size');
    expect(node.textContent).toBe(' · Session —');
    expect(node.title).toContain('Not a managed local backend');
    expect(node.getAttribute('aria-label')).not.toMatch(han);
    expect(api).toHaveBeenCalledTimes(1);
    ui.view.dispatchEvent(new ui.view.Event('pagehide'));
  });
});

describe('localized usage entry and complete panel', () => {
  it('renders English summary, trend, details, pricing and error paths without Han system text', async () => {
    const ui = install();
    ['usageLocale', 'usageApi', 'usageView', 'usageTrend', 'usageControllers', 'usage'].forEach(ui.evaluate);
    await ui.view.fetch('/api/v1/meta', { headers: { authorization: 'Bearer fictional' } });
    ui.doc.querySelector('.okw-usage-entry').click();
    await settled(ui);
    const panel = ui.doc.querySelector('.okw-usage-panel');
    panel.querySelectorAll('.okw-usage-aliases').forEach((node) => node.remove());
    panel.querySelectorAll('[title^="Aliases:"]').forEach((node) => node.removeAttribute('title'));
    expect(systemText(panel)).toEqual([]);
    expect(ui.doc.querySelector('[data-usage="quality"]').textContent).toBe('Some records are invalid (2)');
    const by = (name) => ui.doc.querySelector(`[data-usage="${name}"]`);
    by('save').click();
    expect(by('price-status').textContent).toBe('Choose a confirmed model ID first.');
    by('from').value = '';
    by('refresh').click();
    expect(by('status').textContent).toBe('Choose valid times; the end must be after the start.');
    expect(ui.view.__okwUsageText('公开价格目录返回 HTTP 502')).toBe('Public price catalog returned HTTP 502');
    expect(ui.view.__okwUsageText('目录模型不存在')).toBe('Catalog model not found');
    expect(ui.view.__okwUsageText('手动单价 + 内置价格快照（旧目录价格，目录项已消失）'))
      .toBe('Manual prices + Built-in price snapshot (retained price; catalog entry removed)');
    ui.doc.querySelector('.okw-usage-close').click();
  });
  it('preserves inputs, selected suggestions and user Chinese data through zh→en→zh with no reload', async () => {
    const ui = install('zh');
    ['usageLocale', 'usageApi', 'usageView', 'usageTrend', 'usageControllers', 'usage'].forEach(ui.evaluate);
    await ui.view.fetch('/api/v1/meta', { headers: { authorization: 'Bearer fictional' } });
    ui.doc.querySelector('.okw-usage-entry').click();
    await settled(ui);
    const search = ui.doc.querySelector('[data-usage="model-search"]');
    search.value = '用户查询';
    const checkbox = ui.doc.querySelector('.okw-usage-suggestion-row input');
    checkbox.click();
    const requests = ui.fetch.mock.calls.length;
    ui.view.localStorage.setItem('kimi-locale', 'en');
    ui.doc.querySelector('.st').firstChild.data = 'Idle';
    await settled(ui);
    expect(search.value).toBe('用户查询');
    expect(search.placeholder).toBe('Search model ID');
    expect(ui.doc.querySelector('.okw-usage-suggestion-row input').checked).toBe(false);
    expect(ui.doc.querySelector('.okw-usage-aliases').textContent).toBe('Aliases: 用户别名');
    expect(ui.fetch.mock.calls).toHaveLength(requests);
    ui.fetch.mockImplementationOnce(async () => new Response(JSON.stringify({ error: '目录模型不存在' }), { status: 400 }));
    ui.doc.querySelector('[data-usage="refresh"]').click();
    await settled(ui);
    expect(ui.doc.querySelector('[data-usage="status"]').textContent).toBe('Catalog model not found');
    ui.view.localStorage.setItem('kimi-locale', 'zh');
    ui.doc.querySelector('.st').textContent = '空闲';
    await settled(ui);
    expect(search.placeholder).toBe('搜索模型 ID');
    expect(ui.doc.querySelector('[data-usage="status"]').textContent).toBe('目录模型不存在');
    expect(ui.doc.querySelector('#okw-usage-title').textContent).toBe('使用统计');
    ui.doc.querySelector('.okw-usage-close').click();
  });
});
