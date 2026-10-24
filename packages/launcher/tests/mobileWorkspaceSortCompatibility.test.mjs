/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve('packages/launcher/src/mobile/mobileWorkspaceSort.js'), 'utf8');
const locale = readFileSync(resolve('packages/launcher/src/mobile/locale.js'), 'utf8');
const frames = [];
const observers = [];
const SORT = 'open-kimi-web.mobile-workspace-sort';
const ORDER = 'kimi-web.workspace-order';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const group = (path, name = 'Same display name') => `<div class="mgroup"><div class="mgh">
  <span class="mgh-name">${name}</span><span class="ui-tip"><span class="mgh-path">${path}</span></span>
  <button class="mgh-add">New</button></div><div class="srow">Fictional session</div></div>`;

function install(paths, options = {}) {
  const frame = document.createElement('iframe');
  document.body.append(frame); frames.push(frame);
  const view = frame.contentWindow;
  const doc = view.document;
  doc.documentElement.lang = options.rootLanguage ?? 'en';
  Object.defineProperty(view.navigator, 'language', { value: options.navigatorLanguage ?? 'zh-CN' });
  const values = new Map([[ORDER, '["b","a"]'], ...Object.entries(options.stored ?? {})]);
  const storage = { getItem: vi.fn((key) => values.get(key) ?? null), setItem: vi.fn((key, value) => values.set(key, value)) };
  Object.defineProperty(view, 'localStorage', { value: storage });
  doc.body.innerHTML = `<div class="sheet-root"><div class="sheet-panel"><div class="sheet-body">
    <div class="actions"><button class="newrow">New chat</button></div>
    <div class="view-tabs"><button aria-selected="true">Grouped</button></div>
    <div class="mlist">${paths.map((path) => group(path)).join('')}</div></div></div></div>`;
  view.matchMedia = () => ({ matches: true, addEventListener() {} });
  view.Request = Request;
  const nativeFetch = vi.fn(async () => new Response('{}'));
  view.fetch = nativeFetch;
  const NativeObserver = view.MutationObserver;
  const state = { calls: 0, stopped: false };
  view.MutationObserver = class extends NativeObserver {
    constructor(callback) {
      super((records, observer) => {
        state.calls += 1;
        if (state.calls > 100) { state.stopped = true; observer.disconnect(); return; }
        callback(records, observer);
      });
      observers.push(this);
    }
  };
  const location = { href: 'http://localhost/', origin: 'http://localhost' };
  view.__sortLocation = location;
  view.eval(locale);
  view.eval(`((location) => { ${source}\n})(window.__sortLocation)`);
  const select = () => doc.querySelector('.okw-mobile-workspace-sort select');
  const groups = () => [...doc.querySelectorAll('.mgroup')];
  const choose = (mode) => {
    select().value = mode; select().dispatchEvent(new view.Event('change', { bubbles: true }));
  };
  return { view, doc, values, storage, nativeFetch, state, select, groups, choose };
}
async function respond(ui, path, data, options = {}) {
  const response = new Response(JSON.stringify({ code: options.code ?? 0, data }), { status: options.status ?? 200 });
  if (options.redirected) Object.defineProperty(response, 'redirected', { value: true });
  ui.nativeFetch.mockResolvedValueOnce(response);
  expect(await ui.view.fetch(path, { method: options.method ?? 'GET' })).toBe(response);
  await tick();
}
async function settled(ui) {
  await tick(); const calls = ui.state.calls; await tick();
  expect(ui.state.stopped).toBe(false); expect(ui.state.calls).toBe(calls);
}
afterEach(() => {
  observers.splice(0).forEach((observer) => observer.disconnect());
  frames.splice(0).forEach((frame) => frame.remove());
});

