{
  const key = Symbol.for('open-kimi-web.navigation');
  if (!window[key]) {
    window[key] = true;
    const actions = new Map();
    const entries = new Map();
    const search = window.__okwNavigationCreateSearch();
    const text = (zh, en) => window.__okwLocale?.text(zh, en) ?? en;
    const make = (action, kind, icon, zh, en) => {
      const id = `${kind}:${action}`;
      if (entries.has(id)) return entries.get(id);
      const button = document.createElement('button');
      button.type = 'button'; button.className = `okw-navigation-entry is-${kind}`;
      button.dataset.okwNavigationAction = action;
      button.setAttribute('aria-haspopup', 'dialog');
      const symbol = document.createElement('span'); symbol.className = 'okw-navigation-icon';
      symbol.textContent = icon; symbol.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.className = 'okw-navigation-label';
      const localize = () => { label.textContent = text(zh, en); button.setAttribute('aria-label', text(zh, en)); };
      localize(); window.__okwLocale?.observe(localize); button.append(symbol, label);
      button.addEventListener('click', (event) => {
        if (action === 'search') search.open(event.currentTarget);
        else if (action === 'workspace') openWorkspace(event.currentTarget);
        else actions.get(action)?.(event);
      });
      entries.set(id, button); return button;
    };
    const attach = (host, node, before) => {
      if (before && node.nextElementSibling !== before) before.before(node);
      else if (node.parentElement !== host) host.append(node);
    };
    const nativeSearches = new WeakSet();
    const bindSearch = (button) => {
      if (!button || nativeSearches.has(button)) return;
      nativeSearches.add(button); button.setAttribute('aria-haspopup', 'dialog');
      button.addEventListener('click', (event) => {
        event.preventDefault(); event.stopImmediatePropagation(); search.open(event.currentTarget);
      }, true);
    };
    const appendActions = (host, kind, before) => {
      if (actions.has('cron')) attach(host, make('cron', kind, '◷', '定时任务', 'Scheduled tasks'), before);
      if (actions.has('usage')) attach(host, make('usage', kind, '◫', '使用统计', 'Usage'));
    };
    const workspace = window.__okwNavigationCreateWorkspace();
    const openWorkspace = (opener) => { workspace.open(opener); };
    const nativeWorkspaces = new WeakSet();
    const bindWorkspace = (button) => {
      if (nativeWorkspaces.has(button)) return;
      nativeWorkspaces.add(button); button.dataset.okwNavigationAction = 'workspace';
      button.setAttribute('aria-haspopup', 'dialog');
      button.addEventListener('click', (event) => {
        event.preventDefault(); event.stopImmediatePropagation(); openWorkspace(event.currentTarget);
      }, true);
    };
    const mount = () => {
      const desktop = document.querySelector('.side .sidebar-actions');
      if (desktop?.querySelector(':scope > .btn-new-chat')) {
        if (!desktop.classList.contains('okw-navigation-host')) desktop.classList.add('okw-navigation-host');
        const nativeSearch = desktop.querySelector(':scope > .search');
        const before = desktop.querySelector(':scope > [data-okw-navigation-action="cron"]') ?? nativeSearch;
        attach(desktop, make('workspace', 'desktop', '⊞', '新建工作空间', 'New workspace'), before);
        bindSearch(nativeSearch);
        appendActions(desktop, 'desktop', nativeSearch);
      }
      const mobile = document.querySelector('.sheet-panel .sheet-body > .actions');
      if (!mobile?.nextElementSibling?.classList.contains('view-tabs') ||
        mobile.querySelectorAll(':scope > button.newrow').length !== 2) return;
      if (!mobile.classList.contains('okw-navigation-host')) mobile.classList.add('okw-navigation-host');
      bindWorkspace(mobile.querySelectorAll(':scope > button.newrow')[1]);
      const mobileSearch = make('search', 'mobile', '⌕', '搜索', 'Search');
      attach(mobile, mobileSearch);
      appendActions(mobile, 'mobile', mobileSearch);
    };
    window.__okwNavigation = {
      register(action, handler) {
        if (!['usage', 'cron'].includes(action) || typeof handler !== 'function') return;
        actions.set(action, handler); mount();
      },
      refresh: mount,
      openSearch: search.open,
      closeSearch: search.close,
    };
    const entryKey = (event) => {
      const target = event.target?.closest?.(
        '.okw-navigation-entry, .okw-navigation-host > .search, .okw-navigation-host > [data-okw-navigation-action="workspace"]');
      if (!target || !['Enter', ' '].includes(event.key) || event.isComposing) return false;
      event.stopImmediatePropagation(); return true;
    };
    const searchShortcut = (event) => {
      const modifier = /Mac|iPod|iPhone|iPad/.test(navigator.platform) ? event.metaKey : event.ctrlKey;
      return modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k' && !event.defaultPrevented;
    };
    document.addEventListener('keydown', (event) => {
      if (entryKey(event) || !searchShortcut(event)) return;
      const target = document.querySelector('.okw-navigation-host > .search, [data-okw-navigation-action="search"]');
      if (!target || document.querySelector('#app')?.inert) return;
      event.preventDefault(); event.stopImmediatePropagation(); search.open(target);
    }, true);
    let scheduled = false;
    const selector = '.side, .sidebar-actions, .sheet-root, .sheet-panel, .sheet-body, .actions, .view-tabs';
    const observer = new MutationObserver((records) => {
      const relevant = records.some((record) => [...record.addedNodes, ...record.removedNodes].some((node) =>
        node.nodeType === 1 && (node.matches?.(selector) || node.querySelector?.(selector))));
      if (!relevant || scheduled) return;
      scheduled = true;
      queueMicrotask(() => { scheduled = false; mount(); });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    mount();
  }
}
