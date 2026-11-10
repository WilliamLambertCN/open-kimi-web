{
  const text = (zh, en) => window.__okwLocale?.text(zh, en) ?? en;
  const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const attr = (node, name, value) => {
    if (node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value));
  };
  const element = (tag, className, value) => {
    const node = document.createElement(tag);
    node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  };
  const button = (className, action) => {
    const node = element('button', className);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  };
  window.__okwBuildMobileConversationToc = ({ open, close, select, earlier }) => {
    const trigger = button('ui-icon-button ui-icon-button--lg okw-toc-trigger', open);
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [name, value] of Object.entries({ width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none',
      'aria-hidden': true })) attr(icon, name, value);
    const path = document.createElementNS(icon.namespaceURI, 'path');
    for (const [name, value] of Object.entries({ d: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
      stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round' })) attr(path, name, value);
    icon.append(path); trigger.append(icon);
    attr(trigger, 'aria-haspopup', 'dialog');
    attr(trigger, 'aria-expanded', false);
    attr(trigger, 'aria-controls', 'okw-mobile-conversation-toc');
    const root = element('div', 'okw-toc-backdrop');
    root.hidden = true;
    const panel = element('section', 'okw-toc-panel');
    panel.id = 'okw-mobile-conversation-toc';
    panel.tabIndex = -1;
    attr(panel, 'role', 'dialog');
    attr(panel, 'aria-modal', true);
    attr(panel, 'aria-labelledby', 'okw-toc-title');
    attr(panel, 'aria-describedby', 'okw-toc-hint');
    const head = element('header', 'okw-toc-head');
    const title = element('h2', '');
    title.id = 'okw-toc-title';
    const dismiss = button('okw-toc-close', close);
    head.append(title, dismiss);
    const list = element('nav', 'okw-toc-list');
    const status = element('p', 'okw-toc-status');
    attr(status, 'role', 'status');
    const foot = element('footer', 'okw-toc-foot');
    const hint = element('p', '');
    hint.id = 'okw-toc-hint';
    const more = button('okw-toc-earlier', earlier);
    foot.append(hint, more); panel.append(head, status, list, foot); root.append(panel);
    root.addEventListener('click', (event) => { if (event.target === root) close(); });
    const rows = new Map();
    const localize = () => {
      const label = text('消息目录', 'Message outline');
      setText(title, label); attr(trigger, 'aria-label', label); attr(trigger, 'title', label);
      attr(list, 'aria-label', label);
      setText(dismiss, text('关闭', 'Close'));
      setText(more, text('加载更早消息', 'Load earlier messages'));
      setText(hint, text('从已加载的消息中列出目录；更早内容按需加载。超大消息可能不在目录中。',
        'Lists messages from loaded history. Load earlier messages as needed. Very large messages may be omitted.'));
    };
    const render = (items, activeId, hasMore, error = false) => {
      const ids = new Set(items.map((item) => item.id));
      for (const [id, row] of rows) if (!ids.has(id)) { row.remove(); rows.delete(id); }
      const nodes = items.map((item, index) => {
        let row = rows.get(item.id);
        if (!row) {
          row = button('okw-toc-item', () => select(item.id));
          row.dataset.turnId = item.id;
          row.append(element('span', 'okw-toc-number'), element('span', 'okw-toc-label'));
          rows.set(item.id, row);
        }
        setText(row.firstElementChild, String(index + 1));
        attr(row.firstElementChild, 'aria-hidden', true);
        setText(row.lastElementChild, item.label);
        attr(row, 'title', item.label);
        row.classList.toggle('is-current', item.id === activeId);
        if (item.id === activeId) attr(row, 'aria-current', true);
        else row.removeAttribute('aria-current');
        return row;
      });
      if (list.children.length !== nodes.length || nodes.some((node, index) => list.children[index] !== node)) {
        list.replaceChildren(...nodes);
      }
      more.hidden = !hasMore;
      status.hidden = items.length > 0 && !error;
      setText(status, error ? text('暂时无法定位这条消息，请重新打开目录。',
        'This message cannot be located right now. Reopen the outline.') : text('还没有可定位的消息。',
        'No messages to navigate yet.'));
      status.classList.toggle('is-error', error);
    };
    localize();
    return { trigger, root, panel, list, dismiss, more, rows, localize, render, attr };
  };
}
