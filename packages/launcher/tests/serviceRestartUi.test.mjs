/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, flush, replyAfter, setup } from './testkit/serviceRestart.mjs';

afterEach(cleanup);
const posted = (env) => env.api.mock.calls.filter(([, init]) => init.method === 'POST');

describe('service restart settings interaction', () => {
  it.each([true, false])('mounts once in native settings, mobile=%s, without service requests until clicked', async (mobile) => {
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

describe('service restart request outcomes', () => {
  it('waits through 25 seconds of preparation before showing an accepted restart', async () => {
    const fetchImpl = vi.fn(async (path, init) => {
      if (path.endsWith('/restart')) {
        return replyAfter(25000, { instance: 'original', phase: 'restarting' }, init.signal, 202);
      }
      return Response.json({ instance: 'original', phase: 'ready', available: true });
    });
    const env = setup({ fetchImpl }); await env.open(); env.confirm(); env.confirm(); await flush();
    expect(env.status()).toContain('preparing'); expect(env.status()).not.toContain('Restarting.');
    expect(env.timeout.mock.calls.map(([ms]) => ms)).toEqual([6000, 30000]);
    const signal = posted(env)[0][1].signal;
    await vi.advanceTimersByTimeAsync(6000);
    expect(signal.aborted).toBe(false); expect(env.status()).toContain('preparing');
    await vi.advanceTimersByTimeAsync(19000);
    expect(signal.aborted).toBe(false); expect(env.status()).toContain('Restarting.');
    expect(fetchImpl).toHaveBeenCalledTimes(2); expect(posted(env)).toHaveLength(1);
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({ credentials: 'same-origin', redirect: 'error',
      headers: { authorization: 'Bearer fictional-restart-token', 'content-type': 'application/json' } });
    expect(env.location.reload).not.toHaveBeenCalled();
    expect(env.doc.querySelector('.draft').value).toBe('Fictional unsent draft');
  });
  it.each(['ready', 'checking', 'prepared', 'unknown', undefined])(
    'does not treat a POST reply with phase %s as an accepted restart', async (phase) => {
      const fetchImpl = vi.fn(async (path) => Response.json(path.endsWith('/restart')
        ? { instance: 'original', phase } : { instance: 'original', phase: 'ready', available: true }));
      const env = setup({ fetchImpl }); await env.open(); env.confirm(); await flush();
      expect(env.status()).toContain('outcome is unknown'); expect(env.status()).not.toContain('Restarting.');
      expect(env.doc.querySelector('.okw-service-actions button:last-child').hidden).toBe(true);
      env.confirm(); await vi.advanceTimersByTimeAsync(1100);
      expect(env.status()).toContain('was not restarted'); expect(posted(env)).toHaveLength(1);
      const calls = env.api.mock.calls.length; await vi.advanceTimersByTimeAsync(3000);
      expect(env.api).toHaveBeenCalledTimes(calls); expect(env.location.reload).not.toHaveBeenCalled();
      expect(env.doc.querySelector('.draft').value).toBe('Fictional unsent draft');
    });
  it('stops on the original ready instance after a network failure without retrying the POST', async () => {
    const fetchImpl = vi.fn(async (path) => {
      if (path.endsWith('/restart')) throw new TypeError('Failed to fetch');
      return Response.json({ instance: 'original', phase: 'ready', available: true });
    });
    const env = setup({ fetchImpl }); await env.open(); env.confirm(); await flush();
    expect(env.status()).toContain('Checking service status without sending another restart request');
    env.locale('zh'); await env.settle(); expect(env.status()).toContain('只读核实'); expect(env.status()).toContain('请勿再次发送');
    env.locale('en'); await env.settle(); env.confirm(); await vi.advanceTimersByTimeAsync(1100);
    expect(env.status()).toContain('was not restarted');
    expect(env.doc.querySelector('dialog').getAttribute('aria-busy')).toBe('false');
    env.confirm(); await vi.advanceTimersByTimeAsync(5000);
    expect(fetchImpl).toHaveBeenCalledTimes(3); expect(posted(env)).toHaveLength(1);
    expect(env.location.reload).not.toHaveBeenCalled();
    expect(env.doc.querySelector('.draft').value).toBe('Fictional unsent draft');
  });
});

describe('service restart read-only verification', () => {
  it.each(['restart-outcome-unknown', 'restart-exit-unconfirmed'])('verifies %s without resending', async (error) => {
    let instance = 'original';
    const fetchImpl = vi.fn(async (path) => path.endsWith('/restart') ? Response.json({ error }, { status: 503 }) :
      Response.json({ instance, phase: 'ready', available: true }));
    const env = setup({ fetchImpl }); await env.open(); env.confirm(); await flush();
    expect(env.status()).toContain('outcome is unknown');
    instance = 'replacement'; await vi.advanceTimersByTimeAsync(1100);
    expect(env.status()).toContain('connected again'); expect(posted(env)).toHaveLength(1);
  });
  it('uses only status reads after a POST timeout until a different instance is ready', async () => {
    let instance = 'original'; let phase = 'ready';
    const fetchImpl = vi.fn(async (path, init) => {
      if (path.endsWith('/restart')) {
        phase = 'checking';
        return replyAfter(40000, { instance, phase: 'restarting' }, init.signal, 202);
      }
      return Response.json({ instance, phase, available: true });
    });
    const env = setup({ fetchImpl }); await env.open(); env.confirm(); await flush();
    await vi.advanceTimersByTimeAsync(30000);
    expect(posted(env)[0][1].signal.aborted).toBe(true);
    expect(posted(env)[0][1].signal.reason.name).toBe('TimeoutError');
    expect(env.status()).toContain('outcome is unknown'); expect(env.status()).toContain('Do not resend');
    for (const preparing of ['checking', 'prepared']) {
      phase = preparing; env.confirm(); await vi.advanceTimersByTimeAsync(1100);
      expect(env.status()).toContain('outcome is unknown'); expect(env.status()).not.toContain('Restarting.');
    }
    phase = 'restarting'; await vi.advanceTimersByTimeAsync(1100); expect(env.status()).toContain('Restarting.');
    instance = 'replacement'; phase = 'checking'; await vi.advanceTimersByTimeAsync(1100);
    expect(env.status()).not.toContain('connected again');
    phase = 'ready'; await vi.advanceTimersByTimeAsync(1100); expect(env.status()).toContain('connected again');
    expect(posted(env)).toHaveLength(1);
    expect(env.api.mock.calls.slice(2).every(([path, init]) => path.endsWith('/status') && init.method === 'GET')).toBe(true);
    expect(env.location.reload).not.toHaveBeenCalled();
    expect(env.doc.querySelector('.draft').value).toBe('Fictional unsent draft');
  });
  it('stops after an accepted restart cannot commit and the original instance returns to ready', async () => {
    const env = setup(); await env.open(); env.confirm(); await flush();
    expect(env.status()).toContain('Restarting.'); env.phase('ready');
    await vi.advanceTimersByTimeAsync(1100); expect(env.status()).toContain('was not restarted');
    env.locale('zh'); await env.settle(); expect(env.status()).toContain('服务未重启，原实例仍在运行');
    expect(env.doc.querySelector('dialog').getAttribute('aria-busy')).toBe('false');
    env.confirm(); const calls = env.api.mock.calls.length; await vi.advanceTimersByTimeAsync(5000);
    expect(env.api).toHaveBeenCalledTimes(calls); expect(posted(env)).toHaveLength(1);
    expect(env.location.reload).not.toHaveBeenCalled();
    expect(env.doc.querySelector('.draft').value).toBe('Fictional unsent draft');
  });
});

describe('service restart recovery', () => {
  it.each([true, false])('submits once and preserves drafts until manual refresh, mobile=%s', async (mobile) => {
    const env = setup({ mobile }); await env.open(); env.confirm(); env.confirm(); await flush();
    expect(posted(env)).toHaveLength(1); expect(JSON.parse(posted(env)[0][1].body)).toEqual({ instance: 'original' });
    const response = await env.fetch.mock.results.find((_, index) => env.fetch.mock.calls[index][1].method === 'POST').value;
    expect(response.status).toBe(202); expect(env.status()).toContain('Restarting.');
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
  it.each([
    ['live-inventory-unavailable', 'cannot check all running sessions'],
    ['atomic-restart-unavailable', 'cannot safely hand off a restart'],
  ])('explains %s in status without sending a POST', async (reason, message) => {
    const fetchImpl = vi.fn(async () => Response.json({ instance: 'original', phase: 'ready', available: false, reason }));
    const env = setup({ fetchImpl }); await env.open();
    expect(env.status()).toContain(message); expect(env.status()).toContain('Verify it is idle');
    expect(env.status()).toContain('terminal');
    if (reason === 'atomic-restart-unavailable') expect(env.status()).toContain('restart it manually');
    env.locale('zh'); await env.settle(); expect(env.status()).toContain('服务不会停止');
    expect(env.status()).toContain('原终端确认空闲后');
    env.confirm(); expect(posted(env)).toHaveLength(0);
  });
  it('explains an atomic handoff rejection from POST without polling or losing drafts', async () => {
    const fetchImpl = vi.fn(async (path) => Response.json(path.endsWith('/restart')
      ? { error: 'atomic-restart-unavailable' } : { instance: 'original', phase: 'ready', available: true },
    { status: path.endsWith('/restart') ? 409 : 200 }));
    const env = setup({ fetchImpl }); await env.open(); env.confirm(); await flush();
    expect(env.status()).toContain('Verify it is idle, then restart it manually in the original terminal');
    env.locale('zh'); await env.settle(); expect(env.status()).toContain('原终端确认空闲后手动重启');
    expect(env.doc.querySelector('dialog').getAttribute('aria-busy')).toBe('false');
    await vi.advanceTimersByTimeAsync(2000); expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(posted(env)).toHaveLength(1); expect(env.location.reload).not.toHaveBeenCalled();
    expect(env.doc.querySelector('.draft').value).toBe('Fictional unsent draft');
  });
  it('recovers after an accepted POST loses its reply, without automatically posting again', async () => {
    let instance = 'original';
    const fetchImpl = vi.fn(async (path) => {
      if (path.endsWith('/restart')) { instance = 'replacement'; throw new TypeError('Failed to fetch'); }
      return Response.json({ instance, phase: 'ready', available: true });
    });
    const env = setup({ fetchImpl }); await env.open(); env.confirm(); await flush();
    expect(env.status()).toContain('outcome is unknown'); expect(env.status()).toContain('Do not resend');
    expect(env.status()).not.toContain('Restarting.'); env.confirm();
    await vi.advanceTimersByTimeAsync(1100);
    expect(env.status()).toContain('connected again'); expect(posted(env)).toHaveLength(1);
    expect(env.location.reload).not.toHaveBeenCalled();
    expect(env.doc.querySelector('.draft').value).toBe('Fictional unsent draft');
  });
  it('bounds recovery while restart is pending and stops polling when closed', async () => {
    const env = setup(); await env.open(); env.confirm(); await flush();
    await vi.advanceTimersByTimeAsync(102000); expect(env.status()).toContain('not confirmed');
    expect(env.status()).toContain('do not resend the request');
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
