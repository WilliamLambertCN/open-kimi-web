{
  const key = Symbol.for('open-kimi-web.desktop-session-menu');
  if (!window[key]) {
    window[key] = true;
    const selector = '.okw-desktop-session-menu';
    const sidebars = new Map();
    const menuSelector = '.ui-menu.menu[role="menu"]';
    let activeMenu = null;
    let dispatchedContext = null;
    const expanded = (button, value) => {
      if (button.getAttribute('aria-expanded') !== String(value)) button.setAttribute('aria-expanded', String(value));
    };
    const releaseMenu = () => {
      if (!activeMenu) return;
      const session = activeMenu; activeMenu = null;
      cancelAnimationFrame(session.frame); clearTimeout(session.closeTimer);
      session.observer?.disconnect(); expanded(session.trigger, false);
    };
    const isOpen = (menu) => menu.isConnected && !menu.hidden && menu.getAttribute('aria-hidden') !== 'true' &&
      !menu.classList.contains('menu-pop-leave-active');
    const nativeMenus = () => [...document.body.children].filter((node) => node.matches(menuSelector));
    const focusItem = (session, key) => {
      const items = [...session.menu.querySelectorAll('button[role="menuitem"]')].filter((item) => {
        const style = getComputedStyle(item);
        return !item.matches(':disabled, [aria-disabled="true"]') && !item.closest('[hidden], [inert], [aria-hidden="true"]') &&
          style.display !== 'none' && style.visibility !== 'hidden';
      });
      if (!items.length) return;
      let index = items.indexOf(document.activeElement);
      if (key === 'Home') index = 0;
      else if (key === 'End') index = items.length - 1;
      else if (key === 'ArrowUp') index = (Math.max(index, 0) - 1 + items.length) % items.length;
      else index = (index + 1) % items.length;
      items[index].focus();
    };
    const attachMenu = (session) => {
      if (activeMenu !== session || session.closing) return;
      const menu = nativeMenus().find((node) => !session.before.has(node) && isOpen(node)) ?? session.previous;
      if (!session.trigger.isConnected || !menu || !isOpen(menu)) { releaseMenu(); return; }
      session.menu = menu; expanded(session.trigger, true);
      session.observer = new MutationObserver(() => {
        if (activeMenu === session && !isOpen(menu)) releaseMenu();
      });
      session.observer.observe(menu, { attributes: true, attributeFilter: ['class', 'hidden', 'aria-hidden'] });
      if (session.focusKey && document.activeElement === session.trigger) focusItem(session, session.focusKey);
    };
    const closeMenu = (restoreFocus) => {
      const session = activeMenu;
      if (!session || session.closing) return;
      session.closing = true; expanded(session.trigger, false);
      session.closeTimer = setTimeout(() => {
        if (activeMenu !== session) return;
        session.trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        releaseMenu();
      }, 0);
      if (restoreFocus && session.trigger.isConnected) session.trigger.focus();
    };
    const openMenu = (row, button, focusKey) => {
      if (!row?.isConnected || button.closest('.se') !== row) return;
      const previous = activeMenu?.trigger === button ? activeMenu.menu : null;
      if (activeMenu && activeMenu.trigger !== button) {
        activeMenu.trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      }
      releaseMenu();
      const session = { trigger: button, before: new Set(nativeMenus()), previous, focusKey, frame: 0 };
      activeMenu = session;
      const rect = button.getBoundingClientRect();
      const event = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.bottom,
      });
      dispatchedContext = event; row.dispatchEvent(event); dispatchedContext = null;
      if (!event.defaultPrevented) { releaseMenu(); return; }
      session.frame = requestAnimationFrame(() => attachMenu(session));
    };
    const localize = (button) => {
      const label = window.__okwLocale?.text('会话选项', 'Session options') ?? 'Session options';
      if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
      if (button.title !== label) button.title = label;
    };
    const createButton = (row) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'okw-desktop-session-menu';
      button.setAttribute('aria-haspopup', 'menu'); expanded(button, false);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      for (const x of [5, 12, 19]) {
        const dot = document.createElementNS(svg.namespaceURI, 'circle');
        dot.setAttribute('cx', String(x)); dot.setAttribute('cy', '12'); dot.setAttribute('r', '1.6');
        svg.append(dot);
      }
      button.append(svg); localize(button);
      button.addEventListener('click', (event) => {
        event.stopPropagation(); openMenu(row, button, event.detail === 0 ? 'Home' : null);
      });
      return button;
    };
    const enhance = (side) => {
      for (const row of side.querySelectorAll('.se')) {
        const actions = row.querySelector(':scope > .row > .act > .ha');
        if (!actions) continue;
        const button = actions.querySelector(`:scope > ${selector}`);
        if (button) localize(button);
        else actions.append(createButton(row));
      }
    };
    const bindSidebar = (side) => {
      if (sidebars.has(side)) return;
      let scheduled = false;
      const observer = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => { scheduled = false; if (side.isConnected) enhance(side); });
      });
      sidebars.set(side, observer);
      observer.observe(side, { childList: true, subtree: true });
      enhance(side);
    };
    const discover = (root) => {
      if (root.matches('.side')) { bindSidebar(root); return; }
      if (!root.matches('html, body, #app, .app-shell, .app')) return;
      discovery.observe(root, { childList: true });
      for (const child of root.children) discover(child);
    };
    const refreshRoots = () => {
      discovery.disconnect();
      for (const [side, observer] of sidebars) {
        if (side.isConnected) continue;
        observer.disconnect(); sidebars.delete(side);
      }
      if (activeMenu && (!activeMenu.trigger.isConnected || activeMenu.menu && !isOpen(activeMenu.menu))) releaseMenu();
      discover(document.documentElement);
    };
    const discovery = new MutationObserver(refreshRoots);
    const containsFocus = (session, target) => [session.trigger, session.menu].some((node) => node?.contains(target));
    const currentMenu = (target) => {
      const session = activeMenu;
      if (!session || !containsFocus(session, target)) return null;
      if (session.menu && !isOpen(session.menu)) { releaseMenu(); return null; }
      return session;
    };
    const menuKey = (event) => {
      const session = currentMenu(event.target);
      if (!session) return;
      event.stopImmediatePropagation();
      if (session.closing) return;
      if (event.key === 'Tab') { closeMenu(true); return; }
      if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); return; }
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      if (event.type !== 'keydown') return;
      if (session.menu) focusItem(session, event.key);
      else session.focusKey = event.key;
    };
    const triggerFor = (target) => {
      const candidate = target?.closest?.(selector);
      return candidate?.closest('.side') ? candidate : null;
    };
    const protectActivation = (event) => {
      if (event.isComposing) return;
      const button = triggerFor(event.target);
      if (!button) { menuKey(event); return; }
      if (['Enter', ' '].includes(event.key)) { event.stopImmediatePropagation(); return; }
      if (event.key === 'ArrowDown' && event.type === 'keydown' && activeMenu?.trigger !== button) {
        event.preventDefault(); event.stopImmediatePropagation(); openMenu(button.closest('.se'), button, 'Home'); return;
      }
      menuKey(event);
    };
    window.addEventListener('keydown', protectActivation, true);
    window.addEventListener('keyup', protectActivation, true);
    document.addEventListener('contextmenu', (event) => { if (event !== dispatchedContext) releaseMenu(); }, true);
    document.addEventListener('mousedown', (event) => {
      if (activeMenu?.menu && !activeMenu.menu.contains(event.target)) releaseMenu();
    });
    document.addEventListener('focusin', (event) => {
      if (activeMenu?.menu && !containsFocus(activeMenu, event.target)) closeMenu(false);
    });
    window.__okwLocale?.observe(() => {
      for (const side of sidebars.keys()) {
        if (side.isConnected) side.querySelectorAll(selector).forEach(localize);
      }
    });
    document.querySelectorAll('.side').forEach(bindSidebar);
    refreshRoots();
  }
}
