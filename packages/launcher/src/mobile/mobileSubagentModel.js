{
  const installed = Symbol.for('open-kimi-web.mobile-subagent-model');
  if (!window[installed]) {
    window[installed] = true;
    const api = window.__okwMobileSubagentApi;
    const view = window.__okwMobileSubagentView;
    const mobile = window.matchMedia('(max-width: 640px)');
    const touch = window.matchMedia('(hover: none)');
    const sheets = new Map();
    let current = null;

    const settingsPanel = (panel) => {
      if (!panel || panel.hidden) return false;
      const titles = [panel.getAttribute('aria-label'), panel.querySelector('.sheet-title')?.textContent?.trim()];
      return titles.some((title) => ['设置', '会话设置', 'Settings', 'Session settings'].includes(title));
    };
    const settingsBody = (root) => {
      if (root.matches('.okw-subagent-overlay') || !mobile.matches || !root.isConnected) return null;
      if (!document.querySelector('.app.mobile')) return null;
      const panel = root.querySelector('.sheet-panel[role="dialog"]');
      if (!settingsPanel(panel)) return null;
      const body = panel.querySelector('.sheet-body');
      return body?.querySelector('.cache-note') && body.querySelector('.group-title + .card .srow-main .srow-label')
        ? body : null;
    };
    const active = (state) => current === state && state.ui.overlay.isConnected &&
      state.ui.section.isConnected && settingsBody(state.root) === state.ui.section.parentElement;
    const isolate = (state) => {
      state.isolated = [...document.body.children].filter((node) => node !== state.ui.overlay)
        .map((node) => ({ node, inert: node.getAttribute('inert'), hidden: node.getAttribute('aria-hidden'),
          property: node.inert }));
      state.isolated.forEach(({ node }) => { node.inert = true; view.attr(node, 'inert', '');
        view.attr(node, 'aria-hidden', true); });
    };
    const restoreAttribute = (node, key, value) => {
      if (value === null) node.removeAttribute(key); else view.attr(node, key, value);
    };
    const close = (state, restoreFocus = false) => {
      state.generation += 1;
      state.controller?.abort();
      state.controller = null;
      state.busy = false;
      state.ui.overlay.remove();
      state.isolated?.forEach(({ node, inert, hidden, property }) => {
        node.inert = property;
        restoreAttribute(node, 'inert', inert);
        restoreAttribute(node, 'aria-hidden', hidden);
      });
      state.isolated = null;
      view.attr(state.ui.trigger, 'aria-expanded', false);
      if (current === state) current = null;
      const focus = state.returnFocus?.isConnected ? state.returnFocus : state.ui.trigger;
      if (restoreFocus && focus.isConnected && !focus.closest('[inert]')) focus.focus({ preventScroll: true });
    };
    const selectionError = (state) => {
      try {
        const patch = api.patchFor(state.data.section, state.choice, state.data.models);
        return { changed: patch !== null, error: '' };
      } catch (error) { return { changed: false, error: error.message }; }
    };
    const statusText = (state, error) => {
      const words = view.copy();
      if (state.busy) return words[state.busy];
      return error ? words[error] ?? words.requestFailed : '';
    };
    const renderAvailability = (state) => {
      const { ui } = state;
      const disabled = !!state.busy || !state.data;
      ui.search.disabled = disabled;
      ui.clear.disabled = disabled;
      for (const key of ['list', 'chips', 'effort', 'effortLabelNode', 'hint']) ui[key].hidden = !state.data;
      ui.empty.hidden = !state.data || state.visible.length !== 0;
      ui.details.hidden = !state.data || !state.choice.model;
    };
    const renderState = (state) => {
      const { ui } = state;
      const selection = state.data ? selectionError(state) : { changed: false, error: '' };
      const error = state.error || selection.error;
      view.text(ui.status, statusText(state, error));
      ui.status.classList.toggle('is-error', !!error && !state.busy);
      view.attr(ui.editor, 'aria-busy', !!state.busy);
      renderAvailability(state);
      ui.save.disabled = !!state.busy || !selection.changed || !!error;
      ui.retry.hidden = !state.error || !!state.busy;
      view.text(ui.save, state.busy === 'saving' ? view.copy().saving : view.copy().save);
    };
    const hover = (state, id) => {
      if (state.busy) return;
      state.selected = state.visible.findIndex((model) => model.id === id);
      view.renderActivity(state);
    };
    const renderPicker = (state) => {
      view.renderPicker(state, (id) => select(state, id), (provider) => {
        if (state.busy) return;
        state.provider = provider;
        state.selected = 0;
        renderPicker(state);
      }, (id) => hover(state, id));
    };
    const renderEfforts = (state) => {
      const efforts = ['', ...api.availableEfforts(state.data.section, state.choice.model, state.data.models)];
      if (state.choice.effort && !efforts.includes(state.choice.effort)) efforts.push(state.choice.effort);
      view.renderEfforts(state, efforts, (effort) => {
        if (state.busy || !state.choice.model) return;
        state.choice.effort = effort;
        state.error = '';
        renderData(state);
      });
    };
    const renderData = (state) => {
      renderPicker(state);
      renderEfforts(state);
      view.renderSummary(state.ui, state.data);
      renderState(state);
    };
    const select = (state, id) => {
      if (state.busy || !state.data) return;
      state.choice.model = id;
      state.error = '';
      const efforts = api.availableEfforts(state.data.section, id, state.data.models);
      if (!efforts.includes(state.choice.effort)) state.choice.effort = '';
      renderData(state);
    };
    const load = async (state) => {
      state.controller?.abort();
      const generation = ++state.generation;
      const controller = new AbortController();
      state.controller = controller;
      state.data = null;
      state.error = '';
      state.busy = 'loading';
      renderState(state);
      try {
        const data = await api.load(controller.signal);
        if (generation !== state.generation || !active(state)) return;
        state.data = data;
        state.choice = api.choiceFor(data.section);
        state.busy = false;
        renderData(state);
        if (!touch.matches) state.ui.search.focus({ preventScroll: true });
      } catch (error) {
        if (generation === state.generation && active(state)) {
          state.busy = false;
          state.error = error.message;
          renderState(state);
        }
      }
    };
    const save = async (state) => {
      if (state.busy || !state.data || state.ui.save.disabled || !active(state)) return;
      state.busy = 'saving';
      state.error = '';
      const generation = ++state.generation;
      const controller = new AbortController();
      state.controller = controller;
      renderData(state);
      try {
        const data = await api.save({ ...state.choice }, controller.signal);
        if (generation !== state.generation || !active(state)) return;
        state.data = data;
        view.renderSummary(state.ui, data);
        close(state, true);
      } catch (error) {
        if (generation === state.generation && active(state)) {
          state.busy = false;
          state.error = error.message;
          renderData(state);
        }
      }
    };
    const open = (state) => {
      if (current === state) { close(state, true); return; }
      if (current) close(current);
      current = state;
      state.returnFocus = document.activeElement === document.body ? state.ui.trigger : document.activeElement;
      state.search = '';
      state.provider = null;
      state.selected = 0;
      state.composing = false;
      state.visible = [];
      state.ui.search.value = '';
      state.ui.details.open = false;
      document.body.append(state.ui.overlay);
      view.attr(state.ui.trigger, 'aria-expanded', true);
      state.ui.editor.focus({ preventScroll: true });
      isolate(state);
      load(state);
    };
    const connect = (state) => {
      const { ui } = state;
      ui.trigger.addEventListener('click', () => open(state));
      [ui.cancel, ui.grab, ui.scrim].forEach((node) => node.addEventListener('click', () => close(state, true)));
      ui.retry.addEventListener('click', () => load(state));
      ui.save.addEventListener('click', () => save(state));
      ui.search.addEventListener('input', () => {
        state.search = ui.search.value;
        state.selected = 0;
        if (state.data) renderPicker(state);
      });
      ui.clear.addEventListener('click', () => {
        state.search = '';
        state.selected = 0;
        ui.search.value = '';
        renderPicker(state);
        ui.search.focus();
      });
      ui.search.addEventListener('compositionstart', () => { state.composing = true; });
      ui.search.addEventListener('compositionend', () => { state.composing = false; });
    };
    const localize = (state) => {
      if (state.ui.label.textContent === view.copy().title) return;
      const body = state.ui.section.parentElement;
      const scroll = [body?.scrollTop, state.ui.body.scrollTop];
      view.localize(state.ui);
      view.renderSummary(state.ui, state.data);
      if (state.data && current === state) renderData(state);
      if (current === state) renderState(state);
      if (body) body.scrollTop = scroll[0];
      state.ui.body.scrollTop = scroll[1];
    };
    const enhance = (root) => {
      const body = settingsBody(root);
      const previous = sheets.get(root);
      if (previous && (!body || previous.ui.section.parentElement !== body || !previous.ui.section.isConnected)) {
        close(previous);
        previous.ui.section.remove();
        sheets.delete(root);
      }
      if (!body) return;
      const existing = sheets.get(root);
      if (existing) { localize(existing); return; }
      const ui = view.build();
      const state = { root, ui, data: null, choice: { model: '', effort: '' }, busy: false, error: '', generation: 0 };
      sheets.set(root, state);
      connect(state);
      view.localize(ui);
      view.renderSummary(ui, null);
      body.querySelector('.cache-note').after(ui.section);
    };
    const cleanup = () => {
      for (const [root, state] of sheets) {
        if (!root.isConnected) { close(state); state.ui.section.remove(); sheets.delete(root); }
      }
    };
    const collectAdded = (record, root, roots) => {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1 || node.matches('.a-msg, .sc-body, .okw-subagent-overlay')) continue;
        if (node.matches('.sheet-root')) roots.add(node);
        else if (!root) node.querySelectorAll('.sheet-root:not(.okw-subagent-overlay)').forEach((sheet) => roots.add(sheet));
      }
    };
    const changed = (records) => {
      cleanup();
      const roots = new Set();
      for (const record of records) {
        const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        if (target?.closest('.okw-subagent-overlay, .a-msg, .sc-body, .chat-scroll')) continue;
        const root = target?.closest('.sheet-root');
        if (root) roots.add(root);
        collectAdded(record, root, roots);
      }
      roots.forEach(enhance);
    };
    const trapTab = (state, event) => {
      const nodes = [...state.ui.editor.querySelectorAll('button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]')]
        .filter((node) => node.tabIndex >= 0 && !node.disabled && !node.closest('[hidden]'));
      const index = nodes.indexOf(document.activeElement);
      const start = event.shiftKey ? nodes.length - 1 : 0;
      const nextIndex = index < 0 ? start : (index + (event.shiftKey ? -1 : 1) + nodes.length) % nodes.length;
      event.preventDefault();
      (nodes[nextIndex] || state.ui.editor).focus({ preventScroll: true });
    };
    const reveal = (node, inline = 'nearest') => { node?.scrollIntoView?.({ block: 'nearest', inline }); };
    const horizontal = (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return false;
      const node = event.target.closest('.chip, .ui-seg__item');
      if (!node) return false;
      const nodes = [...node.parentElement.children].filter((item) => !item.disabled);
      let index = nodes.indexOf(node) + (event.key === 'ArrowRight' ? 1 : -1);
      if (event.key === 'Home') index = 0;
      if (event.key === 'End') index = nodes.length - 1;
      const next = nodes[Math.max(0, Math.min(index, nodes.length - 1))];
      event.preventDefault();
      if (next) {
        next.focus();
        if (node.matches('.ui-seg__item')) next.click();
        reveal(next);
      }
      return true;
    };
    const move = (state, delta) => {
      state.selected = Math.max(0, Math.min(state.selected + delta, state.visible.length - 1));
      view.renderActivity(state);
      reveal(state.ui.rows.get(state.visible[state.selected]?.id));
    };
    const navigate = (state, event) => {
      if (!state.data || state.busy || horizontal(event)) return;
      if (![state.ui.search, state.ui.list, state.ui.editor].includes(event.target)) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        const model = state.visible[state.selected];
        if (model) select(state, model.id);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        move(state, event.key === 'ArrowDown' ? 1 : -1);
      }
    };
    new MutationObserver(changed).observe(document.documentElement, {
      childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['aria-label', 'class', 'hidden'],
    });
    document.addEventListener('keydown', (event) => {
      if (!current) return;
      const state = current;
      event.stopImmediatePropagation();
      if (event.isComposing || event.keyCode === 229 || state.composing) return;
      if (event.key === 'Escape') { event.preventDefault(); close(state, true); return; }
      if (event.key === 'Tab') { trapTab(state, event); return; }
      navigate(state, event);
    }, true);
    document.addEventListener('focusin', (event) => {
      if (current && !current.ui.overlay.contains(event.target)) {
        event.stopImmediatePropagation();
        current.ui.editor.focus({ preventScroll: true });
      }
    }, true);
    const refresh = () => {
      cleanup();
      document.querySelectorAll('.sheet-root:not(.okw-subagent-overlay)').forEach(enhance);
    };
    mobile.addEventListener('change', refresh);
    if (window.__okwLocale) window.__okwLocale.observe(() => sheets.forEach(localize));
    else window.addEventListener('storage', (event) => { if (event.key === 'kimi-locale') sheets.forEach(localize); });
    refresh();
  }
}
