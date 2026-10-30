{
  const installed = Symbol.for('open-kimi-web.effort-order');
  if (!window[installed]) {
    window[installed] = true;
    const ranks = new Map(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].map((value, index) => [value, index + 1]));
    const prefixes = new Set(['', 'auto', 'off', 'on', 'model default', '自动', '模型默认']);
    const rank = (value) => {
      const key = String(value ?? '').trim().toLowerCase();
      if (prefixes.has(key)) return 0;
      return key === 'max' ? 8 : ranks.get(key) ?? 7;
    };
    const sort = (entries, valueFor = (entry) => entry) => [...entries]
      .sort((a, b) => rank(valueFor(a)) - rank(valueFor(b)));
    window.__okwEffortOrder = Object.freeze({ sort });

    const segment = '.ui-seg[role="tablist"]';
    const flyout = '.sm-picker__flyout[role="listbox"]';
    const candidates = `${segment}, ${flyout}`;
    const ignored = '.a-msg, .sc-body, .chat-scroll, .okw-subagent-overlay';
    const settingsNames = new Set(['Settings', 'Session settings', '设置', '会话设置']);
    const thinkingNames = new Set(['Thinking', '思考', '思考强度']);
    const defaultNames = new Set(['Thinking by default', '默认开启思考']);
    const effortNames = new Set(['Thinking effort', '思考强度']);
    const cursors = new WeakMap();
    const label = (node) => (node.querySelector('.sm-picker__option-label') ?? node).textContent.trim();
    const optionsFor = (node) => [...node.querySelectorAll('button.sm-picker__option[role="option"][aria-selected]')]
      .filter((item) => item.closest(flyout) === node && item.querySelector('.sm-picker__option-label'));
    const isFlyout = (node) => node.matches(flyout) && effortNames.has(node.getAttribute('aria-label')) &&
      !!node.closest('.sm-picker__menu[role="dialog"]');
    const isMobileThinking = (node) => {
      const row = node.parentElement;
      if (!row?.matches('.srow.read-only') || !thinkingNames.has(row.querySelector('.srow-label')?.textContent.trim())) {
        return false;
      }
      const panel = row.closest('.sheet-body')?.closest('.sheet-panel[role="dialog"]');
      return !!panel && [panel.getAttribute('aria-label'), panel.querySelector('.sheet-title')?.textContent.trim()]
        .some((title) => settingsNames.has(title));
    };
    const isSegment = (node) => node.matches(segment) && (
      !!node.closest('.md-thinking, .thinking-value') || defaultNames.has(node.getAttribute('aria-label')) ||
      isMobileThinking(node));
    const reorder = (nodes) => {
      if (nodes.length < 2 || nodes.some((node) => node.parentElement !== nodes[0].parentElement)) return nodes;
      const ordered = sort(nodes, label);
      const focused = nodes.includes(document.activeElement) ? document.activeElement : null;
      let anchor = nodes[0];
      for (const node of ordered) {
        if (node === anchor) anchor = anchor.nextElementSibling;
        else node.parentElement.insertBefore(node, anchor);
      }
      if (focused && document.activeElement !== focused) focused.focus({ preventScroll: true });
      return ordered;
    };
    const enhance = (node) => {
      if (!node.isConnected || node.closest(ignored)) return;
      if (isFlyout(node)) reorder(optionsFor(node));
      else if (isSegment(node)) {
        reorder([...node.children].filter((item) => item.matches('button.ui-seg__item[role="tab"]')));
      }
    };
    const collect = (node, roots) => {
      if (node.nodeType !== 1 || node.closest(ignored)) return;
      if (node.matches(candidates)) roots.add(node);
      node.querySelectorAll(candidates).forEach((item) => roots.add(item));
    };
    const changed = (records) => {
      const roots = new Set();
      for (const record of records) {
        const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        if (!target || target.closest(ignored)) continue;
        const current = target.closest(candidates);
        if (current) roots.add(current);
        else {
          const container = target.closest('.md-thinking, .thinking-value, .sheet-panel[role="dialog"]');
          if (container) collect(container, roots);
        }
        for (const node of record.addedNodes) collect(node, roots);
      }
      roots.forEach(enhance);
    };
    const menuFor = (target) => {
      const trigger = target.closest('.sm-picker__trigger[role="combobox"][aria-controls]');
      if (!trigger) return target.closest('.sm-picker__menu[role="dialog"]');
      const id = trigger.getAttribute('aria-controls');
      if (trigger.getAttribute('aria-expanded') !== 'true' || !id.startsWith('sm-picker-')) return null;
      const menu = document.getElementById(id);
      return menu?.matches('.sm-picker__menu[role="dialog"]') ? menu : null;
    };
    const laneFor = (menu) => {
      const node = menu?.querySelector(flyout);
      return node && isFlyout(node) ? node : null;
    };
    const rememberPointer = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const menu = target.closest('.sm-picker__menu[role="dialog"]');
      const lane = laneFor(menu);
      if (!lane) return;
      const button = target.closest('button.sm-picker__option[role="option"]');
      if (button?.closest(flyout) === lane) cursors.set(lane, { effort: true, button });
      else if (target.closest('.sm-picker__models')) cursors.delete(lane);
    };
    const nativeLane = (event, lane) => {
      if (event.key === 'ArrowLeft') { cursors.set(lane, { effort: false }); return true; }
      if (event.key === 'ArrowRight') { cursors.delete(lane); return true; }
      if (['Escape', 'Tab'].includes(event.key)) { cursors.delete(lane); return true; }
      return false;
    };
    const nextButton = (key, nodes, current) => {
      if (key === 'Home') return nodes[0];
      if (key === 'End') return nodes.at(-1);
      if (key === 'Enter' || key === ' ') return current;
      const index = nodes.indexOf(current);
      return nodes[(index + (key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length];
    };
    const currentFor = (nodes, target, state) => {
      const focused = nodes.find((node) => node === target.closest('button'));
      if (focused) return focused;
      if (nodes.includes(state?.button)) return state.button;
      const active = nodes.find((node) => node.classList.contains('is-kb-active'));
      return active ?? nodes.find((node) => node.getAttribute('aria-selected') === 'true') ?? nodes[0];
    };
    const cursorFor = (lane, target) => {
      const nodes = reorder(optionsFor(lane)).filter((node) => !node.disabled && !node.closest('[hidden]'));
      const state = cursors.get(lane);
      const active = nodes.some((node) => node.classList.contains('is-kb-active') || node === target.closest('button'));
      if (!nodes.length || !(state?.effort ?? active)) return null;
      return { nodes, current: currentFor(nodes, target, state) };
    };
    const modified = (event) => event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey;
    const navigate = (event) => {
      if (modified(event) || !(event.target instanceof Element)) return;
      const lane = laneFor(menuFor(event.target));
      if (!lane || nativeLane(event, lane)) return;
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
      const cursor = cursorFor(lane, event.target);
      if (!cursor) return;
      const next = nextButton(event.key, cursor.nodes, cursor.current);
      event.preventDefault();
      event.stopImmediatePropagation();
      cursors.set(lane, { effort: true, button: next });
      if (event.key === 'Enter' || event.key === ' ') next.click();
      else {
        next.dispatchEvent(new MouseEvent('mouseenter'));
        next.scrollIntoView?.({ block: 'nearest' });
      }
    };
    new MutationObserver(changed).observe(document.documentElement, {
      childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['class', 'role', 'aria-label', 'hidden'],
    });
    document.addEventListener('mouseenter', rememberPointer, true);
    document.addEventListener('keydown', navigate, true);
    document.querySelectorAll(candidates).forEach(enhance);
  }
}
