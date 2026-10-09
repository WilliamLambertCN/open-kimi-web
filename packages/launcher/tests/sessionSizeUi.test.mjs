/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
const source = readFileSync(resolve('packages/launcher/src/mobile/sessionSize.js'), 'utf8');
const presentation = readFileSync(resolve('packages/launcher/src/mobile/presentation.js'), 'utf8');
const css = readFileSync(resolve('packages/launcher/src/mobile/sessionSize.css'), 'utf8');
const instances = [];
const settle = async () => { for (let pass = 0; pass < 24; pass += 1) await Promise.resolve(); };
const response = (body, ok = true) => ({ ok, json: async () => body, clone: () => response(body, ok) });
const measured = (bytes) => response({ available: true, bytes });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const topbar = (withStatus = true) => `<div class="topbar"><div class="tb-main"><span class="dir">Demo</span>
  <span class="okw-workspace-status"><span class="okw-workspace-summary">空闲</span></span></div>
  ${withStatus ? '<span class="st">空闲</span>' : ''}</div>`;
const desktopHeader = () => `<div class="chat-header" style="height:48px;padding:0 52px 0 78px">
  <div class="ch-id"><span class="ch-ws">Demo</span><span class="ch-sep">/</span>
    <span class="ui-tip"><span class="ch-ses">${'Long title '.repeat(20)}</span></span></div>
  <button class="ch-more">More</button><div class="ui-menu"></div><div class="ch-spacer"></div>
  <button class="ch-git">Branch</button><button class="ch-pr">PR</button>
  <div class="ch-toggles"><button>Terminal</button></div></div>`;
const nativeMount = (mobile, empty, withStatus) => mobile ? topbar(withStatus)
  : empty ? '<div class="empty-drag"></div><div class="empty-toggles"><button>Panel</button></div>' : desktopHeader();
