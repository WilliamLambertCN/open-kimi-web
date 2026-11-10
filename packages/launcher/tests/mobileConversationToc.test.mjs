/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sources = ['mobileConversationTocView.js', 'mobileConversationToc.js']
  .map((name) => readFileSync(resolve(`packages/launcher/src/mobile/${name}`), 'utf8'));
const frames = [];
const observers = [];
const tick = () => new Promise((done) => setTimeout(done, 0));
const markup = (id = 'a:input', value = 'Duplicate title') => `<div class="u-turn">
  <div class="u-bub turn-anchor" data-turn-id="${id}"><div class="u-text">${value}</div></div></div>`;
function setup(options = {}) {
  const frame = document.createElement('iframe'); document.body.append(frame); frames.push(frame);
  const view = frame.contentWindow; const doc = view.document;
  doc.body.innerHTML = '<div id="app"><div class="app mobile"><div class="topbar">' +
    '<button class="tb-main">A long fictional session title</button><button class="settings">Settings</button></div>' +
    '<main class="con"><div class="panes chat-scroll"><div class="chat">' + markup() + markup('b:input') +
    '<div class="a-msg">Stream</div><div class="top-sentinel"><button class="top-sentinel-btn">Older</button>' +
    '</div></div></div><textarea>Unsent fictional draft</textarea></main></div></div>';
  view.Element.prototype.scrollIntoView = vi.fn();
  const media = { matches: options.mobile !== false, addEventListener: vi.fn() };
  view.matchMedia = vi.fn(() => media);
  let session = 'A';
  let items = options.empty ? [] : [{ id: 'a:input', label: 'Duplicate title' }, { id: 'b:input', label: 'Duplicate title' }];
  const listeners = []; const locales = [];
  let language = 'en';
  view.__okwLocale = { text: (zh, en) => language === 'zh' ? zh : en, observe: (fn) => locales.push(fn) };
  const labels = vi.fn();
  view.__okwMobileTocMetadata = { session: () => session, items: () => items, hasMore: () => true,
    observe: (fn) => listeners.push(fn), label: labels };
  const navigate = vi.fn().mockResolvedValue(undefined);
  view.__okwMobileTocNavigate = navigate;
  const state = { calls: 0, storm: false };
  const Native = view.MutationObserver;
  view.MutationObserver = class {
    constructor(callback) {
      const observer = new Native((records) => {
        if (++state.calls > 100) { state.storm = true; observer.disconnect(); return; }
        callback(records);
      }); observers.push(observer); return observer;
    }
  };
  const nativeKey = vi.fn(); doc.addEventListener('keydown', nativeKey, true);
  const storage = vi.spyOn(view.Storage.prototype, 'setItem');
  view.fetch = vi.fn();
  sources.forEach((source) => view.eval(source));
  const query = (selector) => doc.querySelector(selector);
  const settled = async () => { await tick(); await tick(); const count = state.calls; await tick();
    expect(state.calls).toBe(count); expect(state.storm).toBe(false); };
  const key = (key, extra = {}) => {
    const event = new view.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
    doc.activeElement.dispatchEvent(event); return event;
  };
  return { view, doc, query, media, state, navigate, nativeKey, labels, storage, settled, key,
    trigger: () => query('.okw-toc-trigger'), panel: () => query('.okw-toc-panel'),
    rows: () => [...doc.querySelectorAll('.okw-toc-item')],
    open() { this.trigger().click(); },
    update(next) { items = next; listeners.forEach((fn) => fn()); },
    route(next) { session = next; listeners.forEach((fn) => fn()); },
    locale(next) { language = next; locales.forEach((fn) => fn()); },
    resize(next) { media.matches = next; media.addEventListener.mock.calls[0][1](); },
  };
}
afterEach(() => {
  observers.splice(0).forEach((observer) => observer.disconnect()); frames.splice(0).forEach((frame) => frame.remove());
  vi.restoreAllMocks();
});

