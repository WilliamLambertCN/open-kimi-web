{
  const installed = Symbol.for('open-kimi-web.sidechat-identity');
  if (!window[installed]) {
    window[installed] = true;
    const prefix = 'kimi-web.panel-tabs.v1:';
    const snapshots = new Map();
    const bindings = new WeakMap();
    const bound = new Set();
    let storage;
    let pending = false;
    try { storage = window.localStorage; } catch {}
    const validId = (id) => typeof id === 'string' && /^[\w-]{1,200}$/.test(id);
    const session = () => {
      const match = /^\/sessions\/([^/]+)\/?$/.exec(location.pathname);
      return match && validId(match[1]) ? match[1] : null;
    };
    let activeSession = session();
    let routeReady = true;
    const routeChanged = () => {
      const next = session();
      if (next !== activeSession) { activeSession = next; routeReady = false; }
      schedule();
    };
    const changed = () => window.dispatchEvent(new Event('okw-sidechat-identity'));
    const parse = (id, value) => {
      try {
        if (!value || value.length > 1024 * 1024) return null;
        const data = JSON.parse(value);
        if (!Array.isArray(data.tabs) || data.tabs.length > 100 || !Number.isSafeInteger(data.activeIndex)) return null;
        const tabs = data.tabs.map((tab) => {
          const payload = tab?.payload;
          return tab?.type === 'btw' && payload?.parentId === id && validId(payload.agentId) &&
            payload.agentId !== 'main' && Number.isSafeInteger(payload.seq) && payload.seq > 0
            ? { session: id, agent: payload.agentId } : null;
        });
        const agents = tabs.filter(Boolean).map((tab) => tab.agent);
        if (new Set(agents).size !== agents.length) return null;
        return { tabs, active: data.activeIndex, visible: data.visible === true };
      } catch { return null; }
    };
    const remember = (id, value) => {
      if (!validId(id)) return;
      snapshots.delete(id); snapshots.set(id, parse(id, value));
      while (snapshots.size > 4) snapshots.delete(snapshots.keys().next().value);
    };
    const snapshot = (id) => {
      if (snapshots.has(id)) return snapshots.get(id);
      try { remember(id, storage?.getItem(prefix + id)); } catch { remember(id, null); }
      return snapshots.get(id);
    };
    const panelTab = (root, data) => {
      const tabs = [...root.querySelectorAll('.panel-tab-bar .ptb-tab[data-panel-tab-id]')];
      if (tabs.length !== data.tabs.length || tabs.filter((tab) => tab.classList.contains('on')).length !== 1) return null;
      const ids = tabs.map((tab) => tab.dataset.panelTabId);
      if (ids.some((value) => !value) || new Set(ids).size !== ids.length) return null;
      return tabs[data.active]?.classList.contains('on') ? ids[data.active] : null;
    };
    const resolve = (sc) => {
      if (!routeReady) return null;
      const id = session();
      const root = sc.closest('.pt-body')?.parentElement;
      if (!id || !root || root.querySelectorAll('.sc').length !== 1) return null;
      const data = snapshot(id);
      if (!data?.visible || !data.tabs[data.active]) return null;
      const tab = panelTab(root, data);
      return tab ? { ...data.tabs[data.active], tab } : null;
    };
    const fingerprint = (value) => value ? JSON.stringify([value.session, value.agent, value.tab]) : '';
    const update = (sc) => {
      const next = sc.isConnected ? resolve(sc) : null;
      if (fingerprint(bindings.get(sc)) === fingerprint(next)) return false;
      if (next) { bindings.set(sc, next); bound.add(sc); }
      else { bindings.delete(sc); bound.delete(sc); }
      return true;
    };
    const refresh = () => {
      pending = false;
      let dirty = false;
      for (const sc of new Set([...bound, ...document.querySelectorAll('.sc')])) dirty = update(sc) || dirty;
      if (dirty) changed();
    };
    const schedule = () => { if (!pending) { pending = true; queueMicrotask(refresh); } };
    const observeStorage = () => {
      if (!storage) return;
      const prototype = window.Storage.prototype;
      const set = prototype.setItem;
      const remove = prototype.removeItem;
      const clear = prototype.clear;
      prototype.setItem = function sideChatPanelSet(key, value) {
        const result = set.apply(this, arguments);
        if (this === storage && String(key).startsWith(prefix)) {
          const id = String(key).slice(prefix.length);
          remember(id, String(value));
          if (id === activeSession) routeReady = true;
          schedule();
        }
        return result;
      };
      prototype.removeItem = function sideChatPanelRemove(key) {
        const result = remove.apply(this, arguments);
        if (this === storage && String(key).startsWith(prefix)) { remember(String(key).slice(prefix.length), null); schedule(); }
        return result;
      };
      prototype.clear = function sideChatPanelClear() {
        const result = clear.apply(this, arguments);
        if (this === storage) { snapshots.clear(); schedule(); }
        return result;
      };
    };
    const relevant = (node) => node.nodeType === 1 && (node.matches('.sc, .pt-body, .ptb-tab') ||
      !!node.querySelector('.sc, .pt-body, .ptb-tab'));
    const start = () => {
      refresh();
      new MutationObserver((records) => {
        if (records.some((record) => record.type === 'attributes' ? record.target.matches('.ptb-tab') :
          [...record.addedNodes, ...record.removedNodes].some(relevant))) schedule();
      }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    };
    for (const method of ['pushState', 'replaceState']) {
      const native = history[method];
      history[method] = function sideChatRoute() {
        const result = native.apply(this, arguments);
        routeChanged();
        return result;
      };
    }
    window.addEventListener('popstate', routeChanged);
    observeStorage();
    window.__okwSideChatIdentity = {
      session, refresh,
      identity: (sc) => {
        if (!sc?.isConnected) return null;
        const result = resolve(sc);
        return result ? { session: result.session, agent: result.agent } : null;
      },
      has: (id, agent) => snapshots.get(id)?.tabs.some((tab) => tab?.agent === agent) === true,
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
}
