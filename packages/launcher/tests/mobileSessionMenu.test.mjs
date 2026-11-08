/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve('packages/launcher/src/mobile/mobileSessionMenu.js'), 'utf8');
const css = readFileSync(resolve('packages/launcher/src/mobile/mobileSessionMenu.css'), 'utf8');
const resumeKey = 'open-kimi-web.reopen-session-list';
const frames = [];
const states = [];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const failure = (code) => Object.assign(new Error('fixture-private-server-detail'), { code });
const projection = (id) => ({ id, title: `Title ${id}`, cwd: '/fixture/project' });
const nativeMenu = '<div class="kmenu ui-menu" role="menu"><button>Rename</button>' +
  '<button>Archive</button><button>Delete</button></div>';
const rowMarkup = '<div class="srow"><span class="t">Duplicate title</span>' +
  '<span class="age">just now</span><button class="kb">More</button>' + nativeMenu + '</div>';
const sheetMarkup = (flat) => `<div class="sheet-root"><div class="sheet-scrim"></div>
  <div class="sheet-panel" role="dialog"><button class="sheet-grab">Close</button><div class="sheet-body">
  <div class="actions"><button class="newrow">New chat</button><button class="newrow">New workspace</button></div>
  <div class="view-tabs"><button>Flat</button><button>Grouped</button></div><div class="mlist">${flat
    ? rowMarkup.repeat(2) : '<div class="mgroup"><div class="mgh">Workspace<button class="mgh-more">More</button>' +
      '<div class="kmenu wsmenu"><button>Workspace settings</button></div></div>' + rowMarkup.repeat(2) + '</div>'}
  </div></div></div></div>`;
const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

function watchMutations(view) {
  const NativeObserver = view.MutationObserver;
  const state = { calls: 0, stopped: false, observers: [] };
  states.push(state);
  view.MutationObserver = class MutationObserver {
    constructor(callback) {
      const observer = new NativeObserver((records) => {
        state.calls += 1;
        if (state.calls > 100) {
          state.stopped = true; state.observers.forEach((item) => item.disconnect()); return;
        }
        callback(records, observer);
      });
      state.observers.push(observer); return observer;
    }
  };
  return state;
}

function wireSheet(view, root, options) {
  const rows = [...root.querySelectorAll('.mlist .srow')];
  const menus = rows.map((row) => row.querySelector('.kmenu'));
  const originals = menus.map((menu) => [...menu.children]);
  const nativeAction = vi.fn(); const moreClicks = vi.fn();
  const selections = vi.fn((row, index) => {
    const move = () => {
      const sourceId = options.explicitSource ?? `source-${index}`;
      const path = options.selection === 'same' ? view.__qaLocation.pathname :
        options.selection === 'invalid' ? '/settings' : `/sessions/${sourceId}`;
      view.history[options.historyMethod ?? 'pushState'](null, '', path);
      rows.forEach((node) => node.classList.toggle('cur', node === row));
    };
    if (options.selection === 'none') return;
    if (options.currentNoRoute && index === options.currentRow) return;
    if (options.selection === 'late') view.setTimeout(move, 0); else move();
  });
  rows.forEach((row, index) => {
    row.classList.toggle('cur', index === options.currentRow);
    originals[index].forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation(); nativeAction(button.textContent);
    }));
    row.addEventListener('click', () => selections(row, index));
    row.querySelector('.kb').addEventListener('click', (event) => {
      event.stopPropagation(); moreClicks(row);
      const menu = row.querySelector('.kmenu');
      if (menu) menu.remove(); else row.append(menus[index]);
    });
  });
  const close = vi.fn(); root.querySelector('.sheet-grab').addEventListener('click', close);
  return { root, rows, menus, originals, selections, nativeAction, moreClicks, close };
}

