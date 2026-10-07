{
  const installed = Symbol.for('open-kimi-web.tab-feedback');
  if (!window[installed]) {
    window[installed] = true;
    const pending = new Map();
    const sessionRows = '.side .se, .sheet-root .mlist .srow, .sheet-root .mlist .srow-flat';
    const categoryTabs = '.side .status-tabs .status-seg .ui-seg__item[role="tab"]';
    const panelTabs = '.panel-tab-bar .ptb-tab-main[role="tab"]';
    const selectedPanel = () => document.querySelector('.panel-tab-bar .ptb-tab.on')?.dataset.panelTabId;
    const sessionId = () => {
      const match = location.pathname.match(/^\/sessions\/([^/?#]+)/);
      try { return match ? decodeURIComponent(match[1]) : null; } catch { return null; }
    };
    const afterPaint = () => new Promise((resolve) => {
      let frame;
      const finish = () => { clearTimeout(fallback); cancelAnimationFrame(frame); resolve(); };
      const fallback = setTimeout(finish, 100);
      frame = requestAnimationFrame(() => setTimeout(finish, 0));
    });
    const clear = (kind, entry = pending.get(kind)) => {
      if (!entry || pending.get(kind) !== entry) return;
      pending.delete(kind);
      clearTimeout(entry.timeout);
      entry.node.remove();
    };
    const hostFor = (kind) => document.querySelector(kind === 'panel' ? '.pt-body'
      : kind === 'category' ? '.side .sessions' : '.panes.chat-scroll');
    const position = (entry) => {
      const host = hostFor(entry.kind);
      if (!host) return false;
      const rect = host.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return false;
      entry.node.style.left = `${Math.max(8, rect.left + rect.width / 2)}px`;
      entry.node.style.top = `${Math.max(8, rect.top + Math.min(24, rect.height / 2))}px`;
      return true;
    };
    const nativeLoading = (kind) => kind !== 'category' && document.querySelector(kind === 'panel'
      ? '.pt-body .fp-loading' : '.panes.chat-scroll .chat-loading');
    const targetChanged = (entry) => {
      if (!entry.target) return false;
      if (entry.kind === 'panel') return selectedPanel() !== entry.target;
      if (entry.kind === 'session') return sessionId() !== entry.target;
      return !entry.target.isConnected || entry.target.getAttribute('aria-selected') !== 'true';
    };
    const reconcile = (entry) => {
      if (pending.get(entry.kind) !== entry || !entry.painted) return;
      if (!position(entry) || targetChanged(entry)) return clear(entry.kind, entry);
      if (nativeLoading(entry.kind) || entry.requests === 0) clear(entry.kind, entry);
    };
    const begin = (kind, target) => {
      clear(kind);
      const node = document.createElement('div');
      node.className = 'okw-tab-feedback';
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', 'polite');
      const spinner = document.createElement('span');
      spinner.className = 'okw-tab-feedback-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      const chinese = (document.documentElement.lang || navigator.language).toLowerCase().startsWith('zh');
      text.textContent = chinese ? '载入中…' : 'Loading…';
      node.append(spinner, text);
      const entry = { kind, target, node, requests: 0, painted: false, route: sessionId() };
      pending.set(kind, entry);
      document.body.append(node);
      position(entry);
      entry.timeout = setTimeout(() => clear(kind, entry), 15000);
      void afterPaint().then(() => { entry.painted = true; reconcile(entry); });
    };
    const observeTab = (target) => {
      if (target.getAttribute('aria-selected') === 'true') return;
      if (target.matches(panelTabs)) begin('panel', target.closest('[data-panel-tab-id]')?.dataset.panelTabId);
      else begin('category', target);
    };
    const observeClick = (event) => {
      const target = event.target.closest?.('button, .se, .srow, .srow-flat');
      if (!target) return;
      if (target.closest('.panel-tab-bar .ptb-x')) return clear('panel');
      if (target.matches(`${panelTabs}, ${categoryTabs}`)) return observeTab(target);
      if (!target.matches(sessionRows) || target.matches('.on, .cur')) return;
      clear('panel');
      begin('session', target.dataset.sessionId || null);
    };
    document.addEventListener('click', observeClick, true);
    document.addEventListener('keydown', (event) => {
      if (!event.target.matches?.(panelTabs) || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      begin('panel', null);
    }, true);
    const sessionRequestMatches = (entry, id) => {
      if (!entry.target && !entry.requests && id !== entry.route) entry.target = id;
      return id === (entry.target || sessionId());
    };
    const matchRequest = (match, method) => {
      const kind = match[2] === 'transcript' ? 'session' : 'panel';
      if (method !== (kind === 'session' ? 'GET' : 'POST')) return;
      const entry = pending.get(kind);
      if (!entry) return;
      const id = decodeURIComponent(match[1]);
      if (kind === 'session') return sessionRequestMatches(entry, id) ? entry : undefined;
      if (id !== sessionId() || targetChanged(entry)) return;
      return entry;
    };
    const requestEntry = (input, init) => {
      const raw = typeof input === 'string' || input instanceof URL ? input : input.url;
      const url = new URL(raw, location.href);
      if (url.origin !== location.origin) return;
      const method = (init?.method ?? input.method ?? 'GET').toUpperCase();
      const match = url.pathname.match(/^\/api\/v1\/sessions\/([^/]+)\/(transcript|fs:read)$/);
      if (match) return matchRequest(match, method);
      if (method === 'GET' && url.pathname === '/api/v2/sessions') return pending.get('category');
    };
    const nativeFetch = window.fetch;
    if (typeof nativeFetch === 'function') {
      window.fetch = async function tabFeedbackFetch(input, init) {
        let entry;
        try { entry = requestEntry(input, init); } catch { /* Leave unsupported requests unchanged. */ }
        if (entry) entry.requests += 1;
        try {
          const response = await nativeFetch.apply(this, arguments);
          if (entry && pending.get(entry.kind) === entry && !entry.painted) await afterPaint();
          return response;
        } finally {
          if (entry) {
            entry.requests -= 1;
            setTimeout(() => reconcile(entry), 0);
          }
        }
      };
    }
    let scheduled = false;
    new MutationObserver(() => {
      if (!pending.size || scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        for (const entry of pending.values()) reconcile(entry);
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('popstate', () => { for (const kind of pending.keys()) clear(kind); });
    window.addEventListener('pagehide', () => { for (const kind of pending.keys()) clear(kind); });
    window.addEventListener('resize', () => { for (const entry of pending.values()) position(entry); });
  }
}
