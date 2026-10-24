/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
const source = readFileSync(resolve('packages/launcher/src/mobile/navigation.js'), 'utf8');
const usage = ['usageApi.js', 'usageView.js', 'usageTrend.js', 'usageControllers.js', 'usage.js']
  .map((name) => readFileSync(resolve(`packages/launcher/src/mobile/${name}`), 'utf8'));
const desktop = '<aside class="side"><div class="sidebar-actions"><button class="btn-new-chat">New</button>' +
  '<button class="search">Search</button></div><footer class="side-footer">Account</footer></aside>';
const mobile = '<section class="sheet-panel"><div class="sheet-body"><div class="actions">' +
  '<button class="newrow">New</button><button class="newrow"><span>Workspace</span></button></div>' +
  '<div class="view-tabs">Tabs</div></div></section>';
const frames = []; const observers = [];
const tick = () => new Promise((done) => setTimeout(done, 0));
function install(body = '', beforeMount = () => {}) {
  const frame = document.createElement('iframe'); document.body.append(frame); frames.push(frame);
  const view = frame.contentWindow; view.document.body.innerHTML = body;
  const open = vi.fn(); const close = vi.fn(); const workspaceOpen = vi.fn();
  view.__okwNavigationCreateSearch = () => ({ open, close });
  const createWorkspace = vi.fn(() => ({ open: workspaceOpen, close: vi.fn() }));
  view.__okwNavigationCreateWorkspace = createWorkspace;
  view.__okwLocale = { text: (_, en) => en, observe: vi.fn() };
  const Native = view.MutationObserver; const state = { callbacks: 0, storm: false };
  view.MutationObserver = class {
    constructor(callback) {
      const observer = new Native((records) => {
        if (++state.callbacks > 80) { state.storm = true; observer.disconnect(); return; }
        callback(records);
      }); observers.push(observer); return observer;
    }
  };
  beforeMount(view.document);
  view.eval(source); return { view, doc: view.document, open, close, state, workspaceOpen, createWorkspace };
}
async function settled(state) {
  await tick(); const callbacks = state.callbacks; await tick();
  expect(state.callbacks).toBe(callbacks); expect(state.storm).toBe(false);
}
afterEach(() => {
  observers.splice(0).forEach((observer) => observer.disconnect()); frames.splice(0).forEach((frame) => frame.remove());
});
describe('shared navigation hosts', () => {
  it('mounts after official rendering and preserves all native node identities', async () => {
    const test = install(); test.doc.body.insertAdjacentHTML('beforeend', desktop + mobile);
    const native = [...test.doc.querySelectorAll('.btn-new-chat, .search, .newrow')];
    const handler = vi.fn(); test.view.__okwNavigation.register('usage', handler);
    test.view.__okwNavigation.register('cron', vi.fn());
    test.view.__okwNavigation.register('schedules', handler);
    test.view.__okwNavigation.register('unknown', handler); await settled(test.state);
    expect(test.doc.querySelectorAll('.okw-navigation-host')).toHaveLength(2);
    const actionOrder = (selector) => [...test.doc.querySelector(selector).children]
      .map((node) => node.dataset.okwNavigationAction ?? node.className);
    expect(actionOrder('.sidebar-actions')).toEqual(['btn-new-chat', 'workspace', 'cron', 'search', 'usage']);
    expect(actionOrder('.actions')).toEqual(['newrow', 'workspace', 'cron', 'search', 'usage']);
    expect(test.doc.querySelector('[data-okw-navigation-action="schedules"]')).toBeNull();
    expect([...test.doc.querySelectorAll('.btn-new-chat, .search, .newrow')]).toEqual(native);
    test.doc.querySelector('[data-okw-navigation-action="usage"]').click();
    expect(handler).toHaveBeenCalledOnce(); expect(handler.mock.calls[0][0].currentTarget).toBeNull();
    test.view.eval(source); await settled(test.state);
    expect(test.doc.querySelectorAll('[data-okw-navigation-action="usage"]')).toHaveLength(2);
    test.view.__okwNavigation.refresh(); await settled(test.state);
    expect(actionOrder('.sidebar-actions')).toEqual(['btn-new-chat', 'workspace', 'cron', 'search', 'usage']);
  });
  it('opens the same search without the native metadata load-all side effect', async () => {
    const test = install(desktop + mobile); const native = vi.fn();
    test.doc.querySelector('.search').addEventListener('click', native);
    test.doc.querySelector('.search').click();
    test.doc.querySelector('[data-okw-navigation-action="search"]').click();
    expect(test.open).toHaveBeenCalledTimes(2); expect(native).not.toHaveBeenCalled();
    expect(test.open.mock.calls[1][0]).toBe(test.doc.querySelector('[data-okw-navigation-action="search"]'));
    const event = new test.view.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
    test.doc.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    expect(test.open).toHaveBeenCalledTimes(3);
    const question = vi.fn(); test.doc.addEventListener('keydown', question);
    const enter = new test.view.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    test.doc.querySelector('[data-okw-navigation-action="search"]').dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false); expect(question).not.toHaveBeenCalled();
    await settled(test.state);
  });
  it('captures only mobile workspace clicks and shares the desktop controller across repeated mounts', async () => {
    const nativeSession = vi.fn(); const nativeWorkspace = vi.fn();
    const test = install(desktop + mobile, (doc) => {
      doc.querySelectorAll('.btn-new-chat, .newrow:first-child')
        .forEach((node) => node.addEventListener('click', nativeSession));
      doc.querySelector('.newrow:nth-child(2)').addEventListener('click', nativeWorkspace);
    });
    const entry = test.doc.querySelector('.newrow:nth-child(2)');
    const desktopEntry = test.doc.querySelector('.side [data-okw-navigation-action="workspace"]');
    desktopEntry.click(); entry.querySelector('span').click();
    expect(test.workspaceOpen.mock.calls.map(([opener]) => opener)).toEqual([desktopEntry, entry]);
    expect(nativeWorkspace).not.toHaveBeenCalled(); expect(nativeSession).not.toHaveBeenCalled();
    test.view.__okwNavigation.refresh(); test.view.__okwNavigation.refresh(); test.view.eval(source);
    entry.click(); expect(test.workspaceOpen).toHaveBeenCalledTimes(3);
    expect(test.createWorkspace).toHaveBeenCalledOnce(); expect(test.doc.querySelector('.newrow:nth-child(2)')).toBe(entry);
    const question = vi.fn(); test.doc.addEventListener('keydown', question);
    const enter = new test.view.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    entry.dispatchEvent(enter); expect(enter.defaultPrevented).toBe(false); expect(question).not.toHaveBeenCalled();
    test.doc.querySelector('.btn-new-chat').click(); test.doc.querySelector('.newrow:first-child').click();
    expect(nativeSession).toHaveBeenCalledTimes(2); expect(nativeWorkspace).not.toHaveBeenCalled();
    await settled(test.state);
  });
  it('does not rescan navigation during unrelated chat mutations', async () => {
    const test = install(desktop + mobile + '<main></main>'); await settled(test.state);
    const query = vi.spyOn(test.doc, 'querySelector');
    for (let i = 0; i < 10; i += 1) { test.doc.querySelector('main').append(test.doc.createElement('span')); await tick(); }
    expect(query.mock.calls.filter(([selector]) => selector.includes('sidebar-actions') || selector.includes('sheet-body')))
      .toHaveLength(0); await settled(test.state);
  });
  it('uses shared usage entries and leaves no competing footer entry', async () => {
    const test = install(desktop + mobile); test.view.fetch = vi.fn(async () => new Response('{}'));
    test.view.Request = Request; test.view.Headers = Headers;
    usage.forEach((code) => test.view.eval(code)); await settled(test.state);
    expect(test.doc.querySelectorAll('[data-okw-navigation-action="usage"]')).toHaveLength(2);
    expect(test.doc.querySelector('.okw-usage-entry, .okw-usage-mobile-entry')).toBeNull();
  });
});
