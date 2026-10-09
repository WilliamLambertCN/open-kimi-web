/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { addMobilePresentation } from '../src/officialPresentation.mjs';

const usageParts = ['usageApi.js', 'usageView.js', 'usageTrend.js', 'usageControllers.js', 'usage.js'];
const mobileSource = (name) => name === 'usageBundle.js'
  ? usageParts.map((part) => readFileSync(resolve(`packages/launcher/src/mobile/${part}`), 'utf8')).join('\n')
  : readFileSync(resolve(`packages/launcher/src/mobile/${name}`), 'utf8');
const archivedUrl = '/api/v2/sessions?meta.archived=true';
const documents = [];
const observerStates = [];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const archivedItemV2 = (id, { archived = true } = {}) => ({
  id, workspace: { id: 'workspace_fixture', cwd: 'C:\\work' },
  meta: { title: 'Archived title', archived, archived_at: new Date('2026-09-08T12:34:00').getTime() },
});
const archivedResponseV2 = (items) => new Response(JSON.stringify({ data: { items } }), { status: 200 });
const sizeCss = readFileSync(resolve('packages/launcher/src/mobile/sessionSize.css'), 'utf8');
const desktopHeader = `<div class="chat-header" style="height:48px;padding:0 52px 0 78px">
  <div class="ch-id"><span class="ch-ws">Demo</span><span class="ch-sep">/</span>
    <span class="ui-tip"><span class="ch-ses">${'Long title '.repeat(20)}</span></span></div>
  <button class="ch-more">More</button><div class="ui-menu"></div><div class="ch-spacer"></div>
  <button class="ch-git">Branch</button><button class="ch-pr">PR</button>
  <div class="ch-toggles"><button>Panel</button></div></div>`;
const emptyMount = '<div class="empty-drag"></div><div class="empty-toggles"><button>Panel</button></div>';

const sidebarMarkup = `
  <div class="sessions"><div class="se">
    <span class="t">Archived title</span>
    <div class="actions"><button class="reopen-btn">Reopen</button></div>
  </div></div>`;
const settingsMarkup = `
  <div class="archive-list"><div class="archive-card">
    <div class="archive-workspace"><span class="path">C:\\work</span><span class="count">1 session</span></div>
    <div class="archive-row"><span class="archive-name">Archived title</span>
      <time class="archive-time">2026-09-08 12:34</time></div>
  </div></div>`;
const archiveMarkup = (rowScope) => (
  `${rowScope === 'settings' ? '' : sidebarMarkup}${rowScope === 'sidebar' ? '' : settingsMarkup}`
);

function install(options = {}) {
  const { items = [archivedItemV2('session_archived')], allScripts = false, extraMessages = 0,
    deleteResponse, rowScope = 'combined', desktopMount = '', path = '/settings' } = options;
  const messages = Array.from({ length: extraMessages }, (_, index) => `<div class="a-msg">Message ${index}</div>`).join('');
  const frame = document.createElement('iframe');
  document.body.append(frame);
  documents.push(frame);
  const view = frame.contentWindow;
  view.__okwTestLocation = { href: `http://localhost${path}`, origin: 'http://localhost', pathname: path };
  view.document.body.innerHTML = `<div id="app"><div class="app"><div class="con">${desktopMount}
    <div class="chat-scroll">${messages}</div></div></div></div>${archiveMarkup(rowScope)}`;
  view.Request = Request;
  view.Response = Response;
  view.Headers = Headers;
  view.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  view.localStorage.setItem('kimi-locale', 'en');
  view.localStorage.setItem('open-kimi-web.atmospheric-theme', 'original');
  view.confirm = vi.fn(() => true);
  view.fetch = vi.fn(async (url) => {
    if (String(url).includes('meta.archived=true')) return archivedResponseV2(items);
    if (String(url).includes('/session-size?')) return new Response(JSON.stringify({ available: true, bytes: 1234 }));
    return deleteResponse ?? new Response('{}', { status: 200 });
  });

  const NativeMutationObserver = view.MutationObserver;
  const state = { callbacks: 0, exceededLimit: false, observers: [] };
  observerStates.push(state);
  view.MutationObserver = class MutationObserver {
    constructor(callback) {
      let calls = 0;
      const observer = new NativeMutationObserver((records) => {
        state.callbacks += 1;
        calls += 1;
        if (calls > 80) {
          state.exceededLimit = true;
          observer.disconnect();
          return;
        }
        callback(records, observer);
      });
      state.observers.push(observer);
      return observer;
    }
  };

  const names = allScripts
    ? [...addMobilePresentation('<html><head><script type="module" src="/official.js"></script></head></html>')
      .matchAll(/<script src="\/__open-kimi-mobile\/([^"]+)"/g)].map((match) => match[1])
    : ['archivedSessionDelete.js'];
  names.forEach((name) => view.eval(`((location) => { ${mobileSource(name)}\n})(window.__okwTestLocation)`));
  const archiveButton = () => view.document.querySelector('.archive-row .okw-archive-delete');
  const sidebarButton = () => view.document.querySelector('.se .okw-sidebar-archive-delete');
  return { view, state, names, archiveButton, sidebarButton };
}

