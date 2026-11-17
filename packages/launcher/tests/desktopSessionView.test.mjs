/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buttonSelector, buttons, cleanup, css, desktopMarkup, drain, headBlockMarkup, install, labelMarkup, press,
  pressedModes, row, rowSelector, setLocale, source, storageKey, tick, trigger,
} from './testkit/desktopSessionView.mjs';

afterEach(() => cleanup());

const clickButton = (doc, mode) => buttons(doc).find((button) => button.dataset.okwView === mode).click();

describe('desktop view switch rows', () => {
  it('adds one two-segment row below the list title with native labels and no private markers', async () => {
    const app = install();
    await app.settle();
    const head = app.doc.querySelector('.sessions-head');
    const label = app.doc.querySelector('.side-section-label');
    expect(app.doc.querySelectorAll(rowSelector)).toHaveLength(1);
    expect(row(app.doc).parentElement).toBe(head);
    expect(row(app.doc).previousElementSibling).toBe(label);
    expect(app.doc.querySelectorAll(buttonSelector)).toHaveLength(2);
    expect(buttons(app.doc).map((button) => button.tagName)).toEqual(['BUTTON', 'BUTTON']);
    expect(buttons(app.doc).every((button) => button.type === 'button' && button.tabIndex === 0)).toBe(true);
    expect(buttons(app.doc).map((button) => button.textContent)).toEqual(['平铺', '按项目']);
    expect(row(app.doc).getAttribute('role')).toBe('group');
    expect(row(app.doc).getAttribute('aria-label')).toBe('列表视图');
    expect(pressedModes(app.doc)).toEqual(['grouped']);
    expect(app.view.localStorage.getItem(storageKey)).toBeNull();
    expect([...row(app.doc).attributes].some((item) => item.name.startsWith('data-v-'))).toBe(false);
    expect(app.view.fetch).not.toHaveBeenCalled();
    app.view.eval(source);
    await app.settle();
    expect(app.doc.querySelectorAll(rowSelector)).toHaveLength(1);
    expect(app.view.__okwLocale.observe).toHaveBeenCalledOnce();
  });

  it('delegates flat to the native menu click and keeps the native list node untouched', async () => {
    const app = install();
    await app.settle();
    const list = app.doc.querySelector('.sessions');
    const actions = app.doc.querySelector('.side-section-actions');
    const nativeTrigger = trigger(app.doc);
    clickButton(app.doc, 'flat');
    await app.settle();
    expect(app.native.state.openCount).toBe(1);
    expect(app.native.state.clicks).toEqual(['flat']);
    expect(app.view.localStorage.getItem(storageKey)).toBe('flat');
    expect(pressedModes(app.doc)).toEqual(['flat']);
    expect(app.doc.querySelector('.view-menu')).toBeNull();
    expect(app.doc.querySelector('.sessions')).toBe(list);
    expect(app.doc.querySelector('.side-section-actions')).toBe(actions);
    expect(trigger(app.doc)).toBe(nativeTrigger);
    expect(list.querySelector(rowSelector)).toBeNull();
    expect(app.view.fetch).not.toHaveBeenCalled();
    clickButton(app.doc, 'flat');
    await app.settle();
    expect(app.native.state.openCount).toBe(1);
    expect(buttons(app.doc).map((button) => button.getAttribute('aria-pressed')))
      .toEqual(['true', 'false']);
  });

  it('supports a native menu teleported outside the sidebar panel', async () => {
    const app = install({ native: { teleport: true } });
    await app.settle();
    clickButton(app.doc, 'flat');
    await app.settle();
    expect(app.native.state.openCount).toBe(1);
    expect(pressedModes(app.doc)).toEqual(['flat']);
    expect(app.view.localStorage.getItem(storageKey)).toBe('flat');
  });

});

describe('desktop view switch state sync', () => {
  it('follows native menu use, cross-tab storage writes and locale changes', async () => {
    const app = install();
    await app.settle();
    app.native.renderMenu().querySelector('[data-okw-fixture-mode="flat"]').click();
    await app.settle();
    expect(pressedModes(app.doc)).toEqual(['flat']);
    expect(app.doc.querySelector('.side-section-title').textContent).toBe('会话');
    app.view.localStorage.setItem(storageKey, 'grouped');
    app.view.dispatchEvent(new app.view.StorageEvent('storage', { key: storageKey }));
    await app.settle();
    expect(pressedModes(app.doc)).toEqual(['grouped']);
    const nodes = [row(app.doc), ...buttons(app.doc)];
    const writes = nodes.map((node) => vi.spyOn(node, 'setAttribute'));
    setLocale(app, 'en');
    await tick();
    expect(buttons(app.doc).map((button) => button.textContent)).toEqual(['Flat', 'By project']);
    expect(row(app.doc).getAttribute('aria-label')).toBe('List view');
    writes.forEach((write) => write.mockClear());
    setLocale(app, 'en');
    await tick();
    expect(writes.every((write) => write.mock.calls.length === 0)).toBe(true);
    setLocale(app, 'zh');
    await tick();
    expect(buttons(app.doc).map((button) => button.textContent)).toEqual(['平铺', '按项目']);
    expect(row(app.doc).getAttribute('aria-label')).toBe('列表视图');
    expect(writes.reduce((total, write) => total + write.mock.calls.length, 0)).toBe(1);
    await app.settle();
  });
});