function install(options = {}) {
  const frame = document.createElement('iframe'); document.body.append(frame); frames.push(frame);
  const view = frame.contentWindow; const doc = view.document;
  doc.documentElement.lang = 'zh';
  doc.body.innerHTML = '<div class="app mobile"><div class="topbar"><button class="tb-main">Sessions</button></div>' +
    '<div class="con"><div class="chat-scroll"></div><div class="sc-body"></div><div class="composer"></div></div></div>';
  const location = Object.assign(new URL(options.path ?? '/sessions/current?draft=keep#fixture', 'https://fixture.invalid'),
    { reload: vi.fn() });
  view.__qaLocation = location;
  const history = ['pushState', 'replaceState'].map((method) => vi.spyOn(view.history, method)
    .mockImplementation((_, __, path) => { location.href = new URL(path, location.href).href; }));
  const values = new Map(Object.entries(options.stored ?? {}));
  const store = Object.fromEntries(['getItem', 'setItem', 'removeItem'].map((method) => [method, vi.fn((key, value) => {
    if (options.storageFails) throw failure('storage');
    if (method === 'getItem') return values.get(key) ?? null;
    if (method === 'setItem') values.set(key, String(value)); else values.delete(key);
  })]));
  Object.defineProperty(view, 'sessionStorage', { value: store });
  const paints = []; view.requestAnimationFrame = vi.fn((callback) => { paints.push(callback); return paints.length; });
  const localeListeners = []; const apiListeners = []; const mediaListeners = [];
  const locale = { value: options.locale ?? 'en' };
  view.__okwLocale = { text: (zh, en) => locale.value === 'zh' ? zh : en,
    observe: vi.fn((listener) => localeListeners.push(listener)) };
  const media = { matches: options.mobile !== false, addEventListener: vi.fn((_, fn) => mediaListeners.push(fn)) };
  view.matchMedia = vi.fn(() => media); view.alert = vi.fn();
  let pins = [...(options.pins ?? [])]; const records = new Map(Object.entries(options.records ?? {}));
  const notify = () => apiListeners.forEach((listener) => listener());
  const routeId = () => /^\/sessions\/([a-zA-Z0-9_-]+)\/?$/.exec(location.pathname)?.[1] ?? null;
  const api = { validId: (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,256}$/.test(id),
    routeId, routeSupported: () => location.pathname === '/' || Boolean(routeId()), hasUploads: vi.fn(() => false),
    pins: vi.fn(() => { if (options.pinsFail) throw failure('storage'); return [...pins]; }),
    record: vi.fn((id) => records.get(id)), observe: vi.fn((listener) => apiListeners.push(listener)),
    read: vi.fn(async (id) => {
      const record = options.read ? await options.read(id) : projection(id); records.set(id, record); return record;
    }),
    fork: vi.fn(async () => ({ id: 'child-1' })),
    navigate: vi.fn((id) => view.history.pushState(null, '', `/sessions/${id}${location.search}${location.hash}`)),
    setPinned: vi.fn((id, enabled) => {
      if (options.pinFailure) throw options.pinFailure;
      pins = enabled ? [...new Set([...pins, id])] : pins.filter((value) => value !== id); notify();
    }),
    failure: vi.fn((error) => view.__okwLocale.text(`操作失败：${error.code}`, `Action failed: ${error.code}`)),
  };
  view.__okwSessionActions = api;
  const mount = () => { doc.body.insertAdjacentHTML('beforeend', sheetMarkup(options.flat));
    return wireSheet(view, doc.body.lastElementChild, options); };
  let native = options.withSheet === false ? null : mount();
  const open = vi.fn(() => { native = mount(); }); doc.querySelector('.tb-main').addEventListener('click', open);
  const state = watchMutations(view);
  const evaluate = () => view.eval(`((location) => { ${source}\n})(window.__qaLocation)`); evaluate();
  return { view, doc, frame, location, history, store, values, api, records, state, open, evaluate, notify,
    get native() { return native; },
    action: (row, action) => row.querySelector(`[data-okw-session-action="${action}"]`),
    pinned: (id) => doc.querySelector(`[data-okw-pinned-session-id="${id}"]`),
    resize: (matches) => { media.matches = matches; mediaListeners.forEach((listener) => listener()); },
    language: (value) => { locale.value = value; localeListeners.forEach((listener) => listener()); },
    pins: (ids) => { pins = [...ids]; notify(); },
    paint: async () => { paints.splice(0).forEach((callback) => callback(0)); await tick(); },
  };
}

async function settled(ui) {
  await tick(); const calls = ui.state.calls; await tick();
  expect(ui.state.stopped).toBe(false); expect(ui.state.calls).toBe(calls);
}
const key = (ui, node, value) => {
  const event = new ui.view.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true });
  node.dispatchEvent(event); return event;
};
function uploading(ui, mode) {
  if (mode === 'api') ui.api.hasUploads.mockReturnValue(true);
  else ui.doc.querySelector('.composer').innerHTML = mode === 'uploading'
    ? '<span class="uploading">Preparing</span>' : '<span aria-busy="true">Preparing</span>';
}
afterEach(() => {
  states.splice(0).flatMap((state) => state.observers).forEach((observer) => observer.disconnect());
  frames.splice(0).forEach((frame) => frame.remove()); vi.restoreAllMocks();
});