function switchDom(doc, mobile, empty, withStatus) {
  const app = doc.querySelector('.app');
  const con = app.querySelector(':scope > .con');
  app.classList.toggle('mobile', mobile);
  app.querySelector(':scope > .topbar')?.remove();
  con.querySelectorAll(':scope > .chat-header, :scope > .empty-drag, :scope > .empty-toggles').forEach((node) => node.remove());
  (mobile ? app : con).insertAdjacentHTML('afterbegin', nativeMount(mobile, empty, withStatus));
}
function protectObservers(view) {
  const state = { callbacks: 0, exceeded: false, observers: [] };
  const Native = view.MutationObserver;
  view.MutationObserver = class MutationObserver {
    constructor(callback) {
      const observer = new Native((records) => {
        state.callbacks += 1;
        if (state.callbacks > 250) {
          state.exceeded = true;
          state.observers.forEach((item) => item.disconnect());
          return;
        }
        callback(records, observer);
      });
      state.observers.push(observer);
      return observer;
    }
  };
  return state;
}
function install(options = {}) {
  const { fetch = vi.fn(async () => measured(1024)), mobile = true, empty, integrate,
    withStatus, path = '/sessions/A' } = options;
  const header = options.header !== false;
  let hidden = options.hidden === true;
  vi.useFakeTimers();
  window.history.replaceState(null, '', path);
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const view = frame.contentWindow;
  const doc = view.document;
  const mount = header ? nativeMount(mobile, empty, withStatus) : '';
  doc.body.innerHTML = `<div id="app"><div class="app${mobile ? ' mobile' : ''}">${mobile ? mount : ''}
    <div class="con">${mobile ? '' : mount}
      <div class="panes chat-scroll history">${'<div class="a-msg"><span>Earlier</span></div>'.repeat(500)}</div>
      <div class="composer"><textarea></textarea></div></div><div class="sc"><div class="sc-body"></div></div></div></div>`;
  Object.defineProperty(doc, 'hidden', { configurable: true, get: () => hidden });
  const media = { matches: mobile, listeners: [], addEventListener: vi.fn((_name, callback) => {
    media.listeners.push(callback);
  }) };
  view.matchMedia = vi.fn(() => media);
  view.fetch = fetch;
  Object.assign(view, { Request, Response, Headers });
  view.setTimeout = window.setTimeout.bind(window);
  view.clearTimeout = window.clearTimeout.bind(window);
  const api = vi.fn(async (url, options) => {
    const result = await view.fetch(url, options);
    if (!result.ok) throw new Error('Fixture request failed');
    return result.json();
  });
  view.__okwUsageCreateApi = vi.fn(() => api);
  const history = {
    pushState: vi.fn((...args) => window.history.pushState(...args)),
    replaceState: vi.fn((...args) => window.history.replaceState(...args)),
  };
  view.__okwTestHistory = history;
  const state = protectObservers(view);
  const evaluate = (script) => view.eval(`((location, history) => { ${script}\n})({
    get href() { return window.parent.location.href; }, get pathname() { return window.parent.location.pathname; },
    get origin() { return window.parent.location.origin; }
  }, window.__okwTestHistory)`);
  if (integrate) evaluate(presentation);
  evaluate(source);
  const navigate = (next, method = 'pushState') => {
    if (method === 'popstate') {
      window.history.replaceState(null, '', next);
      view.dispatchEvent(new view.PopStateEvent('popstate'));
    } else history[method](null, '', next);
  };
  const setHidden = (value) => { hidden = value; doc.dispatchEvent(new view.Event('visibilitychange')); };
  const setMobile = (value) => {
    switchDom(doc, value, empty, withStatus);
    media.matches = value;
    media.listeners.forEach((callback) => callback());
  };
  const ui = { api, doc, evaluate, fetch, frame, history, media, navigate, setHidden, setMobile, state, view };
  instances.push(ui);
  return ui;
}
const size = (ui) => ui.doc.querySelector('.okw-session-size');
async function expectConverged(ui) {
  await settle();
  const count = ui.state.callbacks;
  await settle();
  expect(ui.state.exceeded).toBe(false);
  expect(ui.state.callbacks).toBe(count);
}
const label = (ui, value) => `${ui.media.matches ? ' · ' : ''}会话 ${value}`;
function expectMounted(ui, value = '1 KB', calls = 1) {
  expect(size(ui).textContent).toBe(label(ui, value));
  expect(ui.doc.querySelectorAll('.okw-session-size')).toHaveLength(1);
  expect(ui.api).toHaveBeenCalledTimes(calls);
  expect(vi.getTimerCount()).toBe(1);
}
function suspend(ui, reason, value) {
  if (reason === 'hidden') ui.setHidden(value);
  else if (reason === 'panel') ui.doc.querySelector('.app').classList.toggle('panel-expanded', value);
  else ui.view.dispatchEvent(new ui.view.Event(value ? 'pagehide' : 'pageshow'));
}
afterEach(() => {
  const completed = instances.splice(0);
  completed.forEach((ui) => {
    ui.view.dispatchEvent(new ui.view.Event('pagehide'));
    ui.state.observers.forEach((observer) => observer.disconnect());
    ui.frame.remove();
  });
  vi.restoreAllMocks();
  vi.useRealTimers();
  expect(completed.every((ui) => !ui.state.exceeded)).toBe(true);
});
describe('session size units and unavailable values', () => {
  it.each([
    [0, '0 B'], [1, '1 B'], [1023, '1023 B'], [1024, '1 KB'], [1234, '1.2 KB'],
    [1024 ** 2 - 52, '1023.9 KB'], [1024 ** 2 - 51, '1 MB'], [1024 ** 2 - 1, '1 MB'],
    [1024 ** 2, '1 MB'], [Math.round(1.2 * 1024 ** 2), '1.2 MB'],
    [1024 ** 3 - 52429, '1023.9 MB'], [1024 ** 3 - 52428, '1 GB'], [1024 ** 3 - 1, '1 GB'],
    [1024 ** 3, '1 GB'], [1.5 * 1024 ** 3, '1.5 GB'],
  ])('renders %s bytes as %s at binary and rounding boundaries', async (bytes, value) => {
    const ui = install({ mobile: bytes < 1024 ** 2, fetch: vi.fn(async () => measured(bytes)) });
    await expectConverged(ui);
    expectMounted(ui, value);
    if (ui.media.matches) expect(ui.doc.querySelector('.okw-workspace-summary').textContent).toBe('空闲');
  });
  it.each([
    ['missing', undefined], ['null', null], ['negative', -1], ['fractional', 1.5], ['string', '1024'],
    ['NaN', NaN], ['infinite', Infinity], ['unsafe', Number.MAX_SAFE_INTEGER + 1],
  ])('never disguises %s bytes as a valid size or zero', async (_label, bytes) => {
    const ui = install({ fetch: vi.fn(async () => measured(bytes)) });
    await expectConverged(ui);
    expect(size(ui).textContent).toBe(' · 会话 —');
    expect(size(ui).title).toContain('暂时无法计量');
  });
  it.each([
    ['unmanaged', { available: false, bytes: 0, reason: 'unmanaged_target' }, '不是受管本机后端'],
    ['unavailable', { available: false, bytes: 0 }, '暂时无法计量'],
    ['missing flag', { bytes: 0 }, '暂时无法计量'],
    ['nonboolean flag', { available: 'true', bytes: 0 }, '暂时无法计量'],
    ['empty response', null, '暂时无法计量'],
  ])('shows an explicit unknown state for %s responses', async (_label, body, note) => {
    const ui = install({ mobile: _label !== 'unmanaged', fetch: vi.fn(async () => response(body)) });
    await settle();
    expect(size(ui).textContent).toBe(label(ui, '—'));
    expect(size(ui).title).toContain(note);
  });
  it.each([['http', true], ['network', false]])('retries a %s failure with mobile=%s', async (kind, mobile) => {
    const fetch = vi.fn().mockResolvedValueOnce(measured(2048));
    if (kind === 'http') fetch.mockResolvedValueOnce(response({ error: 'private fixture detail' }, false));
    else fetch.mockRejectedValueOnce(new Error('private fixture detail'));
    fetch.mockResolvedValue(measured(4096));
    const ui = install({ fetch, mobile });
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(size(ui).textContent).toBe(label(ui, '—'));
    expect(size(ui).title).toContain('读取失败或页面授权未就绪');
    expect(size(ui).title).not.toContain('private fixture detail');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(size(ui).textContent).toBe(label(ui, '4 KB'));
    expect(fetch).toHaveBeenCalledTimes(3);
    await expectConverged(ui);
  });
  it.each([true, false])('describes loading and zero logs with mobile=%s', async (mobile) => {
    const pending = deferred();
    const ui = install({ mobile, fetch: vi.fn(() => pending.promise) });
    expect(size(ui).textContent).toBe(label(ui, '—'));
    expect(size(ui).title).toContain('正在读取');
    pending.resolve(measured(0));
    await settle();
    expect(size(ui).textContent).toBe(label(ui, '0 B'));
    for (const note of ['日志体积', '含子代理', '不含图片附件', '不是模型上下文 token 占用']) {
      expect(size(ui).title).toContain(note);
    }
    expect(size(ui).getAttribute('aria-label')).toBe(size(ui).title);
    expect(size(ui).title).not.toContain('正在读取');
  });
});
describe('session size navigation and response races', () => {
  it.each([['pushState', true], ['replaceState', false], ['popstate', false]])
    ('ignores late %s responses with mobile=%s', async (method, mobile) => {
      const old = deferred();
      const next = deferred();
      const fetch = vi.fn().mockResolvedValueOnce(measured(2048)).mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(next.promise);
      const ui = install({ fetch, mobile });
      await settle();
      expect(size(ui).textContent).toBe(label(ui, '2 KB'));
      await vi.advanceTimersByTimeAsync(10_000);
      const oldSignal = ui.api.mock.calls[1][1].signal;
      ui.navigate('/sessions/B', method);
      expect(oldSignal.aborted).toBe(true);
      expect(size(ui).textContent).toBe(label(ui, '—'));
      expect(ui.api.mock.calls[2][0]).toBe('/__open-kimi-mobile/session-size?session_id=B');
      next.resolve(measured(3 * 1024 ** 2));
      await settle();
      old.resolve(measured(999 * 1024 ** 2));
      await expectConverged(ui);
      expect(size(ui).textContent).toBe(label(ui, '3 MB'));
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(vi.getTimerCount()).toBe(1);
    });
  it('ignores a late rejected request even when navigation returns to the same session ID', async () => {
    const old = deferred();
    const fetch = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(measured(4096));
    const ui = install({ fetch });
    ui.navigate('/sessions/B');
    ui.navigate('/sessions/A', 'replaceState');
    await settle();
    old.reject(new Error('Late aborted fixture'));
    await expectConverged(ui);
    expect(ui.api.mock.calls[0][1].signal.aborted).toBe(true);
    expect(size(ui).textContent).toBe(' · 会话 4 KB');
    expect(size(ui).title).not.toContain('读取失败');
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it.each(['/workspaces/demo', '/settings', '/sessions/', '/sessions/A/files', '/sessions/%E0%A4%A'])
    ('removes size and aborts pending work outside a valid session route: %s', async (path) => {
      const pending = deferred();
      const ui = install({ fetch: vi.fn(() => pending.promise) });
      ui.navigate(path);
      expect(size(ui)).toBeNull();
      expect(ui.api.mock.calls[0][1].signal.aborted).toBe(true);
      pending.resolve(measured(1024));
      await settle();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(size(ui)).toBeNull();
      expect(ui.fetch).toHaveBeenCalledTimes(1);
    });
  it('encodes a decoded session ID and does not refetch for same-session history updates', async () => {
    const ui = install({ path: '/sessions/demo%20id?view=chat' });
    await settle();
    expect(ui.api.mock.calls[0][0]).toBe('/__open-kimi-mobile/session-size?session_id=demo%20id');
    ui.navigate('/sessions/demo%20id?view=files#tab', 'replaceState');
    await settle();
    expect(ui.fetch).toHaveBeenCalledTimes(1);
    expect(size(ui).textContent).toBe(' · 会话 1 KB');
  });
});
describe('session size request lifecycle', () => {
  it.each([true, false])('waits for visibility with mobile=%s then refreshes once', async (mobile) => {
    const ui = install({ hidden: true, mobile });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ui.fetch).not.toHaveBeenCalled();
    ui.setHidden(false);
    await expectConverged(ui);
    expect(ui.fetch).toHaveBeenCalledTimes(1);
    expect(size(ui).textContent).toBe(label(ui, '1 KB'));
  });
  it.each([['hidden', true], ['hidden', false], ['panel', false], ['pagehide', false]])
    ('stops on %s with mobile=%s and recovers once', async (reason, mobile) => {
      const ui = install({ mobile });
      await settle();
      suspend(ui, reason, true);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(ui.fetch).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      if (reason === 'pagehide') { size(ui).remove(); await settle(); }
      expect(ui.fetch).toHaveBeenCalledTimes(1);
      suspend(ui, reason, false);
      await expectConverged(ui);
      expect(ui.fetch).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(1);
    });
  it.each([['hidden', true], ['hidden', false], ['panel', false], ['pagehide', false]])
    ('ignores an aborted %s response with mobile=%s', async (reason, mobile) => {
      const old = deferred();
      const next = deferred();
      const ui = install({ mobile, fetch: vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise) });
      const oldSignal = ui.api.mock.calls[0][1].signal;
      suspend(ui, reason, true);
      await settle();
      expect(oldSignal.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(ui.fetch).toHaveBeenCalledTimes(1);
      suspend(ui, reason, false);
      await settle();
      next.resolve(measured(2048));
      await settle();
      old.resolve(measured(4096));
      await expectConverged(ui);
      expect(size(ui).textContent).toBe(label(ui, '2 KB'));
      expect(ui.fetch).toHaveBeenCalledTimes(2);
    });
  it('shares one in-flight request and one 10s timer across actual 640/641 DOM switches', async () => {
    const slow = deferred();
    const fetch = vi.fn().mockReturnValueOnce(slow.promise).mockResolvedValue(measured(1024));
    const ui = install({ fetch });
    const node = size(ui);
    const signal = ui.api.mock.calls[0][1].signal;
    for (const mobile of [false, true, false]) { ui.setMobile(mobile); await expectConverged(ui); }
    expect(size(ui)).toBe(node);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    slow.resolve(measured(1024));
    await settle();
    const title = ui.doc.querySelector('.ch-ses');
    for (let batch = 0; batch < 20; batch += 1) { title.textContent = `Title ${batch}`; await settle(); }
    ui.setMobile(true);
    await expectConverged(ui);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(ui.doc.querySelectorAll('.okw-session-size')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(9999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(vi.getTimerCount()).toBe(1);
  });
});
describe('session size native mounts and observer scope', () => {
  it('lets presentation supply a mount only after the official mobile topbar appears', async () => {
    const ui = install({ header: false, integrate: true });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(ui.fetch).not.toHaveBeenCalled();
    ui.doc.querySelector('.app').insertAdjacentHTML('afterbegin', `<div class="topbar"><div class="tb-main">
      <span class="dir">Demo</span></div><span class="st">空闲</span></div>`);
    await expectConverged(ui);
    expect(ui.doc.querySelector('.okw-workspace-summary').textContent).toBe('空闲');
    expect(size(ui).textContent).toBe(' · 会话 1 KB');
  });
  it.each([true, false])('cancels a missing native header request and remounts with mobile=%s', async (mobile) => {
    const pending = deferred();
    const ui = install({ mobile, fetch: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(measured(1024)) });
    size(ui).parentElement.closest('.topbar, .chat-header').remove();
    await settle();
    expect(ui.api.mock.calls[0][1].signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(vi.getTimerCount()).toBe(0);
    switchDom(ui.doc, mobile);
    pending.resolve(measured(9999));
    await expectConverged(ui);
    expectMounted(ui, '1 KB', 2);
  });
  it.each([[true, false], [false, false], [false, true]])
    ('waits and repairs native mounts with mobile=%s empty=%s', async (mobile, empty) => {
      const ui = install({ mobile, empty, header: false });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(ui.fetch).not.toHaveBeenCalled();
      switchDom(ui.doc, mobile, empty);
      await expectConverged(ui);
      size(ui).remove();
      await expectConverged(ui);
      size(ui).parentElement.closest('.topbar, .chat-header, .empty-drag').outerHTML = nativeMount(mobile, empty);
      await expectConverged(ui);
      expectMounted(ui);
    });
  it.each([true, false])('ignores history, Side Chat and composer streaming with mobile=%s', async (mobile) => {
    const ui = install({ mobile });
    await expectConverged(ui);
    const tail = ui.doc.querySelector('.history .a-msg:last-child');
    const side = ui.doc.querySelector('.sc');
    const composer = ui.doc.querySelector('.composer');
    const app = ui.doc.querySelector('.app');
    const node = size(ui);
    const query = vi.spyOn(ui.doc, 'querySelector');
    const queryAll = vi.spyOn(ui.doc, 'querySelectorAll');
    const elementQuery = vi.spyOn(ui.view.Element.prototype, 'querySelector');
    const elementQueryAll = vi.spyOn(ui.view.Element.prototype, 'querySelectorAll');
    for (let batch = 0; batch < 20; batch += 1) {
      tail.innerHTML = '<div class="chat-header"><span>Stream</span></div>';
      side.innerHTML = `<div class="con">${desktopHeader()}${topbar()}</div>`;
      composer.append(ui.doc.createElement('span'));
      app.classList.toggle('sidebar-collapsed');
      await settle();
    }
    for (const spy of [query, queryAll, elementQuery, elementQueryAll]) expect(spy).not.toHaveBeenCalled();
    node.remove();
    await expectConverged(ui);
    expect(query).toHaveBeenCalled();
    expectMounted(ui);
  });
  it.each(['.con', '.app', '#app'])('retains state after nested desktop %s structure replacement', async (selector) => {
    const ui = install({ mobile: false });
    await expectConverged(ui);
    const old = ui.doc.querySelector(selector);
    old.outerHTML = `<section class="replacement">${old.outerHTML}</section>`;
    if (selector === '.con') ui.doc.querySelector('.replacement').replaceWith(ui.doc.querySelector('.replacement .con'));
    await expectConverged(ui);
    expectMounted(ui);
  });
});
describe('session size presentation coexistence', () => {
  it('retains live status, branch and session counts when presentation updates beside size', async () => {
    const fetch = vi.fn(async (url) => {
      if (url === '/api/v1/sessions/A') return response({ data: { id: 'A', workspace_id: 'demo' } });
      if (url.endsWith('/fs:git_status')) return response({ data: { branch: 'feature/demo' } });
      if (url === '/api/v2/sessions') return response({ data: { groups: [{ workspace: { id: 'demo' }, total: 5 }] } });
      return measured(1234);
    });
    const ui = install({ fetch, integrate: true });
    await settle();
    for (const url of ['/api/v1/sessions/A', '/api/v1/sessions/A/fs:git_status', '/api/v2/sessions']) {
      await ui.view.fetch(url);
      await settle();
    }
    const original = size(ui);
    ui.doc.querySelector('.st').textContent = '运行中';
    await expectConverged(ui);
    expect(ui.doc.querySelector('.okw-workspace-summary').textContent).toBe('运行中 · feature/demo · 5 个会话');
    expect(size(ui)).toBe(original);
    expectMounted(ui, '1.2 KB');
    ui.setMobile(false);
    await expectConverged(ui);
    expect(ui.doc.querySelector('.okw-workspace-status')).toBeNull();
    expect(size(ui)).toBe(original);
    expect(size(ui).parentElement.className).toBe('chat-header');
    expect(size(ui).textContent).toBe('会话 1.2 KB');
    ui.setMobile(true);
    ui.doc.querySelector('.st').textContent = '运行中';
    await expectConverged(ui);
    expect(ui.doc.querySelector('.okw-workspace-summary').textContent).toBe('运行中 · feature/demo · 5 个会话');
    expectMounted(ui, '1.2 KB');
  });
  it('shows size beside an empty summary but hides the empty status again on workspace navigation', async () => {
    const ui = install({ integrate: true, withStatus: false });
    await expectConverged(ui);
    const status = ui.doc.querySelector('.okw-workspace-status');
    expect(status.hidden).toBe(false);
    expect(status.querySelector('.okw-workspace-summary').textContent).toBe('');
    expect(size(ui).textContent).toBe(' · 会话 1 KB');
    ui.navigate('/workspaces/demo');
    await expectConverged(ui);
    expect(size(ui)).toBeNull();
    expect(status.hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ui.api).toHaveBeenCalledTimes(1);
  });
  it('installs only once without stacking history wrappers, observers, nodes or timers', async () => {
    const ui = install();
    await settle();
    const push = ui.history.pushState;
    const replace = ui.history.replaceState;
    ui.evaluate(source);
    await expectConverged(ui);
    expect(ui.view.__okwUsageCreateApi).toHaveBeenCalledTimes(1);
    expect(ui.media.addEventListener).toHaveBeenCalledTimes(1);
    expect(ui.state.observers).toHaveLength(1);
    expect(ui.history.pushState).toBe(push);
    expect(ui.history.replaceState).toBe(replace);
    expect(ui.doc.querySelectorAll('.okw-session-size')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ui.api).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });
  it('retains the mobile style boundary and truncates only its summary, never the size', () => {
    expect(css.trim().startsWith('@media (max-width: 640px) {')).toBe(true);
    expect(css).toMatch(/\.okw-workspace-status\[hidden\]\s*\{\s*display:\s*none/s);
    expect(css).toMatch(/\.okw-workspace-summary\s*\{[^}]*min-width:\s*0[^}]*text-overflow:\s*ellipsis/s);
    expect(css).toMatch(/\.okw-session-size\s*\{[^}]*flex-shrink:\s*0[^}]*white-space:\s*nowrap/s);
    expect(css).toMatch(/\.okw-session-size\s*\{[^}]*color:\s*var\(--color-text-muted\)/s);
    expect(css).not.toMatch(/\.(?:history|a-msg|sc-body)|token|localStorage/);
  });
});