describe('desktop view switch native entry boundaries', () => {
  it('stays hidden without the native entry and returns when the entry comes back', async () => {
    const app = install({ markup: desktopMarkup({ trigger: false }) });
    await app.settle();
    expect(row(app.doc)).toBeNull();
    const actions = app.doc.querySelector('.side-section-actions');
    actions.insertAdjacentHTML('beforeend', '<button type="button" ' +
      'class="ui-icon-button side-section-toggle side-section-view" aria-label="列表管理"></button>');
    app.native.bindTriggers();
    await app.settle();
    expect(buttons(app.doc)).toHaveLength(2);
    clickButton(app.doc, 'flat');
    await app.settle();
    expect(app.native.state.openCount).toBe(1);
    trigger(app.doc).remove();
    await app.settle();
    expect(row(app.doc)).toBeNull();
    expect(app.native.state.openCount).toBe(1);
  });

  it('stays absent on mobile layouts and on the workspace tab without the native entry', async () => {
    const mobile = install({ markup: '<div id="app"><div class="app-shell"><div class="app">' +
      '<main class="chat"><div class="transcript"></div></main><div class="switcher">Sessions</div>' +
      '</div></div></div>' });
    await mobile.settle();
    expect(mobile.doc.querySelector(rowSelector)).toBeNull();
    expect(mobile.fixture.targets.filter((entry) => entry.options.subtree)).toHaveLength(0);
    const tab = install({ markup: desktopMarkup({ trigger: false }) });
    await tab.settle();
    expect(tab.doc.querySelector(rowSelector)).toBeNull();
    tab.doc.querySelector('.sessions-head').insertAdjacentHTML('afterend', labelMarkup(true, 'zh'));
    await tab.settle();
    expect(tab.doc.querySelectorAll(rowSelector)).toHaveLength(0);
    const secondHead = headBlockMarkup({ trigger: true });
    tab.doc.querySelector('.sessions-head').outerHTML = secondHead;
    tab.native.bindTriggers();
    await tab.settle();
    expect(tab.doc.querySelectorAll(rowSelector)).toHaveLength(1);
  });

  it('drops the row when the sidebar head is replaced and reuses one row for the new head', async () => {
    const app = install();
    await app.settle();
    const detached = app.doc.querySelector('.sessions-head');
    detached.outerHTML = headBlockMarkup({ trigger: true });
    app.native.bindTriggers();
    await app.settle();
    expect(app.doc.querySelectorAll(rowSelector)).toHaveLength(1);
    expect(app.doc.querySelectorAll(rowSelector)[0].closest('.sessions-head')).not.toBe(detached);
    expect(app.native.state.openCount).toBe(0);
    app.doc.querySelector('.sessions-head').outerHTML = headBlockMarkup({ trigger: false });
    await app.settle();
    expect(app.doc.querySelector(rowSelector)).toBeNull();
  });
});

