import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
const code = readFileSync(new URL('../src/mobile/navigationSearch.js', import.meta.url), 'utf8');
const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { resolve, reject, promise };
};
function install() {
  let controls;
  const app = { inert: false, isConnected: true };
  const entry = { isConnected: true, focus: vi.fn() };
  const ui = {
    root: { hidden: true }, input: { value: '', focus: vi.fn() },
    role: { value: '' }, mode: { value: 'terms' }, sort: { value: 'score' }, status: { dataset: {} },
    list: { items: [], append(value) { this.items.push(value); }, replaceChildren() { this.items = []; },
      get childElementCount() { return this.items.length; } },
    more: { hidden: true, disabled: false }, localize: vi.fn(), panel: {},
  };
  const listeners = {};
  const document = { querySelectorAll: () => [app], querySelector: () => entry,
    documentElement: { classList: { add: vi.fn(), remove: vi.fn() } },
    addEventListener: (name, callback) => { listeners[name] = callback; } };
  const window = { __okwNavigationSearch: vi.fn(),
    __okwNavigationBuildSearch: (value) => { controls = value; return ui; },
    __okwNavigationSearchResult: (value) => value, __okwNavigationSearchKey: vi.fn(),
    __okwLocale: { text: (_, en) => en, observe: (callback) => { listeners.locale = callback; } } };
  runInNewContext(code, { window, document, setTimeout, clearTimeout, AbortController });
  const service = window.__okwNavigationCreateSearch(); service.open(entry);
  return { service, ui, app, entry, window, listeners, controls };
}
const page = (title, extra = {}) => ({ items: [{ session_title: title }], has_more: false, ...extra });
afterEach(() => { vi.useRealTimers(); });
describe('shared official search controller', () => {
  it('opens immediately without fetching, and restores focus and inert state on close', () => {
    const test = install();
    expect(test.ui.root.hidden).toBe(false); expect(test.app.inert).toBe(true);
    expect(test.ui.input.focus).toHaveBeenCalledOnce(); expect(test.window.__okwNavigationSearch).not.toHaveBeenCalled();
    test.service.close(); expect(test.ui.root.hidden).toBe(true); expect(test.app.inert).toBe(false);
    expect(test.entry.focus).toHaveBeenCalledOnce(); expect(test.ui.list.items).toEqual([]);
  });
  it('debounces requests and cancels the stale generation', async () => {
    vi.useFakeTimers(); const test = install(); const first = deferred(); const next = deferred();
    test.window.__okwNavigationSearch.mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise);
    test.ui.input.value = 'first'; test.controls.schedule();
    await vi.advanceTimersByTimeAsync(249); expect(test.window.__okwNavigationSearch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); const signal = test.window.__okwNavigationSearch.mock.calls[0][1].signal;
    test.ui.input.value = 'second'; test.controls.schedule(); expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(250); next.resolve(page('second')); await vi.advanceTimersByTimeAsync(0);
    first.resolve(page('first')); await vi.advanceTimersByTimeAsync(0);
    expect(test.ui.list.items.map((item) => item.session_title)).toEqual(['second']);
  });
  it('keeps executed filters with the official cursor and appends one page', async () => {
    const test = install(); test.ui.input.value = 'fixture'; test.ui.role.value = 'assistant';
    test.window.__okwNavigationSearch.mockResolvedValueOnce(page('one', { has_more: true, page_token: 'opaque' }));
    await test.controls.run(); expect(test.ui.more.hidden).toBe(false);
    test.window.__okwNavigationSearch.mockResolvedValueOnce(page('two'));
    await test.controls.run(true);
    expect(test.window.__okwNavigationSearch.mock.calls[1][0]).toMatchObject({query: 'fixture', role: 'assistant'});
    expect(test.window.__okwNavigationSearch.mock.calls[1][1].pageToken).toBe('opaque');
    expect(test.ui.list.items).toHaveLength(2); expect(test.ui.more.hidden).toBe(true);
  });
  it('ignores a response after close and never stores the query', async () => {
    const test = install(); const pending = deferred(); test.ui.input.value = 'fictional query';
    test.window.__okwNavigationSearch.mockReturnValue(pending.promise);
    const done = test.controls.run(); test.service.close(); pending.resolve(page('stale')); await done;
    expect(test.ui.list.items).toEqual([]); expect(test.ui.input.value).toBe('');
  });
  it('distinguishes empty, incomplete and failed searches', async () => {
    const test = install(); test.ui.input.value = 'fixture';
    test.window.__okwNavigationSearch.mockResolvedValueOnce({items: [], has_more: false});
    await test.controls.run(); expect(test.ui.status.textContent).toBe('No matching results.');
    test.window.__okwNavigationSearch.mockResolvedValueOnce(page('partial', {incomplete: 'deadline'}));
    await test.controls.run(); expect(test.ui.status.textContent).toContain('may be incomplete');
    test.window.__okwNavigationSearch.mockRejectedValueOnce(new Error('Fixture unavailable'));
    await test.controls.run(); expect(test.ui.status.textContent).toBe('Fixture unavailable');
    expect(test.ui.status.dataset.error).toBe('true');
  });
  it('localizes without additional requests and forwards only active keyboard events', () => {
    const test = install(); test.listeners.locale(); expect(test.ui.localize).toHaveBeenCalledOnce();
    test.listeners.keydown({key: 'Tab'}); expect(test.window.__okwNavigationSearchKey).toHaveBeenCalledOnce();
    test.service.close(); test.listeners.keydown({key: 'Tab'});
    expect(test.window.__okwNavigationSearchKey).toHaveBeenCalledOnce();
    expect(test.window.__okwNavigationSearch).not.toHaveBeenCalled();
  });
});
