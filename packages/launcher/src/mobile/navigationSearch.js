{
  const text = (zh, en) => window.__okwLocale?.text(zh, en) ?? en;
  const initial = () => text('搜索所有会话的消息和标题。', 'Search messages and titles across all sessions.');
  const incomplete = (page) => page.incomplete || page.index_state?.stale || page.index_state?.degraded ||
    page.index_state?.state === 'building';
  const summary = (page, count) => {
    if (incomplete(page)) return text('搜索索引尚未完整就绪，结果可能不完整。',
      'The search index is not fully ready. Results may be incomplete.');
    if (!count) return text('没有匹配的结果。', 'No matching results.');
    return text(`已显示 ${count} 条结果。点击打开所属会话。`, `Showing ${count} results. Open a result’s session.`);
  };
  window.__okwNavigationCreateSearch = () => {
    const state = { generation: 0, opened: false, inert: [] };
    const cancel = () => { clearTimeout(state.timer); state.controller?.abort(); state.generation += 1; };
    const message = (value, error = false) => {
      state.ui.status.textContent = value; state.ui.status.dataset.error = String(error);
    };
    const reset = () => { state.ui.list.replaceChildren(); state.ui.more.hidden = true; };
    const current = (generation) => state.opened && generation === state.generation;
    const receive = (page, query) => {
      state.executed = query; state.cursor = page.page_token;
      for (const hit of page.items) state.ui.list.append(window.__okwNavigationSearchResult(hit));
      message(summary(page, state.ui.list.childElementCount)); state.ui.more.hidden = !page.has_more;
    };
    const execute = async (query, pageToken) => {
      const generation = state.generation;
      state.controller = new AbortController(); state.ui.more.disabled = true;
      message(text('正在搜索…', 'Searching…'));
      try {
        const page = await window.__okwNavigationSearch(query, { signal: state.controller.signal, pageToken });
        if (current(generation)) receive(page, query);
      } catch (error) {
        if (!current(generation)) return;
        message(error.message, true); state.ui.more.hidden = !state.cursor;
      } finally { if (current(generation)) state.ui.more.disabled = false; }
    };
    const run = async (append = false) => {
      cancel();
      if (!state.opened) return;
      const ui = state.ui;
      const query = append ? state.executed : { query: ui.input.value.trim(), role: ui.role.value,
        mode: ui.mode.value, sort: ui.sort.value };
      if (!append) { reset(); state.cursor = undefined; }
      if (!query?.query) { message(initial()); return; }
      await execute(query, append ? state.cursor : undefined);
    };
    const schedule = () => {
      cancel(); reset(); state.cursor = undefined; message(text('正在等待搜索…', 'Waiting to search…'));
      state.timer = setTimeout(() => { void run(); }, 250);
    };
    const close = () => {
      if (!state.opened) return;
      state.opened = false; cancel(); state.ui.root.hidden = true; reset();
      state.ui.input.value = ''; state.cursor = undefined; state.executed = undefined;
      for (const [node, previous] of state.inert) if (node.isConnected) node.inert = previous;
      state.inert = [];
      document.documentElement.classList.remove('okw-navigation-search-open');
      const fallback = document.querySelector('.app.mobile .topbar .tb-main, .side .sidebar-actions .search');
      (state.opener?.isConnected ? state.opener : fallback)?.focus();
    };
    document.addEventListener('keydown', (event) => {
      if (state.opened) window.__okwNavigationSearchKey(event, { panel: state.ui.panel, close });
    }, true);
    window.__okwLocale?.observe(() => {
      state.ui?.localize();
      if (state.opened) { cancel(); reset(); message(initial()); }
    });
    return {
      open(target) {
        if (state.opened) { state.ui.input.focus(); return; }
        state.opener = target;
        state.ui ??= window.__okwNavigationBuildSearch({ close, run, schedule });
        state.opened = true; state.ui.root.hidden = false;
        state.inert = [...document.querySelectorAll('#app, .sheet-root')].map((node) => [node, node.inert]);
        for (const [node] of state.inert) node.inert = true;
        document.documentElement.classList.add('okw-navigation-search-open');
        message(initial()); state.ui.input.focus();
      }, close,
    };
  };
}
