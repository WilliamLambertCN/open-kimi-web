import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, vi } from 'vitest';

const dir = 'packages/launcher/src/mobile';
export const source = readFileSync(resolve(dir, 'desktopSessionView.js'), 'utf8');
export const css = readFileSync(resolve(dir, 'desktopSessionView.css'), 'utf8');
export const storageKey = 'kimi-web.sidebar-view-mode';
export const rowSelector = '.okw-desktop-view-switch';
export const buttonSelector = '.okw-desktop-view-btn';
export const triggerSelector = '.side-section-view';

const frames = [];
const observers = [];

export function rowMarkup(title = 'Fictional session') {
  return '<div class="se"><div class="row"><span class="t">' + title + '</span></div></div>';
}
export function groupMarkup(name = 'fictional-project') {
  return '<div class="ws-drop-target" data-ws-id="wm_fixture"><div class="group">' +
    `<span class="gh">${name}</span>${rowMarkup()}</div></div>`;
}
export function labelMarkup(withTrigger = true, locale = 'zh') {
  const collapse = locale === 'zh' ? '折叠全部项目' : 'Collapse all projects';
  const switcher = locale === 'zh' ? '列表管理' : 'List options';
  const action = '<button type="button" class="ui-icon-button side-section-toggle" ' +
    `aria-label="${collapse}"></button>`;
  const view = withTrigger ? '<span class="ui-tip"><button type="button" ' +
    `class="ui-icon-button side-section-toggle side-section-view" aria-label="${switcher}"></button></span>` : '';
  return '<div class="side-section-label"><span class="side-section-title">项目</span>' +
    `<div class="side-section-actions">${action}${view}</div></div>`;
}
export function headBlockMarkup({ trigger = true, locale = 'zh' } = {}) {
  return `<div class="sessions-head">${labelMarkup(trigger, locale)}</div>`;
}
export function desktopMarkup({ trigger = true, locale = 'zh', list = groupMarkup() } = {}) {
  return '<div id="app"><div class="app-shell"><div class="app"><aside class="side"><div class="col">' +
    `<div class="session-list-panel">${headBlockMarkup({ trigger, locale })}` +
    `<div class="sessions">${list}</div></div></div></aside>` +
    '<main class="chat"><div class="transcript"></div></main></div></div></div>';
}

const menuText = {
  zh: { view: '视图', flat: '平铺列表', grouped: '按项目分组', sort: '排序', manual: '手动排序', recent: '按最近活动' },
  en: { view: 'View', flat: 'Flat list', grouped: 'Group by project', sort: 'Sort order',
    manual: 'Manual', recent: 'Recent activity' },
};

function menuItem(doc, label, active, extra = '') {
  const item = doc.createElement('button');
  item.type = 'button';
  item.className = 'ui-menu-item ui-menu-item--md';
  item.setAttribute('role', 'menuitem');
  item.textContent = label;
  const check = doc.createElement('span');
  check.className = 'view-menu-check';
  if (active) check.append(doc.createElementNS('http://www.w3.org/2000/svg', 'svg'));
  item.append(check);
  if (extra) item.append(doc.createTextNode(extra));
  return item;
}

