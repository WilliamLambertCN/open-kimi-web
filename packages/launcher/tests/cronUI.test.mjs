/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TextEncoder } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
const sources = ['navigationSearchView.js', 'cronView.js', 'cron.js'].map((name) =>
  readFileSync(resolve(`packages/launcher/src/mobile/${name}`), 'utf8'));
const styles = readFileSync(resolve('packages/launcher/src/mobile/cron.css'), 'utf8');
const task = { id: 'native-task-<exact>', cron: '*/5 * * * *', prompt: '<b>Fictional prompt</b>',
  recurring: true, createdAt: 1792371780000, lastFiredAt: 1792371785000 };
const quality = { complete: true, reasons: [] };
const session = { id: 'original-session', title: 'Original session',
  workspace: { id: 'native-workspace', name: 'Demo workspace' },
  archived: false, loaded: true, model: 'fixture/model', modelSource: 'live', tasks: [task], quality };
const frames = []; const observers = [];
const tick = () => new Promise((done) => setTimeout(done, 0));
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject }; };
function install(overrides = {}) {
  const frame = document.createElement('iframe'); document.body.append(frame); frames.push(frame);
  const view = frame.contentWindow; view.TextEncoder = TextEncoder;
  view.document.body.innerHTML = '<div id="app"><button id="entry">Tasks</button>' +
    '<textarea id="draft">Fictional native draft</textarea></div><div class="sheet-root"></div>';
  const locale = []; let language = 'en';
  view.__okwLocale = { text: (zh, en) => language === 'zh' ? zh : en, observe: (callback) => locale.push(callback) };
  const api = { capabilities: vi.fn(async () => ({ available: true, capabilities: { list: true, create: true, remove: true } })),
    sessions: vi.fn(async () => ({ items: [session], hasMore: false, cursor: null })),
    history: vi.fn(async () => ({ available: false, items: [], hasMore: false, quality: { complete: false, reasons: [] } })),
    list: vi.fn(async () => ({ tasks: [task] })), create: vi.fn(async () => ({ task })),
    remove: vi.fn(async () => ({ removed: [task.id] })), restore: vi.fn(async () => ({})), ...overrides };
  view.__okwCronApi = api; view.__okwNavigation = { register: vi.fn() };
  const state = { callbacks: 0, storm: false }; const Native = view.MutationObserver;
  const observer = new Native(() => {
    if (++state.callbacks > 100) { state.storm = true; observer.disconnect(); }
  }); observer.observe(view.document.documentElement, { childList: true, subtree: true, attributes: true });
  observers.push(observer);
  sources.forEach((source) => view.eval(source));
  let callbacks;
  const buildView = view.__okwCronBuildView;
  view.__okwCronBuildView = (value) => { callbacks = value; return buildView(value); };
  const doc = view.document; const find = (selector) => doc.querySelector(selector);
  const click = (action) => find(`[data-cron-action="${action}"]`).click();
  view.__okwCron.open(find('#entry'));
  return { view, doc, api, find, click, state, get callbacks() { return callbacks; },
    language(value) { language = value; locale.forEach((callback) => callback()); } };
}
async function select(test) {
  await tick(); test.find('[data-session-id="original-session"]').click(); await tick();
}
async function settled(test) {
  await tick(); const count = test.state.callbacks; await tick();
  expect(test.state.callbacks).toBe(count); expect(test.state.storm).toBe(false);
}
afterEach(() => { observers.splice(0).forEach((observer) => observer.disconnect());
  frames.splice(0).forEach((frame) => frame.remove()); });
