/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve('packages/launcher/src/mobile/themes.js'), 'utf8');
const STORAGE_KEY = 'open-kimi-web.atmospheric-theme';
const frames = [];

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

function install({ mobile = false, storedTheme, body = userMenuHtml } = {}) {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const view = frame.contentWindow;
  view.document.body.innerHTML = body;
  view.localStorage.clear();
  if (storedTheme !== undefined) view.localStorage.setItem(STORAGE_KEY, storedTheme);
  const media = {
    matches: mobile,
    addEventListener: vi.fn(),
  };
  view.MutationObserver = class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe() {}
  };
  view.matchMedia = vi.fn(() => media);
  view.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  view.eval(`(() => { ${source}\n})()`);
  return { media, view };
}

afterEach(() => {
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
    expect(view.localStorage.getItem(STORAGE_KEY)).toBeNull();
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
    expect(view.document.querySelector('.sheet-body > [data-okw-theme-picker]')).not.toBeNull();
    expect(view.document.querySelector('.okw-theme-current').textContent).toBe('夜幕 · Nocturne');
  });
});
