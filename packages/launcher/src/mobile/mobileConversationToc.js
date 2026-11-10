{
  const installed = Symbol.for('open-kimi-web.mobile-conversation-toc');
  if (!window[installed]) {
    window[installed] = true;
    const metadata = window.__okwMobileTocMetadata;
    const mobile = window.matchMedia('(max-width: 640px)');
    const selector = '.u-turn > .u-bub.turn-anchor[data-turn-id]';
    let ui;
    let root = null;
    let session = null;
    let opened = false;
    let scheduled = false;
    let isolated = [];
    let navigation = null;
    let error = false;
    let chatObserver;
    const connected = () => root?.isConnected && session === metadata.session();
    const anchors = () => [...root?.querySelectorAll(selector) ?? []]
      .filter((node) => node.closest('.chat-scroll') === root);
    const remember = (node) => {
      const source = node.querySelector('.u-text');
      if (!source) return;
      const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
      let text = ''; let count = 0;
      for (let part = walker.nextNode(); part && text.length < 240 && count < 32; part = walker.nextNode()) {
        text += part.data.slice(0, 240 - text.length); count += 1;
      }
      if (text) metadata.label(node.dataset.turnId, text);
    };
    const active = (items) => {
      if (!root || !items.length) return null;
      if (root.scrollHeight - root.clientHeight - root.scrollTop <= 80) return items.at(-1).id;
      const middle = root.getBoundingClientRect().top + root.clientHeight / 2;
      const ids = new Set(items.map((item) => item.id));
      let id = items[0].id;
      for (const node of anchors()) {
        if (ids.has(node.dataset.turnId) && node.getBoundingClientRect().top <= middle) id = node.dataset.turnId;
      }
      return id;
    };
    const render = () => {
      if (!ui || !opened) return;
      const items = metadata.items();
      ui.localize(); ui.render(items, active(items), !!root?.querySelector('.top-sentinel-btn'), error);
    };
    const close = (restore = true) => {
      if (!opened) return;
      opened = false; ui.root.hidden = true;
      for (const [node, inert] of isolated) node.inert = inert;
      isolated = [];
      ui.attr(ui.trigger, 'aria-expanded', false);
      document.documentElement.classList.remove('okw-toc-open');
      if (restore && ui.trigger.isConnected && !ui.trigger.closest('[inert]')) ui.trigger.focus({ preventScroll: true });
    };
    const cancelNavigation = () => { navigation?.abort(); navigation = null; };
    const select = async (id) => {
      if (!opened || !connected() || !metadata.items().some((item) => item.id === id)) return;
      const targetRoot = root;
      const targetSession = session;
      const items = metadata.items();
      close(); cancelNavigation();
      const controller = new AbortController();
      navigation = controller;
      try {
        await window.__okwMobileTocNavigate({ root: targetRoot, id, items, signal: controller.signal,
          isCurrent: () => root === targetRoot && session === targetSession && connected() && mobile.matches });
      } catch (failure) {
        if (failure.code === 'aborted') return;
        if (!controller.signal.aborted && connected() && session === targetSession) {
          error = true; open();
        }
      } finally { if (navigation === controller) navigation = null; }
    };
    const earlier = () => {
      if (!opened || !connected()) return;
      const button = root.querySelector('.top-sentinel-btn');
      close();
      if (button?.isConnected && !button.disabled) button.click();
    };
    const otherModal = () => [...document.querySelectorAll('[aria-modal="true"]')]
      .some((node) => !ui?.root.contains(node) && !node.closest('[hidden]') && node.getClientRects().length);
    const canOpen = () => mobile.matches && connected() && metadata.items().length &&
      !document.querySelector('#app')?.inert && !otherModal();
    function open() {
      if (opened) { close(); return; }
      if (!canOpen()) return;
      cancelNavigation();
      opened = true; ui.root.hidden = false;
      ui.attr(ui.trigger, 'aria-expanded', true);
      isolated = [...document.querySelectorAll('#app, .sheet-root')].map((node) => [node, node.inert]);
      for (const [node] of isolated) node.inert = true;
      document.documentElement.classList.add('okw-toc-open');
      render();
      const row = ui.list.querySelector('[aria-current="true"]');
      (row ?? ui.dismiss).focus({ preventScroll: true });
      row?.scrollIntoView({ block: 'nearest' });
    }
    const onScroll = () => { if (opened) schedule(); };
    const collect = (node) => {
      if (!(node instanceof Element)) return;
      if (node.matches('.a-msg, .sc-body') || node.closest('.a-msg, .sc-body')) return;
      if (node.matches(selector)) remember(node);
      else node.querySelectorAll(selector).forEach(remember);
    };
    const changedChat = (record) => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (!target || target.closest('.a-msg, .sc-body')) return false;
      const anchor = target.closest(selector);
      if (anchor) { remember(anchor); return true; }
      record.addedNodes.forEach(collect);
      return target.matches('.chat, .history-window, .top-sentinel') || !!target.closest('.history-row');
    };
    const watchChat = () => {
      chatObserver?.disconnect();
      chatObserver = null;
      if (!root) return;
      anchors().forEach(remember);
      chatObserver = new MutationObserver((records) => {
        const relevant = records.map(changedChat).some(Boolean);
        if (relevant && opened) schedule();
      });
      chatObserver.observe(root, { childList: true, subtree: true, characterData: true });
    };
    const switchRoot = (nextRoot, nextSession) => {
      if (root === nextRoot && session === nextSession) return;
      close(false); cancelNavigation(); root?.removeEventListener('scroll', onScroll);
      root = nextRoot; session = nextSession; error = false;
      root?.addEventListener('scroll', onScroll, { passive: true }); watchChat();
    };
    const hideEntry = () => {
      close(false); cancelNavigation();
      ui?.trigger.parentElement?.classList.remove('okw-toc-header');
      ui?.trigger.remove();
    };
    const yieldToModal = () => {
      if ((opened || navigation) && otherModal()) { close(false); cancelNavigation(); }
    };
    const refresh = () => {
      scheduled = false;
      const nextSession = metadata.session();
      const nextRoot = mobile.matches ? document.querySelector('.app.mobile > .con .panes.chat-scroll') : null;
      const header = nextRoot ? document.querySelector('.app.mobile > .topbar') : null;
      switchRoot(nextRoot, nextSession);
      if (!header || !session || !metadata.items().length) { hideEntry(); return; }
      yieldToModal();
      ui ??= window.__okwBuildMobileConversationToc({ open: () => { error = false; open(); }, close, select, earlier });
      if (!ui.root.isConnected) document.body.append(ui.root);
      if (ui.trigger.parentElement !== header) header.insertBefore(ui.trigger, header.lastElementChild);
      header.classList.add('okw-toc-header');
      ui.localize(); render();
    };
    function schedule() {
      if (scheduled) return;
      scheduled = true; setTimeout(refresh, 0);
    }
    const trapTab = (event) => {
      const nodes = [...ui.panel.querySelectorAll('button:not(:disabled)')].filter((node) => !node.closest('[hidden]'));
      const first = nodes[0]; const last = nodes.at(-1);
      let next;
      if (!ui.panel.contains(document.activeElement)) next = first;
      else if (event.shiftKey && document.activeElement === first) next = last;
      else if (!event.shiftKey && document.activeElement === last) next = first;
      if (next) { event.preventDefault(); next.focus(); }
    };
    const stop = (event) => {
      if (!opened) return;
      event.stopImmediatePropagation();
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key === 'Tab') trapTab(event);
    };
    window.addEventListener('keydown', stop, true);
    document.addEventListener('focusin', (event) => {
      if (opened && !ui.root.contains(event.target)) ui.panel.focus({ preventScroll: true });
    }, true);
    mobile.addEventListener('change', () => { close(false); cancelNavigation(); schedule(); });
    metadata.observe(schedule);
    window.__okwLocale?.observe(() => { ui?.localize(); render(); });
    const start = () => {
      new MutationObserver((records) => {
        for (const record of records) {
          const target = record.target instanceof Element ? record.target : record.target.parentElement;
          if (target?.closest('.chat-scroll, .okw-toc-backdrop, .okw-toc-trigger')) continue;
          if (target?.matches('.okw-workspace-status, .okw-workspace-summary, .okw-session-size')) continue;
          if (record.removedNodes.length || record.addedNodes.length) { schedule(); break; }
        }
      }).observe(document.body, { childList: true, subtree: true });
      refresh();
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }
}
