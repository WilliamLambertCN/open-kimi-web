{
  const installed = Symbol.for('open-kimi-web.session-size');
  if (!window[installed]) {
    window[installed] = true;
    const media = window.matchMedia('(max-width: 640px)');
    const api = window.__okwUsageCreateApi();
    const interval = 10_000;
    const explanation = '当前会话的日志体积（含子代理，不含图片附件），不是模型上下文 token 占用。';
    let current = null;
    let timer = null;

    const sessionId = () => {
      try {
        const match = location.pathname.match(/^\/sessions\/([^/?#]+)$/);
        return match ? decodeURIComponent(match[1]) : null;
      } catch {
        return null;
      }
    };

    const formatBytes = (bytes) => {
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let value = bytes;
      let unit = 0;
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
      }
      if (Math.round(value * 10) / 10 >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
      }
      return `${Number(value.toFixed(unit === 0 ? 0 : 1))} ${units[unit]}`;
    };

    const header = () => document.querySelector('.app.mobile .topbar .okw-workspace-status');
    const eligible = () => media.matches && !document.hidden && !!header();
    const stop = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      current?.controller?.abort();
      if (current) current.controller = null;
    };

    const updateNode = (node) => {
      const value = current.bytes === null ? '—' : formatBytes(current.bytes);
      const text = ` · 会话 ${value}`;
      const title = `${explanation}${current.note}`;
      if (node.textContent !== text) node.textContent = text;
      if (node.title !== title) node.title = title;
      if (node.getAttribute('aria-label') !== title) node.setAttribute('aria-label', title);
    };

    const render = () => {
      const status = header();
      if (!status) return;
      let node = status.querySelector('.okw-session-size');
      if (!current || !media.matches) {
        node?.remove();
        return;
      }
      if (!node) {
        node = document.createElement('span');
        node.className = 'okw-session-size';
        status.append(node);
      }
      updateNode(node);
      if (status.hidden) status.hidden = false;
    };

    const schedule = () => {
      if (timer !== null || !eligible() || !current) return;
      timer = window.setTimeout(() => {
        timer = null;
        void refresh();
      }, interval);
    };

    const applyResult = (state, result) => {
      const valid = result?.available === true && Number.isSafeInteger(result.bytes) && result.bytes >= 0;
      state.bytes = valid ? result.bytes : null;
      state.note = valid ? '' : result?.reason === 'unmanaged_target'
        ? '当前不是受管本机后端，无法计量。' : '当前会话日志暂时无法计量。';
    };
    const activeRequest = (state, controller) => current === state && state.controller === controller;

    const refresh = async () => {
      if (!eligible() || !current || current.controller) return;
      const state = current;
      const controller = new AbortController();
      state.controller = controller;
      try {
        const result = await api(`/__open-kimi-mobile/session-size?session_id=${encodeURIComponent(state.id)}`, {
          signal: controller.signal,
        });
        if (activeRequest(state, controller)) applyResult(state, result);
      } catch {
        if (!activeRequest(state, controller)) return;
        state.bytes = null;
        state.note = '读取失败或页面授权未就绪，将自动重试。';
      } finally {
        if (activeRequest(state, controller)) {
          state.controller = null;
          render();
          schedule();
        }
      }
    };

    const sync = () => {
      const id = sessionId();
      if (current?.id !== id) {
        stop();
        current = id ? { id, bytes: null, note: '正在读取。', controller: null } : null;
        render();
        if (current) void refresh();
      } else {
        render();
        if (!eligible()) stop();
        else if (timer === null && !current?.controller) void refresh();
      }
    };

    for (const name of ['pushState', 'replaceState']) {
      const original = history[name];
      history[name] = function sessionSizeHistory() {
        const result = original.apply(this, arguments);
        sync();
        return result;
      };
    }
    window.addEventListener('popstate', sync);
    window.addEventListener('pagehide', stop);
    document.addEventListener('visibilitychange', sync);
    media.addEventListener('change', sync);

    const relevant = (record) => {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (target?.closest('.sc-body')) return false;
      if (target?.closest('.app.mobile .topbar')) return true;
      return Array.from(record.addedNodes).some((node) => node.nodeType === 1 &&
        (node.matches('.app, .topbar, .tb-main, .okw-workspace-status') || node.id === 'app'));
    };
    new MutationObserver((records) => {
      if (records.some(relevant)) sync();
    }).observe(document.documentElement, { childList: true, subtree: true });
    sync();
  }
}