describe.each(['2.3.1', '2.4.1'])('%s read-only scheduled-task UI', (version) => {
  const readonly = { available: true, version, reason: 'read-only-version',
    capabilities: { list: true, inventory: true, history: true, create: false, remove: false } };
  it('keeps cold inventory/history readable and blocks hidden buttons and direct create/remove/restore callbacks', async () => {
    const cold = { ...session, loaded: false, modelSource: 'saved' };
    const test = install({ capabilities: vi.fn(async () => readonly),
      sessions: vi.fn(async () => ({ items: [cold], hasMore: false, cursor: null })) });
    await select(test);
    const notice = test.find('.okw-cron-panel > .okw-cron-status');
    expect(notice.textContent).toContain('This official version');
    expect(notice.textContent).toContain('session ownership and freshness');
    expect(notice.textContent).toContain('no write was sent');
    expect(notice.textContent).not.toContain('not enabled');
    expect(test.find('.okw-cron-main').textContent).toContain('Showing saved records only');
    expect(test.find('[data-cron-action="restore"]').hidden).toBe(true);
    expect(test.find('[data-cron-action="restore"]').disabled).toBe(true);
    expect(test.find('[data-cron-action="new"]').hidden).toBe(true);
    expect(test.find('[data-cron-action="remove"]').disabled).toBe(true);
    test.click('restore'); test.click('new'); test.click('remove');
    test.callbacks.newTask(); test.callbacks.submit();
    test.callbacks.confirm('restore'); test.callbacks.applyConfirm();
    test.callbacks.confirm('remove', task.id); test.callbacks.applyConfirm();
    expect(test.find('.okw-cron-form').hidden).toBe(true);
    expect(test.find('.okw-cron-confirmation').hidden).toBe(true);
    expect(test.api.restore).not.toHaveBeenCalled(); expect(test.api.create).not.toHaveBeenCalled();
    expect(test.api.remove).not.toHaveBeenCalled(); expect(test.api.list).not.toHaveBeenCalled();
    expect(test.api.history).toHaveBeenCalledWith(session.id);
    test.language('zh');
    expect(notice.textContent).toContain('仅支持只读；未写入');
    expect(notice.textContent).toContain('不恢复会话');
    expect(test.find('.okw-cron-main').textContent).toContain('未恢复会话或启动任务');
    expect(test.find('[data-cron-action="open-session"]').getAttribute('href')).toBe('/sessions/original-session');
    expect(test.api.capabilities).toHaveBeenCalledOnce();
    test.find('[data-cron-action="open-session"]').addEventListener('click', (event) => event.preventDefault());
    test.click('open-session'); expect(test.find('.okw-cron-backdrop').hidden).toBe(true);
    expect(test.find('#app').inert).toBeFalsy(); await settled(test);
  });

  it('labels live memory as a backend-local snapshot and never enables mutations after a read', async () => {
    const test = install({ capabilities: vi.fn(async () => readonly) }); await select(test);
    expect(test.find('.okw-cron-task-source').textContent).toContain('backend main-agent memory');
    expect(test.find('.okw-cron-task-source').textContent).toContain('not guaranteed current across processes or on disk');
    expect(test.find('[data-cron-action="remove"]').disabled).toBe(true);
    expect(test.find('[data-cron-action="new"]').hidden).toBe(true);
    test.callbacks.confirm('remove', task.id); test.callbacks.applyConfirm();
    expect(test.api.remove).not.toHaveBeenCalled();
    test.language('zh'); expect(test.find('.okw-cron-task-source').textContent).toContain('不保证与其它进程或磁盘实时一致');
    test.api.list.mockRejectedValueOnce(Object.assign(new Error(), { code: 'not-loaded' }));
    test.click('reload'); await tick();
    expect(test.find('.okw-cron-main').textContent).toContain('未恢复会话或启动任务');
    expect(test.find('[data-cron-action="restore"]').hidden).toBe(true);
    expect(test.api.restore).not.toHaveBeenCalled(); await settled(test);
  });

  it('invalidates an open writable draft when capabilities change to read-only, without submitting it', async () => {
    const test = install(); await select(test); test.click('new');
    test.find('[name="prompt"]').value = 'Keep this unsubmitted draft';
    test.api.capabilities.mockResolvedValueOnce(readonly);
    test.click('reload'); await tick(); test.callbacks.submit(); test.callbacks.newTask();
    expect(test.find('.okw-cron-form').hidden).toBe(true);
    expect(test.find('[name="prompt"]').value).toBe('Keep this unsubmitted draft');
    expect(test.find('[data-cron-action="remove"]').disabled).toBe(true);
    expect(test.api.create).not.toHaveBeenCalled(); expect(test.api.remove).not.toHaveBeenCalled();
    expect(test.api.restore).not.toHaveBeenCalled(); await settled(test);
  });
});

