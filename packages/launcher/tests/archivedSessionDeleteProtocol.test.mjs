/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { addMobilePresentation } from '../src/officialPresentation.mjs';
import {
  archivedItemLegacyV1,
  archivedItemV1,
  archivedItemV2,
} from './testkit/archivedSessionDeleteUi.mjs';

const source = readFileSync(resolve('packages/launcher/src/mobile/archivedSessionDelete.js'), 'utf8');
const legacyUrl = '/api/v1/sessions?archived_only=true';
const v2Url = '/api/v2/sessions?meta.archived=true';
const unifiedUrl = '/api/v1/sessions?archived=true';
const legacyItem = archivedItemLegacyV1('session_archived');
const legacyPage = (items = [legacyItem]) => ({ items, has_more: false });
const response = (data) => new Response(JSON.stringify({ code: 0, data }), {
  headers: { 'content-type': 'application/json' },
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const frames = [];
const states = [];
const markup = `
  <div class="sessions"><div class="se"><span class="t">Archived title</span>
    <div class="ha"><button class="reopen-btn">Reopen</button></div></div></div>
  <div class="archive-list"><div class="archive-card">
    <div class="archive-workspace"><span class="path">C:\\work</span><span class="count">1 session</span></div>
    <div class="archive-row"><span class="archive-name">Archived title</span>
      <time class="archive-time">2026-09-08 12:34</time></div></div></div>`;

function watchMutations(view) {
  const NativeObserver = view.MutationObserver;
  const state = { callbacks: 0, stopped: false, observers: [] };
  states.push(state);
  view.MutationObserver = class MutationObserver {
    constructor(callback) {
      const observer = new NativeObserver((records) => {
        state.callbacks += 1;
        if (state.callbacks > 80) {
          state.stopped = true;
          observer.disconnect();
        } else callback(records, observer);
      });
      state.observers.push(observer);
      return observer;
    }
  };
  return state;
}

function install({ listPath = legacyUrl, page = legacyPage(), officialWebVersion = '2.6.1' } = {}) {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const view = frame.contentWindow;
  view.document.body.innerHTML = markup;
  const location = { href: 'http://localhost/settings', origin: 'http://localhost', reload: vi.fn() };
  view.__okwArchiveWindow = new Proxy(view, {
    get: (target, name) => name === 'location' ? location : Reflect.get(target, name),
  });
  view.__okwArchiveLocation = location;
  view.Request = Request;
  view.Response = Response;
  view.Headers = Headers;
  view.localStorage.setItem('kimi-locale', 'en');
  view.confirm = vi.fn(() => true);
  const listResponse = response(page);
  const nativeFetch = vi.fn(async () => listResponse);
  view.fetch = nativeFetch;
  const state = watchMutations(view);
  const html = addMobilePresentation('<html><head><script type="module" src="/official.js"></script></head></html>', {
    officialWebVersion,
  });
  const names = [...html.matchAll(/<script src="\/__open-kimi-mobile\/([^"]+)"/g)].map((match) => match[1]);
  if (names.includes('archivedSessionDelete.js')) {
    view.eval(`((window, location) => { ${source}\n})(window.__okwArchiveWindow, window.__okwArchiveLocation)`);
  }
  const settingsRow = () => view.document.querySelector('.archive-row');
  const sidebarRow = () => view.document.querySelector('.se');
  const settingsButton = () => settingsRow()?.querySelector('.okw-archive-delete') ?? null;
  const sidebarButton = () => sidebarRow()?.querySelector('.okw-sidebar-archive-delete') ?? null;
  return { view, location, nativeFetch, names, state, listPath, listResponse,
    settingsRow, sidebarRow, settingsButton, sidebarButton };
}

async function load(ui, path = ui.listPath) {
  const received = await ui.view.fetch(path, { headers: { authorization: 'Bearer fixture-token' } });
  await tick();
  await tick();
  expect(received.bodyUsed).toBe(false);
  return received;
}

async function settled(ui) {
  await tick();
  const callbacks = ui.state.callbacks;
  await tick();
  expect(ui.state.stopped).toBe(false);
  expect(ui.state.callbacks).toBe(callbacks);
}

const deleteCalls = (ui) => ui.nativeFetch.mock.calls.filter(([url]) => String(url).endsWith(':delete'));
const expectNoActions = (ui) => {
  expect(ui.settingsButton()).toBeNull();
  expect(ui.sidebarButton()).toBeNull();
  expect(ui.view.confirm).not.toHaveBeenCalled();
  expect(deleteCalls(ui)).toHaveLength(0);
};

afterEach(() => {
  states.splice(0).flatMap((state) => state.observers).forEach((observer) => observer.disconnect());
  frames.splice(0).forEach((frame) => frame.remove());
});

const protocols = [
  ['legacy v1 without total', legacyUrl, legacyPage()],
  ['v2 with total', v2Url, {
    items: [archivedItemV2('session_archived')], total: 1, has_more: false, next_page_token: null,
  }],
];
const clickCases = protocols.flatMap(([protocol, listPath, page]) =>
  ['settings', 'sidebar'].map((scope) => [protocol, scope, listPath, page]));

describe('real archived page jsdom click chain', () => {
  it.each(clickCases)('%s from %s preserves cancel, failure, retry and duplicate guards', async (_, scope, listPath, page) => {
    const ui = install({ listPath, page });
    expect(ui.names).toContain('archivedSessionDelete.js');
    expect(await load(ui)).toBe(ui.listResponse);
    const button = scope === 'settings' ? ui.settingsButton() : ui.sidebarButton();
    const other = scope === 'settings' ? ui.sidebarButton() : ui.settingsButton();
    const row = button.closest('.archive-row, .se');
    ui.view.confirm.mockReturnValue(false);
    button.click();
    expect(deleteCalls(ui)).toHaveLength(0);
    expect(ui.view.confirm).toHaveBeenLastCalledWith(expect.stringContaining('Archived title'));
    expect(ui.view.confirm).toHaveBeenLastCalledWith(expect.stringContaining('cannot be undone'));
    expect(ui.settingsRow()).not.toBeNull();
    expect(ui.sidebarRow()).not.toBeNull();

    ui.view.confirm.mockReturnValue(true);
    ui.nativeFetch.mockResolvedValueOnce(new Response('{"code":50000,"msg":"Fixture failure"}', { status: 500 }));
    button.click();
    await tick();
    expect(deleteCalls(ui)).toHaveLength(1);
    expect(row.querySelector('[role="alert"]').textContent).toBe('Fixture failure');
    expect(button.disabled).toBe(false);
    expect(ui.location.reload).not.toHaveBeenCalled();

    const pending = Promise.withResolvers();
    ui.nativeFetch.mockReturnValueOnce(pending.promise);
    button.click();
    button.click();
    other.click();
    expect(deleteCalls(ui)).toHaveLength(2);
    expect(ui.view.confirm).toHaveBeenCalledTimes(3);
    expect(deleteCalls(ui).at(-1)).toEqual(['/api/v1/sessions/session_archived:delete', {
      method: 'POST', credentials: 'same-origin',
      headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json' }, body: '{}',
    }]);
    pending.resolve(new Response('{"code":0,"data":{"deleted":true}}'));
    await tick();
    expect(ui.settingsRow()).toBeNull();
    expect(ui.sidebarRow()).toBeNull();
    expect(ui.location.reload).toHaveBeenCalledTimes(1);
    await settled(ui);
  });
});

describe('legacy v1 without total destructive boundaries', () => {
  it.each([
    ['another page', '', { has_more: true }],
    ['before cursor only', '&before_id=earlier', {}],
    ['after cursor only', '&after_id=later', {}],
    ['page token only', '&page_token=next%3D%3D', {}],
    ['page 2 only', '&page=2', {}],
    ['generic cursor only', '&cursor=next', {}],
    ['workspace filter', '&workspace_id=workspace_test', {}],
    ['busy filter', '&busy=false', {}],
    ['empty filter', '&exclude_empty=true', {}],
    ['prompt filter', '&has_prompt=true', {}],
    ['activity filter', '&activity=idle', {}],
    ['updated-after filter', '&updated_after=2026-09-01', {}],
    ['updated-before filter', '&updated_before=2026-09-30', {}],
    ['ID projection', '&fields=id', {}],
    ['unavailable host', '&hosts=include', { unavailable_hosts: ['fixture-remote'] }],
    ['mismatched total', '', { total: 2 }],
    ['null total', '', { total: null }],
    ['missing cwd', '', { items: [archivedItemLegacyV1('session_archived', { metadata: {} })] }],
    ['remote session', '', { items: [archivedItemLegacyV1('session_archived', { host_id: 'fixture-remote' })] }],
  ])('does not bind %s', async (_, suffix, fields) => {
    const ui = install({ listPath: `${legacyUrl}${suffix}`, page: { ...legacyPage(), ...fields } });
    await load(ui);
    expectNoActions(ui);
    await settled(ui);
  });

  it('does not treat the last of several total-free pages as a full list', async () => {
    const ui = install({ page: { ...legacyPage(), has_more: true } });
    await load(ui);
    expectNoActions(ui);
    ui.nativeFetch.mockResolvedValueOnce(response(legacyPage([
      archivedItemLegacyV1('last_session', { title: 'Last fixture' }),
    ])));
    await load(ui, `${legacyUrl}&before_id=session_archived`);
    expectNoActions(ui);
    expect(ui.nativeFetch).toHaveBeenCalledTimes(2);
  });

  it('does not treat a continuation as a first page after the initial response fails', async () => {
    const ui = install();
    ui.nativeFetch.mockResolvedValueOnce(new Response('Unavailable', { status: 503 }));
    await load(ui);
    expectNoActions(ui);
    ui.nativeFetch.mockResolvedValueOnce(response(legacyPage()));
    await load(ui, `${legacyUrl}&before_id=earlier_session`);
    expectNoActions(ui);
    await settled(ui);
  });

  it('invalidates old buttons when a full page is refreshed into a partial list', async () => {
    const ui = install();
    await load(ui);
    const oldSettings = ui.settingsButton();
    const oldSidebar = ui.sidebarButton();
    ui.nativeFetch.mockResolvedValueOnce(response({ ...legacyPage(), has_more: true }));
    await load(ui);
    oldSettings.click();
    oldSidebar.click();
    expectNoActions(ui);
    expect(ui.nativeFetch).toHaveBeenCalledTimes(2);
    await settled(ui);
  });

});

describe('legacy and v2 destructive identity matching', () => {
  it.each(protocols)('rejects duplicate visible API keys in %s', async (_, listPath, page) => {
    const duplicate = { ...page.items[0], id: 'duplicate_session' };
    const ui = install({ listPath, page: {
      ...page, items: [...page.items, duplicate], ...('total' in page ? { total: 2 } : {}),
    } });
    await load(ui);
    expectNoActions(ui);
    await settled(ui);
  });

  it('does not infer a unique sidebar ID from same-title sessions in different workspaces', async () => {
    const ui = install({ page: legacyPage([
      legacyItem, archivedItemLegacyV1('other_workspace', { metadata: { cwd: 'C:\\other' }, workspace_id: 'other_workspace' }),
    ]) });
    await load(ui);
    expect(ui.settingsButton()).not.toBeNull();
    expect(ui.sidebarButton()).toBeNull();
    expect(deleteCalls(ui)).toHaveLength(0);
  });

  it('does not bind repeated DOM rows to one legacy session', async () => {
    const ui = install();
    ui.settingsRow().after(ui.settingsRow().cloneNode(true));
    ui.sidebarRow().after(ui.sidebarRow().cloneNode(true));
    await load(ui);
    expect(ui.view.document.querySelectorAll('.okw-archive-delete')).toHaveLength(0);
    expectNoActions(ui);
    await settled(ui);
  });
});

describe('archive protocol distinction', () => {
  it.each([
    ['unified v1', unifiedUrl, archivedItemV1('session_archived')],
    ['v2', v2Url, archivedItemV2('session_archived')],
  ])('does not accept a total-free complete page for %s', async (_, listPath, item) => {
    const ui = install({ listPath, page: { items: [item], has_more: false } });
    await load(ui);
    expectNoActions(ui);
  });

  it('does not accept total-free grouped pages under the legacy parameter', async () => {
    const ui = install({ page: {
      groups: [{ workspace_id: 'workspace_test', sessions: [legacyItem], total: 1 }], has_more: false,
    } });
    await load(ui);
    expectNoActions(ui);
  });

  it('leaves the 2.7.2 official action as the only delete path', async () => {
    const ui = install({ officialWebVersion: '2.7.2', listPath: unifiedUrl, page: {
      items: [archivedItemV1('session_archived')], total: 1, has_more: false,
    } });
    const nativeButton = ui.view.document.createElement('button');
    nativeButton.className = 'ui-button ui-button--danger';
    nativeButton.textContent = 'Delete';
    const nativeDelete = vi.fn(() => {
      void ui.view.fetch('/api/v1/sessions/session_archived:delete', { method: 'POST', body: '{}' });
    });
    nativeButton.addEventListener('click', nativeDelete);
    ui.settingsRow().append(nativeButton);
    await load(ui);
    expect(ui.names).not.toContain('archivedSessionDelete.js');
    expect(ui.view.fetch).toBe(ui.nativeFetch);
    expectNoActions(ui);
    nativeButton.click();
    await tick();
    expect(nativeDelete).toHaveBeenCalledTimes(1);
    expect(deleteCalls(ui)).toHaveLength(1);
    expect(ui.settingsRow().querySelectorAll('button')).toHaveLength(1);
    expect(ui.view.confirm).not.toHaveBeenCalled();
    await settled(ui);
  });
});