describe('desktop view switch failure states', () => {
  it('reports an unavailable native entry instead of a silent switch', async () => {
    const app = install({ native: { failOpen: true } });
    await app.settle();
    clickButton(app.doc, 'flat');
    await drain();
    expect(row(app.doc).dataset.okwViewReason).toBe('native-entry-changed');
    expect(row(app.doc).getAttribute('title')).toContain('列表管理');
    expect(buttons(app.doc).every((button) => button.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(pressedModes(app.doc)).toEqual(['grouped']);
    expect(app.view.localStorage.getItem(storageKey)).toBeNull();
    expect(app.view.fetch).not.toHaveBeenCalled();
  });

  it('marks the row failed when the native menu has no matching entry and clears it after Escape', async () => {
    let menu;
    const app = install({ native: { items: (ctx) => {
      menu = ctx.menu;
      ctx.defaults.forEach((node) => node.remove());
      const other = ctx.doc.createElement('button');
      other.className = 'ui-menu-item';
      other.setAttribute('role', 'menuitem');
      other.textContent = 'Fictional unrelated action';
      ctx.menu.append(other);
    } } });
    await app.settle();
    clickButton(app.doc, 'flat');
    await drain();
    expect(menu).toBeDefined();
    expect(app.native.state.closeCount).toBe(1);
    expect(row(app.doc).dataset.okwViewReason).toBe('native-entry-changed');
    expect(pressedModes(app.doc)).toEqual(['grouped']);
    clickButton(app.doc, 'flat');
    await app.settle();
    expect(app.native.state.openCount).toBe(2);
    expect(menu.querySelector('[data-okw-fixture-mode]')).toBeNull();
  });

  it('keeps the honest pressed state when the native handler does not change the mode', async () => {
    const app = install({ native: { inert: true } });
    await app.settle();
    clickButton(app.doc, 'flat');
    await drain();
    expect(row(app.doc).dataset.okwViewReason).toBe('view-not-updated');
    expect(app.native.state.clicks).toEqual(['flat']);
    expect(pressedModes(app.doc)).toEqual(['grouped']);
    expect(app.doc.querySelector('.view-menu')).toBeNull();
    app.native.state.inert = false;
    clickButton(app.doc, 'flat');
    await app.settle();
    expect(row(app.doc).hasAttribute('data-okw-view-reason')).toBe(false);
    expect(buttons(app.doc).every((button) => !button.hasAttribute('aria-disabled'))).toBe(true);
    expect(pressedModes(app.doc)).toEqual(['flat']);
  });

  it('drops the row and stops delegating when the whole panel is replaced', async () => {
    const app = install();
    await app.settle();
    const detached = app.doc.querySelector('.sessions-head');
    detached.outerHTML = desktopMarkup({}).replace(/^<div id="app">[\s\S]*?(<div class="sessions-head">)/, '$1') +
      '</div>';
    await app.settle();
    expect(app.doc.querySelectorAll(rowSelector).length).toBeLessThanOrEqual(1);
    detached.querySelector('.side-section-actions').insertAdjacentHTML('beforeend', '<button type="button" ' +
      'class="ui-icon-button side-section-toggle side-section-view"></button>');
    await app.settle();
    expect(app.doc.querySelectorAll(rowSelector)).toHaveLength(1);
  });
});

describe('desktop view switch keyboard and observation scope', () => {
  it('protects Enter and Space activation from the app capture without cancelling defaults', async () => {
    const capture = vi.fn((event) => {
      if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); }
    });
    const app = install({ mount: false });
    app.doc.addEventListener('keydown', capture, true);
    app.doc.addEventListener('keyup', capture, true);
    app.mount();
    await app.settle();
    const flat = buttons(app.doc)[0];
    flat.focus();
    expect(app.doc.activeElement).toBe(flat);
    for (const key of ['Enter', ' ']) {
      expect(press(app, flat, key).defaultPrevented).toBe(false);
      expect(capture).not.toHaveBeenCalled();
      flat.click();
      await app.settle();
    }
    expect(app.native.state.openCount).toBe(1);
    expect(pressedModes(app.doc)).toEqual(['flat']);
    press(app, flat, 'Enter', { isComposing: true });
    expect(capture).toHaveBeenCalled();
    app.doc.querySelector('.se').dispatchEvent(new app.view.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it('observes only the sidebar panel and converges while the chat transcript streams', async () => {
    const app = install();
    await app.settle();
    const head = app.doc.querySelector('.sessions-head');
    const transcript = app.doc.querySelector('.transcript');
    expect(app.fixture.targets.filter((entry) => entry.options.subtree).every((entry) => entry.target === head))
      .toBe(true);
    const queries = vi.spyOn(app.view.Element.prototype, 'querySelectorAll');
    const callbacks = app.fixture.count;
    for (let step = 0; step < 6; step += 1) {
      transcript.insertAdjacentHTML('beforeend', '<section><p>Fictional streamed chunk</p></section>');
      await tick();
    }
    expect(app.fixture.count).toBe(callbacks);
    expect(queries).not.toHaveBeenCalled();
    expect(transcript.querySelector(rowSelector)).toBeNull();
    head.querySelector('.side-section-title').textContent = 'Another fictional title';
    await app.settle();
    expect(app.doc.querySelectorAll(rowSelector)).toHaveLength(1);
    expect(pressedModes(app.doc)).toEqual(['grouped']);
  });

  it('uses official tokens for the row style and keeps the failure hint readable', () => {
    expect(css).toContain('var(--faint)');
    expect(css).toContain('var(--dim)');
    expect(css).toContain('var(--color-well)');
    expect(css).toContain('var(--p-focus-ring)');
    expect(css).toContain('var(--text-xs)');
    expect(css).toContain('[data-okw-view-reason]');
    expect(css).toContain(':focus-visible');
    expect(css).not.toMatch(/data-v-|#[\da-f]{3,8}\b|!important/iu);
    expect(source).not.toMatch(/localStorage\.setItem|\/api\/|data-v-|\/sessions\b/u);
  });
});