async function loadArchived(ui) {
  await ui.view.fetch(archivedUrl, { headers: { authorization: 'Bearer fixture-token' } });
  await tick();
  await tick();
}

async function expectSettled(ui) {
  await tick();
  const count = ui.state.callbacks;
  await tick();
  expect(ui.state.exceededLimit).toBe(false);
  expect(ui.state.callbacks).toBe(count);
}

afterEach(() => {
  observerStates.splice(0).flatMap((state) => state.observers).forEach((observer) => observer.disconnect());
  documents.splice(0).forEach((frame) => {
    frame.contentWindow.dispatchEvent(new frame.contentWindow.Event('pagehide'));
    frame.remove();
  });
});

describe('archived delete observer streaming scope', () => {
  it('ignores long chat streaming but restores actions after related rows and buttons change', async () => {
    const ui = install({ extraMessages: 500 });
    await loadArchived(ui);
    const app = ui.view.document.querySelector('#app');
    const sideChat = ui.view.document.createElement('div');
    sideChat.className = 'side-chat';
    const queries = vi.spyOn(ui.view.document, 'querySelectorAll');

    app.append(sideChat);
    for (let batch = 0; batch < 20; batch += 1) {
      const message = ui.view.document.createElement('div');
      message.className = 'a-msg';
      message.textContent = `History batch ${batch}`;
      app.append(message);
      const sideMessage = ui.view.document.createElement('div');
      sideMessage.textContent = `Side Chat batch ${batch}`;
      sideChat.append(sideMessage);
      await tick();
    }
    expect(queries).not.toHaveBeenCalled();

    ui.archiveButton().remove();
    ui.sidebarButton().remove();
    await tick();
    expect(ui.archiveButton()).not.toBeNull();
    expect(ui.sidebarButton()).not.toBeNull();

    const oldRow = ui.view.document.querySelector('.archive-row');
    const newRow = ui.view.document.createElement('div');
    newRow.className = 'archive-row';
    newRow.innerHTML = '<span class="archive-name">Archived title</span><time class="archive-time">2026-09-08 12:34</time>';
    oldRow.replaceWith(newRow);
    await tick();
    expect(newRow.querySelector('.okw-archive-delete')).not.toBeNull();

    ui.view.document.querySelector('.archive-list').outerHTML = settingsMarkup;
    ui.view.document.querySelector('.sessions').outerHTML = sidebarMarkup;
    await tick();
    expect(ui.archiveButton()).not.toBeNull();
    expect(ui.sidebarButton()).not.toBeNull();
    await expectSettled(ui);
    expect(ui.state.callbacks).toBeLessThan(80);
  });
});

