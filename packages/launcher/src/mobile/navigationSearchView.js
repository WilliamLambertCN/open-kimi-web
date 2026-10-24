{
  const text = (zh, en) => window.__okwLocale?.text(zh, en) ?? en;
  const el = (tag, className, content) => {
    const node = document.createElement(tag); node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  };
  window.__okwNavigationSearchResult = (hit) => {
    const link = el('a', 'okw-navigation-search-result');
    link.href = `/sessions/${encodeURIComponent(hit.session_id)}`;
    link.append(el('strong', '', hit.session_title || text('未命名会话', 'Untitled session')));
    link.append(el('span', '', hit.snippet));
    const labels = { user: text('用户', 'User'), assistant: text('助手', 'Assistant'), title: text('标题', 'Title') };
    const time = Number.isFinite(hit.time) ? ` · ${new Date(hit.time).toLocaleString()}` : '';
    link.append(el('small', '', labels[hit.role] + time));
    return link;
  };
  window.__okwNavigationBuildSearch = ({ close, run, schedule }) => {
    const copies = [];
    const copy = (tag, zh, en) => {
      const node = el(tag, '', text(zh, en)); copies.push({ node, zh, en }); return node;
    };
    const button = (zh, en, action) => {
      const node = copy('button', zh, en); node.type = 'button'; node.addEventListener('click', action); return node;
    };
    const root = el('div', 'okw-navigation-search-backdrop'); root.hidden = true;
    const panel = el('section', 'okw-navigation-search-panel');
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'okw-navigation-search-title');
    const head = el('header', '');
    const title = copy('h2', '搜索', 'Search'); title.id = 'okw-navigation-search-title';
    head.append(title, button('关闭', 'Close', close));
    const form = el('form', 'okw-navigation-search-form');
    const label = el('label', 'okw-navigation-search-query');
    label.append(copy('span', '搜索所有会话', 'Search all sessions'));
    const input = el('input', ''); input.type = 'search'; input.autocomplete = 'off'; input.spellcheck = false;
    input.addEventListener('input', (event) => { if (!event.isComposing) schedule(); });
    input.addEventListener('compositionend', schedule); label.append(input);
    const filters = el('div', 'okw-navigation-search-filters');
    const select = (zh, en, choices) => {
      const field = el('label', ''); field.append(copy('span', zh, en));
      const control = el('select', '');
      for (const [value, chinese, english] of choices) {
        const option = copy('option', chinese, english); option.value = value; control.append(option);
      }
      control.addEventListener('change', () => { sort.disabled = mode.value === 'literal'; schedule(); });
      field.append(control); filters.append(field); return control;
    };
    const role = select('内容', 'Content', [['', '全部', 'All'], ['user', '用户消息', 'User messages'],
      ['assistant', '助手回复', 'Assistant replies'], ['title', '会话标题', 'Session titles']]);
    const mode = select('匹配方式', 'Match', [['terms', '关键词', 'Terms'], ['literal', '原文片段', 'Literal']]);
    const sort = select('排序', 'Sort', [['score', '相关度', 'Relevance'], ['time_desc', '最新优先', 'Newest'],
      ['time_asc', '最早优先', 'Oldest']]);
    filters.append(button('搜索', 'Search', () => { void run(); }));
    form.append(label, filters); form.addEventListener('submit', (event) => { event.preventDefault(); void run(); });
    const status = el('p', 'okw-navigation-search-status'); status.setAttribute('role', 'status');
    const list = el('div', 'okw-navigation-search-results');
    const more = button('加载更多', 'Load more', () => { void run(true); }); more.hidden = true;
    panel.append(head, form, status, list, more); root.append(panel);
    root.addEventListener('click', (event) => { if (event.target === root) close(); });
    document.body.append(root);
    return { root, panel, input, role, mode, sort, status, list, more,
      localize() { for (const { node, zh, en } of copies) node.textContent = text(zh, en); } };
  };
  window.__okwNavigationSearchKey = (event, { panel, close }) => {
    event.stopImmediatePropagation();
    if (event.key === 'Escape' && !event.isComposing) {
      event.preventDefault(); close(); return;
    }
    if (event.key !== 'Tab') return;
    const controls = [...panel.querySelectorAll('button, input, select, a[href]')]
      .filter((node) => !node.disabled && !node.hidden);
    const first = controls[0]; const last = controls.at(-1);
    if (!first) { event.preventDefault(); return; }
    let target;
    if (!panel.contains(document.activeElement)) target = first;
    else if (event.shiftKey) { if (document.activeElement === first) target = last; }
    else if (document.activeElement === last) target = first;
    if (target) { event.preventDefault(); target.focus(); }
  };
}
