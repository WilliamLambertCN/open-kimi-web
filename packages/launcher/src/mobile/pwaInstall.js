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
        ios: ios(), secure: window.isSecureContext === true,
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
    const close = () => {
      if (!state.opened) return;
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
      state.opened = true; state.ui.root.hidden = false; protect();
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
