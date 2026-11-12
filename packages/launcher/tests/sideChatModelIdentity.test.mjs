/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, flush, setup } from './testkit/sideChatModel.mjs';

afterEach(cleanup);
const store = (env, value, id = 'A') => env.view.localStorage.setItem(`kimi-web.panel-tabs.v1:${id}`, JSON.stringify(value));

describe('native side chat panel identity', () => {
  it('uses native typed payloads and exact active tab IDs, not labels', async () => {
    const env = setup(); const sc = env.tabs(['side-1', 'side-2']); await flush();
    expect(env.identity.identity(sc)).toEqual({ session: 'A', agent: 'side-1' });
    const data = JSON.parse(env.view.localStorage.getItem('kimi-web.panel-tabs.v1:A'));
    data.activeIndex = 1; store(env, data);
    expect(env.identity.identity(sc)).toBeNull();
    env.doc.querySelectorAll('.ptb-tab').forEach((tab, i) => tab.classList.toggle('on', i === 1)); await flush();
    expect(env.identity.identity(sc)).toEqual({ session: 'A', agent: 'side-2' }); await env.settle();
  });
  it('tracks reordering with matching typed native snapshots', async () => {
    const env = setup(); const sc = env.tabs(['side-1', 'side-2']);
    const data = JSON.parse(env.view.localStorage.getItem('kimi-web.panel-tabs.v1:A'));
    data.tabs.reverse(); data.activeIndex = 1;
    const tabs = env.doc.querySelector('.panel-tab-bar'); tabs.append(tabs.firstElementChild); store(env, data); await flush();
    expect(env.identity.identity(sc)).toEqual({ session: 'A', agent: 'side-1' });
  });
  it('rejects transient count mismatches, multiple active tabs and duplicate IDs', async () => {
    const env = setup(); const sc = env.tabs(['side-1', 'side-2']); await flush();
    const tabs = env.doc.querySelectorAll('.ptb-tab'); tabs[1].classList.add('on');
    expect(env.identity.identity(sc)).toBeNull(); tabs[1].classList.remove('on');
    tabs[1].dataset.panelTabId = tabs[0].dataset.panelTabId; expect(env.identity.identity(sc)).toBeNull();
    tabs[1].remove(); expect(env.identity.identity(sc)).toBeNull(); await env.settle();
  });
  it('rejects missing storage, malformed values and oversized snapshots', async () => {
    const env = setup(); const sc = env.tabs(); await flush();
    for (const value of ['{', 'null', '{}', 'x'.repeat(1024 * 1024 + 1)]) {
      env.view.localStorage.setItem('kimi-web.panel-tabs.v1:A', value); expect(env.identity.identity(sc)).toBeNull();
    }
    env.view.localStorage.removeItem('kimi-web.panel-tabs.v1:A'); expect(env.identity.identity(sc)).toBeNull();
    await env.settle();
  });
  it.each([
    { tabs: [], activeIndex: null, visible: true },
    { tabs: [], activeIndex: -1, visible: true },
    { tabs: [{ type: 'agent', payload: { parentId: 'A', agentId: 'worker', seq: 1 } }], activeIndex: 0, visible: true },
    { tabs: [{ type: 'btw', payload: { parentId: 'B', agentId: 'side-1', seq: 1 } }], activeIndex: 0, visible: true },
    { tabs: [{ type: 'btw', payload: { parentId: 'A', agentId: 'main', seq: 1 } }], activeIndex: 0, visible: true },
    { tabs: [{ type: 'btw', payload: { parentId: 'A', agentId: 'side-1', seq: 0 } }], activeIndex: 0, visible: true },
    { tabs: [{ type: 'btw', payload: { parentId: 'A', agentId: 'side-1', seq: 1 } }], activeIndex: 0, visible: false },
  ])('refuses a non-side, foreign or incomplete snapshot %#', async (data) => {
    const env = setup(); const sc = env.tabs(); store(env, data); await flush(); expect(env.identity.identity(sc)).toBeNull();
  });
  it('isolates route changes, detached panels and duplicate side roots', async () => {
    const env = setup(); const sc = env.tabs(); await flush(); env.route('B');
    expect(env.identity.identity(sc)).toBeNull(); env.route('A'); await flush();
    expect(env.identity.identity(sc)).toBeNull();
    env.view.localStorage.setItem('kimi-web.panel-tabs.v1:A', env.view.localStorage.getItem('kimi-web.panel-tabs.v1:A'));
    expect(env.identity.identity(sc)?.agent).toBe('side-1');
    const duplicate = sc.cloneNode(true); sc.parentElement.append(duplicate); expect(env.identity.identity(sc)).toBeNull();
    duplicate.remove(); sc.remove(); expect(env.identity.identity(sc)).toBeNull(); await env.settle();
  });
  it('observes remove/clear but not other storage scopes and converges', async () => {
    const env = setup(); const sc = env.tabs(); await flush();
    env.view.sessionStorage.setItem('kimi-web.panel-tabs.v1:A', '{}');
    env.view.localStorage.setItem('unrelated', 'unchanged'); expect(env.identity.identity(sc)?.agent).toBe('side-1');
    env.view.localStorage.clear(); await flush(); expect(env.identity.identity(sc)).toBeNull(); await env.settle();
  });
});
