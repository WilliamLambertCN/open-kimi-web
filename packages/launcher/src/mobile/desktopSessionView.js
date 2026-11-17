{
  const key = Symbol.for('open-kimi-web.desktop-session-view');
  if (!window[key]) {
    window[key] = true;
    const storageKey = 'kimi-web.sidebar-view-mode';
    const rowClass = 'okw-desktop-view-switch';
    const buttonClass = 'okw-desktop-view-btn';
    const rowSelector = `.${rowClass}`;
    const menuSelector = '.view-menu';
    const menuNodeSelector = '.view-menu-label, button.ui-menu-item';
    const labelSelector = ':scope > .side-section-label';
    const triggerSelector = '.side-section-view';
    const headSelector = '.sessions-head';
    const shells = 'html, body, #app, .app-shell, .app, .side, .col, .session-list-panel';
    const modes = ['flat', 'grouped'];
    const patterns = { flat: /平铺|\bflat\b/iu, grouped: /按项目|by project/iu };
    const text = (zh, en) => window.__okwLocale?.text(zh, en) ?? en;
    const labels = {
      flat: () => text('平铺', 'Flat'),
      grouped: () => text('按项目', 'By project'),
    };
    const groupLabel = () => text('列表视图', 'List view');
    const hint = () => text('列表视图切换暂不可用，请在“列表管理”菜单中选择',
      'View switch unavailable; pick the mode in the List options menu');
    const panels = new Map();
    const dirty = new Set();
    let scheduled = false;
    let refreshing = false;
    let switching = false;

    const readMode = () => {
      let stored = null;
      try { stored = window.localStorage?.getItem(storageKey) ?? null; } catch { stored = null; }
      return stored === 'flat' ? 'flat' : 'grouped';
    };
    const tick = () => new Promise((done) => { setTimeout(done, 0); });
    const waitFor = async (read, attempts = 12) => {
      for (let step = 0; step < attempts; step += 1) {
        const value = read();
        if (value) return value;
        await tick();
      }
      return null;
    };
    const visibleMenu = (root) => [...root.querySelectorAll(menuSelector)]
      .find((menu) => menu.isConnected && !menu.classList.contains('menu-pop-leave-active')) ?? null;
    const currentMenu = (panel) => visibleMenu(panel.host ?? document) ?? visibleMenu(document);
    const dismissMenu = (menu) => {
      if (!menu) return;
      menu.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    };
    const viewItems = (menu) => {
      const nodes = [...menu.querySelectorAll(menuNodeSelector)];
      const first = nodes.findIndex((node) => node.matches('.view-menu-label'));
      if (first === -1) return nodes;
      const items = [];
      for (const node of nodes.slice(first + 1)) {
        if (node.matches('.view-menu-label')) break;
        items.push(node);
      }
      return items;
    };
    const itemChecked = (item) => item.getAttribute('aria-checked') === 'true' ||
      item.classList.contains('is-active') || !!item.querySelector('.view-menu-check svg');
    const itemFor = (menu, mode) => {
      const items = viewItems(menu);
      const matched = items.find((item) => patterns[mode].test(item.textContent?.trim() ?? ''));
      return matched ?? (items.length === modes.length ? items[modes.indexOf(mode)] : null);
    };
    const setAttribute = (node, name, value) => {
      if (node.getAttribute(name) === value) return;
      if (value === null) node.removeAttribute(name);
      else node.setAttribute(name, value);
    };
    const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };
    const createButton = (panel, mode) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = buttonClass;
      button.dataset.okwView = mode;
      button.setAttribute('aria-pressed', 'false');
      button.append(document.createTextNode(labels[mode]()));
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        void delegate(panel, mode);
      });
      return button;
    };
    const createRow = (panel) => {
      const row = document.createElement('div');
      row.className = rowClass;
      row.setAttribute('role', 'group');
      for (const mode of modes) row.append(createButton(panel, mode));
      return row;
    };
    const renderRow = (panel, mode) => {
      const row = panel.row;
      setAttribute(row, 'aria-label', groupLabel());
      setAttribute(row, 'data-okw-view-reason', panel.reason || null);
      setAttribute(row, 'title', panel.reason ? hint() : null);
      for (const button of row.children) {
        const name = button.dataset.okwView;
        setText(button, labels[name]());
        setAttribute(button, 'aria-pressed', String(name === mode));
        setAttribute(button, 'aria-disabled', panel.reason ? 'true' : null);
      }
    };
    const paint = (panel) => {
      if (!panel.label.querySelector(triggerSelector)) {
        if (panel.row) { panel.row.remove(); panel.row = null; }
        return;
      }
      if (!panel.row?.isConnected) {
        panel.row = createRow(panel);
        panel.reason = '';
        panel.label.insertAdjacentElement('afterend', panel.row);
      }
      renderRow(panel, readMode());
    };
    const renderPanel = (panel) => {
      if (!panel.head.isConnected) { unbind(panel.head); return; }
      paint(panel);
    };
    const flushPanels = () => {
      scheduled = false;
      for (const head of [...dirty]) {
        dirty.delete(head);
        const panel = panels.get(head);
        if (panel) renderPanel(panel);
      }
    };
    const markDirty = (head) => {
      dirty.add(head);
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(flushPanels);
    };
    const markAll = () => { for (const head of panels.keys()) markDirty(head); };
    const bindHead = (head) => {
      if (panels.has(head)) return;
      const label = head.querySelector(labelSelector);
      if (!label) return;
      const host = head.closest('.session-list-panel') ?? head.parentElement;
      const observer = new MutationObserver(() => markDirty(head));
      observer.observe(head, { childList: true, characterData: true, subtree: true });
      if (host) observer.observe(host, { childList: true });
      panels.set(head, { head, label, host, row: null, reason: '', observer });
      markDirty(head);
    };
    const unbind = (head) => {
      panels.get(head)?.observer.disconnect();
      panels.delete(head);
    };
    const discover = (node, depth) => {
      if (node.matches(headSelector)) { bindHead(node); return; }
      if (!node.matches(shells) || depth >= 12) return;
      discovery.observe(node, { childList: true });
      for (const child of node.children) discover(child, depth + 1);
    };
    const refreshRoots = () => {
      discovery.disconnect();
      for (const [head, panel] of [...panels]) {
        if (head.isConnected) continue;
        panel.row?.remove();
        unbind(head);
      }
      discover(document.documentElement, 0);
      markAll();
    };
    const discovery = new MutationObserver(() => {
      if (refreshing) return;
      refreshing = true;
      queueMicrotask(() => { refreshing = false; refreshRoots(); });
    });
    const openNativeMenu = async (panel, trigger) => {
      const existing = currentMenu(panel);
      if (existing) return existing;
      trigger.click();
      return waitFor(() => currentMenu(panel));
    };
    const fail = (panel, reason) => {
      panel.reason = reason;
      dismissMenu(currentMenu(panel));
    };
    const applyMode = async (panel, mode, trigger) => {
      const menu = await openNativeMenu(panel, trigger);
      const item = menu ? itemFor(menu, mode) : null;
      if (!item) { fail(panel, 'native-entry-changed'); return; }
      if (!itemChecked(item)) item.click();
      if (!await waitFor(() => readMode() === mode)) fail(panel, 'view-not-updated');
    };
    const delegate = async (panel, mode) => {
      if (switching) return;
      const trigger = panel.label.querySelector(triggerSelector);
      if (!trigger) return;
      switching = true;
      panel.reason = '';
      try {
        if (readMode() !== mode) await applyMode(panel, mode, trigger);
      } finally {
        switching = false;
        markDirty(panel.head);
      }
    };
    const protectActivation = (event) => {
      if (event.isComposing || (event.key !== 'Enter' && event.key !== ' ')) return;
      if (event.target?.closest?.(rowSelector)) event.stopImmediatePropagation();
    };
    window.addEventListener('keydown', protectActivation, true);
    window.addEventListener('keyup', protectActivation, true);
    window.addEventListener('storage', (event) => {
      if (event.key === storageKey || event.key === null) markAll();
    });
    window.__okwLocale?.observe(markAll);
    document.querySelectorAll(headSelector).forEach(bindHead);
    refreshRoots();
  }
}
