/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve('packages/launcher/src/mobile/mobileWorkspaceSort.js'), 'utf8');
const presentation = readFileSync(resolve('packages/launcher/src/mobile/presentation.js'), 'utf8');
const css = readFileSync(resolve('packages/launcher/src/mobile/mobileWorkspaceSort.css'), 'utf8');
const presentationCss = readFileSync(resolve('packages/launcher/src/mobile/presentation.css'), 'utf8');
const SORT_KEY = 'open-kimi-web.mobile-workspace-sort';
const ORDER_KEY = 'kimi-web.workspace-order';
const PINS_KEY = 'open-kimi-web.pinned-workspaces';
const VIEW_KEY = 'kimi-web.mobile-switcher-view-mode';
const frames = [];
const states = [];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const group = (name, path) => `<div class="mgroup"><div class="mgh"><span class="mgh-name">${name}</span>
  <span class="ui-tip"><span class="mgh-path">${path}</span></span><button class="mgh-more">More</button>
  <button class="mgh-add">New</button></div><div><div class="srow"><span class="t">Demo session</span></div>
  <div class="mshow-more-row"><button class="mshow-more">Show more</button></div></div></div>`;
const defaultGroups = () => group('Zulu', '~/zulu') + group('Alpha', '~/alpha') + group('Beta', '~/beta');
const sheetMarkup = (content) => `<div class="sheet-root"><div class="sheet-scrim"></div>
  <div class="sheet-panel" role="dialog"><button class="sheet-grab">Close</button><div class="sheet-body">
  <div class="actions"><button class="newrow">New chat</button><button class="newrow">New workspace</button></div>
  <div class="view-tabs"><div role="tablist"><button role="tab" aria-selected="false">Flat</button>
  <button role="tab" aria-selected="true">Grouped</button></div></div><div class="mlist">${content}</div>
  </div></div></div>`;
const workspaceItems = () => [
  { id: 'z', root: '/home/demo/zulu', name: 'Zulu' },
  { id: 'a', root: '/home/demo/alpha', name: 'Alpha' },
  { id: 'b', root: '/home/demo/beta', name: 'Beta' },
];

function watchMutations(view) {
  const NativeObserver = view.MutationObserver;
  const state = { calls: 0, stopped: false, observers: [] };
  states.push(state);
  view.MutationObserver = class MutationObserver {
    constructor(callback) {
      const observer = new NativeObserver((records) => {
        state.calls += 1;
        if (state.calls > 100) {
          state.stopped = true;
          state.observers.forEach((item) => item.disconnect());
          return;
        }
        callback(records, observer);
      });
      state.observers.push(observer);
      return observer;
    }
  };
  return state;
}

function installStorage(view, values, fails) {
  const storage = new Map(Object.entries(values));
  const store = { getItem: vi.fn((key) => {
    if (fails) throw new Error('Storage denied');
    return storage.get(key) ?? null;
  }), setItem: vi.fn((key, value) => {
    if (fails) throw new Error('Storage denied');
    storage.set(key, value);
  }) };
  Object.defineProperty(view, 'localStorage', { value: store });
  return { storage, store };
}