describe('archived delete observer convergence', () => {
  it.each(['sidebar', 'settings'])('settles when only the %s archived row exists', async (rowScope) => {
    const ui = install({ rowScope });
    await loadArchived(ui);
    expect(ui.sidebarButton() !== null).toBe(rowScope === 'sidebar');
    expect(ui.archiveButton() !== null).toBe(rowScope === 'settings');
    await expectSettled(ui);
    ui.view.document.body.append(ui.view.document.createElement('div'));
    await expectSettled(ui);
  });

  it('settles after matching unique sidebar and settings rows, DOM changes, and a locale change', async () => {
    const ui = install();
    await loadArchived(ui);
    expect(ui.archiveButton()).not.toBeNull();
    expect(ui.sidebarButton()).not.toBeNull();
    await expectSettled(ui);

    ui.view.document.body.append(ui.view.document.createElement('div'));
    await expectSettled(ui);
    ui.view.localStorage.setItem('kimi-locale', 'zh');
    ui.view.document.body.append(ui.view.document.createElement('div'));
    await expectSettled(ui);
    expect(ui.archiveButton().textContent).toBe('永久删除');
    expect(ui.sidebarButton().textContent).toBe('删除');
    expect(ui.archiveButton().getAttribute('aria-label')).toBe('永久删除');
    expect(ui.sidebarButton().getAttribute('aria-label')).toBe('永久删除');
  });

  it('adds no action for an empty list or ambiguous API matches', async () => {
    for (const items of [[], [archivedItemV2('one', { archived: false })],
      [archivedItemV2('one'), archivedItemV2('two')]]) {
      const ui = install({ items });
      await loadArchived(ui);
      expect(ui.archiveButton()).toBeNull();
      expect(ui.sidebarButton()).toBeNull();
      await expectSettled(ui);
    }
  });

  it('keeps the in-progress copy while disabled and restores translated copy on failure', async () => {
    let finishDelete;
    const pending = new Promise((resolve) => { finishDelete = resolve; });
    const ui = install({ deleteResponse: pending });
    await loadArchived(ui);
    ui.archiveButton().click();
    expect(ui.archiveButton().disabled).toBe(true);
    expect(ui.archiveButton().textContent).toBe('Deleting…');
    ui.view.localStorage.setItem('kimi-locale', 'zh');
    ui.view.document.body.append(ui.view.document.createElement('div'));
    await expectSettled(ui);
    expect(ui.archiveButton().textContent).toBe('Deleting…');
    expect(ui.archiveButton().getAttribute('aria-label')).toBe('永久删除');
    finishDelete(new Response(JSON.stringify({ msg: 'Fixture failure' }), { status: 500 }));
    await tick();
    expect(ui.archiveButton().disabled).toBe(false);
    expect(ui.archiveButton().textContent).toBe('永久删除');
    await expectSettled(ui);
  });

  it('settles with all injected scripts, 100 messages, and Original theme', async () => {
    const ui = install({ allScripts: true, extraMessages: 100 });
    expect(ui.names).toHaveLength(19);
    expect(ui.names).toContain('mobileWorkspaceSort.js');
    expect(ui.names).toContain('imagePreviewGuard.js');
    expect(ui.names).toContain('tabFeedback.js');
    expect(ui.names.slice(-5)).toEqual([
      'usageBundle.js', 'questionCardLayout.js', 'presentation.js', 'sessionSize.js', 'messageTimestamps.js',
    ]);
    await loadArchived(ui);
    expect(ui.view.document.querySelectorAll('.a-msg')).toHaveLength(100);
    expect(ui.archiveButton()).not.toBeNull();
    expect(ui.sidebarButton()).not.toBeNull();
    expect(ui.view.document.documentElement.hasAttribute('data-okw-theme')).toBe(false);
    await expectSettled(ui);
    ui.view.document.body.append(ui.view.document.createElement('div'));
    await expectSettled(ui);
  });
});