describe('native mobile session menus', () => {
  it.each([false, true])('preserves native nodes and listeners in flat=%s lists', async (flat) => {
    const ui = install({ flat }); const { root, rows, menus, originals, nativeAction } = ui.native;
    ui.notify(); await settled(ui);
    rows.forEach((row, index) => {
      expect(row.querySelector('.kmenu')).toBe(menus[index]);
      expect([...menus[index].children].slice(2)).toEqual(originals[index]);
      expect([...menus[index].querySelectorAll('[data-okw-session-action]')].map((node) => node.textContent))
        .toEqual(['Fork', 'Pin']); originals[index].forEach((button) => button.click());
    });
    expect(root.querySelectorAll('.srow')).toHaveLength(2); expect(nativeAction).toHaveBeenCalledTimes(6);
    expect(ui.native.selections).not.toHaveBeenCalled(); expect(ui.api.fork).not.toHaveBeenCalled();
  });
  it('leaves workspace menus, native actions and settings sheets alone', async () => {
    const ui = install(); const workspace = ui.doc.querySelector('.wsmenu'); const html = workspace.outerHTML;
    const actions = ui.native.root.querySelector('.actions').outerHTML;
    ui.doc.body.insertAdjacentHTML('beforeend', `<div class="sheet-root settings"><div class="sheet-body">
      <div class="mlist">${rowMarkup}</div></div></div>`);
    await settled(ui);
    expect(workspace.outerHTML).toBe(html); expect(ui.native.root.querySelector('.actions').outerHTML).toBe(actions);
    expect(ui.doc.querySelector('.settings [data-okw-session-action]')).toBeNull();
  });
  it('updates mounted native and pinned menus from same-tab shared locale changes', async () => {
    const ui = install({ pins: ['pin-1'], records: { 'pin-1': projection('pin-1') } });
    const row = ui.native.rows[0]; const own = ui.pinned('pin-1'); own.querySelector('.kb').click();
    const unpin = ui.action(own, 'pin'); ui.language('zh'); await settled(ui);
    expect(unpin.textContent).toBe('取消置顶'); expect(ui.doc.querySelector('h3').textContent).toBe('已置顶');
    expect(own.querySelector('.kb').getAttribute('aria-label')).toBe('会话选项');
    row.querySelector('.kb').click(); await settled(ui); const fork = ui.action(row, 'fork');
    expect(fork.textContent).toBe('分叉'); expect(fork.getAttribute('aria-label')).toBe('分叉');
    expect(ui.action(row, 'pin').textContent).toBe('置顶'); ui.language('en'); await settled(ui);
    expect(ui.action(row, 'fork')).toBe(fork); expect(fork.textContent).toBe('Fork');
    own.querySelector('.kb').click(); expect(ui.action(own, 'pin').textContent).toBe('Unpin');
    expect(ui.doc.querySelector('h3').textContent).toBe('Pinned'); expect(ui.api.read).not.toHaveBeenCalled();
  });
});

describe('exact native row identity', () => {
  it.each(['pushState', 'replaceState'])('uses selected history.%s, not duplicate titles or ages', async (method) => {
    const ui = install({ historyMethod: method }); const [, row] = ui.native.rows;
    ui.api.fork.mockImplementationOnce(async (id) => {
      expect(id).toBe('source-1'); expect(ui.location.pathname).toBe('/sessions/source-1');
      expect(ui.native.selections).toHaveBeenCalledExactlyOnceWith(row, 1); return { id: 'child-1' };
    });
    ui.action(row, 'fork').click(); await settled(ui);
    expect(ui.api.fork).toHaveBeenCalledExactlyOnceWith('source-1');
    expect(ui.view.history.pushState).toBe(ui.history[0]); expect(ui.view.history.replaceState).toBe(ui.history[1]);
  });
  it('selects a .cur row and retains prior only when its native click leaves the route unchanged', async () => {
    const ui = install({ currentRow: 0, currentNoRoute: true, path: '/sessions/route-only-id' });
    ui.action(ui.native.rows[0], 'fork').click(); await settled(ui);
    expect(ui.api.fork).toHaveBeenCalledExactlyOnceWith('route-only-id');
    expect(ui.native.selections).toHaveBeenCalledExactlyOnceWith(ui.native.rows[0], 0);
  });
  it('uses .cur native selection A for both fork and pin while a cold navigation URL still names B', async () => {
    const ui = install({ currentRow: 0, explicitSource: 'source-A', path: '/sessions/cold-B' }); const [row] = ui.native.rows;
    ui.action(row, 'fork').click(); await settled(ui);
    expect(ui.api.fork).toHaveBeenCalledExactlyOnceWith('source-A');
    ui.location.pathname = '/sessions/cold-B'; ui.action(row, 'pin').click();
    expect(ui.location.pathname).toBe('/sessions/source-A'); expect(ui.api.setPinned).not.toHaveBeenCalled();
    await ui.paint(); await settled(ui); expect(ui.api.setPinned).toHaveBeenCalledExactlyOnceWith('source-A', true);
    expect(ui.native.selections).toHaveBeenCalledTimes(2); expect(ui.view.alert).not.toHaveBeenCalled();
  });
  it.each(['none', 'same', 'late', 'invalid'])('rejects unverified %s selection without an action', async (selection) => {
    const ui = install({ selection }); ui.action(ui.native.rows[1], 'fork').click(); await settled(ui);
    expect(ui.api.fork).not.toHaveBeenCalled(); expect(ui.api.setPinned).not.toHaveBeenCalled();
    expect(ui.api.navigate).not.toHaveBeenCalled(); expect(ui.location.reload).not.toHaveBeenCalled();
    expect(ui.view.alert).toHaveBeenCalledExactlyOnceWith('Action failed: identity');
    expect(ui.view.history.pushState).toBe(ui.history[0]); expect(ui.view.history.replaceState).toBe(ui.history[1]);
  });
  it('rejects unsupported routes and detached native rows before selecting anything', async () => {
    const unsupported = install({ path: '/devices/fixture/sessions/current' });
    const detached = install(); const button = detached.action(detached.native.rows[0], 'fork');
    detached.native.root.remove(); button.click(); unsupported.action(unsupported.native.rows[0], 'pin').click();
    for (const ui of [unsupported, detached]) {
      await settled(ui); expect(ui.native.selections).not.toHaveBeenCalled(); expect(ui.api.fork).not.toHaveBeenCalled();
      expect(ui.api.setPinned).not.toHaveBeenCalled(); expect(ui.view.alert).toHaveBeenCalledWith('Action failed: identity');
    }
  });
});

