/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve('packages/launcher/src/mobile/desktopSessionMenu.js'), 'utf8');
const css = readFileSync(resolve('packages/launcher/src/mobile/desktopSessionMenu.css'), 'utf8');
const selector = '.okw-desktop-session-menu';
const frames = []; const observers = [];
const tick = () => new Promise((done) => setTimeout(done, 0));
function rowMarkup(kind = '') {
  const actions = kind === 'done' ? '<button class="reopen-btn">Reopen</button>' :
    '<button class="pin-btn">Pin</button><button class="complete-btn">Complete</button>';
  return `<div class="se ${kind}"><div class="row"><span class="lead">•</span>` +
    '<div class="left"><span class="t"><span class="t-inner">Same title</span></span></div>' +
    `<span class="act"><span class="ts">now</span><span class="ha">${actions}</span></span></div>` +
    (kind === 'flat' ? '<div class="sub">workspace</div>' : '') + '</div>';
}
function sidebarMarkup() {
  return '<aside class="side"><div class="sessions"><div class="pinned">' + rowMarkup('pinned') +
    '</div><div class="group"><button class="gh-more">Workspace options</button>' + rowMarkup() +
    '</div>' + rowMarkup('flat') + rowMarkup('done') + '</div></aside>';
}
const appMarkup = () => `<div id="app"><div class="app-shell"><div class="app">${sidebarMarkup()}` +
  '<main class="chat"><div class="transcript"></div></main></div></div></div>';
function install(body = '', beforeMount = () => {}) {
  const frame = document.createElement('iframe'); document.body.append(frame); frames.push(frame);
  const view = frame.contentWindow; const doc = view.document; doc.body.innerHTML = body;
  const state = { callbacks: 0, storm: false, targets: [], locale: 'en' }; const listeners = [];
  view.__okwLocale = {
    text: (zh, en) => state.locale === 'zh' ? zh : en,
    observe: vi.fn((listener) => listeners.push(listener)),
  };
  const Native = view.MutationObserver;
  view.MutationObserver = class {
    constructor(callback) {
      const observer = new Native((records) => {
        if (++state.callbacks > 80) { state.storm = true; observer.disconnect(); return; }
        callback(records);
      });
      const observe = observer.observe.bind(observer);
      observer.observe = (target, options) => { state.targets.push({ target, options }); observe(target, options); };
      observers.push(observer); return observer;
    }
  };
  const animationFrames = new Map(); let nextFrame = 0;
  view.requestAnimationFrame = vi.fn((callback) => { animationFrames.set(++nextFrame, callback); return nextFrame; });
  view.cancelAnimationFrame = (id) => animationFrames.delete(id);
  const flushFrames = async () => {
    await tick(); const pending = [...animationFrames.values()]; animationFrames.clear();
    pending.forEach((callback) => callback(0)); await settled(state);
  };
  view.fetch = vi.fn();
  beforeMount(doc); view.eval(source);
  const setLocale = (locale) => { state.locale = locale; listeners.forEach((listener) => listener()); };
  return { view, doc, state, setLocale, flushFrames };
}
async function settled(state) {
  await tick(); const callbacks = state.callbacks; await tick();
  expect(state.callbacks).toBe(callbacks); expect(state.storm).toBe(false);
}
function bindNative(doc, { asyncOpen = false } = {}) {
  const selected = vi.fn(); const context = vi.fn(); const actions = vi.fn(); const outside = vi.fn();
  const ids = new Map();
  const close = () => {
    doc.querySelector('.native-menu')?.remove(); doc.removeEventListener('mousedown', outside);
  };
  outside.mockImplementation((event) => { if (!event.target.closest('.native-menu')) close(); });
  const renderMenu = (id) => {
    close(); const menu = doc.createElement('div'); menu.className = 'ui-menu menu native-menu';
    menu.setAttribute('role', 'menu');
    for (const label of ['Fork', 'Pin', 'Rename', 'Archive', 'Export', 'Delete']) {
      const action = doc.createElement('button'); action.textContent = label; action.setAttribute('role', 'menuitem');
      action.addEventListener('click', () => { actions(label, id); close(); }); menu.append(action);
    }
    doc.body.append(menu); return menu;
  };
  doc.querySelectorAll('.side .se').forEach((row, index) => {
    const id = `fixture-session-${index}`; ids.set(row, id);
    row.addEventListener('click', () => selected(id));
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault(); event.stopPropagation(); context({ row, id, event });
      if (asyncOpen) {
        close(); setTimeout(() => doc.addEventListener('mousedown', outside), 0);
        doc.defaultView.queueMicrotask(() => renderMenu(id));
      } else { renderMenu(id); doc.addEventListener('mousedown', outside); }
    });
  });
  doc.defaultView.addEventListener('resize', close);
  return { selected, context, actions, ids, close, outside };
}
function press(test, target, key, options = {}) {
  const event = new test.view.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event); return event;
}
function keyboardFixture() {
  let native; const question = vi.fn((event) => { event.preventDefault(); event.stopImmediatePropagation(); });
  const test = install(appMarkup(), (doc) => {
    doc.addEventListener('keydown', question, true); doc.addEventListener('keyup', question, true);
    native = bindNative(doc, { asyncOpen: true });
  });
  const trigger = test.doc.querySelector(selector); trigger.focus();
  return { ...test, native, trigger, question };
}
afterEach(() => {
  observers.splice(0).forEach((observer) => observer.disconnect());
  frames.splice(0).forEach((frame) => frame.remove()); vi.restoreAllMocks();
});