function install(options = {}) {
  const { flat, stored, content, storageFails, withPresentation, language, isMobile } = {
    flat: false, stored: {}, content: defaultGroups(), storageFails: false,
    withPresentation: false, language: 'zh-CN', isMobile: true, ...options,
  };
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const view = frame.contentWindow;
  const doc = view.document;
  doc.documentElement.lang = language;
  Object.defineProperty(view.navigator, 'language', { value: options.navigatorLanguage ?? 'en-US' });
  doc.body.innerHTML = `<div class="app mobile"><div class="con"><div class="chat-scroll"></div></div></div>` +
    sheetMarkup(flat ? '<div class="srow srow-flat">Flat session</div>' : content);
  const { storage, store } = installStorage(view, { [VIEW_KEY]: flat ? 'flat' : 'grouped', ...stored }, storageFails);
  const listeners = [];
  const media = { matches: isMobile, addEventListener: (_name, listener) => listeners.push(listener) };
  view.matchMedia = () => media;
  view.Request = Request;
  view.Response = Response;
  view.Headers = Headers;
  const nativeFetch = vi.fn(async () => new Response('{}'));
  view.fetch = nativeFetch;
  const state = watchMutations(view);
  const location = { href: 'http://localhost/', origin: 'http://localhost', pathname: '/' };
  view.__sortLocation = location;
  const tabs = Array.from(doc.querySelectorAll('[role="tab"]'));
  const clicks = vi.fn();
  tabs.forEach((tab, index) => tab.addEventListener('click', () => {
    clicks();
    tabs.forEach((node, other) => node.setAttribute('aria-selected', String(index === other)));
    doc.querySelector('.mlist').innerHTML = index ? content : '<div class="srow srow-flat">Flat session</div>';
    if (!storageFails) storage.set(VIEW_KEY, index ? 'grouped' : 'flat');
  }));
  if (flat) tabs.forEach((tab, index) => tab.setAttribute('aria-selected', String(index === 0)));
  if (withPresentation) view.eval(`((location) => { ${presentation}\n})(window.__sortLocation)`);
  view.eval(`((location) => { ${source}\n})(window.__sortLocation)`);
  const select = () => doc.querySelector('.okw-mobile-workspace-sort select');
  const groups = () => Array.from(doc.querySelector('.mlist').children).filter((node) => node.matches('.mgroup'));
  const visualNames = () => groups().sort((a, b) => Number(a.style.order) - Number(b.style.order))
    .map((node) => node.querySelector('.mgh-name').textContent);
  const choose = (value) => {
    select().value = value;
    select().dispatchEvent(new view.Event('change', { bubbles: true }));
  };
  const resize = (matches) => {
    media.matches = matches;
    listeners.forEach((listener) => listener());
  };
  return { view, doc, frame, state, store, storage, tabs, clicks, select, groups, visualNames, choose, resize, nativeFetch };
}

async function respond(ui, path, data, { status = 200, method = 'GET', envelope = true } = {}) {
  const response = new Response(JSON.stringify(envelope ? { code: 0, data } : data), { status });
  ui.nativeFetch.mockResolvedValueOnce(response);
  expect(await ui.view.fetch(path, { method })).toBe(response);
  await tick();
}

async function settled(ui) {
  await tick();
  const calls = ui.state.calls;
  await tick();
  expect(ui.state.stopped).toBe(false);
  expect(ui.state.calls).toBe(calls);
}