describe('fork lifecycle', () => {
  it('navigates to the verified child and closes the sheet without changing the source or preferences', async () => {
    const original = Object.freeze(projection('source-0')); const before = { ...original };
    const ui = install({ records: { 'source-0': original } }); const [row] = ui.native.rows;
    const title = row.querySelector('.t'); const originalText = title.textContent;
    ui.action(row, 'fork').click(); await settled(ui);
    expect(ui.api.navigate).toHaveBeenCalledExactlyOnceWith('child-1'); expect(ui.native.close).toHaveBeenCalledOnce();
    expect(ui.location.pathname).toBe('/sessions/child-1'); expect(ui.records.get('source-0')).toEqual(before);
    expect(row.querySelector('.t')).toBe(title); expect(title.textContent).toBe(originalText);
    expect(ui.api.setPinned).not.toHaveBeenCalled(); expect(ui.store.setItem).not.toHaveBeenCalled();
  });
  it('disables all actions and suppresses repeated or competing clicks until the pending fork settles', async () => {
    const result = deferred(); const ui = install(); const [first, other] = ui.native.rows;
    ui.api.fork.mockReturnValueOnce(result.promise); const fork = ui.action(first, 'fork'); fork.click();
    for (const button of [fork, ui.action(other, 'pin'), ui.action(other, 'fork')]) {
      expect(button.disabled).toBe(true); button.dispatchEvent(new ui.view.Event('click', { bubbles: true }));
    }
    expect(ui.api.fork).toHaveBeenCalledOnce(); expect(ui.api.setPinned).not.toHaveBeenCalled();
    expect(ui.api.navigate).not.toHaveBeenCalled(); result.resolve({ id: 'child-1' }); await settled(ui);
    expect(fork.disabled).toBe(false); expect(ui.api.navigate).toHaveBeenCalledOnce();
    expect(ui.native.close).toHaveBeenCalledOnce();
  });
  it('shows the API failure without retry or navigation, then releases the pending guard for an explicit retry', async () => {
    const ui = install(); const error = failure('occupied'); ui.api.fork.mockRejectedValueOnce(error);
    const fork = ui.action(ui.native.rows[0], 'fork'); fork.click(); await settled(ui);
    expect(ui.api.failure).toHaveBeenCalledExactlyOnceWith(error);
    expect(ui.view.alert).toHaveBeenCalledWith('Action failed: occupied');
    expect(ui.api.fork).toHaveBeenCalledOnce(); expect(ui.api.navigate).not.toHaveBeenCalled();
    expect(ui.native.close).not.toHaveBeenCalled(); expect(ui.store.setItem).not.toHaveBeenCalled();
    expect(ui.location.reload).not.toHaveBeenCalled(); expect(fork.disabled).toBe(false);
    fork.click(); await settled(ui); expect(ui.api.fork).toHaveBeenCalledTimes(2); expect(ui.api.navigate).toHaveBeenCalledOnce();
  });
});

