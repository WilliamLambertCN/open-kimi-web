/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
const sources = ['navigationApi.js', 'navigationSearchView.js', 'navigationWorkspace.js', 'navigation.js']
  .map((name) => readFileSync(resolve(`packages/launcher/src/mobile/${name}`), 'utf8'));
const frames = []; const observers = [];
const tick = () => new Promise((done) => setTimeout(done, 0));
const workspace = { id: 'fixture', root: '/fixture', name: 'Fictional workspace', session_count: 0,
  created_at: '2026-10-24T06:50:33.000Z', last_opened_at: '2026-10-24T06:50:33.000Z' };
const envelope = (data, code = 0) => new Response(JSON.stringify({ code, data }));
function install({ kind = 'desktop', api = false, respond = () => envelope(workspace) } = {}) {
  const frame = document.createElement('iframe'); frame.src = 'http://fixture.invalid/';
  document.body.append(frame); frames.push(frame);
  const view = frame.contentWindow;
  view.document.open(); view.document.write('<!doctype html><html><body></body></html>'); view.document.close();
  view.document.body.innerHTML = '<div id="app"><aside class="side"><div class="sidebar-actions">' +
    '<button class="btn-new-chat">New</button><button class="search">Search</button></div></aside>' +
    '<main data-session-id="fictional-session"><textarea>Current fictional draft</textarea></main></div>' +
    '<div class="sheet-root"><section class="sheet-panel"><div class="sheet-body"><div class="actions">' +
    '<button class="newrow">New</button><button class="newrow"><span>Workspace</span></button></div>' +
    '<div class="view-tabs">Tabs</div></div></section></div>';
  const locale = []; view.__okwLocale = { text: (_, en) => en, observe: (callback) => locale.push(callback) };
  view.__okwNavigationCreateSearch = () => ({ open() {}, close() {} });
  const nativeSession = vi.fn(); const nativeWorkspace = vi.fn();
  view.document.querySelectorAll('.btn-new-chat, .newrow:first-child')
    .forEach((node) => node.addEventListener('click', nativeSession));
  view.document.querySelector('.newrow:nth-child(2)').addEventListener('click', nativeWorkspace);
  const fetch = vi.fn(respond); view.fetch = fetch; view.Headers = Headers; view.Request = Request;
  const Native = view.MutationObserver;
  view.MutationObserver = class {
    constructor(callback) { const observer = new Native(callback); observers.push(observer); return observer; }
  };
  sources.forEach((code) => view.eval(code));
  if (!api) view.__okwNavigationAddWorkspace = vi.fn(async () => workspace);
  const entry = view.document.querySelector(`${kind === 'mobile' ? '.sheet-panel' : '.side'} ` +
    '[data-okw-navigation-action="workspace"]');
  const authorize = () => view.fetch('/api/v1/meta', { headers: { authorization: 'Bearer fictional-only' } });
  return { view, doc: view.document, entry, locale, nativeSession, nativeWorkspace, fetch, authorize };
}
function enter(test, value) {
  const input = test.doc.querySelector('.okw-navigation-workspace-panel input');
  input.focus(); input.value = value;
  input.dispatchEvent(new test.view.InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  return input;
}
const save = (test) => test.doc.querySelector('.okw-navigation-workspace-actions button[type="submit"]');
const close = (test) => test.doc.querySelector('.okw-navigation-workspace-actions button[type="button"]').click();
const status = (test) => test.doc.querySelector('.okw-navigation-workspace-panel [role="status"]');
function preserved(test) {
  expect(test.doc.querySelector('textarea').value).toBe('Current fictional draft');
  expect(test.doc.querySelector('main').dataset.sessionId).toBe('fictional-session');
  expect(test.nativeSession).not.toHaveBeenCalled(); expect(test.nativeWorkspace).not.toHaveBeenCalled();
}
afterEach(async () => {
  observers.splice(0).forEach((observer) => observer.disconnect()); await tick();
  frames.splice(0).forEach((frame) => frame.remove());
});
describe.each(['desktop', 'mobile'])('%s workspace path dialog', (kind) => {
  it('opens and cancels without native folder browsing, session changes or draft loss', () => {
    const test = install({ kind }); test.entry.click();
    expect(test.doc.querySelector('.okw-navigation-workspace-panel')).not.toBeNull();
    expect(test.doc.querySelector('#app').inert).toBe(true); expect(test.doc.querySelector('.sheet-root').inert).toBe(true);
    close(test); preserved(test);
    expect(test.view.__okwNavigationAddWorkspace).not.toHaveBeenCalled();
    expect(test.doc.activeElement).toBe(test.entry); expect(test.doc.querySelector('#app').inert).toBeFalsy();
    expect(test.doc.querySelector('.sheet-root').inert).toBeFalsy();
  });
  it('submits once from the actual save button, preserves content and reports rejected paths', async () => {
    const test = install({ kind }); test.entry.click(); const input = enter(test, '/fixture');
    save(test).click(); save(test).click();
    expect(test.view.__okwNavigationAddWorkspace).toHaveBeenCalledOnce(); expect(save(test).disabled).toBe(true);
    await tick(); expect(status(test).textContent).toContain('Workspace added'); preserved(test);
    expect(input.value).toBe(''); expect(save(test).disabled).toBe(false);
    enter(test, '/missing'); test.view.__okwNavigationAddWorkspace.mockRejectedValueOnce(new Error('Fixture rejected'));
    save(test).click(); await tick();
    expect(input.value).toBe('/missing'); expect(status(test).dataset.error).toBe('true');
    expect(status(test).textContent).toBe('Fixture rejected'); expect(save(test).disabled).toBe(false); preserved(test);
  });
  it('does not submit empty or whitespace-only input', async () => {
    const test = install({ kind }); test.entry.click();
    for (const value of ['', '  \n\t ']) { enter(test, value); save(test).click(); await tick(); }
    expect(test.view.__okwNavigationAddWorkspace).not.toHaveBeenCalled(); expect(save(test).disabled).toBe(false);
    preserved(test);
  });
  it('aborts on close, restores prior inert state and ignores stale outcomes after reopening', async () => {
    const test = install({ kind }); test.doc.querySelector('#app').inert = true;
    let finish;
    test.view.__okwNavigationAddWorkspace.mockImplementationOnce(() => new Promise((done) => { finish = done; }));
    test.entry.click(); enter(test, '/pending'); save(test).click();
    const signal = test.view.__okwNavigationAddWorkspace.mock.calls[0][1]; close(test);
    expect(signal.aborted).toBe(true); expect(test.doc.querySelector('#app').inert).toBe(true);
    expect(test.doc.querySelector('.sheet-root').inert).toBeFalsy(); expect(test.doc.activeElement).toBe(test.entry);
    test.entry.click(); const input = enter(test, '/next'); finish(workspace); await tick();
    expect(input.value).toBe('/next'); expect(status(test).textContent).toBe(''); expect(save(test).disabled).toBe(false);
    save(test).click(); await tick(); expect(status(test).textContent).toContain('Workspace added'); preserved(test);
  });
  it('blocks background keyboard handlers but preserves Enter default and IME composition', () => {
    const test = install({ kind }); test.entry.click(); const native = vi.fn();
    test.doc.addEventListener('keydown', native, true); test.doc.addEventListener('keydown', native);
    const input = test.doc.querySelector('.okw-navigation-workspace-panel input');
    for (const isComposing of [false, true]) {
      const event = new test.view.KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true, isComposing});
      input.dispatchEvent(event); expect(event.defaultPrevented).toBe(false); expect(native).not.toHaveBeenCalled();
    }
    input.dispatchEvent(new test.view.KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
    expect(test.doc.querySelector('.okw-navigation-search-backdrop').hidden).toBe(true); preserved(test);
  });
});
describe.each(['desktop', 'mobile'])('%s workspace form with the official API', (kind) => {
  it.each([
    ['  "C:\\Fixture Projects\\demo"  ', 'C:\\Fixture Projects\\demo'],
    [" '/srv/fixture projects/demo' ", '/srv/fixture projects/demo'],
  ])('registers an entered server path through a real save click (%j)', async (input, expected) => {
    const test = install({ kind, api: true, respond: (url, options) => {
      if (url === '/api/v1/meta' && options.method === undefined) return envelope({ server_version: '2.3.1' });
      if (url === '/api/v1/workspaces' && options.method === 'POST') {
        expect(JSON.parse(options.body)).toEqual({ root: expected });
        return envelope({ ...workspace, root: expected });
      }
      throw new Error('Unexpected navigation request');
    } });
    await test.authorize(); test.fetch.mockClear(); test.entry.click(); enter(test, input); save(test).click(); await tick();
    expect(test.fetch).toHaveBeenCalledOnce();
    expect(test.fetch.mock.calls[0][0]).toBe('/api/v1/workspaces');
    expect(test.fetch.mock.calls[0][1].headers.authorization).toBe('Bearer fictional-only');
    expect(status(test).textContent).toContain('Workspace added'); expect(status(test).dataset.error).toBe('false');
    preserved(test);
  });
  it.each([
    ['  relative/fixture  ', 'relative/fixture', 40001, 'absolute directory path'],
    ['"C:\\Fixture Projects\\demo', '"C:\\Fixture Projects\\demo', 40001, 'absolute directory path'],
    ['/missing/fixture', '/missing/fixture', 40409, 'does not exist'],
  ])('retains rejected input and preserves the native session (%j)', async (input, expected, code, message) => {
    const test = install({ kind, api: true, respond: (url, options) => {
      if (url === '/api/v1/meta' && options.method === undefined) return envelope({ server_version: '2.3.1' });
      expect(url).toBe('/api/v1/workspaces'); expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toEqual({ root: expected }); return envelope(null, code);
    } });
    await test.authorize(); test.fetch.mockClear(); test.entry.click(); const field = enter(test, input);
    save(test).click(); await tick();
    expect(test.fetch).toHaveBeenCalledOnce(); expect(field.value).toBe(input); expect(save(test).disabled).toBe(false);
    expect(status(test).textContent).toContain(message); expect(status(test).dataset.error).toBe('true'); preserved(test);
  });
  it('rejects quote-only input without any server mutation', async () => {
    const test = install({ kind, api: true }); await test.authorize(); test.fetch.mockClear();
    test.entry.click(); enter(test, ' "" '); save(test).click(); await tick();
    expect(test.fetch).not.toHaveBeenCalled(); expect(status(test).textContent).toContain('absolute directory path');
    expect(save(test).disabled).toBe(false); preserved(test);
  });
});
describe('shared workspace dialog', () => {
  it('reuses the same dialog node after desktop close and mobile open', () => {
    const test = install(); test.entry.click(); const panel = test.doc.querySelector('.okw-navigation-workspace-panel');
    close(test); test.doc.querySelector('.sheet-panel [data-okw-navigation-action="workspace"] span').click();
    expect(test.doc.querySelector('.okw-navigation-workspace-panel')).toBe(panel);
    expect(test.doc.querySelectorAll('.okw-navigation-workspace-panel')).toHaveLength(1);
    expect(test.doc.querySelector('.okw-navigation-search-backdrop').hidden).toBe(false);
    preserved(test);
  });
});
