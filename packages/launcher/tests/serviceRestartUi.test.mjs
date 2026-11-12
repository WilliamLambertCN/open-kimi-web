/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, flush, setup } from './testkit/serviceRestart.mjs';

afterEach(cleanup);
const posted = (env) => env.api.mock.calls.filter(([, init]) => init.method === 'POST');

describe('service restart settings interaction', () => {
  it.each([true, false])('mounts once in native settings, mobile=%s, without fetching until clicked', async (mobile) => {
    const env = setup({ mobile }); env.install(); await env.settle();
    expect(env.doc.querySelectorAll('.okw-service-trigger')).toHaveLength(1); expect(env.api).not.toHaveBeenCalled();
    await env.open(); expect(env.status()).toBe('');
    expect(env.doc.querySelector('dialog h2').textContent).toBe('Restart service');
    env.cancel(); expect(posted(env)).toHaveLength(0); expect(env.doc.activeElement.className).toContain('okw-service-trigger');
    expect(env.doc.querySelector('.draft').value).toBe('Fictional unsent draft'); await env.settle();
  });
  it('remounts with native settings and switches languages without writes', async () => {
    const env = setup(); await env.open(); env.locale('zh'); await env.settle();
    expect(env.doc.querySelector('dialog h2').textContent).toBe('重启服务'); env.cancel();
    env.mount(); await env.settle(); expect(env.doc.querySelectorAll('.okw-service-trigger')).toHaveLength(1);
    expect(env.doc.querySelector('.okw-service-trigger').textContent).toBe('重启服务'); expect(posted(env)).toHaveLength(0);
  });
  it('isolates native global shortcuts but preserves Tab default and closes on Escape', async () => {
    const env = setup(); const nativeShortcut = vi.fn(); env.view.addEventListener('keydown', nativeShortcut, true);
    await env.open(); const button = env.doc.querySelector('.okw-service-actions button');
    const tab = new env.view.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    button.dispatchEvent(tab); expect(tab.defaultPrevented).toBe(false); expect(nativeShortcut).not.toHaveBeenCalled();
    env.doc.body.dispatchEvent(new env.view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(nativeShortcut).not.toHaveBeenCalled(); expect(env.doc.querySelector('.sheet-panel')).not.toBeNull();
    expect(env.doc.querySelector('dialog')).toBeNull();
    env.doc.querySelector('.draft').dispatchEvent(new env.view.KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    expect(nativeShortcut).toHaveBeenCalledOnce(); expect(posted(env)).toHaveLength(0);
  });
  it('does not scan settings during streamed chat mutations and converges after opening', async () => {
    const env = setup(); await env.settle(); const queries = vi.spyOn(env.doc, 'querySelectorAll');
    const chat = env.doc.body.appendChild(env.doc.createElement('article')); chat.className = 'a-msg';
    for (let i = 0; i < 10; i += 1) { chat.append(env.doc.createElement('span')); await flush(); }
    expect(queries).not.toHaveBeenCalled(); await env.open(); await env.settle();
  });
});

describe('desktop service restart placement', () => {
  it('belongs only to General when native panels change visibility', async () => {
    const env = setup({ mobile: false }); await env.settle();
    const [general, agents] = env.doc.querySelectorAll('.panel');
    expect(general.querySelectorAll('.okw-service-trigger')).toHaveLength(1);
    expect(agents.querySelector('.okw-service-section')).toBeNull();
    general.style.display = 'none'; agents.style.display = ''; agents.append('Native agent update'); await env.settle();
    expect(agents.querySelector('.okw-service-section')).toBeNull();
    general.style.display = ''; agents.style.display = 'none'; general.append('Native general update'); await env.settle();
    expect(general.querySelectorAll('.okw-service-trigger')).toHaveLength(1);
    expect(env.api).not.toHaveBeenCalled();
  });
  it('recognizes the Chinese General label after native remount and localizes the one entry', async () => {
    const env = setup({ mobile: false }); await env.settle(); env.mount();
    const [generalTab, agentsTab] = env.doc.querySelectorAll('.settings-tabs [role=tab]');
    generalTab.textContent = '通用'; agentsTab.textContent = '智能体与会话'; env.locale('zh'); await env.settle();
    expect(env.doc.querySelectorAll('.okw-service-trigger')).toHaveLength(1);
    expect(env.doc.querySelector('.panel .okw-service-trigger').textContent).toBe('重启服务');
    await env.open(); env.cancel(); expect(posted(env)).toHaveLength(0); await env.settle();
  });
  it('does not guess a desktop destination when the General label is unknown', async () => {
    const env = setup({ mobile: false });
    env.doc.querySelector('.settings-tabs [role=tab]').textContent = 'Unknown'; await env.settle();
    expect(env.doc.querySelector('.okw-service-section')).toBeNull(); expect(env.api).not.toHaveBeenCalled();
  });
});

describe('service restart recovery', () => {
  it('submits once, waits for a different ready instance, and never reloads or resends a draft itself', async () => {
    const env = setup(); await env.open(); env.confirm(); env.confirm(); await flush();
    expect(posted(env)).toHaveLength(1); expect(JSON.parse(posted(env)[0][1].body)).toEqual({ instance: 'original' });
    await vi.advanceTimersByTimeAsync(1100); expect(env.status()).toContain('Waiting');
    env.instance('replacement'); await vi.advanceTimersByTimeAsync(1100); expect(env.status()).toContain('connected again');
    expect(env.location.reload).not.toHaveBeenCalled();
    expect(env.doc.querySelector('.draft').value).toBe('Fictional unsent draft');
    env.confirm(); expect(env.location.reload).toHaveBeenCalledOnce(); expect(posted(env)).toHaveLength(1);
  });
  it.each(['service-busy', 'restart-pending', 'unmanaged-or-unsupported', '页面授权已失效', 'restart-prepare-failed'])(
    'reports %s without polling or retrying a rejected restart', async (message) => {
      const api = vi.fn(async (path) => {
        if (path.endsWith('/restart')) throw new Error(message);
        return { instance: 'original', phase: 'ready', available: true };
      });
      const env = setup({ request: api }); await env.open(); env.confirm(); await flush();
      expect(env.doc.querySelector('.okw-service-status.is-error')).not.toBeNull();
      expect(env.doc.querySelector('dialog').getAttribute('aria-busy')).toBe('false');
      await vi.advanceTimersByTimeAsync(2000); expect(api).toHaveBeenCalledTimes(2); expect(posted(env)).toHaveLength(1);
    });
  it('recovers after an accepted POST loses its reply, without automatically posting again', async () => {
    let instance = 'original';
    const api = vi.fn(async (path) => {
      if (path.endsWith('/restart')) { instance = 'replacement'; throw new TypeError('Failed to fetch'); }
      return { instance, phase: 'ready', available: true };
    });
    const env = setup({ request: api }); await env.open(); env.confirm(); await flush();
    await vi.advanceTimersByTimeAsync(1100);
    expect(env.status()).toContain('connected again'); expect(posted(env)).toHaveLength(1);
  });
  it('bounds recovery, stops polling when closed and does not report a stale instance as successful', async () => {
    const env = setup(); await env.open(); env.confirm(); await flush();
    await vi.advanceTimersByTimeAsync(102000); expect(env.status()).toContain('not confirmed');
    expect(env.doc.querySelector('dialog').getAttribute('aria-busy')).toBe('false');
    env.cancel(); const calls = env.api.mock.calls.length; await vi.advanceTimersByTimeAsync(5000);
    expect(env.api).toHaveBeenCalledTimes(calls); expect(env.location.reload).not.toHaveBeenCalled();
  });
  it('leaves a closed dialog closed when the initial check finishes late', async () => {
    let complete;
    const env = setup({ request: vi.fn(() => new Promise((resolve) => { complete = resolve; })) });
    await env.open(); env.cancel(); complete({ instance: 'original', available: true, phase: 'ready' }); await flush();
    expect(env.doc.querySelector('dialog')).toBeNull(); expect(posted(env)).toHaveLength(0);
  });
});