describe('pin actions and native reload', () => {
  it('shows Pin for an unknown native row and enables its ID only after the paint and timer check', async () => {
    const ui = install({ pins: ['source-0'], records: { 'source-0': projection('source-0') } });
    const pin = ui.action(ui.native.rows[0], 'pin'); expect(pin.textContent).toBe('Pin'); pin.click();
    expect(ui.api.setPinned).not.toHaveBeenCalled(); expect(ui.values.has(resumeKey)).toBe(false);
    expect(ui.location.reload).not.toHaveBeenCalled(); await ui.paint(); await settled(ui);
    expect(ui.api.setPinned).toHaveBeenCalledExactlyOnceWith('source-0', true);
    expect(ui.values.get(resumeKey)).toBe('1'); expect(ui.location.reload).toHaveBeenCalledOnce();
  });
  it('uses the pinned projection ID to Unpin with enabled=false without selecting the native row', async () => {
    const ui = install({ pins: ['pin-1'], records: { 'pin-1': projection('pin-1') } });
    const own = ui.pinned('pin-1'); own.querySelector('.kb').click();
    expect(ui.action(own, 'pin').textContent).toBe('Unpin'); ui.action(own, 'pin').click();
    expect(ui.api.setPinned).not.toHaveBeenCalled(); expect(ui.pinned('pin-1')).toBe(own);
    await ui.paint(); await settled(ui); expect(ui.api.setPinned).toHaveBeenCalledExactlyOnceWith('pin-1', false);
    expect(ui.native.selections).not.toHaveBeenCalled(); expect(ui.pinned('pin-1')).toBeNull();
    expect(ui.location.reload).toHaveBeenCalledOnce();
  });
  it('consumes the reload restoration flag and opens the native list once after the composer is present', async () => {
    const first = install(); first.action(first.native.rows[0], 'pin').click(); await first.paint(); await settled(first);
    const next = install({ withSheet: false, stored: Object.fromEntries(first.values) }); await settled(next);
    expect(next.open).toHaveBeenCalledOnce(); expect(next.values.has(resumeKey)).toBe(false);
    expect(next.native.root.querySelector('.mlist')).not.toBeNull(); next.notify(); next.resize(true); await settled(next);
    expect(next.open).toHaveBeenCalledOnce(); expect(next.store.removeItem).toHaveBeenCalledExactlyOnceWith(resumeKey);
  });
  it('handles unreadable pin storage and reports a failed pin write without reloading or saving a restoration flag', async () => {
    const error = failure('storage'); const ui = install({ pinsFail: true, pinFailure: error });
    expect(ui.doc.querySelector('.okw-mobile-session-pins')).toBeNull();
    ui.action(ui.native.rows[0], 'pin').click(); await ui.paint(); await settled(ui);
    expect(ui.api.setPinned).toHaveBeenCalledExactlyOnceWith('source-0', true);
    expect(ui.api.failure).toHaveBeenCalledExactlyOnceWith(error);
    expect(ui.view.alert).toHaveBeenCalledWith('Action failed: storage');
    expect(ui.location.reload).not.toHaveBeenCalled(); expect(ui.store.setItem).not.toHaveBeenCalled();
  });
  it('still reloads a successfully saved pin when optional sessionStorage is unavailable', async () => {
    const ui = install({ storageFails: true }); ui.action(ui.native.rows[0], 'pin').click(); await ui.paint(); await settled(ui);
    expect(ui.api.setPinned).toHaveBeenCalledExactlyOnceWith('source-0', true);
    expect(ui.location.reload).toHaveBeenCalledOnce(); expect(ui.view.alert).not.toHaveBeenCalled();
  });
  it('blocks pin and unpin before selection or delayed writes when API or composer uploads are preparing', async () => {
    for (const mode of ['api', 'uploading', 'busy']) {
      for (const duringWait of [false, true]) {
        const ui = install({ pins: ['pin-1'], records: { 'pin-1': projection('pin-1') } }); const [row] = ui.native.rows;
        if (duringWait) ui.action(row, 'pin').click();
        uploading(ui, mode);
        if (!duringWait) ui.action(row, 'pin').click();
        await ui.paint(); await settled(ui);
        expect(ui.native.selections).toHaveBeenCalledTimes(duringWait ? 1 : 0);
        expect(ui.api.setPinned).not.toHaveBeenCalled(); expect(ui.location.reload).not.toHaveBeenCalled();
        expect(ui.store.setItem).not.toHaveBeenCalled(); expect(ui.view.alert).toHaveBeenCalledWith('Action failed: uploading');
        const own = ui.pinned('pin-1'); own.querySelector('.kb').click();
        ui.api.hasUploads.mockReturnValue(false); ui.doc.querySelector('.composer').replaceChildren();
        if (duringWait) ui.action(own, 'pin').click();
        uploading(ui, mode);
        if (!duringWait) ui.action(own, 'pin').click();
        await ui.paint(); await settled(ui);
        expect(ui.api.setPinned).not.toHaveBeenCalled(); expect(ui.location.reload).not.toHaveBeenCalled();
        expect(ui.store.setItem).not.toHaveBeenCalled(); expect(ui.pinned('pin-1')).toBe(own);
        expect(ui.view.alert).toHaveBeenCalledTimes(2);
      }
    }
  });
});

