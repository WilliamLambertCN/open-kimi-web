/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
const source = readFileSync(resolve('packages/launcher/src/mobile/mobileConversationTocNavigate.js'), 'utf8');
const frames = []; const observers = [];
const turns = [
  { id: 'user-first', user: true }, { id: 'assistant-first' },
  { id: 'user-middle', user: true }, { id: 'assistant-middle' }, { id: 'user-last', user: true },
];
function installLayout(view, root, options) {
  const state = { now: 0, timers: new Map(), next: 1, documentTop: 200, height: 68, corrections: 0, freezes: 0 };
  vi.spyOn(view.performance, 'now').mockImplementation(() => state.now);
  view.setTimeout = vi.fn((callback, delay) => {
    const id = state.next++; state.timers.set(id, { callback, delay }); return id;
  });
  view.clearTimeout = vi.fn((id) => state.timers.delete(id));
  Object.defineProperty(root, 'clientHeight', { value: 600 });
  Object.defineProperty(root, 'scrollHeight', { get: () => state.scrollHeight ?? 20000 });
  root.getBoundingClientRect = () => ({ top: 50, bottom: 650, width: 390, height: 600 });
  view.Element.prototype.getBoundingClientRect = function() {
    return { top: state.documentTop - root.scrollTop, bottom: state.documentTop - root.scrollTop + state.height,
      height: state.height, width: 300 };
  };
  const scroll = vi.fn();
  view.Element.prototype.scrollIntoView = function(value) {
    scroll(this, value);
    if (!options.noSmoothMovement) root.scrollTop = state.documentTop - 316;
    options.onScrollIntoView?.(this, state);
  };
  root.scrollTo = vi.fn(({ top, behavior }) => {
    if (behavior === 'instant') {
      if (top === root.scrollTop) state.freezes += 1; else state.corrections += 1;
    }
    if (!options.noCorrection) root.scrollTop = top;
  });
  return { layout: state, scroll };
}
async function microtasks() { for (let count = 0; count < 20; count += 1) await Promise.resolve(); }
async function advanceTime(test, before) {
  await microtasks(); const next = test.layout.timers.entries().next().value;
  if (!next) return false;
  const [id, timer] = next; test.layout.timers.delete(id); test.layout.now += timer.delay;
  before?.(test.layout); timer.callback(); await microtasks(); return true;
}
async function finishNavigation(test, result) {
  let settled = false; let value; let error;
  result.then((next) => { value = next; settled = true; }, (next) => { error = next; settled = true; });
  for (let count = 0; count < 40 && !settled; count += 1) {
    if (!await advanceTime(test)) await microtasks();
  }
  expect(settled).toBe(true);
  if (error) throw error;
  return value;
}
function setup(options = {}) {
  const frame = document.createElement('iframe'); document.body.append(frame); frames.push(frame);
  const view = frame.contentWindow; const doc = view.document;
  doc.body.innerHTML = '<main class="app mobile"><section class="con"><div class="chat-scroll is-following">' +
    '<div class="content-wrap"><div class="chat"><div class="history-window" data-virtual-scroll-root></div>' +
    '</div></div></div></section></main>';
  const root = doc.querySelector('.chat-scroll'); const chat = doc.querySelector('.chat');
  const history = chat.firstElementChild; const data = options.turns ?? turns;
  const controller = new view.AbortController(); const isCurrent = vi.fn(() => true);
  const items = data.filter((turn) => turn.user).map(({ id }) => ({ id, label: 'Repeated question' }));
  const { scroll, layout } = installLayout(view, root, options); const clicks = []; const focused = [];
  const state = { active: 0, callbacks: 0, storm: false, current: true };
  const Native = view.MutationObserver;
  view.MutationObserver = class {
    constructor(callback) {
      const observer = new Native((records) => {
        if (++state.callbacks > 1200) { state.storm = true; observer.disconnect(); return; }
        callback(records);
      });
      observers.push(observer); let active = false;
      return {
        observe(...args) { observer.observe(...args); if (!active) { active = true; state.active += 1; } },
        disconnect() { observer.disconnect(); if (active) { active = false; state.active -= 1; } },
      };
    }
  };
  const wheel = vi.fn((event) => {
    if (event.deltaY < 0) { root.scrollTo({ top: root.scrollTop, behavior: 'auto' }); state.following = false; }
  });
  root.addEventListener('wheel', wheel); state.following = true;
  const bubbled = vi.fn(); doc.addEventListener('wheel', bubbled);
  root.addEventListener('focusin', (event) => focused.push(event.target));
  view.matchMedia = vi.fn(() => ({ matches: Boolean(options.reduced) }));
  view.fetch = vi.fn(); view.XMLHttpRequest = vi.fn(); view.WebSocket = vi.fn();
  const storage = vi.spyOn(view.Storage.prototype, 'setItem'); view.requestAnimationFrame = vi.fn();
  const makeBubble = (parent, id) => {
    const turn = doc.createElement('div'); turn.className = 'u-turn';
    const bubble = doc.createElement('div'); bubble.className = 'u-bub turn-anchor';
    bubble.setAttribute('data-turn-id', id); bubble.textContent = 'Repeated question';
    turn.append(bubble); parent.append(turn); return bubble;
  };
  const render = (indices) => {
    history.replaceChildren(...indices.map(makeRow)); return [...history.children];
  };
  const reveal = async (index) => {
    await Promise.resolve();
    const rows = render([index, ...(options.keep ?? []).filter((value) => value !== index)]);
    await Promise.resolve(); root.scrollTop = index * 100; rows[0].focus({ preventScroll: true });
    options.afterFocus?.(rows[0]);
  };
  function makeRow(index) {
    const turn = data[index]; const row = doc.createElement('div'); row.className = 'history-row';
    row.setAttribute('data-history-key', turn.id); row.setAttribute('aria-posinset', String(index + 1));
    row.setAttribute('aria-setsize', String(data.length)); row.tabIndex = -1;
    if (turn.user) makeBubble(row, turn.id);
    else { const assistant = doc.createElement('div'); assistant.className = 'a-msg'; row.append(assistant); }
    for (const direction of [-1, 1]) {
      const next = index + direction; if (next < 0 || next >= data.length) continue;
      const button = doc.createElement('button'); button.className = direction < 0 ? 'history-previous' : 'history-next';
      button.textContent = direction < 0 ? 'Previous message' : 'Next message';
      button.addEventListener('click', () => {
        clicks.push({ index, direction });
        if (options.onClick) options.onClick({ index, next, direction, row, render, controller, isCurrent });
        else void reveal(next);
      });
      if (direction < 0) row.prepend(button); else row.append(button);
    }
    return row;
  }
  render(options.mounted ?? [0]); view.eval(source);
  const navigate = (id, patch = {}) => view.__okwMobileTocNavigate({ root, id, items,
    signal: controller.signal, isCurrent, ...patch });
  const result = { view, doc, root, chat, history, data, controller, isCurrent, items, scroll, clicks, focused, state,
    wheel, bubbled, storage, navigate, render, makeRow, makeBubble, layout };
  result.complete = (id, patch) => finishNavigation(result, navigate(id, patch)); return result;
}
function quiet(test) {
  expect(test.state.active).toBe(0); expect(test.state.storm).toBe(false);
  expect(test.view.fetch).not.toHaveBeenCalled(); expect(test.view.XMLHttpRequest).not.toHaveBeenCalled();
  expect(test.view.WebSocket).not.toHaveBeenCalled(); expect(test.storage).not.toHaveBeenCalled();
  expect(test.view.requestAnimationFrame).not.toHaveBeenCalled();
}
async function rejects(test, code, id = 'user-last', patch = {}) {
  let caught;
  try { await test.complete(id, patch); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(test.view.Error); expect(caught.code).toBe(code); expect(caught.message).toBe(code);
  expect(test.scroll).not.toHaveBeenCalled(); quiet(test);
}
afterEach(() => {
  observers.splice(0).forEach((observer) => observer.disconnect());
  frames.splice(0).forEach((frame) => frame.remove()); vi.restoreAllMocks();
});
describe('exact main-chat target', () => {
  it.each([false, true])('scrolls the exact mounted bubble with reduced motion %s', async (reduced) => {
    const test = setup({ mounted: [0, 2, 4], reduced }); const bubble = test.history.children[1].querySelector('.u-bub');
    const text = vi.spyOn(test.view.Node.prototype, 'textContent', 'get');
    const label = vi.fn(() => { throw new Error('Labels are not identities'); });
    test.items.forEach((item) => Object.defineProperty(item, 'label', { get: label }));
    expect(await test.complete('user-middle')).toBe(true);
    expect(test.scroll).toHaveBeenCalledExactlyOnceWith(bubble, {
      block: 'center', behavior: reduced ? 'instant' : 'smooth',
    });
    expect(test.clicks).toEqual([]); expect(test.wheel).toHaveBeenCalledOnce(); expect(test.bubbled).toHaveBeenCalledOnce();
    expect(test.wheel.mock.calls[0][0]).toMatchObject({ deltaY: -1, bubbles: true, isTrusted: false });
    expect(test.root.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
    expect(test.state.following).toBe(false); expect(text).not.toHaveBeenCalled(); expect(label).not.toHaveBeenCalled();
    quiet(test);
  });
  it('handles ordinary nonvirtual DOM and does not interpret IDs as selectors', async () => {
    const id = 'user-"[data-private]\\exact'; const test = setup({ turns: [{ id, user: true }] });
    test.history.remove(); const bubble = test.makeBubble(test.chat, id);
    expect(await test.complete(id)).toBe(true); expect(test.scroll.mock.calls[0][0]).toBe(bubble); quiet(test);
  });
  it('registers once without document observers or side effects', () => {
    const test = setup(); const navigate = test.view.__okwMobileTocNavigate; test.view.eval(source);
    expect(test.view.__okwMobileTocNavigate).toBe(navigate); expect(test.state.callbacks).toBe(0);
    expect(test.wheel).not.toHaveBeenCalled(); quiet(test);
  });
  it('rejects unknown, duplicate and malformed directory IDs before touching navigation', async () => {
    const test = setup();
    for (const items of [[...test.items, test.items[0]], [{ id: '' }], [{ id: 1 }], [null], null]) {
      await rejects(test, 'identity', 'user-last', { items });
    }
    await rejects(test, 'identity', ''); await rejects(test, 'unavailable', 'not-loaded');
    expect(test.wheel).not.toHaveBeenCalled(); expect(test.clicks).toEqual([]);
  });
  it('rejects duplicate exact target bubbles and conflicting row identities', async () => {
    const test = setup({ mounted: [4] }); test.makeBubble(test.history.firstElementChild, 'user-last');
    await rejects(test, 'identity'); test.render([0]); test.makeBubble(test.history.firstElementChild, 'user-last');
    await rejects(test, 'identity'); expect(test.wheel).not.toHaveBeenCalled();
  });
  it('ignores side chat, nested tool history and unrelated roots even with an identical target ID', async () => {
    const test = setup({ mounted: [0, 1] });
    const other = test.root.cloneNode(true); test.root.after(other); const otherBubble = test.makeBubble(other, 'user-last');
    const nested = test.doc.createElement('div'); nested.className = 'history-window';
    nested.setAttribute('data-virtual-scroll-root', ''); nested.append(test.makeRow(4));
    test.history.children[1].querySelector('.a-msg').append(nested);
    const nestedClick = vi.fn(); nested.addEventListener('click', nestedClick);
    const otherClick = vi.fn(); other.addEventListener('click', otherClick);
    const bubble = test.makeBubble(test.chat, 'user-middle');
    expect(await test.complete('user-middle')).toBe(true); expect(test.scroll.mock.calls[0][0]).toBe(bubble);
    test.scroll.mockClear(); expect(await test.complete('user-last')).toBe(true);
    expect(test.scroll.mock.calls[0][0]).not.toBe(otherBubble);
    expect(test.scroll.mock.calls[0][0].closest('.chat-scroll')).toBe(test.root);
    expect(nestedClick).not.toHaveBeenCalled(); expect(otherClick).not.toHaveBeenCalled(); quiet(test);
  });
});
describe('native virtual history navigation', () => {
  it('walks each adjacent display row and reaches exact duplicate-text users within microtasks', async () => {
    const test = setup(); const task = vi.fn(); const timeout = setTimeout(task, 0);
    const result = test.navigate('user-last'); await microtasks();
    expect(test.scroll).toHaveBeenCalledOnce(); clearTimeout(timeout); expect(task).not.toHaveBeenCalled();
    expect(await finishNavigation(test, result)).toBe(true);
    expect(test.clicks).toEqual([0, 1, 2, 3].map((index) => ({ index, direction: 1 })));
    expect(test.focused.map((row) => row.getAttribute('data-history-key'))).toEqual(turns.slice(1).map((turn) => turn.id));
    expect(test.scroll.mock.calls[0][0].getAttribute('data-turn-id')).toBe('user-last');
    expect(test.state.callbacks).toBeGreaterThan(0); const count = test.state.callbacks;
    await Promise.resolve(); await Promise.resolve(); expect(test.state.callbacks).toBe(count); quiet(test);
  });
  it.each([
    { mounted: [0, 4], target: 'user-middle', first: 0, direction: 1 },
    { mounted: [0, 4], target: 'user-first', direct: true },
    { mounted: [2, 4], target: 'user-first', first: 2, direction: -1 },
    { mounted: [4], target: 'user-first', first: 4, direction: -1 },
  ])('chooses the nearest loaded user in directory order: %j', async (options) => {
    const test = setup(options); expect(await test.complete(options.target)).toBe(true);
    if (options.direct) expect(test.clicks).toEqual([]);
    else expect(test.clicks[0]).toEqual({ index: options.first, direction: options.direction });
    expect(test.scroll.mock.calls[0][0].getAttribute('data-turn-id')).toBe(options.target); quiet(test);
  });
  it('waits for native focus before clicking an already mounted next row', async () => {
    let test; const active = [];
    test = setup({ mounted: [0, 1], onClick: ({ row, index, next, render }) => {
      active.push(test.doc.activeElement);
      if (index > 0) expect(test.doc.activeElement).toBe(row);
      const mount = index === 0 ? test.history.children[1] : render([next])[0];
      void Promise.resolve().then(() => mount.focus());
    } });
    const mounted = test.history.children[1]; expect(await test.complete('user-last')).toBe(true);
    expect(active[1]).toBe(mounted); expect(test.clicks).toHaveLength(4); quiet(test);
  });
  it('does not use a nested user or assistant as the starting identity or load older pages', async () => {
    const test = setup({ mounted: [1] }); const nested = test.doc.createElement('div');
    nested.className = 'history-window'; nested.setAttribute('data-virtual-scroll-root', '');
    nested.append(test.makeRow(0)); test.history.firstElementChild.querySelector('.a-msg').append(nested);
    const load = test.doc.createElement('button'); load.className = 'top-sentinel-btn'; test.chat.prepend(load);
    const clicked = vi.fn(); load.addEventListener('click', clicked);
    await rejects(test, 'unavailable'); expect(test.clicks).toEqual([]); expect(clicked).not.toHaveBeenCalled();
  });
  it('ignores identity-free placeholders instead of inferring an ID from aria position or label', async () => {
    const test = setup(); const placeholder = test.doc.createElement('div'); placeholder.className = 'history-space';
    placeholder.setAttribute('aria-posinset', '5'); placeholder.textContent = 'Repeated question';
    test.history.prepend(placeholder); expect(await test.complete('user-last')).toBe(true);
    expect(test.clicks).toHaveLength(4); quiet(test);
  });
});
describe('navigation cancellation and bounded failures', () => {
  it.each(['aborted', 'stale'])('refuses an already %s session without navigation effects', async (code) => {
    const test = setup({ mounted: [4] });
    if (code === 'aborted') test.controller.abort(); else test.isCurrent.mockReturnValue(false);
    await rejects(test, code); expect(test.wheel).not.toHaveBeenCalled();
  });
  it.each(['abort', 'isCurrent', 'root', 'history'])('stops a pending reveal after %s invalidation', async (mode) => {
    let test;
    test = setup({ onClick: ({ render, controller, isCurrent }) => {
      if (mode === 'abort') controller.abort();
      if (mode === 'isCurrent') isCurrent.mockReturnValue(false);
      if (mode === 'root') test.root.remove();
      if (mode === 'history') test.history.replaceWith(test.doc.createElement('div'));
      render([4]);
    } });
    await rejects(test, mode === 'abort' ? 'aborted' : 'stale'); expect(test.clicks).toHaveLength(1);
  });
  it('rechecks session identity between every async row reveal', async () => {
    let test;
    test = setup({ afterFocus: () => { test.isCurrent.mockReturnValue(false); } });
    await rejects(test, 'stale'); expect(test.clicks).toHaveLength(1);
  });
  it('cleans pending observers immediately on abort and ignores a late native mount', async () => {
    let pending;
    const test = setup({ onClick: ({ render }) => { pending = render; } });
    const result = test.navigate('user-last'); expect(test.state.active).toBe(1); test.controller.abort();
    await expect(result).rejects.toMatchObject({ code: 'aborted', message: 'aborted' });
    pending([4]); await Promise.resolve(); expect(test.scroll).not.toHaveBeenCalled(); quiet(test);
  });
  it.each(['missing', 'disabled', 'nested', 'end'])('fails at a native %s boundary without fallback clicks', async (mode) => {
    const test = setup(); const row = test.history.firstElementChild; const button = row.querySelector('.history-next');
    if (mode === 'missing') button.remove();
    if (mode === 'disabled') button.disabled = true;
    if (mode === 'nested') { const child = test.doc.createElement('div'); row.append(child); child.append(button); }
    if (mode === 'end') { row.setAttribute('aria-posinset', '5'); button.remove(); }
    await rejects(test, 'boundary'); expect(test.clicks).toEqual([]);
  });
  it.each(['nothing', 'wrong-row', 'no-focus'])('does not report success when reveal produces %s', async (mode) => {
    const test = setup({ onClick: ({ render }) => {
      if (mode === 'wrong-row') render([3]);
      if (mode === 'no-focus') render([1]);
    } });
    const timer = vi.spyOn(test.view, 'setTimeout'); const result = test.navigate('user-last');
    const failed = expect(result).rejects.toMatchObject({ code: 'stalled', message: 'stalled' });
    expect(timer.mock.calls[0][1]).toBe(400); timer.mock.calls[0][0](); await failed;
    expect(test.clicks).toHaveLength(1); quiet(test);
  });
  it.each(['position', 'size', 'key', 'duplicate'])('rejects malformed %s row metadata without guessing', async (mode) => {
    const test = setup(); const row = test.history.firstElementChild;
    if (mode === 'position') row.setAttribute('aria-posinset', '1.5');
    if (mode === 'size') row.setAttribute('aria-setsize', '0');
    if (mode === 'key') row.removeAttribute('data-history-key');
    if (mode === 'duplicate') test.history.append(test.makeRow(0));
    await rejects(test, 'identity'); expect(test.clicks).toEqual([]);
  });
  it('rejects a shifted native index set instead of navigating into newly paged history', async () => {
    const test = setup({ onClick: ({ render }) => {
      const [row] = render([1]); row.setAttribute('aria-setsize', '6'); row.focus();
    } });
    await rejects(test, 'stale'); expect(test.clicks).toHaveLength(1);
  });
});
describe('navigation budgets and safe errors', () => {
  it('enforces the total deadline even while native nextTick keeps advancing', async () => {
    const test = setup(); const now = vi.spyOn(test.view.performance, 'now').mockReturnValue(0);
    const button = test.history.firstElementChild.querySelector('.history-next');
    button.addEventListener('click', () => now.mockReturnValue(4001));
    await rejects(test, 'timeout'); expect(test.clicks).toHaveLength(1);
  });
  it('expires a pending native reveal on the same total deadline', async () => {
    const test = setup({ onClick: () => {} }); const now = vi.spyOn(test.view.performance, 'now').mockReturnValue(0);
    const timer = vi.spyOn(test.view, 'setTimeout'); const result = test.navigate('user-last');
    const failed = expect(result).rejects.toMatchObject({ code: 'timeout', message: 'timeout' });
    now.mockReturnValue(4000); timer.mock.calls[0][0](); await failed; quiet(test);
  });
  it('bounds a fast but very long native chain without pretending the target was reached', async () => {
    const data = Array.from({ length: 516 }, (_, index) => ({ id: `turn-${index}`, user: index === 0 || index === 515 }));
    const test = setup({ turns: data }); const result = test.navigate('turn-515');
    const failed = expect(result).rejects.toMatchObject({ code: 'limit', message: 'limit' });
    for (let count = 0; count < 200; count += 1) await microtasks();
    await failed; expect(test.clicks).toHaveLength(512); quiet(test);
  });
  it('does not leak raw errors, labels or IDs when native behavior fails', async () => {
    const test = setup({ mounted: [4] });
    test.view.Element.prototype.scrollIntoView = () => { throw new Error('user-last Repeated question private detail'); };
    await rejects(test, 'failed'); quiet(test);
  });
});
describe('stable exact-target visibility', () => {
  it('does not resolve at scrollIntoView and corrects late layout changes through the native settling window', async () => {
    const test = setup({ mounted: [4], noSmoothMovement: true }); test.layout.documentTop = 2200;
    const result = test.navigate('user-last'); let finished = false; result.then(() => { finished = true; });
    expect(test.scroll).toHaveBeenCalledOnce(); await microtasks(); expect(finished).toBe(false);
    for (let sample = 0; sample < 15; sample += 1) {
      await advanceTime(test, (layout) => { if (layout.now === 1560) layout.documentTop += 900; });
    }
    expect(finished).toBe(false); expect(test.layout.corrections).toBe(2);
    expect(await finishNavigation(test, result)).toBe(true);
    const bubble = test.history.firstElementChild.querySelector('.u-bub');
    expect(bubble.getBoundingClientRect().top).toBe(316); expect(test.layout.now).toBeGreaterThanOrEqual(2000); quiet(test);
  });
  it('pins the exact target row when it first appears in overscan while an assistant still owns native focus', async () => {
    let test;
    test = setup({ onClick: ({ next, render }) => { const rows = render([next, 4]); rows[0].focus(); } });
    expect(await test.complete('user-last')).toBe(true);
    expect(test.clicks).toEqual([{ index: 0, direction: 1 }]);
    expect(test.doc.activeElement.getAttribute('data-history-key')).toBe('user-last'); quiet(test);
  });
  it('measures the unobscured area above the current native dock, without fixed viewport offsets', async () => {
    const test = setup({ mounted: [4] }); const dock = test.doc.createElement('div'); dock.className = 'chat-dock';
    dock.getBoundingClientRect = () => ({ top: 400, bottom: 650 }); test.root.after(dock);
    expect(await test.complete('user-last')).toBe(true);
    expect(test.history.firstElementChild.querySelector('.u-bub').getBoundingClientRect().top).toBe(191); quiet(test);
  });
  it('keeps exact identity when native pagination shifts row indices during final alignment', async () => {
    const test = setup({ mounted: [4] }); const row = test.history.firstElementChild;
    const result = test.navigate('user-last'); await advanceTime(test);
    row.setAttribute('aria-posinset', '15'); row.setAttribute('aria-setsize', '15');
    expect(await finishNavigation(test, result)).toBe(true); expect(test.clicks).toEqual([]); quiet(test);
  });
  it.each(['stuck', 'changing'])('never reports a stable landing when the real geometry is %s', async (mode) => {
    const test = setup({ mounted: [4], noSmoothMovement: true, noCorrection: mode === 'stuck' });
    test.layout.documentTop = 2200; const result = test.navigate('user-last');
    const failed = expect(result).rejects.toMatchObject({ code: 'stalled', message: 'stalled' });
    for (let sample = 0; sample < 24; sample += 1) {
      await advanceTime(test, (layout) => { if (mode === 'changing') layout.documentTop += 180; });
    }
    await failed; expect(test.layout.corrections).toBeLessThanOrEqual(21); quiet(test);
  });
});
describe('final-alignment cancellation', () => {
  it.each(['signal', 'route', 'pointer', 'touch', 'keyboard'])('stops correction after %s cancellation', async (mode) => {
    const test = setup({ mounted: [4], noSmoothMovement: true }); test.layout.documentTop = 2200;
    const remove = vi.spyOn(test.root, 'removeEventListener'); const result = test.navigate('user-last');
    const failed = expect(result).rejects.toMatchObject({ code: mode === 'route' ? 'stale' : 'aborted' });
    test.root.scrollTop = 173;
    if (mode === 'signal') test.controller.abort();
    if (mode === 'route') test.isCurrent.mockReturnValue(false);
    if (mode === 'pointer') test.root.dispatchEvent(new test.view.Event('pointerdown', { bubbles: true }));
    if (mode === 'touch') test.root.dispatchEvent(new test.view.Event('touchstart', { bubbles: true }));
    if (mode === 'keyboard') test.doc.dispatchEvent(new test.view.KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
    expect(test.layout.freezes).toBe(mode === 'route' ? 0 : 1);
    if (mode !== 'route') expect(test.root.scrollTo).toHaveBeenLastCalledWith({ top: 173, behavior: 'instant' });
    const calls = test.root.scrollTo.mock.calls.length;
    if (mode !== 'signal') await advanceTime(test);
    await failed; expect(test.root.scrollTo).toHaveBeenCalledTimes(calls);
    expect(test.layout.corrections).toBe(0); expect(remove).toHaveBeenCalledTimes(3); quiet(test);
  });
  it('does not touch a reused root when the old navigation is aborted after a route change', async () => {
    const test = setup({ mounted: [4], noSmoothMovement: true }); const result = test.navigate('user-last');
    const failed = expect(result).rejects.toMatchObject({ code: 'aborted' });
    test.isCurrent.mockReturnValue(false); const calls = test.root.scrollTo.mock.calls.length;
    test.controller.abort(); await failed; expect(test.root.scrollTo).toHaveBeenCalledTimes(calls); quiet(test);
  });
  it('removes interruption handlers once positioning has completed', async () => {
    const test = setup({ mounted: [4] }); expect(await test.complete('user-last')).toBe(true);
    const calls = test.root.scrollTo.mock.calls.length;
    test.root.dispatchEvent(new test.view.Event('pointerdown', { bubbles: true }));
    test.controller.abort(); expect(test.root.scrollTo).toHaveBeenCalledTimes(calls); quiet(test);
  });
  it('checks abort again after exact row focus before starting any scroll', async () => {
    const test = setup({ mounted: [4] });
    test.history.firstElementChild.addEventListener('focusin', () => test.controller.abort());
    await rejects(test, 'aborted');
  });
  it('does not follow a replacement bubble after the exact original node unmounts', async () => {
    const test = setup({ mounted: [4] }); const result = test.navigate('user-last');
    const failed = expect(result).rejects.toMatchObject({ code: 'stale' }); test.render([4]);
    await advanceTime(test); await failed; expect(test.layout.corrections).toBe(0); quiet(test);
  });
  it('enforces the same total deadline during stable-position checks', async () => {
    const test = setup({ mounted: [4] }); const result = test.navigate('user-last');
    const failed = expect(result).rejects.toMatchObject({ code: 'timeout' }); test.layout.now = 4000;
    await advanceTime(test); await failed; quiet(test);
  });
});
