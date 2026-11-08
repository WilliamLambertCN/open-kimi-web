{
  const installed = Symbol.for('open-kimi-web.mobile-session-menu');
  if (!window[installed]) {
    window[installed] = true;
    const api = window.__okwSessionActions;
    const media = window.matchMedia('(max-width: 640px)');
    const resumeKey = 'open-kimi-web.reopen-session-list';
    const sheets = new Map();
    const knownRows = new WeakMap();
    const reading = new Set();
    const unavailable = new Set();
    const pending = new Set();
    const text = (zh, en) => window.__okwLocale?.text(zh, en) ?? en;
    const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };
    const make = (tag, className) => {
      const node = document.createElement(tag); node.className = className; return node;
    };
    const pinIds = () => { try { return api.pins(); } catch { return []; } };
    const directId = (row) => {
      const id = row.dataset.okwPinnedSessionId ?? knownRows.get(row);
      return api.validId(id) ? id : null;
    };
    const selectRow = (row) => {
      if (!row.isConnected || !api.routeSupported()) throw Object.assign(new Error(), { code: 'identity' });
      const prior = api.routeId();
      const current = row.classList.contains('cur');
      const originalPush = history.pushState;
      const originalReplace = history.replaceState;
      let observed = null;
      const capture = (original) => function rowSelectionRoute() {
        const result = original.apply(this, arguments);
        observed = api.routeId(); return result;
      };
      history.pushState = capture(originalPush); history.replaceState = capture(originalReplace);
      try { row.click(); } finally { history.pushState = originalPush; history.replaceState = originalReplace; }
      const id = observed ?? (current && api.routeId() === prior ? prior : null);
      if (!id || (id === prior && !current)) throw Object.assign(new Error(), { code: 'identity' });
      knownRows.set(row, id); return id;
    };
    const closePinnedMenus = (root = document, focus = false) => {
      root.querySelectorAll('.okw-pinned-session > .kmenu').forEach((menu) => {
        const button = menu.parentElement.querySelector(':scope > .kb');
        menu.remove(); button?.setAttribute('aria-expanded', 'false');
        if (focus) button?.focus();
      });
    };
    const showFailure = (failure) => { window.alert(api.failure(failure)); };
    const requireUploadsFinished = () => {
      const preparing = document.querySelector('.composer .uploading, .composer [aria-busy="true"]');
      if (api.hasUploads() || preparing) throw Object.assign(new Error(), { code: 'uploading' });
    };
    const pinAndReload = async (id, enabled) => {
      await new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)));
      requireUploadsFinished(); api.setPinned(id, enabled);
      try { sessionStorage.setItem(resumeKey, '1'); } catch { /* Pin is saved even if list restoration is unavailable. */ }
      location.reload();
    };
    const perform = async (row, action, unpin) => {
      if (pending.size) return;
      const initial = directId(row);
      pending.add(row); refresh();
      try {
        if (action === 'pin') requireUploadsFinished();
        const isOwn = row.hasAttribute('data-okw-pinned-session-id');
        const id = isOwn ? initial : selectRow(row);
        if (!api.validId(id)) throw Object.assign(new Error(), { code: 'identity' });
        if (isOwn) closePinnedMenus(row);
        if (action === 'fork') {
          const fork = await api.fork(id);
          api.navigate(fork.id);
          row.closest('.sheet-root')?.querySelector('.sheet-grab')?.click();
        } else await pinAndReload(id, !unpin);
      } catch (failure) { showFailure(failure); }
      finally { pending.delete(row); refresh(); }
    };
    const menuItem = (action, row) => {
      const button = make('button', 'okw-mobile-session-action'); button.type = 'button';
      button.dataset.okwSessionAction = action; button.setAttribute('role', 'menuitem');
      button.addEventListener('click', (event) => {
        event.preventDefault(); event.stopPropagation(); void perform(row, action, button.dataset.okwPinned === 'true');
      });
      return button;
    };
    const positionMenu = (menu, row) => {
      const anchor = row.querySelector(':scope > .kb')?.getBoundingClientRect();
      if (!anchor) return;
      const rect = menu.getBoundingClientRect();
      const top = Math.max(8, Math.min(anchor.bottom, innerHeight - rect.height - 8));
      const inset = rect.top - (Number.parseFloat(getComputedStyle(menu).top) || 0);
      const value = `${Math.round(top - inset)}px`;
      if (menu.style.top !== value) menu.style.top = value;
    };
    const enhanceMenu = (row) => {
      const menu = row.querySelector(':scope > .kmenu:not(.wsmenu)');
      if (!menu) return;
      for (const action of ['pin', 'fork']) {
        let button = menu.querySelector(`[data-okw-session-action="${action}"]`);
        if (!button) { button = menuItem(action, row); menu.insertBefore(button, menu.firstChild); }
        const id = directId(row);
        const pinned = Boolean(id && pinIds().includes(id));
        const label = action === 'fork' ? text('分叉', 'Fork') : pinned ? text('取消置顶', 'Unpin') : text('置顶', 'Pin');
        setText(button, label);
        if (button.dataset.okwPinned !== String(pinned)) button.dataset.okwPinned = String(pinned);
        if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
        button.disabled = pending.size > 0;
      }
      if (!menu.classList.contains('okw-mobile-session-menu')) menu.classList.add('okw-mobile-session-menu');
      positionMenu(menu, row);
    };
    const readPins = () => {
      for (const id of pinIds()) {
        if (api.record(id) || reading.has(id) || unavailable.has(id)) continue;
        reading.add(id);
        void api.read(id).catch(() => { unavailable.add(id); }).finally(() => { reading.delete(id); refresh(); });
      }
    };
    const makePinnedRow = (id) => {
      const row = make('div', 'okw-pinned-session'); row.dataset.okwPinnedSessionId = id;
      const link = make('a', 'okw-pinned-session-link'); link.href = `/sessions/${encodeURIComponent(id)}`;
      const title = make('span', 'okw-pinned-session-title');
      const cwd = make('span', 'okw-pinned-session-cwd'); link.append(title, cwd);
      link.addEventListener('click', (event) => {
        event.preventDefault(); event.stopPropagation();
        try { api.navigate(id); row.closest('.sheet-root')?.querySelector('.sheet-grab')?.click(); }
        catch (failure) { showFailure(failure); }
      });
      const button = make('button', 'kb okw-pinned-session-more'); button.type = 'button';
      button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false');
      button.textContent = '⋯';
      button.addEventListener('click', (event) => {
        event.preventDefault(); event.stopPropagation();
        const existing = row.querySelector(':scope > .kmenu');
        if (existing) { closePinnedMenus(row); return; }
        closePinnedMenus();
        row.closest('.sheet-root')?.querySelectorAll('.srow > .kmenu:not(.wsmenu), .mgh > .wsmenu').forEach((menu) => {
          const owner = menu.parentElement;
          owner.querySelector(':scope > .kb, :scope > .mgh-more')?.click();
        });
        const menu = make('div', 'kmenu ui-menu okw-mobile-session-menu'); menu.setAttribute('role', 'menu');
        menu.addEventListener('click', (click) => click.stopPropagation()); row.append(menu);
        button.setAttribute('aria-expanded', 'true'); enhanceMenu(row);
      });
      row.append(link, button); return row;
    };
    const renderPins = (state) => {
      const ids = pinIds();
      const list = state.root.querySelector('.sheet-body > .mlist');
      if (!ids.length || !list || !media.matches) { state.pins?.remove(); state.pins = null; return; }
      if (!state.pins?.isConnected) {
        state.pins = make('section', 'okw-mobile-session-pins');
        const heading = make('h3', 'okw-mobile-session-pins-heading'); state.pins.append(heading);
        list.before(state.pins);
      }
      setText(state.pins.querySelector('h3'), text('已置顶', 'Pinned'));
      state.pins.querySelectorAll('[data-okw-pinned-session-id]').forEach((row) => {
        if (!ids.includes(row.dataset.okwPinnedSessionId)) row.remove();
      });
      ids.forEach((id, index) => {
        let row = [...state.pins.children].find((node) => node.dataset.okwPinnedSessionId === id);
        if (!row) { row = makePinnedRow(id); state.pins.append(row); }
        const record = api.record(id);
        setText(row.querySelector('.okw-pinned-session-title'), record?.title ??
          (unavailable.has(id) ? text('会话不可用', 'Session unavailable') : text('正在载入…', 'Loading…')));
        setText(row.querySelector('.okw-pinned-session-cwd'), record?.cwd ?? '');
        const button = row.querySelector('.kb');
        const label = text('会话选项', 'Session options');
        if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
        if (row.style.order !== String(index)) row.style.order = String(index);
        enhanceMenu(row);
      });
      readPins();
    };
    function render(state) {
      renderPins(state);
      if (!media.matches) return;
      state.root.querySelectorAll('.sheet-body > .mlist .srow > .kmenu:not(.wsmenu)')
        .forEach((menu) => enhanceMenu(menu.parentElement));
    }
    function refresh() {
      sheets.forEach((state, root) => {
        if (!root.isConnected) { state.observer.disconnect(); sheets.delete(root); } else render(state);
      });
      resumeList();
    }
    const relevant = ({ target, addedNodes, removedNodes }) => {
      const element = target.nodeType === 1 ? target : target.parentElement;
      if (element?.closest('.okw-mobile-session-pins')) return false;
      return element?.matches('.sheet-body, .mlist') || element?.closest('.srow > .kmenu') ||
        [...addedNodes, ...removedNodes].some((node) => node.matches?.('.mlist, .kmenu, .srow, .mgroup') ||
          node.querySelector?.('.srow > .kmenu'));
    };
    const attach = (root) => {
      if (sheets.has(root) || !root.querySelector('.sheet-body .actions > .newrow')) return;
      const state = { root, pins: null };
      state.observer = new MutationObserver((records) => { if (records.some(relevant)) render(state); });
      state.observer.observe(root, { childList: true, subtree: true });
      sheets.set(root, state); render(state);
    };
    let reopen = false;
    try {
      reopen = sessionStorage.getItem(resumeKey) === '1'; sessionStorage.removeItem(resumeKey);
    } catch { /* Optional UI state. */ }
    function resumeList() {
      if (!reopen || !media.matches || document.querySelector('.sheet-panel .mlist')) return;
      const button = document.querySelector('.app.mobile .topbar .tb-main');
      if (button && document.querySelector('.composer')) { reopen = false; button.click(); }
    }
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.target.closest?.('.chat-scroll, .con, .sc-body, .composer, .okw-mobile-session-pins, .sheet-root')) continue;
        for (const node of record.addedNodes) {
          if (node.matches?.('.sheet-root')) attach(node);
          else node.querySelectorAll?.('.sheet-root').forEach(attach);
        }
        if (record.removedNodes.length) {
          sheets.forEach((state, root) => { if (!root.isConnected) { state.observer.disconnect(); sheets.delete(root); } });
        }
        if (reopen) resumeList();
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
    document.querySelectorAll('.sheet-root').forEach(attach);
    document.addEventListener('click', (event) => {
      if (!event.target.closest?.('.okw-pinned-session')) closePinnedMenus();
    }, true);
    document.addEventListener('scroll', (event) => {
      if (event.target.matches?.('.sheet-body')) refresh();
    }, true);
    window.addEventListener('resize', refresh);
    const escapeMenu = (button) => {
      const pinned = button.closest('.okw-pinned-session');
      if (pinned) closePinnedMenus(pinned, true);
      else {
        const more = button.closest('.srow')?.querySelector(':scope > .kb'); more?.click(); more?.focus();
      }
    };
    const moveFocus = (button, direction) => {
      const menu = button.closest('.kmenu') ?? button.parentElement.querySelector(':scope > .kmenu');
      const items = [...(menu?.querySelectorAll('button:not(:disabled)') ?? [])];
      const index = items.indexOf(button);
      items[(index + direction + items.length) % items.length]?.focus();
    };
    const menuControl = (target) => target?.closest?.(
      '.okw-mobile-session-action, .okw-pinned-session-more, .okw-pinned-session-link');
    window.addEventListener('keydown', (event) => {
      const button = menuControl(event.target);
      if (!button || !['Enter', ' ', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.stopImmediatePropagation();
      if (event.key === ' ' && button.tagName === 'A') { event.preventDefault(); button.click(); }
      if (event.key === 'Escape') { event.preventDefault(); escapeMenu(button); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); moveFocus(button, event.key === 'ArrowDown' ? 1 : -1);
      }
    }, true);
    window.__okwLocale?.observe(refresh); api.observe(refresh); media.addEventListener('change', refresh); resumeList();
  }
}