describe('visible pinned session projections', () => {
  it('renders cached title and cwd as text above the native list in pin order without additional reads', async () => {
    const record = { id: 'pin-1', title: '<img src=x> fixture', cwd: '/fixture/<b>project</b>' };
    const ui = install({ pins: ['pin-2', 'pin-1'], records: { 'pin-1': record, 'pin-2': projection('pin-2') } });
    const section = ui.doc.querySelector('.okw-mobile-session-pins');
    expect(section.nextElementSibling).toBe(ui.native.root.querySelector('.mlist'));
    expect([...section.querySelectorAll('.okw-pinned-session')].map((row) => row.dataset.okwPinnedSessionId))
      .toEqual(['pin-2', 'pin-1']);
    expect(ui.pinned('pin-1').querySelector('.okw-pinned-session-title').textContent).toBe(record.title);
    expect(ui.pinned('pin-1').querySelector('.okw-pinned-session-cwd').textContent).toBe(record.cwd);
    expect(section.querySelector('img, b')).toBeNull(); expect(ui.api.read).not.toHaveBeenCalled(); await settled(ui);
  });
  it('reads only missing IDs on demand and deduplicates pending reads across refreshes', async () => {
    const read = deferred(); const ui = install({ pins: ['cached', 'missing'], records: { cached: projection('cached') },
      read: () => read.promise });
    expect(ui.pinned('missing').querySelector('.okw-pinned-session-title').textContent).toBe('Loading…');
    for (let index = 0; index < 4; index += 1) { ui.notify(); ui.resize(true); await tick(); }
    expect(ui.api.read).toHaveBeenCalledExactlyOnceWith('missing'); read.resolve(projection('missing')); await settled(ui);
    expect(ui.pinned('missing').querySelector('.okw-pinned-session-title').textContent).toBe('Title missing');
    ui.records.set('cached', { ...projection('cached'), title: 'Updated projection' }); ui.notify(); await settled(ui);
    expect(ui.pinned('cached').querySelector('.okw-pinned-session-title').textContent).toBe('Updated projection');
    expect(ui.api.read).toHaveBeenCalledOnce();
  });
  it('keeps unavailable pins removable without a read storm or automatic failure alerts', async () => {
    const ui = install({ pins: ['missing'], read: async () => { throw failure('unavailable'); } }); await settled(ui);
    const row = ui.pinned('missing'); expect(row.textContent).toContain('Session unavailable');
    for (let index = 0; index < 4; index += 1) { ui.notify(); ui.resize(true); await tick(); }
    ui.language('zh'); expect(row.textContent).toContain('会话不可用'); expect(ui.api.read).toHaveBeenCalledOnce();
    row.querySelector('.kb').click(); ui.action(row, 'pin').click(); await ui.paint(); await settled(ui);
    expect(ui.api.setPinned).toHaveBeenCalledExactlyOnceWith('missing', false); expect(ui.view.alert).not.toHaveBeenCalled();
    expect(ui.pinned('missing')).toBeNull();
  });
  it('updates added, reordered and removed pin IDs without moving or recreating retained native rows', async () => {
    const ui = install({ pins: ['pin-1'], records: { 'pin-1': projection('pin-1'), 'pin-2': projection('pin-2') } });
    const own = ui.pinned('pin-1'); const nativeRows = ui.native.rows;
    ui.pins(['pin-2', 'pin-1']); await settled(ui);
    expect(ui.pinned('pin-1')).toBe(own); expect(own.style.order).toBe('1'); expect(ui.pinned('pin-2').style.order).toBe('0');
    ui.pins([]); await settled(ui); expect(ui.doc.querySelector('.okw-mobile-session-pins')).toBeNull();
    expect([...ui.native.root.querySelectorAll('.srow')]).toEqual(nativeRows); expect(ui.store.setItem).not.toHaveBeenCalled();
  });
  it('removes only its pinned section on desktop and restores it when returning to mobile', async () => {
    const ui = install({ pins: ['pin-1'], records: { 'pin-1': projection('pin-1') } }); const rows = ui.native.rows;
    ui.resize(false); await settled(ui); expect(ui.doc.querySelector('.okw-mobile-session-pins')).toBeNull();
    expect([...ui.native.root.querySelectorAll('.srow')]).toEqual(rows);
    const desktop = install({ mobile: false, pins: ['missing'] }); expect(desktop.api.read).not.toHaveBeenCalled();
    expect(desktop.doc.querySelector('[data-okw-session-action]')).toBeNull();
    ui.resize(true); await settled(ui); expect(ui.pinned('pin-1')).not.toBeNull();
    expect(ui.api.setPinned).not.toHaveBeenCalled();
  });
});