function createNative(view, doc, options) {
  const state = { openCount: 0, closeCount: 0, clicks: [], mode: options.mode ?? 'grouped',
    locale: options.locale ?? 'zh', failOpen: Boolean(options.failOpen), teleport: Boolean(options.teleport),
    inert: Boolean(options.inert), items: options.items ?? null };
  const menuNode = () => doc.querySelector('.view-menu');
  const close = () => {
    if (!menuNode()) return;
    state.closeCount += 1;
    menuNode().remove();
  };
  const titleFor = (mode) => (mode === 'flat' ? '会话' : '项目');
  const listFor = (mode) => {
    const list = doc.querySelector('.sessions');
    if (!list) return;
    list.innerHTML = mode === 'flat' ? rowMarkup('Fictional flat row') : groupMarkup();
  };
  const applyMode = (mode) => {
    state.mode = mode;
    doc.defaultView.localStorage.setItem(storageKey, mode);
    const title = doc.querySelector('.side-section-title');
    if (title) title.textContent = titleFor(mode);
    listFor(mode);
    close();
  };
  const renderMenu = () => {
    const menu = doc.createElement('div');
    menu.className = 'ui-menu view-menu';
    menu.setAttribute('role', 'menu');
    menu.style.position = 'fixed';
    const copy = menuText[state.locale];
    const label = (text) => {
      const node = doc.createElement('div');
      node.className = 'view-menu-label';
      node.textContent = text;
      return node;
    };
    menu.append(label(copy.view));
    const items = [];
    for (const [mode, text] of [['flat', copy.flat], ['grouped', copy.grouped]]) {
      const item = menuItem(doc, text, state.mode === mode);
      item.dataset.okwFixtureMode = mode;
      item.addEventListener('click', () => {
        state.clicks.push(mode);
        if (state.inert) { close(); return; }
        applyMode(mode);
      });
      menu.append(item);
      items.push(item);
    }
    menu.append(label(copy.sort));
    menu.append(menuItem(doc, copy.manual, false), menuItem(doc, copy.recent, true));
    if (state.items) state.items({ menu, doc, label, item: menuItem, defaults: [...menu.children], items });
    (state.teleport ? doc.body : doc.querySelector('.session-list-panel') ?? doc.body).append(menu);
    state.openCount += 1;
    return menu;
  };
  view.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); }, true);
  view.addEventListener('mousedown', (event) => { if (!event.target?.closest?.('.view-menu')) close(); });
  const bindTriggers = () => {
    for (const trigger of doc.querySelectorAll(triggerSelector)) {
      if (trigger.dataset.okwFixtureBound) continue;
      trigger.dataset.okwFixtureBound = '1';
      trigger.addEventListener('click', () => {
        if (state.failOpen) return;
        if (menuNode()) { close(); return; }
        renderMenu();
      });
    }
  };
  bindTriggers();
  return { state, close, applyMode, renderMenu, bindTriggers, menuNode };
}

export const tick = () => new Promise((done) => { setTimeout(done, 0); });
export async function drain(times = 18) {
  for (let step = 0; step < times; step += 1) await tick();
}

export async function settle(app) {
  await drain();
  const callbacks = app.fixture.count;
  await tick();
  expect(app.fixture.count).toBe(callbacks);
  expect(app.fixture.storm).toBe(false);
}

export function install({ locale = 'zh', mode = 'grouped', markup = desktopMarkup({ locale }),
  native = {}, mount = true } = {}) {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const view = frame.contentWindow;
  const doc = view.document;
  doc.body.innerHTML = markup;
  const store = new Map(mode === 'grouped' ? [] : [[storageKey, mode]]);
  Object.defineProperty(view, 'localStorage', {
    configurable: true,
    value: {
      getItem: (name) => (store.has(name) ? store.get(name) : null),
      setItem: (name, value) => { store.set(name, String(value)); },
      removeItem: (name) => { store.delete(name); },
    },
  });
  const fixture = { count: 0, storm: false, targets: [], locale, store };
  const Native = view.MutationObserver;
  view.MutationObserver = class {
    constructor(callback) {
      const observer = new Native((records) => {
        if (++fixture.count > 120) { fixture.storm = true; observer.disconnect(); return; }
        callback(records);
      });
      const observe = observer.observe.bind(observer);
      observer.observe = (target, options) => {
        fixture.targets.push({ target, options });
        observe(target, options);
      };
      observers.push(observer);
      return observer;
    }
  };
  const listeners = [];
  view.__okwLocale = {
    current: () => fixture.locale,
    text: (zh, en) => (fixture.locale === 'zh' ? zh : en),
    observe: vi.fn((listener) => listeners.push(listener)),
  };
  const app = { view, doc, fixture, native: createNative(view, doc, { ...native, locale }), listeners };
  view.fetch = vi.fn();
  app.settle = () => settle(app);
  app.mount = () => { view.eval(source); return app; };
  if (mount) app.mount();
  return app;
}

export const trigger = (doc) => doc.querySelector(triggerSelector);
export function press(app, target, key, init = {}) {
  const event = new app.view.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

export function setLocale(app, locale) {
  app.fixture.locale = locale;
  app.listeners.forEach((listener) => listener());
}

export const buttons = (doc) => [...doc.querySelectorAll(buttonSelector)];
export const row = (doc) => doc.querySelector(rowSelector);
export const pressedModes = (doc) => buttons(doc)
  .filter((button) => button.getAttribute('aria-pressed') === 'true')
  .map((button) => button.dataset.okwView);

export function cleanup() {
  observers.splice(0).forEach((observer) => observer.disconnect());
  for (const frame of frames.splice(0)) {
    frame.contentWindow?.localStorage?.removeItem(storageKey);
    frame.remove();
  }
  vi.restoreAllMocks();
}