describe('desktop session menu entry', () => {
  it('keeps native nodes and handlers while enhancing grouped, flat, pinned and done rows exactly once', async () => {
    let native; let nodes; const pin = vi.fn(); const workspace = vi.fn();
    const test = install(appMarkup(), (doc) => {
      nodes = [...doc.querySelectorAll('.side *')]; native = bindNative(doc);
      doc.querySelector('.pin-btn').addEventListener('click', pin);
      doc.querySelector('.gh-more').addEventListener('click', workspace);
    });
    await settled(test.state);
    expect(test.doc.querySelectorAll(selector)).toHaveLength(4);
    expect(test.doc.querySelectorAll(`.side .se > .row > .act > .ha > ${selector}`)).toHaveLength(4);
    expect(nodes.every((node) => node.isConnected)).toBe(true);
    expect(test.doc.querySelector('.se').hasAttribute('data-session-id')).toBe(false);
    const button = test.doc.querySelector(selector);
    expect(button.tagName).toBe('BUTTON'); expect(button.type).toBe('button'); expect(button.tabIndex).toBe(0);
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-label')).toBe('Session options'); expect(button.title).toBe('Session options');
    expect(button.querySelector('svg').getAttribute('aria-hidden')).toBe('true');
    expect(button.querySelectorAll('circle')).toHaveLength(3);
    expect([...button.attributes].some((attribute) => attribute.name.startsWith('data-v-'))).toBe(false);
    test.doc.querySelector('.pin-btn').click(); expect(pin).toHaveBeenCalledOnce();
    test.doc.querySelector('.gh-more').click(); expect(workspace).toHaveBeenCalledOnce();
    const calls = native.selected.mock.calls.length;
    button.querySelector('circle').dispatchEvent(new test.view.MouseEvent('click', { bubbles: true }));
    expect(native.selected).toHaveBeenCalledTimes(calls); expect(native.context).toHaveBeenCalledOnce();
    expect(test.view.fetch).not.toHaveBeenCalled();
    test.view.eval(source); await settled(test.state);
    expect(test.doc.querySelectorAll(selector)).toHaveLength(4);
    expect(test.view.__okwLocale.observe).toHaveBeenCalledOnce();
  });

  it('dispatches at the button edge to the exact same-title row without selecting it or rebuilding its menu', async () => {
    let native; const test = install(appMarkup(), (doc) => { native = bindNative(doc); });
    const row = test.doc.querySelector('.se.flat'); const button = row.querySelector(selector);
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ left: 120, width: 28, bottom: 196 });
    const bubbled = vi.fn(); test.doc.addEventListener('contextmenu', bubbled);
    button.click(); await settled(test.state);
    const first = native.context.mock.calls[0][0];
    expect(first.row).toBe(row); expect(first.id).toBe(native.ids.get(row));
    expect(first.event).toBeInstanceOf(test.view.MouseEvent); expect(first.event.target).toBe(row);
    expect(first.event.bubbles).toBe(true); expect(first.event.cancelable).toBe(true);
    expect(first.event.defaultPrevented).toBe(true);
    expect(first.event.clientX).toBe(134); expect(first.event.clientY).toBe(196);
    expect(native.selected).not.toHaveBeenCalled(); expect(bubbled).not.toHaveBeenCalled();
    expect([...test.doc.querySelectorAll('.native-menu button')].map((action) => action.textContent))
      .toEqual(['Fork', 'Pin', 'Rename', 'Archive', 'Export', 'Delete']);
    test.doc.querySelector('.native-menu button').click();
    expect(native.actions).toHaveBeenLastCalledWith('Fork', native.ids.get(row));
    button.dispatchEvent(new test.view.MouseEvent('mousedown', { bubbles: true }));
    expect(test.doc.querySelector('.native-menu')).toBeNull();
    button.click(); button.click();
    expect(native.context).toHaveBeenCalledTimes(3);
    expect(native.context.mock.calls.every(([call]) => call.row === row)).toBe(true);
    expect(test.doc.querySelectorAll('.native-menu button:first-child')).toHaveLength(1);
    expect(test.doc.querySelectorAll(selector)).toHaveLength(4);
    test.view.dispatchEvent(new test.view.Event('resize'));
    expect(test.doc.querySelector('.native-menu')).toBeNull();
    expect(test.view.fetch).not.toHaveBeenCalled(); await settled(test.state);
  });
});