describe('pinned menu interaction and keyboard boundaries', () => {
  it('opens one menu at a time, toggles aria-expanded and closes it on a second click or outside click', async () => {
    const ui = install({ pins: ['pin-1', 'pin-2'], records: { 'pin-1': projection('pin-1'), 'pin-2': projection('pin-2') } });
    const first = ui.pinned('pin-1').querySelector('.kb'); const second = ui.pinned('pin-2').querySelector('.kb');
    first.click(); expect(first.getAttribute('aria-expanded')).toBe('true');
    second.click(); expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(second.getAttribute('aria-expanded')).toBe('true'); second.click();
    expect(second.getAttribute('aria-expanded')).toBe('false'); first.click(); ui.doc.querySelector('.sheet-scrim').click();
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(ui.doc.querySelector('.okw-pinned-session > .kmenu')).toBeNull(); await settled(ui);
  });
  it('closes native menus through their more listeners and excludes pinned menus in both directions', async () => {
    const ui = install({ pins: ['pin-1'], records: { 'pin-1': projection('pin-1') } });
    const { rows, menus, originals, moreClicks, nativeAction } = ui.native; const more = rows[0].querySelector('.kb');
    const pinnedMore = ui.pinned('pin-1').querySelector('.kb'); pinnedMore.click(); await settled(ui);
    expect(moreClicks.mock.calls.map(([row]) => row)).toEqual(rows);
    expect(rows.every((row) => !row.querySelector('.kmenu'))).toBe(true);
    more.click(); await settled(ui); expect(rows[0].querySelector('.kmenu')).toBe(menus[0]);
    expect(pinnedMore.getAttribute('aria-expanded')).toBe('false'); expect(ui.pinned('pin-1').querySelector('.kmenu')).toBeNull();
    originals[0][0].click(); expect(nativeAction).toHaveBeenCalledExactlyOnceWith('Rename');
    pinnedMore.click(); await settled(ui); expect(rows[0].querySelector('.kmenu')).toBeNull();
    expect(moreClicks).toHaveBeenCalledTimes(4); expect(pinnedMore.getAttribute('aria-expanded')).toBe('true');
    expect(ui.native.selections).not.toHaveBeenCalled();
  });
  it('closes pinned and native menus on Escape, restores focus and keeps menu keys away from native shortcuts', async () => {
    const ui = install({ pins: ['pin-1'], records: { 'pin-1': projection('pin-1') } });
    const shortcut = vi.fn(); ui.doc.addEventListener('keydown', shortcut);
    const own = ui.pinned('pin-1'); const more = own.querySelector('.kb'); more.click();
    const fork = ui.action(own, 'fork'); fork.focus(); expect(key(ui, fork, 'Escape').defaultPrevented).toBe(true);
    expect(own.querySelector('.kmenu')).toBeNull(); expect(ui.doc.activeElement).toBe(more);
    const row = ui.native.rows[0]; row.querySelector('.kb').click(); await settled(ui);
    key(ui, ui.action(row, 'pin'), 'Escape');
    expect(row.querySelector('.kmenu')).toBeNull(); expect(ui.doc.activeElement).toBe(row.querySelector('.kb'));
    expect(shortcut).not.toHaveBeenCalled(); expect(ui.api.fork).not.toHaveBeenCalled(); await settled(ui);
  });
  it('preserves Enter button activation and implements Space on pinned links without duplicate actions', async () => {
    const ui = install({ pins: ['pin-1'], records: { 'pin-1': projection('pin-1') } }); const own = ui.pinned('pin-1');
    const more = own.querySelector('.kb'); expect(key(ui, more, 'Enter').defaultPrevented).toBe(false);
    more.click(); const fork = ui.action(own, 'fork'); expect(key(ui, fork, 'Enter').defaultPrevented).toBe(false);
    expect(ui.api.fork).not.toHaveBeenCalled(); fork.click(); await settled(ui);
    expect(ui.api.fork).toHaveBeenCalledExactlyOnceWith('pin-1');
    expect(key(ui, own.querySelector('a'), ' ').defaultPrevented).toBe(true);
    expect(ui.api.navigate.mock.calls).toEqual([['child-1'], ['pin-1']]); expect(ui.native.close).toHaveBeenCalledTimes(2);
  });
  it('supports arrow focus within the pinned menu without trapping normal Tab behavior', async () => {
    const ui = install({ pins: ['pin-1'], records: { 'pin-1': projection('pin-1') } }); const own = ui.pinned('pin-1');
    const more = own.querySelector('.kb'); more.click(); key(ui, more, 'ArrowDown');
    expect(ui.doc.activeElement).toBe(ui.action(own, 'fork')); key(ui, ui.doc.activeElement, 'ArrowDown');
    expect(ui.doc.activeElement).toBe(ui.action(own, 'pin')); key(ui, ui.doc.activeElement, 'ArrowUp');
    expect(ui.doc.activeElement).toBe(ui.action(own, 'fork'));
    expect(key(ui, ui.doc.activeElement, 'Tab').defaultPrevented).toBe(false); await settled(ui);
  });
});

