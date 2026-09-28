/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sources = ['presentation.js', 'workspacePins.js'].map((name) =>
  readFileSync(resolve(`packages/launcher/src/mobile/${name}`), 'utf8'));
const frames = [];
const observers = [];

const group = (id) => `<div class="ws-drop-target" data-ws-id="${id}">
  <div class="group"><div class="gh"><span class="gh-name">${id}</span>
    <div class="gh-actions"><button class="gh-more"></button></div></div></div></div>`;

function install() {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const view = frame.contentWindow;
  const doc = view.document;
  doc.body.innerHTML = `<div class="side"><div class="ch-brand"><span class="ch-name">Kimi Code</span></div></div>
    <div class="app"><div class="composer"><div class="ph"><div contenteditable="true"></div></div>
      <button class="stop"></button><button class="send" disabled></button><div class="toolbar-right"></div></div></div>
    <div class="sessions">${group('workspace-a')}${group('workspace-b')}</div>
    <div class="history">${'<div class="a-msg"><span>Earlier</span></div>'.repeat(500)}</div>
    <div class="sc-body"></div>`;
  view.localStorage.clear();
  view.localStorage.setItem('open-kimi-web.pinned-workspaces', JSON.stringify(['workspace-c']));
  const media = { matches: false, addEventListener: vi.fn() };
  view.matchMedia = vi.fn(() => media);
  view.fetch = vi.fn(async () => ({ ok: false }));
  const state = { callbacks: 0, exceeded: false };
  const NativeMutationObserver = view.MutationObserver;
  view.MutationObserver = class MutationObserver {
    constructor(callback) {
      this.observer = new NativeMutationObserver((records) => {
        state.callbacks += 1;
        if (state.callbacks > 250) {
          state.exceeded = true;
          observers.forEach((observer) => observer.disconnect());
          return;
        }
        callback(records);
      });
      observers.push(this.observer);
    }
    observe(target, options) { this.observer.observe(target, options); }
  };
  for (const source of sources) view.eval(`(() => { ${source}\n})()`);
  return { doc, media, state, view };
}

const settle = async () => {
  for (let pass = 0; pass < 5; pass += 1) await Promise.resolve();
};

afterEach(() => {
  observers.splice(0).forEach((observer) => observer.disconnect());
  frames.splice(0).forEach((frame) => frame.remove());
});

describe('streaming observer scope', () => {
  it('does not rescan the document for main history or Side Chat output', async () => {
    const { doc, state } = install();
    await settle();
    let globalQueries = 0;
    const query = doc.querySelector.bind(doc);
    const queryAll = doc.querySelectorAll.bind(doc);
    doc.querySelector = (selector) => { globalQueries += 1; return query(selector); };
    doc.querySelectorAll = (selector) => { globalQueries += 1; return queryAll(selector); };

    const historyTail = doc.querySelector('.history .a-msg:last-child');
    const side = doc.querySelector('.sc-body');
    globalQueries = 0;
    for (let batch = 0; batch < 20; batch += 1) {
      historyTail.append(doc.createElement('span'));
      await settle();
      side.append(doc.createElement('span'));
      await settle();
    }

    expect(globalQueries).toBe(0);
    expect(state.exceeded).toBe(false);
    const settledCallbacks = state.callbacks;
    await settle();
    expect(state.callbacks).toBe(settledCallbacks);
  });

  it('still responds to relevant workspace, brand, and composer changes', async () => {
    const { doc, state } = install();
    await settle();
    expect(doc.querySelector('.side .ch-name').textContent).toBe('OPEN-KIMI-WEB');
    expect(doc.querySelector('.okw-steer-button')).toBeNull();

    doc.querySelector('.side .ch-name').textContent = 'Kimi Code';
    doc.querySelector('.app .composer .send').disabled = false;
    doc.querySelector('.sessions').insertAdjacentHTML('beforeend', group('workspace-c'));
    await settle();

    expect(doc.querySelector('.side .ch-name').textContent).toBe('OPEN-KIMI-WEB');
    expect(doc.querySelector('.okw-steer-button')).not.toBeNull();
    expect(doc.querySelector('.sessions').firstElementChild.dataset.wsId).toBe('workspace-c');
    expect(doc.querySelector('[data-ws-id="workspace-c"] .okw-workspace-pin-mark')).not.toBeNull();

    const sessions = doc.querySelector('.sessions');
    sessions.append(sessions.querySelector('[data-ws-id="workspace-a"]'));
    await settle();
    expect(sessions.firstElementChild.dataset.wsId).toBe('workspace-c');
    doc.querySelector('[data-ws-id="workspace-c"] .gh-more').click();
    doc.body.insertAdjacentHTML('beforeend', '<div class="workspace-menu"><button class="ui-menu-item">Rename</button></div>');
    await settle();
    expect(doc.querySelector('.workspace-menu [data-okw-workspace-pin-action]')).not.toBeNull();
    doc.querySelector('.workspace-menu').outerHTML =
      '<div class="workspace-menu"><button class="ui-menu-item">Rename again</button></div>';
    await settle();
    expect(doc.querySelector('.workspace-menu [data-okw-workspace-pin-action]')).not.toBeNull();
    expect(state.exceeded).toBe(false);
  });
});

describe('mobile header observer scope', () => {
  it('updates on topbar changes and restores the desktop header on media change', async () => {
    const { doc, media, state } = install();
    await settle();
    media.matches = true;
    const mobileApp = doc.createElement('div');
    mobileApp.className = 'app mobile';
    mobileApp.innerHTML = '<div class="topbar"><div class="tb-main"><span class="dir">Demo</span></div>' +
      '<span class="st">Idle</span></div>';
    doc.body.append(mobileApp);
    await settle();
    expect(mobileApp.querySelector('.okw-workspace-badge').textContent).toBe('D');
    expect(mobileApp.querySelector('.okw-workspace-status').textContent).toBe('Idle');

    mobileApp.querySelector('.st').textContent = 'Running';
    await settle();
    expect(mobileApp.querySelector('.okw-workspace-status').textContent).toBe('Running');
    media.matches = false;
    media.addEventListener.mock.calls[0][1]();
    await settle();
    expect(mobileApp.querySelector('.okw-workspace-badge')).toBeNull();
    expect(state.exceeded).toBe(false);
  });
});
