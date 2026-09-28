/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { addMobilePresentation } from '../src/officialPresentation.mjs';

const mobileSource = (name) => readFileSync(resolve(`packages/launcher/src/mobile/${name}`), 'utf8');
const archivedUrl = '/api/v2/sessions?meta.archived=true';
const documents = [];
const observerStates = [];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const archivedItemV2 = (id, { archived = true } = {}) => ({
  id, workspace: { id: 'workspace_fixture', cwd: 'C:\\work' },
  meta: { title: 'Archived title', archived, archived_at: new Date('2026-09-08T12:34:00').getTime() },
});
const archivedResponseV2 = (items) => new Response(JSON.stringify({ data: { items } }), { status: 200 });

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

function install({ items = [archivedItemV2('session_archived')], allScripts = false, extraMessages = 0,
  deleteResponse, rowScope = 'combined' } = {}) {
  const messages = Array.from({ length: extraMessages }, (_, index) => `<div class="a-msg">Message ${index}</div>`).join('');
  const frame = document.createElement('iframe');
  document.body.append(frame);
  documents.push(frame);
  const view = frame.contentWindow;
  view.document.body.innerHTML = `<div id="app" class="app">${messages}</div>${archiveMarkup(rowScope)}`;
  view.Request = Request;
  view.Response = Response;
  view.Headers = Headers;
  view.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  view.localStorage.setItem('kimi-locale', 'en');
  view.localStorage.setItem('open-kimi-web.atmospheric-theme', 'original');
  view.confirm = vi.fn(() => true);
  view.fetch = vi.fn(async (url) => String(url).includes('meta.archived=true')
    ? archivedResponseV2(items) : deleteResponse ?? new Response('{}', { status: 200 }));

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
  names.forEach((name) => view.eval(`((location) => { ${mobileSource(name)}\n})({
    href: 'http://localhost/settings', origin: 'http://localhost', pathname: '/settings'
  })`));
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
  documents.splice(0).forEach((frame) => frame.remove());
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
    expect(ui.names).toHaveLength(15);
    expect(ui.names.slice(-4)).toEqual(['usageView.js', 'usageTrend.js', 'usage.js', 'presentation.js']);
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