describe('native session scheduled-task UI', () => {
  it('registers only cron and does not load session status or tasks implicitly on open', async () => {
    const test = install(); await tick();
    expect(test.view.__okwNavigation.register).toHaveBeenCalledWith('cron', expect.any(Function));
    expect(test.api.sessions).toHaveBeenCalledOnce(); expect(test.api.list).not.toHaveBeenCalled();
    expect(test.api.restore).not.toHaveBeenCalled(); expect(test.api.history).not.toHaveBeenCalled();
    expect(test.find('#app').inert).toBe(true); await settled(test);
  });
  it('renders native tasks as text and unavailable history honestly without storage', async () => {
    const test = install(); await select(test);
    expect(test.find('.okw-cron-details').textContent).toContain(task.id);
    expect(test.find('.okw-cron-details').textContent).toContain(task.prompt);
    expect(test.find('.okw-cron-details b')).toBeNull();
    expect(test.find('.okw-cron-history').textContent).toBe('');
    expect(test.find('.okw-cron-main').textContent).toContain('Trigger history is unavailable');
    expect(test.find('[data-cron-action="open-session"]').getAttribute('href')).toBe('/sessions/original-session');
    expect(test.view.localStorage.length).toBe(0); await settled(test);
  });
  it('shows loading, empty inventory and disabled mode without pretending no tasks exist', async () => {
    const pending = deferred(); const test = install({ capabilities: vi.fn(() => pending.promise) });
    expect(test.find('.okw-cron-backdrop').dataset.state).toBe('loading');
    pending.resolve({ available: false, reason: 'not-enabled' }); await tick();
    expect(test.find('.okw-cron-panel').textContent).toContain('kimi web --scheduled-tasks');
    expect(test.api.sessions).not.toHaveBeenCalled(); expect(test.find('.okw-cron-tasks').textContent).toBe('');
    test.api.capabilities.mockResolvedValue({ available: true, capabilities: { list: true } });
    test.api.sessions.mockResolvedValue({ items: [] }); test.click('reload'); await tick();
    expect(test.find('.okw-cron-inventory').textContent).toContain('No sessions were returned');
  });
  it('keeps missing inventory distinct from empty tasks', async () => {
    const test = install({ sessions: vi.fn(async () => { throw new Error('not-available'); }) }); await tick();
    expect(test.find('.okw-cron-inventory').textContent).toContain('Session inventory is unavailable');
    expect(test.api.list).not.toHaveBeenCalled();
  });
  it('cancels exact-ID deletion and guards duplicate confirmation on success', async () => {
    const pending = deferred(); const test = install({ remove: vi.fn(() => pending.promise) }); await select(test);
    test.click('remove'); expect(test.find('.okw-cron-confirmation code').textContent).toBe(task.id);
    test.click('cancel-confirm'); expect(test.api.remove).not.toHaveBeenCalled();
    test.click('remove'); test.click('confirm'); test.click('confirm');
    expect(test.api.remove).toHaveBeenCalledOnce(); expect(test.api.remove).toHaveBeenCalledWith('original-session', task.id);
    test.api.list.mockResolvedValue({ tasks: [] }); pending.resolve({ removed: [task.id] }); await tick();
    expect(test.find('.okw-cron-main').textContent).toContain('Task removed');
    expect(test.find('.okw-cron-task')).toBeNull(); await settled(test);
  });
  it('keeps a rejected deletion visible and reports failure rather than success', async () => {
    const test = install({ remove: vi.fn(async () => { throw Object.assign(new Error(), { status: 429 }); }) });
    await select(test); test.click('remove'); test.click('confirm'); await tick();
    expect(test.find('.okw-cron-main').textContent).toContain('server is busy');
    expect(test.find('.okw-cron-task')).not.toBeNull(); expect(test.api.list).toHaveBeenCalledOnce();
  });
});
describe('scheduled-task mutation and recovery', () => {
  it('blocks further writes after unknown outcome until an explicit successful task reload', async () => {
    const test = install({ remove: vi.fn(async () => { throw Object.assign(new Error(), { outcomeUnknown: true }); }) });
    await select(test); test.click('remove'); test.click('confirm'); await tick();
    expect(test.find('.okw-cron-main').textContent).toContain('write outcome is unknown');
    expect(test.find('[data-cron-action="remove"]').disabled).toBe(true);
    test.click('remove'); test.click('confirm'); expect(test.api.remove).toHaveBeenCalledOnce();
    test.click('reload'); await tick(); expect(test.api.list).toHaveBeenCalledTimes(2);
    expect(test.find('[data-cron-action="remove"]').disabled).toBe(false);
  });
  it('requires a separate restore confirmation and then rereads original tasks', async () => {
    const test = install({ list: vi.fn(async () => { throw Object.assign(new Error(), { code: 'not-loaded' }); }) });
    await select(test); expect(test.api.restore).not.toHaveBeenCalled();
    test.click('restore'); expect(test.find('.okw-cron-confirmation').textContent).toContain('restarts its existing');
    test.click('cancel-confirm'); expect(test.api.restore).not.toHaveBeenCalled();
    test.click('restore'); test.api.list.mockResolvedValue({ tasks: [task] }); test.click('confirm'); await tick();
    expect(test.api.restore).toHaveBeenCalledWith('original-session', true);
    expect(test.api.list).toHaveBeenCalledTimes(2); expect(test.find('.okw-cron-main').textContent).toContain('Session restored');
  });
  it('preserves cron/prompt/recurring draft across dynamic locale and native key isolation', async () => {
    const pending = deferred(); const test = install({ create: vi.fn(() => pending.promise) }); await select(test);
    test.click('new'); const prompt = test.find('[name="prompt"]'); const cron = test.find('[name="cron"]');
    cron.value = '7 * * * *'; prompt.value = '中文 <b>draft</b>'; test.find('[name="recurring"]').checked = true;
    prompt.dispatchEvent(new test.view.Event('input', { bubbles: true })); test.language('zh');
    expect(cron.isConnected && prompt.isConnected).toBe(true); expect(prompt.value).toBe('中文 <b>draft</b>');
    expect(test.find('.okw-cron-hint').textContent).toContain('跟随');
    expect(test.find('.okw-cron-form').textContent).toContain('8192 字节');
    const native = vi.fn(); test.doc.addEventListener('keydown', native, true);
    const enter = new test.view.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    prompt.dispatchEvent(enter); expect(native).not.toHaveBeenCalled(); expect(enter.defaultPrevented).toBe(false);
    const form = test.find('.okw-cron-form'); const submit = () => form.dispatchEvent(
      new test.view.Event('submit', { bubbles: true, cancelable: true }));
    submit(); submit(); expect(test.api.create).toHaveBeenCalledOnce();
    expect(test.api.create).toHaveBeenCalledWith('original-session',
      { cron: '7 * * * *', prompt: '中文 <b>draft</b>', recurring: true });
    pending.resolve({ task }); await tick(); expect(test.find('.okw-cron-main').textContent).toContain('任务已创建');
    test.click('close'); expect(test.doc.activeElement).toBe(test.find('#entry'));
    expect(test.find('#app').inert).toBeFalsy(); expect(test.find('#draft').value).toBe('Fictional native draft');
  });
  it('shows empty tasks and auth/version failures without fabricated results', async () => {
    const test = install({ list: vi.fn(async () => ({ tasks: [] })) }); await select(test);
    expect(test.find('.okw-cron-main').textContent).toContain('has no scheduled tasks');
    test.api.list.mockRejectedValueOnce(Object.assign(new Error(), { code: 'unsupported-version' }));
    test.click('reload'); await tick(); expect(test.find('.okw-cron-main').textContent).toContain('not supported');
    test.api.list.mockRejectedValueOnce(Object.assign(new Error(), { status: 401 }));
    test.click('reload'); await tick(); expect(test.find('.okw-cron-main').textContent).toContain('authorization');
  });
});
describe('scheduled-task focus and interrupted requests', () => {
  it('keeps hidden forms and confirmations outside the keyboard focus loop', async () => {
    const test = install(); await select(test); test.find('[data-cron-action="remove"]').focus();
    const tab = new test.view.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    test.doc.activeElement.dispatchEvent(tab); expect(tab.defaultPrevented).toBe(true);
    expect(test.doc.activeElement).toBe(test.find('[data-cron-action="reload"]'));
    const escape = new test.view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    test.doc.activeElement.dispatchEvent(escape); expect(test.find('.okw-cron-backdrop').hidden).toBe(true);
    expect(test.doc.activeElement).toBe(test.find('#entry'));
  });
  it('does not unlock an unknown write when the required reload also fails', async () => {
    const test = install({ remove: vi.fn(async () => { throw Object.assign(new Error(), { outcomeUnknown: true }); }) });
    await select(test); test.click('remove'); test.click('confirm'); await tick();
    test.api.list.mockRejectedValueOnce(new Error('offline')); test.click('reload'); await tick();
    expect(test.find('.okw-cron-main').textContent).toContain('write outcome is unknown');
    expect(test.find('[data-cron-action="remove"]').disabled).toBe(true);
    test.click('remove'); test.click('confirm'); expect(test.api.remove).toHaveBeenCalledOnce();
    test.api.list.mockResolvedValue({ tasks: [task] }); test.click('reload'); await tick();
    expect(test.find('[data-cron-action="remove"]').disabled).toBe(false);
  });
  it('blocks repeat writes after close/reopen while a mutation is unresolved', async () => {
    const pending = deferred(); const test = install({ remove: vi.fn(() => pending.promise) }); await select(test);
    test.click('remove'); test.click('confirm'); test.click('close'); test.view.__okwCron.open(test.find('#entry'));
    expect(test.find('[data-cron-action="reload"]').disabled).toBe(true);
    expect(test.api.remove).toHaveBeenCalledOnce(); pending.reject(Object.assign(new Error(), { outcomeUnknown: true }));
    await tick(); expect(test.find('.okw-cron-main').textContent).toContain('write outcome is unknown');
    expect(test.find('[data-cron-action="remove"]').disabled).toBe(true); await settled(test);
  });
  it('paginates inventory but reports the bounded history cap without a repeat-request button', async () => {
    const test = install({ sessions: vi.fn(async () => ({ items: [session], hasMore: true, cursor: 'session-next' })),
    history: vi.fn(async () => ({ available: true, items: [{ time: 1792371780000, taskId: task.id, kind: 'started' }],
      hasMore: true, quality })) });
    await select(test); expect(test.find('[data-cron-action="history-more"]')).toBeNull();
    expect(test.api.history).toHaveBeenLastCalledWith('original-session'); expect(test.api.history).toHaveBeenCalledOnce();
    expect(test.find('.okw-cron-main').textContent).toContain('latest 100 records');
    test.api.sessions.mockResolvedValue({ items: [{ ...session, id: 'second', title: 'Second' }], hasMore: false });
    test.click('sessions-more'); test.click('sessions-more'); await tick();
    expect(test.api.sessions).toHaveBeenLastCalledWith('session-next'); expect(test.api.sessions).toHaveBeenCalledTimes(2);
    expect(test.find('[data-session-id="second"]')).not.toBeNull();
  });
  it('separates confirmed write success from a failed follow-up read and blocks repeat writes', async () => {
    const test = install(); await select(test);
    test.api.list.mockRejectedValueOnce(new Error('read failed')); test.click('remove'); test.click('confirm'); await tick();
    expect(test.find('.okw-cron-main').textContent).toContain('write was confirmed, but task reload failed');
    expect(test.find('[data-cron-action="remove"]').disabled).toBe(true);
    expect(test.api.remove).toHaveBeenCalledOnce();
  });
});
describe('saved inventory without implicit restoration', () => {
  it('shows cold saved tasks and metadata without main RPC until separate restore confirmation', async () => {
    const second = { ...task, id: 'saved-second', prompt: 'Second saved task' };
    const cold = { ...session, loaded: false, archived: true, modelSource: 'saved', tasks: [task, second] };
    const test = install({ sessions: vi.fn(async () => ({ items: [cold], hasMore: false, cursor: null })) });
    await select(test); const directory = test.find('.okw-cron-inventory').textContent;
    expect(directory).toContain('Demo workspace'); expect(directory).not.toContain('[object Object]');
    expect(directory).toContain('2 saved tasks'); expect(directory).toContain('Archived');
    expect(directory).toContain('Not loaded'); expect(directory).toContain('Saved session model: fixture/model');
    expect(test.find('.okw-cron-task-columns').textContent).toContain('Second saved task');
    test.find('[data-task-id="saved-second"]').click();
    expect(test.find('.okw-cron-details').textContent).toContain('saved-second');
    expect(test.find('[data-cron-action="remove"]').disabled).toBe(true);
    expect(test.find('[data-cron-action="new"]').hidden).toBe(true);
    expect(test.find('.okw-cron-main').textContent).toContain('Saved read-only task projection');
    test.click('reload'); await tick(); expect(test.api.list).not.toHaveBeenCalled();
    expect(test.api.create).not.toHaveBeenCalled(); expect(test.api.remove).not.toHaveBeenCalled();
    expect(test.api.restore).not.toHaveBeenCalled(); expect(test.api.history).toHaveBeenCalledTimes(2);
    test.click('restore'); expect(test.find('.okw-cron-confirmation').textContent).toContain('restarts its existing');
    test.click('cancel-confirm'); expect(test.api.restore).not.toHaveBeenCalled();
    test.click('restore'); test.click('confirm'); await tick();
    expect(test.api.restore).toHaveBeenCalledWith('original-session', true); expect(test.api.list).toHaveBeenCalledOnce();
    expect(test.find('[data-cron-action="remove"]').disabled).toBe(false); await settled(test);
  });
  it('marks unknown load state and missing evidence as unconfirmed rather than empty or corrupt', async () => {
    const incomplete = { complete: false, reasons: ['main-wire-missing', 'wire-byte-limit', 'future-quality-code'] };
    const cold = { ...session, loaded: null, model: null, modelSource: 'unknown', tasks: [], quality: incomplete };
    const test = install({ sessions: vi.fn(async () => ({ items: [cold], hasMore: false, cursor: null })),
      history: vi.fn(async () => ({ available: true, items: [], hasMore: false, quality: incomplete })) });
    await select(test); const content = test.find('.okw-cron-panel').textContent;
    expect(content).toContain('0 known saved tasks; total unconfirmed'); expect(content).toContain('Session model unknown');
    expect(content).toContain('session load state is unknown'); expect(content).not.toContain('has no scheduled tasks');
    expect(content).not.toContain('No saved trigger records'); expect(content).not.toContain('corrupt');
    expect(test.find('[data-cron-action="restore"]').hidden).toBe(false); test.language('zh');
    const chinese = test.find('.okw-cron-panel').textContent;
    expect(chinese).toContain('记录缺失或不可读，无法确认'); expect(chinese).toContain('达到有界读取限额');
    expect(chinese).toContain('部分证据无法确认'); expect(chinese).not.toMatch(/main-wire|wire-byte|future-quality/);
    expect(test.api.list).not.toHaveBeenCalled(); expect(test.api.restore).not.toHaveBeenCalled(); await settled(test);
  });
  it('falls back to saved tasks when directory loaded state has no materialized main agent', async () => {
    const test = install({ list: vi.fn(async () => { throw Object.assign(new Error(), { code: 'not-loaded' }); }) });
    await select(test); expect(test.find('.okw-cron-details').textContent).toContain(task.id);
    expect(test.find('.okw-cron-main').textContent).toContain('Saved read-only task projection');
    expect(test.find('[data-cron-action="remove"]').disabled).toBe(true);
    expect(test.find('[data-cron-action="new"]').hidden).toBe(true);
    expect(test.api.list).toHaveBeenCalledOnce(); expect(test.api.restore).not.toHaveBeenCalled();
  });
  it('does not reuse a prior live read to call main RPC after the directory reports cold', async () => {
    const test = install(); await select(test); expect(test.api.list).toHaveBeenCalledOnce();
    test.api.sessions.mockResolvedValue({ items: [{ ...session, loaded: false }], hasMore: false, cursor: null });
    test.click('reload'); await tick(); expect(test.api.list).toHaveBeenCalledOnce();
    expect(test.find('.okw-cron-task-source').textContent).toContain('Saved read-only task projection');
    expect(test.find('[data-cron-action="remove"]').disabled).toBe(true); expect(test.api.restore).not.toHaveBeenCalled();
  });
});
describe('native trigger evidence and model display', () => {
  it('renders localized kinds, explicit endings, inherited history and actual model requests without guessing', async () => {
    const base = { time: 1792371780000, taskId: task.id, kind: 'started', turnId: 7, inherited: false };
    const items = [{ ...base, endReason: 'completed', endedAt: 1792371785000, durationMs: 5000, inherited: true,
      models: [{ model: 'fixture/actual', alias: 'Fictional alias', provider: 'Fixture provider', time: base.time }] },
    { ...base, kind: 'steered', endReason: 'cancelled', endedAt: 1792371785000 },
    { ...base, turnId: 8, endReason: 'failed', endedAt: 1792371785000 },
    { ...base, turnId: 9, endReason: 'blocked', endedAt: 1792371785000 },
    { ...base, kind: 'submitted', turnId: 99 }, { ...base, turnId: 10 }];
    const test = install({ history: vi.fn(async () => ({ available: true, items, hasMore: false, quality })) });
    await select(test); const rows = [...test.doc.querySelectorAll('.okw-cron-history li')];
    expect(rows[0].textContent).toContain('Native turn completed (not business success)');
    expect(rows[0].textContent).toContain('Native turn duration: 5000 ms');
    expect(rows[0].textContent).toContain('Inherited history record');
    expect(rows[0].textContent).toContain('Actual request model: fixture/actual');
    expect(rows[0].textContent).toContain('Alias: Fictional alias'); expect(rows[0].textContent).toContain('Fixture provider');
    const displayedTime = new test.view.Date(base.time).toLocaleString();
    expect(rows[0].textContent).toContain(displayedTime); expect(rows[1].textContent).toContain('Steered into current turn');
    expect(rows[1].textContent).toContain('Native turn cancelled'); expect(rows[2].textContent).toContain('Native turn failed');
    expect(rows[3].textContent).toContain('Native turn blocked');
    expect(rows[4].textContent).toContain('Submitted (turn association unconfirmed)');
    expect(rows[4].textContent).not.toContain('Native turn: 99'); expect(rows[5].textContent).toContain('End state unknown');
    test.language('zh'); const chinese = test.find('.okw-cron-history').textContent;
    expect(chinese).toContain('原生回合完成（不代表业务成功）'); expect(chinese).toContain('已插入当前回合');
    expect(chinese).toContain('已提交（未确认关联回合）'); expect(chinese).toContain('结束状态未知');
    expect(chinese).toContain('原生回合耗时：5000 毫秒'); expect(chinese).toContain('实际请求模型: fixture/actual');
    expect(chinese).not.toMatch(/started|steered|submitted|completed|cancelled|failed|blocked/);
    expect(test.api.history).toHaveBeenCalledOnce(); await settled(test);
  });
  it('does not retain the previous history quality after a new history request fails', async () => {
    const test = install({ history: vi.fn(async () => ({ available: true, items: [], hasMore: false,
      quality: { complete: false, reasons: ['wire-byte-limit'] } })) });
    await select(test); expect(test.find('.okw-cron-history-quality').textContent).toContain('Bounded read limit');
    test.api.history.mockRejectedValueOnce(new Error('offline')); test.click('reload'); await tick();
    expect(test.find('.okw-cron-history-quality').textContent).not.toContain('Bounded read limit');
    expect(test.find('.okw-cron-main').textContent).toContain('Trigger history is unavailable');
  });
});
describe('write verification cannot be replaced by saved inventory', () => {
  it('keeps an unknown write blocked across cold inventory refresh and reopens until a real list succeeds', async () => {
    const test = install({ remove: vi.fn(async () => { throw Object.assign(new Error(), { outcomeUnknown: true }); }) });
    await select(test); test.click('remove'); test.click('confirm'); await tick();
    test.api.sessions.mockResolvedValue({ items: [{ ...session, loaded: false }], hasMore: false, cursor: null });
    test.api.list.mockRejectedValueOnce(Object.assign(new Error(), { code: 'not-loaded' }));
    test.click('reload'); await tick(); expect(test.api.list).toHaveBeenCalledTimes(2);
    expect(test.find('.okw-cron-main').textContent).toContain('Saved read-only task projection');
    expect(test.find('.okw-cron-main').textContent).toContain('write outcome is unknown');
    expect(test.find('[data-cron-action="remove"]').disabled).toBe(true);
    expect(test.find('[data-session-id="original-session"]').disabled).toBe(true);
    test.click('close'); test.view.__okwCron.open(test.find('#entry')); await tick();
    expect(test.api.list).toHaveBeenCalledTimes(3); expect(test.find('[data-cron-action="remove"]').disabled).toBe(false);
    expect(test.api.remove).toHaveBeenCalledOnce();
  });
  it('requires a real reread after a confirmed mutation even if refreshed inventory is cold', async () => {
    const test = install(); await select(test);
    test.api.list.mockRejectedValueOnce(new Error('offline')); test.click('remove'); test.click('confirm'); await tick();
    test.api.sessions.mockResolvedValue({ items: [{ ...session, loaded: false }], hasMore: false, cursor: null });
    test.api.list.mockRejectedValueOnce(new Error('offline')); test.click('reload'); await tick();
    expect(test.api.list).toHaveBeenCalledTimes(3); expect(test.find('[data-cron-action="remove"]').disabled).toBe(true);
    expect(test.find('.okw-cron-main').textContent).toContain('write outcome is unknown');
    test.click('reload'); await tick(); expect(test.api.list).toHaveBeenCalledTimes(4);
    expect(test.find('[data-cron-action="remove"]').disabled).toBe(false); expect(test.api.remove).toHaveBeenCalledOnce();
  });
});
describe('scheduled-task theme and scroll-list CSS contracts', () => {
  it('backs translucent raised surfaces with the theme background and an opaque Canvas base', () => {
    const panel = styles.match(/\.okw-cron-panel\s*\{([^}]+)\}/)?.[1];
    expect(panel).toContain('linear-gradient(var(--color-surface-raised, Canvas), var(--color-surface-raised, Canvas))');
    expect(panel).toContain('linear-gradient(var(--color-bg, Canvas), var(--color-bg, Canvas)), Canvas');
    expect(panel).toContain('font: inherit');
  });
  it('keeps session and task items unshrunk and limits only list titles and prompt previews', async () => {
    const itemRule = styles.match(/\.okw-cron-panel :is\(\.okw-cron-session, \.okw-cron-task\)\s*\{([^}]+)\}/)?.[1];
    expect(itemRule).toMatch(/flex-shrink:\s*0/);
    expect(styles).toMatch(/\.okw-cron-sessions\s*\{[^}]*max-height:\s*180px;\s*overflow:\s*auto/s);
    const preview = styles.match(/\.okw-cron-session strong, \.okw-cron-task strong, \.okw-cron-task span\s*\{([^}]+)\}/)?.[1];
    expect(preview).toMatch(/display:\s*-webkit-box/); expect(preview).toMatch(/-webkit-line-clamp:\s*2/);
    expect(preview).toMatch(/-webkit-box-orient:\s*vertical/); expect(preview).toMatch(/overflow:\s*hidden/);
    const title = 'Fictional long session title '.repeat(12);
    const test = install({ sessions: vi.fn(async () => ({ items: [{ ...session, title }], hasMore: false, cursor: null })) });
    await select(test); expect(test.find('.okw-cron-session strong').textContent).toBe(title);
    expect(test.find('.okw-cron-main > h3').textContent).toBe(title);
    expect(styles).not.toMatch(/[^{}]*h3[^{}]*\{[^}]*-webkit-line-clamp/s);
  });
});
