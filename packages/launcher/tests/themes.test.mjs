/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve('packages/launcher/src/mobile/themes.js'), 'utf8');
const themeCss = readFileSync(resolve('packages/launcher/src/mobile/themes.css'), 'utf8');
const STORAGE_KEY = 'open-kimi-web.atmospheric-theme';
const frames = [];
const observers = [];

// Stable semantic portion of the official 0.41.0 account-menu DOM.
const userMenuHtml = `
  <div class="user-menu" role="menu">
    <button class="ui-menu-item" type="button" role="menuitem">
      <svg aria-hidden="true"></svg>
      <span class="user-menu-item-label">会员升级</span>
      <svg aria-hidden="true"></svg>
    </button>
    <div class="ui-menu-sep" role="separator"></div>
    <button class="ui-menu-item" type="button" role="menuitem" aria-haspopup="true">
      <svg aria-hidden="true"></svg>
      <span class="user-menu-item-label">外观</span>
      <span class="user-menu-row-value">月之暗面</span>
      <svg aria-hidden="true"></svg>
    </button>
  </div>
`;

function install({ mobile = false, storedTheme, body = userMenuHtml, observeMutations = false } = {}) {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const view = frame.contentWindow;
  view.document.body.innerHTML = body;
  const style = view.document.createElement('style');
  style.textContent = themeCss;
  view.document.head.append(style);
  view.localStorage.clear();
  if (storedTheme !== undefined) view.localStorage.setItem(STORAGE_KEY, storedTheme);
  const media = {
    matches: mobile,
    addEventListener: vi.fn(),
  };
  const observerState = { callbacks: 0, exceeded: false };
  const NativeMutationObserver = view.MutationObserver;
  view.MutationObserver = class MutationObserver {
    constructor(callback) {
      this.observer = observeMutations && new NativeMutationObserver((records) => {
        observerState.callbacks += 1;
        if (observerState.callbacks > 100) {
          observerState.exceeded = true;
          this.observer.disconnect();
          return;
        }
        callback(records);
      });
      if (this.observer) observers.push(this.observer);
    }
    observe(target, options) { if (this.observer) this.observer.observe(target, options); }
  };
  view.matchMedia = vi.fn(() => media);
  view.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  view.eval(`(() => { ${source}\n})()`);
  return { media, observerState, view };
}

const settleMutations = async () => {
  for (let pass = 0; pass < 4; pass += 1) await Promise.resolve();
};

afterEach(() => {
  observers.splice(0).forEach((observer) => observer.disconnect());
  frames.splice(0).forEach((frame) => frame.remove());
});

