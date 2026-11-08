{
  const key = Symbol.for('open-kimi-web.pwa-install');
  if (!window[key]) {
    window[key] = true;
    const media = window.matchMedia?.('(display-mode: standalone)');
    const state = { installed: false, opened: false, phase: 'manual', inert: [] };
    const standalone = () => Boolean(media?.matches || navigator.standalone);
    const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const unavailable = () => state.installed || standalone();
    const render = () => {
      const blocked = unavailable();
      window.__okwNavigation.setVisible('install', !blocked);
      state.ui?.render({
        phase: state.installed ? 'installed' : standalone() ? 'standalone' : currentPhase(),
        ios: ios(), secure: window.isSecureContext === true, ca: state.ca,
        available: !blocked && Boolean(state.deferred || state.flight), busy: Boolean(state.flight),
      });
      if (state.opened && document.activeElement === state.ui.submit &&
        (state.ui.submit.hidden || state.ui.submit.disabled)) state.ui.dismiss.focus();
    };
    const currentPhase = () => {
      if (state.flight) return 'prompting';
      if (state.deferred) return 'ready';
      return window.isSecureContext === true ? state.phase : 'insecure';
    };
    const protect = () => {
      for (const node of document.querySelectorAll('#app, .sheet-root')) {
        if (state.inert.some(([previous]) => previous === node)) continue;
        state.inert.push([node, node.inert]); node.inert = true;
      }
    };
    const observer = new MutationObserver(() => { if (state.opened) protect(); });
    const cancelCa = () => {
      const request = state.caRequest; state.caRequest = undefined;
      if (request) { clearTimeout(request.timer); request.controller.abort(); }
    };
    const validExpiry = (value) => {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
      const expires = new Date(value); const canonical = value.includes('.') ? value : value.replace('Z', '.000Z');
      return Number.isFinite(expires.getTime()) && expires.getTime() > Date.now() && expires.toISOString() === canonical;
    };
    const validCa = (data) => data?.source === 'local-ca' && typeof data.fingerprint === 'string' &&
      data.fingerprint.length === 95 && /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(data.fingerprint) && validExpiry(data.expiresAt);
    const loadCa = async () => {
      cancelCa(); state.ca = undefined;
      const request = { controller: new AbortController() }; state.caRequest = request;
      request.timer = setTimeout(() => { if (state.caRequest === request) cancelCa(); }, 5000);
      try {
        const response = await fetch('/__open-kimi-mobile/tls/status', {
          credentials: 'omit', cache: 'no-store', redirect: 'error', signal: request.controller.signal,
        });
        if (!response.ok || state.caRequest !== request) return;
        const data = await response.json();
        if (!state.opened || state.caRequest !== request || !validCa(data)) return;
        state.ca = { fingerprint: data.fingerprint }; render();
      } catch { return; }
      finally {
        if (state.caRequest === request) { clearTimeout(request.timer); state.caRequest = undefined; }
      }
    };
    const close = () => {
      if (!state.opened) return;
      cancelCa(); state.ca = undefined;
      state.opened = false; state.ui.root.hidden = true; observer.disconnect();
      for (const [node, previous] of state.inert) if (node.isConnected) node.inert = previous;
      state.inert = []; document.documentElement.classList.remove('okw-pwa-install-open');
      const fallback = document.querySelector('.app.mobile .topbar .tb-main, .side .sidebar-actions .btn-new-chat');
      (state.opener?.isConnected && !state.opener.hidden ? state.opener : fallback)?.focus();
    };
    const finish = (flight, phase) => {
      if (state.flight !== flight) return;
      state.flight = undefined; state.phase = phase; render();
    };
    const install = () => {
      if (unavailable() || state.flight || !state.deferred) return;
      const event = state.deferred; const flight = {};
      state.deferred = undefined; state.flight = flight; render();
      try {
        const result = event.prompt();
        Promise.resolve(result).then((choice) => event.userChoice ?? choice).then((choice) => {
          finish(flight, choice?.outcome === 'accepted' ? 'accepted' : 'dismissed');
        }, () => finish(flight, 'failed'));
      } catch { finish(flight, 'failed'); }
    };
    const open = (event) => {
      if (unavailable()) return;
      if (state.opened) { state.ui.dismiss.focus(); return; }
      if (document.querySelector('#app')?.inert) return;
      state.opener = event.currentTarget;
      state.ui ??= window.__okwPwaInstallBuildView({ close, install });
      state.opened = true; state.ui.root.hidden = false; protect(); void loadCa();
      observer.observe(document.body, { childList: true, subtree: true });
      document.documentElement.classList.add('okw-pwa-install-open'); render(); state.ui.dismiss.focus();
    };
    window.addEventListener('keydown', (event) => {
      if (!state.opened) return;
      const dialog = event.target?.closest?.('[role="dialog"], dialog');
      if (dialog && dialog !== state.ui.panel) return;
      window.__okwNavigationSearchKey(event, { panel: state.ui.panel, close });
    }, true);
    window.addEventListener('beforeinstallprompt', (event) => {
      if (window.isSecureContext !== true || unavailable() || typeof event.prompt !== 'function') return;
      event.preventDefault(); state.deferred = event; render();
    });
    const invalidate = () => {
      state.deferred = undefined; state.flight = undefined; state.phase = 'manual'; render();
    };
    window.addEventListener('appinstalled', () => { state.installed = true; invalidate(); });
    const displayChanged = () => { if (standalone()) invalidate(); else render(); };
    if (media?.addEventListener) media.addEventListener('change', displayChanged);
    else media?.addListener?.(displayChanged);
    window.addEventListener('pageshow', displayChanged);
    window.__okwLocale?.observe(render);
    window.__okwNavigation.register('install', open); render();
  }
}