describe('official 2.3.1 mobile workspace identity', () => {
  it('keeps official home-shortened and full Windows paths distinct after a successful registration', async () => {
    const a = 'F:\\fictional home\\alpha folder';
    const b = 'F:\\fictional workspace\\beta folder';
    const ui = install(['~\\alpha folder']);
    await respond(ui, '/api/v1/fs:home', { home: 'F:\\fictional home' });
    await respond(ui, '/api/v1/workspaces', { items: [{ id: 'a', root: a }] });
    expect(ui.select().options[2].disabled).toBe(false);
    ui.doc.querySelector('.mlist').insertAdjacentHTML('beforeend', group(b));
    await settled(ui);
    expect(ui.select().options[2].disabled).toBe(true);
    await respond(ui, '/api/v1/workspaces', { id: 'b', root: b }, { method: 'POST' });
    expect(ui.select().options[2].disabled).toBe(false);
    ui.choose('desktop');
    expect(ui.groups().map((node) => node.style.order)).toEqual(['1', '0']);
    expect(ui.storage.setItem.mock.calls).toEqual([[SORT, 'desktop']]);
    expect(ui.doc.querySelector('.okw-mobile-workspace-sort-hint').hidden).toBe(true);
    await settled(ui);
  });
  it.each([
    ['failed envelope', '/api/v1/workspaces', { code: 40409, method: 'POST' }],
    ['failed HTTP', '/api/v1/workspaces', { status: 500, method: 'POST' }],
    ['redirected response', '/api/v1/workspaces', { redirected: true, method: 'POST' }],
    ['other origin', 'https://example.test/api/v1/workspaces', { method: 'POST' }],
    ['unrelated method', '/api/v1/workspaces', { method: 'DELETE' }],
  ])('ignores %s instead of assigning identity', async (_name, path, options) => {
    const ui = install(['/fictional/project']);
    await respond(ui, path, { id: 'a', root: '/fictional/project' }, options);
    expect(ui.select().options[2].disabled).toBe(true);
    expect(ui.storage.setItem).not.toHaveBeenCalled(); await settled(ui);
  });
  it.each([
    ['same root under two IDs', '/project', [{ id: 'a', root: '/project' }], { id: 'b', root: '/project' }],
    ['same ID under two roots', '/project', [{ id: 'a', root: '/project' }], { id: 'a', root: '/different' }],
    ['shortened collision', '~/project', [{ id: 'a', root: '/home/one/project' }],
      { id: 'b', root: '/home/two/project' }],
  ])('stays fail-closed for %s even after a valid POST', async (_name, path, initial, added) => {
    const ui = install([path]);
    await respond(ui, '/api/v1/workspaces', { items: initial });
    await respond(ui, '/api/v1/workspaces', added, { method: 'POST' });
    expect(ui.select().options[2].disabled).toBe(true);
    expect(ui.doc.querySelector('.okw-mobile-workspace-sort-hint').textContent).toContain('无法唯一识别');
    await settled(ui);
  });
  it('does not duplicate idempotent registration or persist roots and names', async () => {
    const ui = install(['/project']);
    const workspace = { id: 'a', root: '/project', name: 'Fictional private display name' };
    await respond(ui, '/api/v1/workspaces', { items: [workspace] });
    await respond(ui, '/api/v1/workspaces', workspace, { method: 'POST' });
    await respond(ui, '/api/v1/workspaces', workspace, { method: 'POST' });
    expect(ui.select().options[2].disabled).toBe(false);
    expect(ui.storage.setItem).not.toHaveBeenCalled();
    expect([...ui.values.keys()]).toEqual([ORDER]); await settled(ui);
  });
});

describe('registration response boundaries', () => {
  it('keeps GET list replacement authoritative after successful registration', async () => {
    const ui = install(['/project']);
    await respond(ui, '/api/v1/workspaces', { id: 'a', root: '/project' }, { method: 'POST' });
    expect(ui.select().options[2].disabled).toBe(false);
    await respond(ui, '/api/v1/workspaces', { items: [{ id: 'b', root: '/other' }] });
    expect(ui.select().options[2].disabled).toBe(true); await settled(ui);
  });
  it.each([{ items: [{ id: 'a', root: '/project' }] }, { id: '/project', root: '/project' },
    { id: 'a', root: null }])('ignores malformed registration data %j', async (data) => {
    const ui = install(['/project']);
    await respond(ui, '/api/v1/workspaces', data, { method: 'POST' });
    expect(ui.select().options[2].disabled).toBe(true); await settled(ui);
  });
  it('observes the method of a native Request and rejects external response origins', async () => {
    const ui = install(['/project']);
    const body = JSON.stringify({ code: 0, data: { id: 'a', root: '/project' } });
    const external = new Response(body);
    Object.defineProperty(external, 'url', { value: 'https://example.test/api/v1/workspaces' });
    ui.nativeFetch.mockResolvedValueOnce(external);
    const input = new Request('http://localhost/api/v1/workspaces', { method: 'POST' });
    expect(await ui.view.fetch(input)).toBe(external); await settled(ui);
    expect(ui.select().options[2].disabled).toBe(true);
    ui.nativeFetch.mockResolvedValueOnce(new Response(body));
    await ui.view.fetch(input); await settled(ui);
    expect(ui.select().options[2].disabled).toBe(false);
  });
});

describe('shared official locale for mounted workspace sort', () => {
  it('uses navigator rather than root lang when no official locale is stored', async () => {
    const ui = install(['/unknown']);
    expect(ui.view.__okwLocale.current()).toBe('zh');
    expect(ui.doc.querySelector('.okw-mobile-workspace-sort label > span').textContent).toBe('工作区排序');
    expect(ui.doc.querySelector('.okw-mobile-workspace-sort-hint').textContent).toContain('无法唯一识别');
    expect(ui.storage.setItem).not.toHaveBeenCalled(); await settled(ui);
  });
  it('updates same-tab labels, options and warning without changing mode, nodes or issuing requests', async () => {
    const ui = install(['/unknown'], { stored: { [SORT]: 'name' } });
    const nodes = ui.groups(); const select = ui.select();
    for (const [locale, label, warning] of [
      ['en', 'Workspace order', 'Workspace identity is not unique'], ['zh', '工作区排序', '无法唯一识别'],
    ]) {
      ui.values.set('kimi-locale', locale);
      ui.doc.body.append(ui.doc.createElement('span'));
      await settled(ui);
      expect(ui.doc.querySelector('.okw-mobile-workspace-sort label > span').textContent).toBe(label);
      expect(ui.doc.querySelector('.okw-mobile-workspace-sort-hint').textContent).toContain(warning);
      expect(select.options[2].textContent).toBe(locale === 'zh' ? '桌面保存顺序' : 'Saved desktop order');
      expect(ui.select()).toBe(select); expect(select.value).toBe('name'); expect(ui.groups()).toEqual(nodes);
    }
    expect(ui.nativeFetch).not.toHaveBeenCalled(); expect(ui.storage.setItem).not.toHaveBeenCalled();
  });
});
