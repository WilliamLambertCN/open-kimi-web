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
    let sizeNode = null;
    let paused = false;

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

    const header = () => {
      const selector = media.matches ? '.app.mobile > .topbar .okw-workspace-status'
        : '.app:not(.mobile) > .con > .chat-header, .app:not(.mobile) > .con > .empty-drag';
      const mount = document.querySelector(selector);
      return mount?.closest('.app.panel-expanded') ? null : mount;
    };
    const eligible = () => !paused && !document.hidden && !!header();
    const stop = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      current?.controller?.abort();
      if (current) current.controller = null;
    };

    const updateNode = (node) => {
      const value = current.bytes === null ? '—' : formatBytes(current.bytes);
      const text = `${media.matches ? ' · ' : ''}会话 ${value}`;
      const title = `${explanation}${current.note}`;
      if (node.textContent !== text) node.textContent = text;
      if (node.title !== title) node.title = title;
      if (node.getAttribute('aria-label') !== title) node.setAttribute('aria-label', title);
    };

    const attachNode = (mount) => {
      mount.querySelectorAll(':scope > .okw-session-size').forEach((node) => {
        if (node !== sizeNode) node.remove();
      });
      const spacer = media.matches ? null : mount.querySelector(':scope > .ch-spacer');
      if (sizeNode.parentElement !== mount || (spacer && sizeNode.nextElementSibling !== spacer)) {
        mount.insertBefore(sizeNode, spacer);
      }
    };
    const render = () => {
      const mount = current ? header() : null;
      if (!mount) {
        sizeNode?.remove();
        sizeNode = null;
        return;
      }
      if (!sizeNode) sizeNode = document.createElement('span');
      const className = `okw-session-size${media.matches ? '' : ' okw-desktop-session-size'}`;
      if (sizeNode.className !== className) sizeNode.className = className;
      attachNode(mount);
      updateNode(sizeNode);
      if (media.matches && mount.hidden) mount.hidden = false;
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
    window.addEventListener('pagehide', () => { paused = true; stop(); });
    window.addEventListener('pageshow', () => { paused = false; sync(); });
    document.addEventListener('visibilitychange', sync);
    media.addEventListener('change', sync);

    const structure = '.app, #app, .con, .topbar, .tb-main, .okw-workspace-status, .chat-header, .empty-drag';
    const structureChanged = (node) => {
      if (node.nodeType !== 1 || node.matches('.sc, .sc-body, .chat-scroll, .history, .composer, .a-msg, .u-msg')) {
        return false;
      }
      if (node.matches(structure)) return true;
      return Array.from(node.children).some(structureChanged);
    };
    const modeChanged = (record, target) => {
      if (!target.matches('.app')) return false;
      const previous = (record.oldValue || '').split(/\s+/);
      return ['mobile', 'panel-expanded'].some((name) => previous.includes(name) !== target.classList.contains(name));
    };
    const relevant = (record) => {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (!target || target.closest('.sc, .sc-body')) return false;
      if (record.type === 'attributes') return modeChanged(record, target);
      if (target.closest('.app > .topbar, .app > .con > .chat-header, .app > .con > .empty-drag')) return true;
      const app = target.closest('.app');
      if (app && target !== app && !target.matches('.app > .con')) return false;
      return [...record.addedNodes, ...record.removedNodes].some(structureChanged);
    };
    new MutationObserver((records) => {
      if (records.some(relevant)) sync();
    }).observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true,
    });
    sync();
  }
}