describe('mobile conversation outline', () => {
  it('opens a themed dialog without changing the draft, closes and restores focus', async () => {
    const ui = setup();
    expect(ui.trigger().getAttribute('aria-label')).toBe('Message outline');
    expect(ui.query('.topbar').children[1]).toBe(ui.trigger());
    ui.open();
    expect(ui.rows()).toHaveLength(2);
    expect(ui.query('#app').inert).toBe(true);
    expect(ui.trigger().getAttribute('aria-expanded')).toBe('true');
    expect(ui.panel().contains(ui.doc.activeElement)).toBe(true);
    ui.query('.okw-toc-close').click();
    expect(ui.query('.okw-toc-backdrop').hidden).toBe(true);
    expect(ui.query('#app').inert).toBeUndefined();
    expect(ui.doc.activeElement).toBe(ui.trigger());
    expect(ui.query('textarea').value).toBe('Unsent fictional draft');
    expect(ui.storage).not.toHaveBeenCalled(); expect(ui.view.fetch).not.toHaveBeenCalled(); await ui.settled();
  });
  it('selects duplicate titles by precise ID after removing inert, never by text', async () => {
    const ui = setup();
    ui.navigate.mockImplementation(({ id, root }) => {
      expect(ui.query('#app').inert).toBeUndefined();
      expect(root).toBe(ui.query('.chat-scroll'));
      expect(id).toBe('b:input');
    });
    ui.open(); ui.rows()[1].click(); await ui.settled();
    expect(ui.navigate).toHaveBeenCalledOnce();
    expect(ui.navigate.mock.calls[0][0]).toMatchObject({ id: 'b:input', items: [
      { id: 'a:input', label: 'Duplicate title' }, { id: 'b:input', label: 'Duplicate title' },
    ] });
    expect(ui.query('.okw-toc-backdrop').hidden).toBe(true);
  });
  it('loads older messages only on explicit click through the official button', async () => {
    const ui = setup(); const older = vi.fn();
    ui.query('.top-sentinel-btn').addEventListener('click', older);
    ui.open(); expect(older).not.toHaveBeenCalled();
    ui.query('.okw-toc-earlier').click(); expect(older).toHaveBeenCalledOnce();
    expect(ui.query('.okw-toc-backdrop').hidden).toBe(true); await ui.settled();
  });
  it('keeps local keyboard focus and Escape without running native shortcuts', async () => {
    const ui = setup(); ui.open();
    ui.query('.okw-toc-earlier').focus();
    expect(ui.key('Tab').defaultPrevented).toBe(true);
    expect(ui.doc.activeElement).toBe(ui.query('.okw-toc-close'));
    expect(ui.key('Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(ui.doc.activeElement).toBe(ui.query('.okw-toc-earlier'));
    expect(ui.key('Escape').defaultPrevented).toBe(true);
    expect(ui.nativeKey).not.toHaveBeenCalled();
    ui.key('Escape'); expect(ui.nativeKey).toHaveBeenCalledOnce(); await ui.settled();
  });
  it('retranslates without replacing rows, changing identity or making requests', async () => {
    const ui = setup(); ui.open(); const rows = ui.rows();
    ui.locale('zh');
    expect(ui.trigger().getAttribute('aria-label')).toBe('消息目录');
    expect(ui.query('.okw-toc-close').textContent).toBe('关闭');
    expect(ui.rows()).toEqual(rows); expect(rows[0].textContent).toContain('Duplicate title');
    expect(ui.view.fetch).not.toHaveBeenCalled(); await ui.settled();
  });
});

describe('mobile conversation outline lifecycle', () => {
  it('closes on session switch, aborts stale navigation and preserves existing inert state', async () => {
    const ui = setup(); ui.query('#app').inert = false; ui.open();
    ui.route('B'); ui.update([]); await ui.settled();
    expect(ui.query('.okw-toc-backdrop').hidden).toBe(true);
    expect(ui.query('#app').inert).toBe(false); expect(ui.trigger()).toBeNull();
    ui.update([{ id: 'b2:input', label: 'New session' }]); await ui.settled(); ui.open();
    let reject;
    ui.navigate.mockImplementation(() => new Promise((done, fail) => { reject = fail; }));
    ui.rows()[0].click(); const signal = ui.navigate.mock.calls[0][0].signal;
    ui.route('C'); await ui.settled(); expect(signal.aborted).toBe(true);
    reject(Error('private detail')); await ui.settled(); expect(ui.query('.okw-toc-backdrop').hidden).toBe(true);
  });
  it('does not mount for desktop, empty sessions or open over an existing modal', async () => {
    const desktop = setup({ mobile: false }); expect(desktop.trigger()).toBeNull();
    const empty = setup({ empty: true }); expect(empty.trigger()).toBeNull();
    const ui = setup(); ui.query('#app').inert = true; ui.open();
    expect(ui.query('.okw-toc-backdrop').hidden).toBe(true);
    ui.query('#app').inert = false; ui.open(); ui.resize(false); await ui.settled();
    expect(ui.query('.okw-toc-backdrop').hidden).toBe(true); expect(ui.trigger()).toBeNull();
  });
  it('yields to another modal and removes all stale state when the current directory empties', async () => {
    const ui = setup(); ui.open();
    const modal = ui.doc.createElement('section'); modal.setAttribute('aria-modal', 'true');
    modal.getClientRects = () => [{}]; ui.doc.body.append(modal); await ui.settled();
    expect(ui.query('.okw-toc-backdrop').hidden).toBe(true);
    expect(ui.query('#app').inert).toBeUndefined();
    modal.remove(); await ui.settled(); ui.open();
    let reject;
    ui.navigate.mockImplementation(() => new Promise((done, fail) => { reject = fail; }));
    ui.rows()[0].click(); const signal = ui.navigate.mock.calls[0][0].signal;
    ui.update([]); await ui.settled();
    expect(signal.aborted).toBe(true); expect(ui.trigger()).toBeNull();
    expect(ui.query('.topbar').classList.contains('okw-toc-header')).toBe(false);
    reject(Error('removed')); await ui.settled();
    expect(ui.query('.okw-toc-backdrop').hidden).toBe(true);
  });
  it('cancels pending navigation when another dialog appears without taking its focus', async () => {
    const ui = setup(); ui.open();
    let reject;
    ui.navigate.mockImplementation(() => new Promise((done, fail) => { reject = fail; }));
    ui.rows()[0].click(); const signal = ui.navigate.mock.calls[0][0].signal;
    const modal = ui.doc.createElement('section'); modal.setAttribute('aria-modal', 'true');
    modal.tabIndex = -1; modal.getClientRects = () => [{}]; ui.doc.body.append(modal); modal.focus();
    await ui.settled();
    expect(signal.aborted).toBe(true); expect(ui.doc.activeElement).toBe(modal);
    reject(Error('cancelled')); await ui.settled(); expect(ui.query('.okw-toc-backdrop').hidden).toBe(true);
  });
  it('leaves the outline closed when the user interrupts positioning to scroll or type', async () => {
    const ui = setup(); ui.open();
    ui.navigate.mockRejectedValue(Object.assign(Error('aborted'), { code: 'aborted' }));
    ui.rows()[0].click(); await ui.settled();
    expect(ui.query('.okw-toc-backdrop').hidden).toBe(true);
    expect(ui.query('#app').inert).toBeUndefined();
  });
  it('handles backdrop closure and exact failure visibly without exposing raw errors', async () => {
    const ui = setup(); ui.open(); ui.query('.okw-toc-backdrop').click();
    expect(ui.query('.okw-toc-backdrop').hidden).toBe(true);
    ui.navigate.mockRejectedValue(Error('private error detail'));
    ui.open(); ui.rows()[0].click(); await ui.settled();
    expect(ui.query('.okw-toc-backdrop').hidden).toBe(false);
    expect(ui.query('.okw-toc-status').textContent).toContain('cannot be located');
    expect(ui.query('.okw-toc-status').textContent).not.toContain('private');
  });
  it('converges after its own writes and never scans assistant text during streaming', async () => {
    const ui = setup(); ui.open(); await ui.settled();
    const global = vi.spyOn(ui.doc, 'querySelector');
    const chat = vi.spyOn(ui.query('.chat-scroll'), 'querySelectorAll');
    global.mockClear();
    for (let index = 0; index < 6; index += 1) {
      ui.query('.a-msg').textContent = `Assistant delta ${index}`; global.mockClear(); await tick();
      expect(global).not.toHaveBeenCalled(); expect(chat).not.toHaveBeenCalled();
    }
    await ui.settled();
  });
});