describe('observer scope, reinstallation and mobile CSS', () => {
  it('converges after real menu mutations and attaches replacement sheets without reviving detached ones', async () => {
    const ui = install(); await settled(ui); const row = ui.native.rows[0]; const more = row.querySelector('.kb');
    more.click(); await settled(ui); more.click(); await settled(ui);
    expect(row.querySelectorAll('[data-okw-session-action]')).toHaveLength(2);
    ui.native.root.remove(); await settled(ui); ui.doc.querySelector('.tb-main').click(); await settled(ui);
    expect(ui.native.root.querySelectorAll('[data-okw-session-action]')).toHaveLength(4);
    expect(row.isConnected).toBe(false);
  });
  it('does not scan all sheets or menus when main chat, side chat and composer contents stream', async () => {
    const ui = install(); await settled(ui);
    const targets = ['.chat-scroll', '.sc-body', '.composer'].map((selector) => ui.doc.querySelector(selector));
    const globalScan = vi.spyOn(ui.doc, 'querySelectorAll'); const root = ui.native.root;
    const listScan = vi.spyOn(root, 'querySelector'); const menuScan = vi.spyOn(root, 'querySelectorAll');
    for (let batch = 0; batch < 12; batch += 1) {
      targets.forEach((node) => node.insertAdjacentHTML('beforeend', `<div>${'Stream '.repeat(200)}</div>`)); await tick();
    }
    expect(globalScan).not.toHaveBeenCalled(); expect(listScan).not.toHaveBeenCalled(); expect(menuScan).not.toHaveBeenCalled();
    await settled(ui);
  });
  it('installs observers and listeners only once even when the same script is evaluated repeatedly', async () => {
    const ui = install(); const count = ui.state.observers.length; ui.evaluate(); ui.evaluate(); ui.notify(); await settled(ui);
    expect(ui.state.observers).toHaveLength(count); expect(ui.api.observe).toHaveBeenCalledOnce();
    expect(ui.view.__okwLocale.observe).toHaveBeenCalledOnce(); expect(ui.view.matchMedia).toHaveBeenCalledOnce();
    expect(ui.native.root.querySelectorAll('[data-okw-session-action]')).toHaveLength(4);
    ui.action(ui.native.rows[0], 'fork').click(); await settled(ui); expect(ui.api.fork).toHaveBeenCalledOnce();
  });
  it.each([0, 9])('clamps short-screen menus with a %spx containing-block inset and 44px targets', async (inset) => {
    const ui = install(); const row = ui.native.rows[0]; const menu = row.querySelector('.kmenu');
    row.querySelector('.kb').getBoundingClientRect = () => ({ bottom: 180 }); menu.style.top = '0px';
    menu.getBoundingClientRect = () => ({ top: (Number.parseFloat(menu.style.top) || 0) + inset, height: 220 });
    Object.defineProperty(ui.view, 'innerHeight', { value: 200 }); ui.view.dispatchEvent(new ui.view.Event('resize'));
    expect(menu.style.top).toBe(`${8 - inset}px`); await settled(ui);
    expect(css).toMatch(/@media \(max-width: 640px\)/);
    expect(css).toMatch(/\.okw-mobile-session-menu\s*\{[^}]*max-height:[^;]*100dvh[^}]*overflow-y:\s*auto/s);
    expect(css).toMatch(/\.okw-mobile-session-action\s*\{[^}]*min-height:\s*44px/s);
    expect(css).toMatch(/\.okw-pinned-session-more\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/s);
    for (const token of ['--color-menu-bg', '--color-text', '--color-accent', '--color-line']) {
      expect(css).toContain(`var(${token}`);
    }
    expect(css).not.toMatch(/#[\da-f]{3,8}\b|!important/i);
  });
});