describe('desktop session menu accessibility', () => {
  it('isolates native button activation before QuestionCard capture without canceling Enter or Space defaults', async () => {
    const question = vi.fn((event) => {
      if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); }
    });
    let native; const test = install(appMarkup(), (doc) => {
      doc.addEventListener('keydown', question, true); doc.addEventListener('keyup', question, true);
      native = bindNative(doc);
    });
    const button = test.doc.querySelector(selector); button.focus();
    expect(test.doc.activeElement).toBe(button);
    for (const key of ['Enter', ' ']) {
      for (const type of ['keydown', 'keyup']) {
        const event = new test.view.KeyboardEvent(type, { key, bubbles: true, cancelable: true });
        expect(button.dispatchEvent(event)).toBe(true); expect(event.defaultPrevented).toBe(false);
      }
    }
    expect(question).not.toHaveBeenCalled(); expect(native.context).not.toHaveBeenCalled();
    button.click(); expect(native.context).toHaveBeenCalledOnce();
    const escape = press(test, button, 'Escape');
    expect(question).not.toHaveBeenCalled(); expect(escape.defaultPrevented).toBe(true);
    await settled(test.state); expect(test.doc.querySelector('.native-menu')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false'); expect(test.doc.activeElement).toBe(button);
    button.dispatchEvent(new test.view.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    button.dispatchEvent(new test.view.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    expect(question).toHaveBeenCalledTimes(2);
    test.doc.querySelector('.pin-btn').dispatchEvent(new test.view.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(question).toHaveBeenCalledTimes(3);
    expect(native.context).toHaveBeenCalledOnce(); await settled(test.state);
  });

  it('localizes existing and replaced buttons with one shared listener and no repeated attribute writes', async () => {
    const test = install(appMarkup()); await settled(test.state);
    const buttons = [...test.doc.querySelectorAll(selector)];
    const writes = buttons.map((button) => vi.spyOn(button, 'setAttribute'));
    test.setLocale('zh');
    expect(buttons.every((button) => button.title === '会话选项' && button.getAttribute('aria-label') === '会话选项')).toBe(true);
    writes.forEach((write) => write.mockClear()); test.setLocale('zh');
    expect(writes.every((write) => write.mock.calls.length === 0)).toBe(true);
    test.doc.querySelector('.se.flat').outerHTML = rowMarkup('flat'); await settled(test.state);
    expect(test.doc.querySelector('.se.flat button.okw-desktop-session-menu').title).toBe('会话选项');
    expect(test.doc.querySelectorAll(selector)).toHaveLength(4);
    test.setLocale('en'); await settled(test.state);
    expect([...test.doc.querySelectorAll(selector)].every((button) => button.title === 'Session options')).toBe(true);
    expect(test.view.__okwLocale.observe).toHaveBeenCalledOnce();
  });
});

describe('desktop native menu keyboard navigation', () => {
  it('focuses the async native first item for Enter/Space default clicks and keeps item activation native', async () => {
    const test = keyboardFixture();
    for (const key of ['Enter', ' ']) {
      const down = press(test, test.trigger, key);
      expect(down.defaultPrevented).toBe(false);
      const up = new test.view.KeyboardEvent('keyup', { key, bubbles: true, cancelable: true });
      test.trigger.dispatchEvent(up); expect(up.defaultPrevented).toBe(false);
      test.trigger.click(); expect(test.doc.querySelector('.native-menu')).toBeNull();
      await test.flushFrames();
      const menu = test.doc.querySelector('.native-menu'); const items = [...menu.children];
      expect(test.doc.activeElement).toBe(items[0]); expect(test.trigger.getAttribute('aria-expanded')).toBe('true');
      expect(press(test, items[0], key).defaultPrevented).toBe(false);
      expect(test.native.actions).toHaveBeenCalledTimes(key === 'Enter' ? 0 : 1);
      items[0].click(); await settled(test.state);
      expect(test.native.actions).toHaveBeenLastCalledWith('Fork', test.native.ids.get(test.trigger.closest('.se')));
      expect(test.trigger.getAttribute('aria-expanded')).toBe('false'); test.trigger.focus();
    }
    expect(test.question).not.toHaveBeenCalled(); expect(test.native.selected).not.toHaveBeenCalled();
  });

  it('lets trigger ArrowDown enter, skips unavailable items and cycles ArrowUp/Down/Home/End', async () => {
    const test = keyboardFixture();
    expect(press(test, test.trigger, 'ArrowDown').defaultPrevented).toBe(true);
    await tick(); const menu = test.doc.querySelector('.native-menu'); const items = [...menu.children];
    items[0].disabled = true; items[1].setAttribute('aria-disabled', 'true'); items[2].hidden = true;
    await test.flushFrames(); expect(test.doc.activeElement).toBe(items[3]);
    for (const [key, item] of [['ArrowUp', items[5]], ['ArrowDown', items[3]], ['End', items[5]], ['Home', items[3]]]) {
      expect(press(test, test.doc.activeElement, key).defaultPrevented).toBe(true);
      expect(test.doc.activeElement).toBe(item);
    }
    expect([...menu.children]).toEqual(items); expect(test.native.actions).not.toHaveBeenCalled();
    test.trigger.focus(); press(test, test.trigger, 'ArrowDown'); expect(test.doc.activeElement).toBe(items[3]);
    expect(test.native.context).toHaveBeenCalledOnce(); expect(test.question).not.toHaveBeenCalled();
  });
});

describe('desktop native menu keyboard dismissal', () => {
  it('closes Escape through native outside mousedown, restores the trigger and never resizes other panels', async () => {
    const test = keyboardFixture(); const resize = vi.fn(); test.view.addEventListener('resize', resize);
    const mousedown = vi.fn(); test.trigger.addEventListener('mousedown', mousedown);
    test.trigger.click(); await test.flushFrames();
    const event = press(test, test.doc.activeElement, 'Escape');
    expect(event.defaultPrevented).toBe(true); expect(test.doc.activeElement).toBe(test.trigger);
    await settled(test.state);
    expect(test.doc.querySelector('.native-menu')).toBeNull(); expect(test.trigger.getAttribute('aria-expanded')).toBe('false');
    expect(mousedown).toHaveBeenCalledOnce(); expect(mousedown.mock.calls[0][0].bubbles).toBe(true);
    expect(test.native.outside).toHaveBeenCalledOnce(); expect(resize).not.toHaveBeenCalled();
    expect(test.question).not.toHaveBeenCalled(); expect(test.native.selected).not.toHaveBeenCalled();
  });

  it('keeps Tab defaults but starts forward/backward movement at the trigger before closing the menu', async () => {
    const test = keyboardFixture(); const outside = test.doc.querySelector('.pin-btn');
    for (const shiftKey of [false, true]) {
      test.trigger.focus(); test.trigger.click(); await test.flushFrames(); const item = test.doc.activeElement;
      const event = press(test, item, 'Tab', { shiftKey });
      expect(event.defaultPrevented).toBe(false); expect(test.doc.activeElement).toBe(test.trigger);
      outside.focus(); await settled(test.state);
      expect(test.doc.activeElement).toBe(outside); expect(test.doc.querySelector('.native-menu')).toBeNull();
      expect(test.trigger.getAttribute('aria-expanded')).toBe('false');
    }
    expect(test.native.selected).not.toHaveBeenCalled(); expect(test.question).not.toHaveBeenCalled();
  });

  it('closes an Escape pressed before the outside listener is installed without later rAF stealing focus', async () => {
    const test = keyboardFixture(); test.trigger.click(); press(test, test.trigger, 'Escape');
    await test.flushFrames(); expect(test.doc.querySelector('.native-menu')).toBeNull();
    expect(test.doc.activeElement).toBe(test.trigger); expect(test.trigger.getAttribute('aria-expanded')).toBe('false');
    expect(test.native.outside).toHaveBeenCalledOnce(); expect(test.question).not.toHaveBeenCalled();
  });
});

describe('desktop native menu instance boundaries', () => {
  it('keeps mouse focus on its trigger and releases tracking when native outside-close or transition runs', async () => {
    const test = keyboardFixture();
    test.trigger.dispatchEvent(new test.view.MouseEvent('click', { bubbles: true, detail: 1 }));
    await test.flushFrames(); expect(test.doc.activeElement).toBe(test.trigger);
    expect(test.trigger.getAttribute('aria-expanded')).toBe('true');
    test.doc.body.dispatchEvent(new test.view.MouseEvent('mousedown', { bubbles: true })); await settled(test.state);
    expect(test.doc.querySelector('.native-menu')).toBeNull(); expect(test.trigger.getAttribute('aria-expanded')).toBe('false');
    test.trigger.click(); await test.flushFrames();
    const menu = test.doc.querySelector('.native-menu'); menu.classList.add('menu-pop-leave-active');
    await settled(test.state); expect(test.trigger.getAttribute('aria-expanded')).toBe('false');
    test.native.close(); await settled(test.state);
    expect(test.question).not.toHaveBeenCalled(); expect(test.native.selected).not.toHaveBeenCalled();
  });

  it('never takes over a right-click menu or a different existing menu and discards stale pending frames', async () => {
    const test = keyboardFixture(); const row = test.doc.querySelector('.se.flat');
    const foreign = test.doc.createElement('div'); foreign.className = 'ui-menu menu'; foreign.setAttribute('role', 'menu');
    foreign.innerHTML = '<button role="menuitem">Other menu</button>'; test.doc.body.append(foreign);
    test.trigger.click();
    row.dispatchEvent(new test.view.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await test.flushFrames(); const menu = test.doc.querySelector('.native-menu'); const item = menu.firstElementChild;
    expect(test.trigger.getAttribute('aria-expanded')).toBe('false'); expect(test.doc.activeElement).toBe(test.trigger);
    item.focus(); press(test, item, 'Escape');
    expect(test.question).toHaveBeenCalledOnce(); expect(menu.isConnected).toBe(true);
    expect(foreign.firstElementChild.textContent).toBe('Other menu');
    test.question.mockClear(); test.trigger.focus(); test.trigger.click(); await test.flushFrames();
    expect(test.doc.activeElement).toBe(test.doc.querySelector('.native-menu button'));
    expect(test.doc.activeElement).not.toBe(foreign.firstElementChild);
    const next = test.doc.querySelector('.se.flat').querySelector(selector); next.focus(); next.click();
    await test.flushFrames(); expect(test.doc.activeElement).toBe(test.doc.querySelector('.native-menu button'));
    expect(test.trigger.getAttribute('aria-expanded')).toBe('false'); expect(next.getAttribute('aria-expanded')).toBe('true');
    expect(test.question).not.toHaveBeenCalled();
  });

  it('releases removed menu/trigger instances and never observes or scans chat while or after a menu is open', async () => {
    const test = keyboardFixture(); test.trigger.click(); await test.flushFrames();
    const transcript = test.doc.querySelector('.transcript'); const side = test.doc.querySelector('.side');
    const query = vi.spyOn(test.view.Element.prototype, 'querySelectorAll'); const callbacks = test.state.callbacks;
    transcript.insertAdjacentHTML('beforeend', `<section>${rowMarkup()}</section>`); await tick();
    expect(query).not.toHaveBeenCalled(); expect(test.state.callbacks).toBe(callbacks);
    expect(test.state.targets.filter(({ options }) => options.subtree).every(({ target }) => target === side)).toBe(true);
    test.native.close(); await settled(test.state); expect(test.trigger.getAttribute('aria-expanded')).toBe('false');
    query.mockClear(); const closedCallbacks = test.state.callbacks;
    transcript.append(test.doc.createElement('span')); await tick();
    expect(query).not.toHaveBeenCalled(); expect(test.state.callbacks).toBe(closedCallbacks);
    test.trigger.focus(); test.trigger.click(); test.trigger.closest('.side').remove();
    await test.flushFrames(); expect(test.trigger.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('desktop session menu lifecycle', () => {
  it('discovers late app/sidebar mounts and native row/action/sidebar replacements with a real observer', async () => {
    const test = install(); test.doc.body.innerHTML = '<div id="app"></div>'; await settled(test.state);
    test.doc.querySelector('#app').innerHTML = '<div class="app-shell"><div class="app"></div></div>';
    await settled(test.state); test.doc.querySelector('.app').innerHTML = sidebarMarkup(); await settled(test.state);
    expect(test.doc.querySelectorAll(selector)).toHaveLength(4);
    test.doc.querySelector('.se .ha').innerHTML = '<button class="pin-btn">New pin</button>';
    test.doc.querySelector('.se.flat').outerHTML = rowMarkup('flat'); await settled(test.state);
    expect(test.doc.querySelectorAll(selector)).toHaveLength(4);
    test.doc.querySelector('.sessions').insertAdjacentHTML('beforeend', rowMarkup()); await settled(test.state);
    expect(test.doc.querySelectorAll(selector)).toHaveLength(5);
    const detached = test.doc.querySelector('.side'); detached.outerHTML = sidebarMarkup(); await settled(test.state);
    expect(test.doc.querySelectorAll(selector)).toHaveLength(4);
    const callbacks = test.state.callbacks; detached.insertAdjacentHTML('beforeend', rowMarkup()); await tick();
    expect(test.state.callbacks).toBe(callbacks);
    test.doc.querySelector('.app-shell').outerHTML = `<div class="app-shell"><div class="app">${sidebarMarkup()}</div></div>`;
    await settled(test.state); expect(test.doc.querySelectorAll(selector)).toHaveLength(4);
  });

  it('waits through native rename markup and preserves the reopened action nodes', async () => {
    const test = install(appMarkup()); const row = test.doc.querySelector('.se.done');
    row.querySelector('.act').outerHTML = '<div class="rename-wrap"><input value="Same title"></div>';
    await settled(test.state); expect(row.querySelector(selector)).toBeNull();
    row.querySelector('.rename-wrap').outerHTML = '<span class="act"><span class="ha">' +
      '<button class="reopen-btn">Reopen</button><button class="okw-sidebar-archive-delete">Delete</button></span></span>';
    const reopen = row.querySelector('.reopen-btn'); const handler = vi.fn(); reopen.addEventListener('click', handler);
    await settled(test.state); expect(row.querySelectorAll(selector)).toHaveLength(1);
    expect(row.querySelector('.reopen-btn')).toBe(reopen); reopen.click(); expect(handler).toHaveBeenCalledOnce();
    expect(row.querySelector('.okw-sidebar-archive-delete').textContent).toBe('Delete');
  });

  it('never scans or observes an unrelated chat transcript and converges after sidebar mutations', async () => {
    const test = install(appMarkup()); await settled(test.state);
    const transcript = test.doc.querySelector('.transcript'); const side = test.doc.querySelector('.side');
    const documentQuery = vi.spyOn(test.doc, 'querySelectorAll'); const sideQuery = vi.spyOn(side, 'querySelectorAll');
    const elementQuery = vi.spyOn(test.view.Element.prototype, 'querySelectorAll');
    const callbacks = test.state.callbacks;
    for (let index = 0; index < 8; index += 1) {
      transcript.insertAdjacentHTML('beforeend', `<section>${rowMarkup()}</section>`); await tick();
    }
    expect(documentQuery).not.toHaveBeenCalled(); expect(sideQuery).not.toHaveBeenCalled();
    expect(elementQuery).not.toHaveBeenCalled(); expect(test.state.callbacks).toBe(callbacks);
    expect(test.state.targets.filter(({ options }) => options.subtree).every(({ target }) => target === side)).toBe(true);
    expect(transcript.querySelector(selector)).toBeNull();
    side.querySelector('.t-inner').textContent = 'A much longer title'; await settled(test.state);
    expect(side.querySelectorAll(selector)).toHaveLength(4);
    test.view.eval(source); await settled(test.state);
    expect(test.view.__okwLocale.observe).toHaveBeenCalledOnce();
  });

  it('uses semantic theme tokens, focus-within reveal, title spacing and archive-action coexistence', () => {
    expect(css).toContain('var(--icon-button-sm'); expect(css).toContain('var(--p-focus-ring)');
    expect(css).toContain('var(--color-hover)'); expect(css).toContain('var(--color-text-muted)');
    expect(css).toContain(':focus-within'); expect(css).toContain(':where(:not(.okw-sidebar-archive-actions))');
    expect(css).toContain('min-width: var(--okw-session-actions-width)'); expect(css).toContain('--sb-fade: 0px');
    expect(css).toContain('@media (hover: none)'); expect(css).toContain(':has(.okw-sidebar-archive-delete)');
    expect(css).not.toMatch(/data-v-|#[\da-f]{3,8}\b|!important/iu);
    expect(source).not.toMatch(/data-session-id|localStorage|\/api\/|data-v-|\.click\(/u);
  });
});
