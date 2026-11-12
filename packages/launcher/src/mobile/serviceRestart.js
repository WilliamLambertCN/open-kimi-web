{
  const key = Symbol.for('open-kimi-web.service-restart');
  if (!window[key]) {
    window[key] = true;
    const view = window.__okwServiceRestartView;
    const api = window.__okwUsageCreateApi();
    const prefix = '/__open-kimi-mobile/service/';
    const mounts = new Map();
    let current;
    const requestError = (code) => {
      if (['service-busy', 'request-in-flight'].includes(code)) return 'busy';
      if (code === 'restart-pending') return 'pending';
      if (code === 'unmanaged-or-unsupported') return 'unavailable';
      if (/授权|authorization/i.test(code)) return 'auth';
      return /^(restart-|backend-|idle-|invalid|stale-|body-|cross-|not-found|method-)/.test(code) ? 'rejected' : 'request';
    };
    const request = async (path, body) => {
      try {
        const result = await api(prefix + path, { method: body ? 'POST' : 'GET', credentials: 'same-origin',
          redirect: 'error', signal: AbortSignal.timeout(6000), ...(body ? { body: JSON.stringify(body) } : {}) });
        if (typeof result?.instance !== 'string' || typeof result?.phase !== 'string') throw new Error('invalid-response');
        return result;
      } catch (error) { throw new Error(requestError(error.message)); }
    };
    const render = (state) => {
      const words = view.copy(); const { ui } = state;
      view.setText(ui.title, words.title); view.setText(ui.explanation, words.confirm); view.setText(ui.draft, words.draft);
      view.setText(ui.status, state.error ? words[state.error] : state.phase === 'confirm' ? '' : words[state.phase] ?? '');
      ui.status.classList.toggle('is-error', !!state.error);
      ui.confirm.hidden = !!state.error || state.phase === 'restarting';
      ui.confirm.disabled = !['confirm', 'ready'].includes(state.phase);
      view.setText(ui.confirm, words[state.phase === 'ready' ? 'refresh' : 'title']);
      view.setText(ui.cancel, words[['loading', 'confirm'].includes(state.phase) && !state.error ? 'cancel' : 'close']);
      view.attr(ui.root, 'aria-busy', !state.error && ['loading', 'checking', 'restarting'].includes(state.phase));
    };
    const close = (state) => {
      state.closed = true; clearTimeout(state.timer); state.ui.root.close(); state.ui.root.remove();
      if (current === state) current = null;
      if (state.trigger.isConnected) state.trigger.focus({ preventScroll: true });
    };
    const reconnect = async (state) => {
      if (state.closed) return;
      try {
        const result = await request('status');
        if (state.closed) return;
        if (result.instance !== state.instance && result.phase === 'ready') {
          state.phase = 'ready'; state.error = ''; render(state); return;
        }
      } catch {}
      if (state.closed) return;
      if (Date.now() > state.deadline) { state.error = 'failed'; render(state); return; }
      state.timer = window.setTimeout(() => reconnect(state), 1000);
    };
    const confirm = async (state) => {
      if (state.phase === 'ready') { location.reload(); return; }
      if (state.phase !== 'confirm' || state.error) return;
      state.phase = 'checking'; render(state);
      try { await request('restart', { instance: state.instance }); }
      catch (error) {
        if (error.message !== 'request') { state.error = error.message; if (!state.closed) render(state); return; }
      }
      if (state.closed) return;
      state.phase = 'restarting'; state.deadline = Date.now() + 100000; render(state);
      state.timer = window.setTimeout(() => reconnect(state), 1000);
    };
    const open = async (trigger) => {
      if (current) return;
      const state = { ui: view.dialog(), trigger, phase: 'loading', error: '', closed: false };
      current = state;
      state.ui.cancel.addEventListener('click', () => close(state));
      state.ui.confirm.addEventListener('click', () => confirm(state));
      state.ui.root.addEventListener('cancel', (event) => { event.preventDefault(); close(state); });
      document.body.append(state.ui.root); render(state); state.ui.root.showModal(); state.ui.cancel.focus();
      try {
        const result = await request('status');
        if (state.closed) return;
        state.instance = result.instance;
        state.error = result.available ? result.phase === 'ready' ? '' : 'pending' : 'unavailable';
        state.phase = 'confirm'; render(state);
      } catch (error) { if (!state.closed) { state.error = error.message; render(state); } }
    };
    window.addEventListener('keydown', (event) => {
      if (!current?.ui.root.open) return;
      event.stopImmediatePropagation();
      if (event.key === 'Escape') { event.preventDefault(); close(current); }
    }, true);
    const settingsBodies = () => {
      const result = [];
      document.querySelectorAll('.sheet-panel[role="dialog"]').forEach((panel) => {
        const title = panel.getAttribute('aria-label') ?? panel.querySelector('.sheet-title')?.textContent;
        const body = panel.querySelector('.sheet-body');
        if (['会话设置', 'session settings', '设置', 'settings'].includes(title?.trim().toLowerCase()) &&
            body?.querySelector('.cache-note')) result.push([body, true]);
      });
      document.querySelectorAll('.ui-dialog[role="dialog"] .sd').forEach((settings) => {
        const tabs = [...settings.querySelectorAll('.settings-tabs [role="tab"]')];
        const index = tabs.findIndex((node) => ['通用', 'general'].includes(node.textContent.trim().toLowerCase()));
        const panel = index >= 0 && settings.querySelectorAll('.panel')[index];
        if (panel && !panel.closest('[hidden]')) result.push([panel, false]);
      });
      return result;
    };
    const sync = () => {
      for (const [body, ui] of mounts) if (!body.isConnected) { ui.section.remove(); mounts.delete(body); }
      for (const [body, mobile] of settingsBodies()) {
        let ui = mounts.get(body);
        if (!ui) {
          ui = view.trigger(mobile); mounts.set(body, ui);
          ui.button.addEventListener('click', () => open(ui.button)); body.append(ui.section);
        }
        view.localizeTrigger(ui);
      }
      if (current) render(current);
    };
    let queued = false;
    const schedule = () => {
      if (queued) return;
      queued = true; queueMicrotask(() => { queued = false; sync(); });
    };
    const settingsSelector = '.sheet-panel, .ui-dialog, .sd, .okw-service-dialog';
    const relevant = (node) => node.nodeType === 1 &&
      (node.matches(settingsSelector) || node.querySelector(settingsSelector));
    new MutationObserver((records) => {
      if (records.some((record) => record.target.closest?.(settingsSelector) ||
          [...record.addedNodes, ...record.removedNodes].some(relevant))) schedule();
    }).observe(document.documentElement, { childList: true, subtree: true });
    window.__okwLocale?.observe(schedule);
    schedule();
  }
}