describe('session size desktop all-script coexistence', () => {
  it('preserves native title, tooltip, rename, controls and reserved padding', async () => {
    const ui = install({ allScripts: true, desktopMount: desktopHeader, path: '/sessions/fixture' });
    const doc = ui.view.document;
    const header = doc.querySelector('.chat-header');
    const id = header.querySelector('.ch-id');
    const originalTitle = id.outerHTML;
    const controls = Array.from(header.children).filter((node) => !node.matches('.okw-session-size'));
    const padding = header.getAttribute('style');
    await loadArchived(ui);
    ui.view.dispatchEvent(new ui.view.Event('pagehide'));
    ui.view.dispatchEvent(new ui.view.Event('pageshow'));
    await expectSettled(ui);
    const size = header.querySelector('.okw-desktop-session-size');
    expect(size.textContent).toBe('会话 1.2 KB');
    expect(size.parentElement).toBe(header);
    expect(size.nextElementSibling.className).toBe('ch-spacer');
    expect(id.outerHTML).toBe(originalTitle);
    expect(header.getAttribute('style')).toBe(padding);
    expect(Array.from(header.children).filter((node) => node !== size)).toEqual(controls);
    expect(doc.querySelector('.okw-workspace-status')).toBeNull();
    id.querySelector('.ui-tip').outerHTML = '<input class="ch-rename" value="Renaming">';
    await expectSettled(ui);
    expect(id.querySelector('.ch-rename').value).toBe('Renaming');
    expect(header.querySelector('.okw-session-size')).toBe(size);
    expect(doc.querySelectorAll('.okw-session-size')).toHaveLength(1);
  });

  it('uses the native empty drag area, stops for an expanded panel and never fabricates a home header', async () => {
    const ui = install({ allScripts: true, desktopMount: emptyMount, path: '/sessions/fixture' });
    const doc = ui.view.document;
    const app = doc.querySelector('.app');
    const drag = doc.querySelector('.empty-drag');
    await loadArchived(ui);
    ui.view.dispatchEvent(new ui.view.Event('pagehide'));
    ui.view.dispatchEvent(new ui.view.Event('pageshow'));
    await expectSettled(ui);
    expect(drag.querySelector('.okw-session-size').textContent).toBe('会话 1.2 KB');
    expect(doc.querySelector('.chat-header')).toBeNull();
    expect(doc.querySelector('.empty-toggles button').textContent).toBe('Panel');
    app.classList.add('panel-expanded');
    await expectSettled(ui);
    expect(doc.querySelector('.okw-session-size')).toBeNull();
    app.classList.remove('panel-expanded');
    await expectSettled(ui);
    expect(drag.querySelector('.okw-desktop-session-size')).not.toBeNull();
    drag.outerHTML = desktopHeader;
    await expectSettled(ui);
    expect(doc.querySelector('.chat-header > .okw-session-size').textContent).toBe('会话 1.2 KB');
    doc.querySelector('.chat-header').outerHTML = emptyMount;
    await expectSettled(ui);
    expect(doc.querySelector('.empty-drag > .okw-session-size').textContent).toBe('会话 1.2 KB');
    ui.view.__okwTestLocation.pathname = '/';
    ui.view.dispatchEvent(new ui.view.PopStateEvent('popstate'));
    await expectSettled(ui);
    expect(doc.querySelector('.okw-session-size')).toBeNull();
    expect(doc.querySelector('.chat-header')).toBeNull();
  });

  it('limits desktop CSS to direct main mounts without changing native header height or padding', () => {
    const desktop = sizeCss.slice(sizeCss.indexOf('@media (min-width: 641px)'));
    const rules = [...desktop.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    expect(rules).toHaveLength(4);
    for (const [, selector] of rules) {
      expect(selector).toContain('.app:not(.mobile)');
      expect(selector).toContain('> .con >');
      expect(selector).toContain('.okw-desktop-session-size');
    }
    expect(desktop).not.toMatch(/(?:^|[;{])\s*(?:height|padding(?:-[\w-]+)?|overflow|text-overflow|gap)\s*:/);
    expect(rules[0][2]).toContain('font-size: var(--text-xs)');
    expect(rules[0][2]).toContain('color: var(--color-text-muted)');
    expect(rules[0][2]).toContain('white-space: nowrap');
    expect(rules[0][2]).toContain('font-variant-numeric: tabular-nums');
    expect(rules[1][2]).toMatch(/flex-shrink:\s*1/);
    expect(rules[2][2]).toContain('inset-inline: 78px');
    expect(rules[3][2]).toContain('inset-inline-start: 146px');
  });
});