afterEach(() => {
  states.splice(0).flatMap((state) => state.observers).forEach((observer) => observer.disconnect());
  frames.splice(0).forEach((frame) => frame.remove());
});
describe('native mobile list restoration', () => {
  it.each([false, true])('retains the initial flat=%s preference without synthetic tab clicks', async (flat) => {
    const ui = install({ flat, withPresentation: true });
    expect(ui.doc.querySelector('.sheet-root').classList.contains('okw-workspaces')).toBe(true);
    expect(ui.storage.get(VIEW_KEY)).toBe(flat ? 'flat' : 'grouped');
    expect(ui.store.setItem).not.toHaveBeenCalled();
    expect(ui.clicks).not.toHaveBeenCalled();
    expect(Boolean(ui.select())).toBe(!flat);
    await settled(ui);
    expect(presentation).not.toMatch(/enhancedWorkspaceSheets|workspaceSheetViews|grouped\.click|tab\.click/);
    expect(presentationCss).not.toMatch(/\.view-tabs\s*\{[^}]*display:\s*none/s);
  });
  it('keeps native flat/grouped changes and does not replay a previous choice at the desktop breakpoint', async () => {
    const ui = install({ withPresentation: true });
    ui.choose('name');
    expect(ui.visualNames()).toEqual(['Alpha', 'Beta', 'Zulu']);
    ui.tabs[0].click();
    await settled(ui);
    expect(ui.select()).toBeNull();
    expect(ui.doc.querySelector('.mlist').classList.contains('okw-mobile-workspace-ordered')).toBe(false);
    ui.resize(false);
    expect(ui.storage.get(VIEW_KEY)).toBe('flat');
    expect(ui.clicks).toHaveBeenCalledTimes(1);
    ui.resize(true);
    ui.tabs[1].click();
    await settled(ui);
    expect(ui.select().value).toBe('name');
    expect(ui.visualNames()).toEqual(['Alpha', 'Beta', 'Zulu']);
    const nodes = ui.groups();
    ui.resize(false);
    await settled(ui);
    expect(ui.select()).toBeNull();
    expect(nodes.map((node) => node.style.order)).toEqual(['', '', '']);
    expect(ui.clicks).toHaveBeenCalledTimes(2);
    expect(ui.storage.get(VIEW_KEY)).toBe('grouped');
  });
});
describe('workspace-only visual sorting', () => {
  it('sorts immediately with no identity data, persists only its enum and keeps actions adjacent to view-tabs', async () => {
    const ui = install();
    const nodes = ui.groups();
    const body = nodes[0].lastElementChild;
    body.style.display = 'none';
    const collapse = vi.fn(() => { body.style.display = body.style.display === 'none' ? '' : 'none'; });
    const more = vi.fn();
    const session = vi.fn();
    const menu = vi.fn();
    const initialCount = body.querySelectorAll('.srow').length;
    nodes[0].querySelector('.mgh').addEventListener('click', collapse);
    nodes[0].querySelector('.mshow-more').addEventListener('click', more);
    nodes[0].querySelector('.srow').addEventListener('click', session);
    nodes[0].querySelector('.mgh-more').addEventListener('click', menu);
    ui.choose('name');
    expect(ui.groups()).toEqual(nodes);
    expect(ui.visualNames()).toEqual(['Alpha', 'Beta', 'Zulu']);
    expect(ui.store.setItem.mock.calls).toEqual([[SORT_KEY, 'name']]);
    expect(ui.doc.querySelector('.actions').nextElementSibling.className).toBe('view-tabs');
    expect(ui.doc.querySelector('.view-tabs').nextElementSibling.className).toBe('okw-mobile-workspace-sort');
    expect(ui.select().options[2].disabled).toBe(true);
    expect(body.style.display).toBe('none');
    expect(body.querySelectorAll('.srow')).toHaveLength(initialCount);
    nodes[0].querySelector('.mgh').click();
    nodes[0].querySelector('.mshow-more').click();
    nodes[0].querySelector('.srow').click();
    nodes[0].querySelector('.mgh-more').click();
    expect(collapse).toHaveBeenCalledTimes(2);
    expect(more).toHaveBeenCalledOnce();
    expect(session).toHaveBeenCalledOnce();
    expect(menu).toHaveBeenCalledOnce();
    await settled(ui);
    const reload = install({ stored: Object.fromEntries(ui.storage) });
    expect(reload.select().value).toBe('name');
    expect(reload.visualNames()).toEqual(['Alpha', 'Beta', 'Zulu']);
  });
  it('uses the live native order for recent and name ties instead of a captured first snapshot', async () => {
    const ui = install({ content: group('Same', '/first') + group('Same', '/second') + group('Alpha', '/third') });
    ui.choose('name');
    const [first, second, third] = ui.groups();
    ui.doc.querySelector('.mlist').insertBefore(second, first);
    await settled(ui);
    expect([third.style.order, second.style.order, first.style.order]).toEqual(['0', '1', '2']);
    ui.choose('recent');
    expect(ui.groups()).toEqual([second, first, third]);
    expect(ui.groups().map((node) => node.style.order)).toEqual(['', '', '']);
    ui.doc.querySelector('.mlist').prepend(third);
    await settled(ui);
    expect(ui.groups()).toEqual([third, second, first]);
    expect(ui.visualNames()).toEqual(['Alpha', 'Same', 'Same']);
  });
  it('does not sort or create controls on desktop and survives storage read/write failures', async () => {
    const desktop = install({ isMobile: false, stored: { [SORT_KEY]: 'name' } });
    expect(desktop.select()).toBeNull();
    expect(desktop.visualNames()).toEqual(['Zulu', 'Alpha', 'Beta']);
    const blocked = install({ storageFails: true });
    expect(blocked.select().value).toBe('recent');
    expect(() => blocked.choose('name')).not.toThrow();
    expect(blocked.visualNames()).toEqual(['Alpha', 'Beta', 'Zulu']);
    await settled(blocked);
    blocked.frame.contentWindow.document.querySelector('.sheet-root').remove();
    await settled(blocked);
    blocked.doc.body.insertAdjacentHTML('beforeend', sheetMarkup(defaultGroups()));
    await settled(blocked);
    expect(blocked.select().value).toBe('name');
  });
  it('limits column layout to its marked mobile list and does not shrink groups', () => {
    expect(css).toMatch(/@media \(max-width: 640px\)/);
    expect(css).toMatch(/\.mlist\.okw-mobile-workspace-ordered\s*\{[^}]*flex-direction:\s*column/s);
    expect(css).toMatch(/\.mlist\.okw-mobile-workspace-ordered > \.mgroup\s*\{[^}]*flex-shrink:\s*0/s);
    expect(css).not.toMatch(/\.view-tabs|\.actions|\.srow|!important/);
  });
});
describe('observed workspace identity and saved desktop order', () => {
  it('enables desktop order from actual v1 response shape, reads pins and never writes official preferences', async () => {
    const ui = install({ stored: { [ORDER_KEY]: '["b","z","a"]', [PINS_KEY]: '["a","missing"]' } });
    await respond(ui, '/api/v1/workspaces', { items: workspaceItems() });
    expect(ui.select().options[2].disabled).toBe(false);
    ui.choose('desktop');
    expect(ui.visualNames()).toEqual(['Alpha', 'Beta', 'Zulu']);
    expect(ui.storage.get(ORDER_KEY)).toBe('["b","z","a"]');
    expect(ui.storage.get(PINS_KEY)).toBe('["a","missing"]');
    expect(ui.store.setItem.mock.calls).toEqual([[SORT_KEY, 'desktop']]);
    await respond(ui, '/api/v1/workspaces?filtered=true', { items: [workspaceItems()[0]] });
    expect(ui.select().options[2].disabled).toBe(true);
    expect(ui.storage.get(PINS_KEY)).toBe('["a","missing"]');
    expect(ui.store.setItem.mock.calls).toHaveLength(1);
    await settled(ui);
  });
  it('restores a saved identity-dependent mode only when mapping arrives and handles absent saved order honestly', async () => {
    const ui = install({ stored: { [SORT_KEY]: 'desktop', [ORDER_KEY]: '["b","a","z"]' } });
    expect(ui.select().value).toBe('recent');
    expect(ui.doc.querySelector('.okw-mobile-workspace-sort-hint').textContent).toContain('无法唯一识别');
    await respond(ui, '/api/v1/workspaces', { items: workspaceItems() });
    expect(ui.select().value).toBe('desktop');
    expect(ui.visualNames()).toEqual(['Beta', 'Alpha', 'Zulu']);
    expect(ui.doc.querySelector('.okw-mobile-workspace-sort-hint').hidden).toBe(true);
    const absent = install({ language: 'en', stored: { [ORDER_KEY]: '{"invalid":true}' } });
    await respond(absent, '/api/v1/workspaces', { items: workspaceItems() });
    expect(absent.select().options[2].disabled).toBe(true);
    expect(absent.doc.querySelector('.okw-mobile-workspace-sort-hint').textContent).toContain('No desktop order');
  });
  it('uses successful fs:home shortening and v2 grouped identity projections without retaining session content', async () => {
    const ui = install({ stored: { [ORDER_KEY]: '["b","a","z"]' } });
    const items = workspaceItems().map((item) => ({ ...item, root: item.root.replace('/home/demo', '/srv/demo') }));
    await respond(ui, '/api/v1/workspaces', { items: items.slice(0, 2) });
    await respond(ui, '/api/v1/fs:home', { home: '/srv/demo', recent_roots: ['/do-not-persist'] });
    expect(ui.select().options[2].disabled).toBe(true);
    await respond(ui, '/api/v2/sessions?view=by_workspace&group.page_size=10', {
      groups: [{ workspace: { id: 'b', cwd: '/srv/demo/beta' }, sessions: [{ meta: { title: 'Private fixture' } }] }],
    });
    expect(ui.select().options[2].disabled).toBe(false);
    ui.choose('desktop');
    expect(ui.visualNames()).toEqual(['Beta', 'Alpha', 'Zulu']);
    expect([...ui.storage.keys()]).toEqual([VIEW_KEY, ORDER_KEY, SORT_KEY]);
    expect(ui.store.setItem.mock.calls).toEqual([[SORT_KEY, 'desktop']]);
    await settled(ui);
  });
});
describe('partial saved desktop order', () => {
  it('puts visible saved IDs before identifiable unsaved groups without disabling desktop mode', async () => {
    const ui = install({ stored: { [ORDER_KEY]: '["b","z"]' } });
    const nodes = ui.groups();
    await respond(ui, '/api/v1/workspaces', { items: workspaceItems() });
    expect(ui.select().options[2].disabled).toBe(false);
    ui.choose('desktop');
    expect(ui.visualNames()).toEqual(['Beta', 'Zulu', 'Alpha']);
    expect(ui.groups()).toEqual(nodes);
    expect(ui.storage.get(ORDER_KEY)).toBe('["b","z"]');
    await settled(ui);
  });
  it('keeps native order when every saved ID is outside the visible identifiable groups', async () => {
    const ui = install({ stored: { [ORDER_KEY]: '["hidden-one","hidden-two"]' } });
    await respond(ui, '/api/v1/workspaces', { items: workspaceItems() });
    expect(ui.select().options[2].disabled).toBe(false);
    ui.choose('desktop');
    expect(ui.visualNames()).toEqual(['Zulu', 'Alpha', 'Beta']);
    expect(ui.groups().map((node) => node.style.order)).toEqual(['', '', '']);
    ui.doc.querySelector('.mlist').prepend(ui.groups()[2]);
    await settled(ui);
    expect(ui.visualNames()).toEqual(['Beta', 'Zulu', 'Alpha']);
    expect(ui.select().value).toBe('desktop');
    expect(ui.select().options[2].disabled).toBe(false);
    expect(ui.groups().map((node) => node.style.order)).toEqual(['', '', '']);
  });
  it('keeps pins before saved IDs and updates unsaved group ties from the current native DOM', async () => {
    const ui = install({ content: defaultGroups() + group('Delta', '/delta') + group('Echo', '/echo'),
      stored: { [ORDER_KEY]: '["b"]', [PINS_KEY]: '["delta","a"]' } });
    const [zulu, alpha, beta, delta, echo] = ui.groups();
    await respond(ui, '/api/v1/workspaces', { items: [...workspaceItems(),
      { id: 'delta', root: '/delta' }, { id: 'echo', root: '/echo' },
    ] });
    ui.choose('desktop');
    expect(ui.visualNames()).toEqual(['Delta', 'Alpha', 'Beta', 'Zulu', 'Echo']);
    ui.doc.querySelector('.mlist').insertBefore(echo, zulu);
    await settled(ui);
    expect(ui.visualNames()).toEqual(['Delta', 'Alpha', 'Beta', 'Echo', 'Zulu']);
    expect(ui.groups()).toEqual([echo, zulu, alpha, beta, delta]);
    expect(ui.storage.get(PINS_KEY)).toBe('["delta","a"]');
    expect(ui.store.setItem.mock.calls).toEqual([[SORT_KEY, 'desktop']]);
  });
});
describe('strict workspace identity and preference changes', () => {
  it.each([
    ['shortened collision', group('Same', '~/project') + group('Other', '~/other'),
      [{ id: 'one', root: '/home/one/project' }, { id: 'two', root: '/home/two/project' },
        { id: 'other', root: '/home/one/other' }]],
    ['two nodes for one ID', group('One', '/project') + group('Two', '/project'), [{ id: 'one', root: '/project' }]],
    ['two IDs for one root', group('One', '/project'), [{ id: 'one', root: '/project' }, { id: 'two', root: '/project' }]],
    ['one ID for two roots', group('One', '/project'), [{ id: 'one', root: '/project' }, { id: 'one', root: '/another' }]],
    ['name-only resemblance', group('Name', '/unknown'), [{ id: 'one', root: '/different', name: 'Name' }]],
    ['path used as ID', group('One', '/project'), [{ id: '/project', root: '/project' }]],
  ])('rejects ambiguous or guessed identity: %s', async (_label, content, items) => {
    const ui = install({ content, stored: { [ORDER_KEY]: '["one","two","other"]', [PINS_KEY]: '["one"]' } });
    await respond(ui, '/api/v1/workspaces', { items });
    expect(ui.select().options[2].disabled).toBe(true);
    expect(ui.doc.querySelector('.okw-mobile-workspace-sort-hint').textContent).toContain('无法唯一识别');
    ui.choose('name');
    expect(ui.groups().every((node) => !node.hasAttribute('data-okw-workspace-id'))).toBe(true);
    expect(ui.storage.get(PINS_KEY)).toBe('["one"]');
    await settled(ui);
  });
  it('allows identical names only through unique paths and applies pins in their saved ID order', async () => {
    const ui = install({ content: group('Same', '/first') + group('Same', '/second') + group('Same', '/third'),
      stored: { [ORDER_KEY]: '["one","two","three"]', [PINS_KEY]: '["three","two"]' } });
    const nodes = ui.groups();
    await respond(ui, '/api/v1/workspaces', { items: [
      { id: 'one', root: '/first', name: 'Same' }, { id: 'two', root: '/second', name: 'Same' },
      { id: 'three', root: '/third', name: 'Same' },
    ] });
    expect(ui.select().options[2].disabled).toBe(false);
    expect(nodes.map((node) => node.style.order)).toEqual(['2', '1', '0']);
    ui.choose('name');
    expect(nodes.map((node) => node.style.order)).toEqual(['2', '1', '0']);
    expect(ui.groups()).toEqual(nodes);
    await settled(ui);
  });
  it.each([
    ['https://elsewhere.test/api/v1/workspaces', 'GET', 200, true],
    ['/api/v1/workspaces', 'POST', 200, true],
    ['/api/v1/workspaces', 'GET', 500, true],
    ['/api/v2/sessions', 'GET', 200, true],
    ['/api/v1/workspaces', 'GET', 200, false],
  ])('ignores unrelated or unsuccessful identity response %s %s %s %s', async (path, method, status, success) => {
    const ui = install({ stored: { [ORDER_KEY]: '["z","a","b"]' } });
    const data = { items: workspaceItems(), groups: workspaceItems().map(({ id, root }) => ({ workspace: { id, cwd: root } })) };
    await respond(ui, path, success ? data : { code: 7, data }, { status, method, envelope: success });
    expect(ui.select().options[2].disabled).toBe(true);
    expect(ui.store.setItem).not.toHaveBeenCalled();
    await settled(ui);
  });
  it.each([
    ['https://elsewhere.test/api/v1/workspaces', false], ['http://localhost/api/v1/workspaces', true],
  ])('rejects identity delivered from an external response or redirect %s %s', async (url, redirected) => {
    const ui = install({ stored: { [ORDER_KEY]: '["z","a","b"]' } });
    const response = new Response(JSON.stringify({ items: workspaceItems() }));
    Object.defineProperties(response, { url: { value: url }, redirected: { value: redirected } });
    const clone = vi.spyOn(response, 'clone');
    ui.nativeFetch.mockResolvedValueOnce(response);
    expect(await ui.view.fetch('/api/v1/workspaces')).toBe(response);
    await tick();
    expect(clone).not.toHaveBeenCalled();
    expect(ui.select().options[2].disabled).toBe(true);
  });
  it('responds to cross-tab enum, desktop-order and pins updates without rewriting storage', async () => {
    const ui = install({ stored: { [ORDER_KEY]: '["z","a","b"]' } });
    await respond(ui, '/api/v1/workspaces', { items: workspaceItems() });
    ui.storage.set(ORDER_KEY, '["b","a","z"]');
    ui.view.dispatchEvent(new ui.view.StorageEvent('storage', { key: SORT_KEY, newValue: 'desktop' }));
    expect(ui.visualNames()).toEqual(['Beta', 'Alpha', 'Zulu']);
    ui.storage.set(PINS_KEY, '["z"]');
    ui.view.dispatchEvent(new ui.view.StorageEvent('storage', { key: PINS_KEY }));
    expect(ui.visualNames()).toEqual(['Zulu', 'Beta', 'Alpha']);
    ui.view.dispatchEvent(new ui.view.StorageEvent('storage', { key: SORT_KEY, newValue: 'invalid' }));
    expect(ui.select().value).toBe('recent');
    expect(ui.visualNames()).toEqual(['Zulu', 'Alpha', 'Beta']);
    expect(ui.store.setItem).not.toHaveBeenCalled();
    await settled(ui);
  });
});
describe('official locale preference', () => {
  it.each([
    ['en', 'zh', false, 'en-US', '工作区排序'], ['zh', 'en', false, 'zh-CN', 'Workspace order'],
    ['en', 'zh-CN', false, 'zh-CN', 'Workspace order'], ['zh', 'invalid', false, 'en-US', '工作区排序'],
    ['en', 'zh', true, 'zh-CN', 'Workspace order'], ['zh', 'en', true, 'en-US', '工作区排序'],
    ['', 'invalid', false, 'zh-CN', '工作区排序'], ['', 'zh', true, 'en-US', 'Workspace order'],
  ])('resolves %s / %s / storageFails=%s / %s', async (language, locale, storageFails, navigatorLanguage, label) => {
    const ui = install({ language, storageFails, navigatorLanguage, stored: { 'kimi-locale': locale } });
    expect(ui.doc.querySelector('.okw-mobile-workspace-sort label > span').textContent).toBe(label);
    expect(ui.store.setItem).not.toHaveBeenCalled();
    await settled(ui);
  });
  it('refreshes all copy on cross-tab locale changes without changing the selected sort mode', async () => {
    const ui = install({ language: 'en', stored: { 'kimi-locale': 'en', [SORT_KEY]: 'name' } });
    const select = ui.select();
    const nodes = ui.groups();
    const hint = ui.doc.querySelector('.okw-mobile-workspace-sort-hint');
    const changeLocale = (locale) => {
      ui.storage.set('kimi-locale', locale);
      ui.view.dispatchEvent(new ui.view.StorageEvent('storage', { key: 'kimi-locale', newValue: locale }));
    };
    changeLocale('zh');
    expect(ui.doc.querySelector('.okw-mobile-workspace-sort label > span').textContent).toBe('工作区排序');
    expect(Array.from(select.options, (option) => option.textContent)).toEqual(['最近会话', '工作区名称', '桌面保存顺序']);
    expect(ui.doc.querySelector('.okw-mobile-workspace-sort-hint').textContent).toBe('此浏览器尚无桌面保存顺序。');
    await settled(ui);
    changeLocale('en');
    expect(ui.doc.querySelector('.okw-mobile-workspace-sort label > span').textContent).toBe('Workspace order');
    expect(Array.from(select.options, (option) => option.textContent))
      .toEqual(['Recent sessions', 'Workspace name', 'Saved desktop order']);
    expect(hint.textContent).toBe('No desktop order is saved in this browser.');
    expect(ui.select()).toBe(select);
    expect(select.value).toBe('name');
    expect(ui.storage.get(SORT_KEY)).toBe('name');
    expect(ui.visualNames()).toEqual(['Alpha', 'Beta', 'Zulu']);
    expect(ui.groups()).toEqual(nodes);
    expect(ui.store.setItem).not.toHaveBeenCalled();
    await settled(ui);
  });
});
describe('mobile sort observer scope and convergence', () => {
  it('settles after actual mutations, header changes, control removal, flat transition and sheet replacement', async () => {
    const ui = install({ stored: { [SORT_KEY]: 'name' } });
    await settled(ui);
    ui.groups()[0].querySelector('.mgh-name').firstChild.data = 'Aardvark';
    await settled(ui);
    expect(ui.visualNames()).toEqual(['Aardvark', 'Alpha', 'Beta']);
    ui.doc.querySelector('.okw-mobile-workspace-sort').remove();
    await settled(ui);
    expect(ui.select().value).toBe('name');
    ui.tabs[0].click();
    await settled(ui);
    expect(ui.select()).toBeNull();
    ui.doc.querySelector('.sheet-root').remove();
    await settled(ui);
    ui.doc.body.insertAdjacentHTML('beforeend', sheetMarkup(defaultGroups()));
    await settled(ui);
    expect(ui.select().value).toBe('name');
    expect(ui.doc.querySelectorAll('.okw-mobile-workspace-sort')).toHaveLength(1);
  });
  it('performs no global queries or header scans while long main/side-chat content streams', async () => {
    const ui = install({ stored: { [SORT_KEY]: 'name' } });
    await settled(ui);
    const chat = ui.doc.querySelector('.chat-scroll');
    const side = ui.doc.createElement('div');
    side.className = 'sc-body';
    ui.doc.querySelector('.con').append(side);
    await settled(ui);
    const globalQueries = vi.spyOn(ui.doc, 'querySelectorAll');
    const rootQueries = vi.spyOn(ui.doc.querySelector('.sheet-root'), 'querySelector');
    for (let batch = 0; batch < 20; batch += 1) {
      chat.insertAdjacentHTML('beforeend', `<div class="a-msg">${'Long content '.repeat(200)}</div>`);
      side.insertAdjacentHTML('beforeend', '<div class="a-msg">Side chat stream</div>');
      await tick();
    }
    expect(globalQueries).not.toHaveBeenCalled();
    expect(rootQueries).not.toHaveBeenCalled();
    await settled(ui);
  });
});