describe('atmospheric theme entry', () => {
  it('defaults to Nocturne and places the desktop entry above Appearance', () => {
    const { view } = install();
    const items = Array.from(view.document.querySelectorAll('.user-menu > button.ui-menu-item'));
    const labels = items.map((item) => item.querySelector('.user-menu-item-label')?.textContent);
    const trigger = view.document.querySelector('[data-okw-theme-menu-trigger]');

    expect(view.document.documentElement.dataset.okwTheme).toBe('nocturne');
    expect(labels).toEqual(['会员升级', '氛围主题', '外观']);
    expect(trigger.querySelector('.okw-theme-current').textContent).toBe('夜幕');
    expect(trigger.nextElementSibling.querySelector('.user-menu-item-label').textContent).toBe('外观');
    expect(view.document.querySelector('.okw-theme-menu-dialog').parentElement).toBe(view.document.body);
    expect(view.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it.each([
    ['right of the menu when space is available', 1000, 8, 268, 274],
    ['left of the menu when only that side fits', 1000, 700, 960, 414],
    ['clamped inside a narrow viewport', 400, 8, 268, 8],
  ])('opens the detached single-column picker %s', (_name, width, anchorLeft, anchorRight, expectedLeft) => {
    const { view } = install();
    Object.defineProperty(view, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(view, 'innerHeight', { configurable: true, value: 500 });
    const trigger = view.document.querySelector('[data-okw-theme-menu-trigger]');
    const dialog = view.document.querySelector('.okw-theme-menu-dialog');
    trigger.getBoundingClientRect = () => ({ bottom: 332, left: anchorLeft, right: anchorRight, top: 300 });
    dialog.getBoundingClientRect = () => ({ height: 380.4, width: 280 });

    trigger.click();

    expect(dialog.style.left).toBe(`${expectedLeft}px`);
    expect(dialog.style.top).toBe('111px');
    expect(Number.parseInt(dialog.style.left, 10)).toBeGreaterThanOrEqual(8);
    expect(Number.parseInt(dialog.style.left, 10) + 280).toBeLessThanOrEqual(width - 8);
    expect(Number.parseInt(dialog.style.top, 10) + 380.4).toBeLessThanOrEqual(500 - 8);
    expect(view.getComputedStyle(dialog.querySelector('.okw-theme-options')).gridTemplateColumns)
      .toBe('minmax(0, 1fr)');
    expect(view.getComputedStyle(dialog).overflowY).toBe('auto');
    expect(Array.from(dialog.querySelectorAll('.okw-theme-option-label')).map(({ textContent }) => textContent))
      .toEqual(['原始 · Original', '极光 · Aurora', '暮色 · Twilight', '余烬 · Ember', '矿物青绿 · Mineral', '夜幕 · Nocturne']);
  });
});

describe('atmospheric theme selection', () => {
  it('keeps exactly one selected option and one visible check mark', () => {
    const { view } = install();
    const trigger = view.document.querySelector('[data-okw-theme-menu-trigger]');
    const dialog = view.document.querySelector('.okw-theme-menu-dialog');
    const outsideMouseDown = vi.fn();
    view.document.addEventListener('mousedown', outsideMouseDown);
    trigger.click();

    const selectedThemes = () => Array.from(dialog.querySelectorAll('.okw-theme-option.selected'))
      .map((option) => option.dataset.theme);
    const pressedThemes = () => Array.from(dialog.querySelectorAll('.okw-theme-option[aria-pressed="true"]'))
      .map((option) => option.dataset.theme);
    const visibleChecks = () => Array.from(dialog.querySelectorAll('.okw-theme-check'))
      .filter((check) => view.getComputedStyle(check).visibility === 'visible');

    expect(selectedThemes()).toEqual(['nocturne']);
    expect(pressedThemes()).toEqual(['nocturne']);
    expect(visibleChecks()).toHaveLength(1);
    dialog.querySelector('[data-theme="ember"] .okw-theme-check')
      .dispatchEvent(new view.MouseEvent('mousedown', { bubbles: true }));
    expect(outsideMouseDown).not.toHaveBeenCalled();
    dialog.querySelector('.okw-theme-option[data-theme="ember"]').click();
    expect(selectedThemes()).toEqual(['ember']);
    expect(pressedThemes()).toEqual(['ember']);
    expect(visibleChecks()).toHaveLength(1);
  });

  it('preserves stored themes and persists an explicit Original selection', () => {
    const stored = install({ storedTheme: 'twilight' }).view;
    expect(stored.document.documentElement.dataset.okwTheme).toBe('twilight');
    expect(stored.document.querySelector('.okw-theme-current').textContent).toBe('暮色');
    expect(stored.localStorage.getItem(STORAGE_KEY)).toBe('twilight');

    const original = install({ storedTheme: 'original' }).view;
    const trigger = original.document.querySelector('[data-okw-theme-menu-trigger]');
    expect(original.document.documentElement.hasAttribute('data-okw-theme')).toBe(false);
    expect(trigger.querySelector('.okw-theme-current').textContent).toBe('原始');
    trigger.click();
    original.document.querySelector('.okw-theme-option[data-theme="nocturne"]').click();
    expect(original.localStorage.getItem(STORAGE_KEY)).toBe('nocturne');
    trigger.click();
    original.document.querySelector('.okw-theme-option[data-theme="original"]').click();
    expect(original.localStorage.getItem(STORAGE_KEY)).toBe('original');
    expect(original.document.documentElement.hasAttribute('data-okw-theme')).toBe(false);
  });

  it('keeps the existing settings picker on mobile without adding a menu entry', () => {
    const body = `${userMenuHtml}
      <div class="sheet-panel" aria-label="设置">
        <div class="sheet-body"><div class="card"></div></div>
      </div>`;
    const { view } = install({ mobile: true, body });

    expect(view.document.querySelector('[data-okw-theme-menu-trigger]')).toBeNull();
    const picker = view.document.querySelector('.sheet-body > [data-okw-theme-picker]');
    expect(picker).not.toBeNull();
    expect(view.getComputedStyle(picker.querySelector('.okw-theme-options')).gridTemplateColumns)
      .toBe('repeat(2, minmax(0, 1fr))');
    expect(view.document.querySelector('.okw-theme-current').textContent).toBe('夜幕 · Nocturne');
  });
});

describe('atmospheric theme mutation observer', () => {
  it('does not revisit old messages for repeated additions in the last message', async () => {
    const body = `<div class="side"><div class="ch-brand">Kimi</div></div>
      <div class="messages">${'<div class="a-msg"><span>Earlier</span></div>'.repeat(500)}</div>
      ${userMenuHtml}`;
    const { observerState, view } = install({ body, observeMutations: true });
    await settleMutations();
    const doc = view.document;
    const messages = doc.querySelector('.messages');
    const lastMessage = messages.lastElementChild;
    expect(doc.querySelectorAll('.a-msg > .okw-assistant-mark')).toHaveLength(500);
    expect(doc.querySelector('.side .ch-brand > .okw-brand-mark')).not.toBeNull();

    let globalMessageQueries = 0;
    let oldMessageChecks = 0;
    const queryAll = doc.querySelectorAll.bind(doc);
    const query = view.Element.prototype.querySelector;
    doc.querySelectorAll = (selector) => {
      if (selector === '.a-msg') globalMessageQueries += 1;
      return queryAll(selector);
    };
    view.Element.prototype.querySelector = function querySelector(selector) {
      if (selector === ':scope > .okw-assistant-mark' && this !== lastMessage &&
        this.classList.contains('a-msg')) oldMessageChecks += 1;
      return query.call(this, selector);
    };

    for (let batch = 0; batch < 20; batch += 1) {
      lastMessage.append(doc.createElement('span'));
      await settleMutations();
    }
    expect(oldMessageChecks).toBe(0);
    expect(globalMessageQueries).toBe(0);
    expect(observerState.exceeded).toBe(false);
    expect(observerState.callbacks).toBeLessThan(100);
    const settledCallbacks = observerState.callbacks;
    await settleMutations();
    expect(observerState.callbacks).toBe(settledCallbacks);
  });

  it('restores changed markers and adds controls in newly inserted subtrees', async () => {
    const body = `<div class="side"><div class="ch-brand">Kimi</div></div>
      <div class="messages"><div class="a-msg">Earlier</div></div>${userMenuHtml}`;
    const { observerState, view } = install({ body, observeMutations: true });
    await settleMutations();
    const doc = view.document;
    const messages = doc.querySelector('.messages');

    const wrapper = doc.createElement('div');
    wrapper.innerHTML = '<div class="a-msg"><span>New</span></div>';
    messages.append(wrapper);
    await settleMutations();
    expect(wrapper.querySelector('.a-msg > .okw-assistant-mark')).not.toBeNull();

    const moved = messages.firstElementChild;
    messages.append(moved);
    await settleMutations();
    expect(moved.querySelectorAll(':scope > .okw-assistant-mark')).toHaveLength(1);
    moved.querySelector('.okw-assistant-mark').remove();
    doc.querySelector('.side .ch-brand').innerHTML = 'New brand';
    await settleMutations();
    expect(moved.querySelector(':scope > .okw-assistant-mark')).not.toBeNull();
    expect(doc.querySelector('.side .ch-brand > .okw-brand-mark')).not.toBeNull();

    const newSide = doc.createElement('div');
    newSide.className = 'side';
    newSide.innerHTML = '<div class="ch-brand">Another</div>';
    doc.body.append(newSide);
    const newMenu = doc.createElement('div');
    newMenu.innerHTML = userMenuHtml;
    doc.body.append(newMenu);
    await settleMutations();
    expect(newSide.querySelector('.okw-brand-mark')).not.toBeNull();
    expect(newMenu.querySelector('[data-okw-theme-menu-trigger]')).not.toBeNull();
    expect(observerState.exceeded).toBe(false);
    expect(observerState.callbacks).toBeLessThan(100);
    const settledCallbacks = observerState.callbacks;
    await settleMutations();
    expect(observerState.callbacks).toBe(settledCallbacks);
  });
});

describe('atmospheric theme responsive controls', () => {
  it('adds settings controls on a new panel and retains media-change behavior', async () => {
    const { media, observerState, view } = install({
      body: userMenuHtml,
      mobile: true,
      observeMutations: true,
    });
    const panel = view.document.createElement('div');
    panel.className = 'sheet-panel';
    panel.setAttribute('aria-label', '设置');
    panel.innerHTML = '<div class="sheet-body"><div class="card"></div></div>';
    view.document.body.append(panel);
    await settleMutations();
    expect(panel.querySelectorAll('[data-okw-theme-picker]')).toHaveLength(1);

    media.matches = false;
    media.addEventListener.mock.calls[0][1]();
    await settleMutations();
    expect(panel.querySelector('[data-okw-theme-picker]')).toBeNull();
    expect(view.document.querySelector('[data-okw-theme-menu-trigger]')).not.toBeNull();

    media.matches = true;
    media.addEventListener.mock.calls[0][1]();
    await settleMutations();
    expect(panel.querySelectorAll('[data-okw-theme-picker]')).toHaveLength(1);
    expect(view.document.querySelector('[data-okw-theme-menu-trigger]')).toBeNull();
    expect(observerState.exceeded).toBe(false);
  });
});
