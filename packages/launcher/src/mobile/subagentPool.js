{
  const installed = Symbol.for('open-kimi-web.subagent-pool');
  if (!window[installed]) {
    window[installed] = true;
    const api = window.__okwSubagentPoolApi;
    const view = window.__okwSubagentPoolView;
    const picker = window.__okwMobileSubagentView;
    const mounts = new Map();
    let current;
    const settingsSelector = '.sheet-root:not(.okw-subagent-overlay), .ui-dialog';
    const ignored = '.okw-pool-dialog, .okw-pool-entry, .a-msg, .sc-body, .chat-scroll, .okw-subagent-overlay';
    const detach = (state) => {
      state.closed = true; state.controller?.abort();
      if (state.resize) window.removeEventListener('resize', state.resize);
      state.ui.root.remove();
      if (current === state) current = null;
    };
    const close = (state, restore = true) => {
      if (state.busy === 'saving') return;
      if (state.ui.root.hasAttribute('open')) state.ui.root.close();
      detach(state);
      if (restore && state.trigger.isConnected) state.trigger.focus({ preventScroll: true });
    };
    const eventsFor = (state) => ({
      default: (alias) => {
        if (state.busy) return;
        state.draft.defaultModel = alias; state.error = ''; state.saved = false; render(state);
      },
      description: (alias, value) => {
        if (state.busy) return;
        state.draft.entries.set(alias, value); state.error = ''; state.saved = false; view.renderState(state);
      },
      template: (alias, key) => {
        if (state.busy) return;
        state.draft.entries.set(alias, view.copy()[key]); state.error = ''; state.saved = false; render(state);
        state.ui.cardNodes.get(alias).description.focus({ preventScroll: true });
      },
    });
    const renderPicker = (state) => {
      if (!state.adding || !state.data) return;
      state.pickerState.data = { models: state.data.models.filter((model) => !state.draft.entries.has(model.id)) };
      state.pickerState.busy = state.busy;
      picker.renderPicker(state.pickerState, (alias) => add(state, alias), (provider) => {
        state.pickerState.provider = provider; state.pickerState.selected = 0; renderPicker(state);
      }, (alias) => {
        state.pickerState.selected = state.pickerState.visible.findIndex((model) => model.id === alias);
        picker.renderActivity(state.pickerState);
      });
      if (!state.pickerState.data.models.length) picker.text(state.ui.empty, view.copy().noModels);
    };
    const render = (state) => {
      view.localize(state);
      if (state.draft) view.renderCards(state, eventsFor(state));
      view.renderState(state); renderPicker(state);
    };
    const load = async (state) => {
      state.controller?.abort(); state.controller = new AbortController();
      state.busy = 'loading'; state.error = ''; render(state);
      try {
        const data = await api.load(state.controller.signal);
        if (state.closed) return;
        state.data = data; state.draft = api.draftFor(data); state.busy = false;
        render(state);
      } catch (error) {
        if (!state.closed) { state.busy = false; state.error = error.message; render(state); }
      }
    };
    const save = async (state) => {
      if (state.busy || !state.draft || state.ui.save.disabled) return;
      state.busy = 'saving'; state.error = ''; state.saved = false;
      state.controller = new AbortController(); render(state);
      try {
        const data = await api.save(state.draft, state.controller.signal);
        if (state.closed) return;
        state.data = data; state.draft = api.draftFor(data); state.busy = false; state.saved = true;
        render(state);
      } catch (error) {
        if (!state.closed) { state.busy = false; state.error = error.message; render(state); }
      } finally {
        if (!state.mount.root.isConnected || !state.trigger.isConnected) close(state, false);
      }
    };
    const togglePicker = (state, adding) => {
      if (state.busy || !state.draft) return;
      state.adding = adding;
      state.pickerState.search = ''; state.pickerState.provider = null; state.pickerState.selected = 0;
      state.ui.search.value = ''; render(state);
      if (adding && !window.matchMedia('(hover: none)').matches) state.ui.search.focus();
      if (!adding) state.ui.add.focus({ preventScroll: true });
    };
    const add = (state, alias) => {
      if (state.busy || !alias || state.draft.entries.has(alias)) return;
      state.draft.entries.set(alias, '');
      if (!state.draft.defaultModel) state.draft.defaultModel = alias;
      state.error = ''; state.saved = false; togglePicker(state, false);
      const field = state.ui.cardNodes.get(alias)?.description;
      field?.focus({ preventScroll: true }); field?.scrollIntoView?.({ block: 'nearest' });
    };
    const move = (state, key) => {
      const choice = state.pickerState;
      const delta = key === 'ArrowDown' ? 1 : -1;
      choice.selected = Math.max(0, Math.min(choice.selected + delta, choice.visible.length - 1));
      picker.renderActivity(choice);
      const selected = state.ui.rows.get(choice.visible[choice.selected]?.id);
      selected?.scrollIntoView?.({ block: 'nearest' });
    };
    const navigate = (state, event) => {
      if (!state.adding || state.busy || event.isComposing || event.keyCode === 229) return;
      if (![state.ui.search, state.ui.list].includes(event.target)) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        const model = state.pickerState.visible[state.pickerState.selected];
        if (model) add(state, model.id);
      } else if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault(); move(state, event.key);
      }
    };
    const connect = (state) => {
      const { ui } = state;
      ui.form.addEventListener('submit', (event) => { event.preventDefault(); save(state); });
      [ui.close, ui.cancel].forEach((node) => node.addEventListener('click', () => close(state)));
      ui.root.addEventListener('cancel', (event) => { event.preventDefault(); close(state); });
      ui.root.addEventListener('close', () => detach(state));
      ui.retry.addEventListener('click', () => state.draft ? save(state) : load(state));
      ui.add.addEventListener('click', () => togglePicker(state, true));
      ui.back.addEventListener('click', () => togglePicker(state, false));
      ui.search.addEventListener('input', () => {
        state.pickerState.search = ui.search.value; state.pickerState.selected = 0; renderPicker(state);
      });
      ui.clear.addEventListener('click', () => {
        ui.search.value = ''; state.pickerState.search = ''; state.pickerState.selected = 0;
        renderPicker(state); ui.search.focus();
      });
      ui.root.addEventListener('keydown', (event) => { navigate(state, event); event.stopPropagation(); });
      state.resize = () => view.resizeDescriptions(ui);
      window.addEventListener('resize', state.resize);
    };
    const open = (mount) => {
      if (current) return;
      const state = { ui: view.build(), trigger: mount.ui.trigger, mount, busy: false, error: '',
        data: null, draft: null, adding: false, saved: false, closed: false };
      state.pickerState = { ui: state.ui, allowFollow: false, choice: { model: '' }, search: '',
        provider: null, selected: 0, visible: [], busy: false, data: { models: [] } };
      current = state; connect(state); document.body.append(state.ui.root); render(state);
      mount.ui.error.hidden = true;
      try {
        if (typeof state.ui.root.showModal !== 'function') throw new Error('missing');
        state.ui.root.showModal();
      } catch {
        detach(state); mount.ui.error.hidden = false; return;
      }
      state.ui.close.focus({ preventScroll: true }); load(state);
    };
    const panelTitle = (panel) => panel.getAttribute('aria-label') ?? panel.querySelector('.sheet-title')?.textContent;
    const mobileTarget = (root) => {
      if (!document.querySelector('.app.mobile') || !window.matchMedia('(max-width: 640px)').matches) return null;
      const panel = root.querySelector('.sheet-panel[role="dialog"]');
      if (!panel) return null;
      if (!['设置', '会话设置', 'settings', 'session settings'].includes(panelTitle(panel)?.trim().toLowerCase())) return null;
      const body = panel.querySelector('.sheet-body');
      return body?.querySelector('.cache-note') ? { body, mobile: true } : null;
    };
    const settingsPanels = (settings) => {
      const tabs = [...settings.querySelectorAll('.settings-tabs [role="tab"]')];
      const panels = settings.querySelectorAll('.panel');
      const names = ['通用', 'general', '智能体与会话', 'agent & sessions'];
      return tabs.flatMap((tab, index) => names.includes(tab.textContent.trim().toLowerCase()) ? [panels[index]] : [])
        .filter((panel) => panel && !panel.closest('[hidden]') && panel.style.display !== 'none');
    };
    const subagentSection = (panel) => [...panel.querySelectorAll('.sec')].find((section) =>
      ['子智能体', 'subagents'].includes(section.querySelector('.sec-title')?.textContent?.trim().toLowerCase()));
    const desktopTarget = (root) => {
      const settings = root.querySelector('.sd');
      if (!settings) return null;
      const body = settingsPanels(settings).map(subagentSection).find(Boolean);
      return body ? { body, mobile: false } : null;
    };
    const removeMount = (root, mount) => {
      if (current?.mount === mount) close(current, false);
      mount.ui.section.remove(); mounts.delete(root);
    };
    const createMount = (root, target) => {
      const ui = view.entry(target.mobile);
      const mount = { ...target, root, ui }; mounts.set(root, mount);
      ui.trigger.addEventListener('click', () => open(mount));
      const sibling = target.mobile && target.body.querySelector('.okw-subagent-section, .cache-note');
      if (sibling) sibling.after(ui.section); else target.body.append(ui.section);
      return mount;
    };
    const enhance = (root) => {
      const target = root.matches('.sheet-root') ? mobileTarget(root) : desktopTarget(root);
      const previous = mounts.get(root);
      if (previous && (!target || previous.body !== target.body)) removeMount(root, previous);
      if (!target) return;
      const mount = mounts.get(root) || createMount(root, target);
      view.localizeEntry(mount.ui);
    };
    const cleanup = () => {
      for (const [root, mount] of mounts) {
        if (!root.isConnected || !mount.ui.section.isConnected) removeMount(root, mount);
      }
    };
    const collectNode = (node, root, roots) => {
      if (node.nodeType !== 1 || node.matches(ignored)) return;
      if (node.matches(settingsSelector)) roots.add(node);
      else if (!root) node.querySelectorAll(settingsSelector).forEach((item) => roots.add(item));
    };
    const collect = (record, roots) => {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (target?.closest(ignored)) return;
      const root = target?.closest(settingsSelector);
      if (root) roots.add(root);
      record.addedNodes.forEach((node) => collectNode(node, root, roots));
    };
    new MutationObserver((records) => {
      cleanup();
      const roots = new Set(); records.forEach((record) => collect(record, roots)); roots.forEach(enhance);
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['hidden', 'aria-label', 'class', 'style'] });
    const refresh = () => {
      cleanup(); document.querySelectorAll(settingsSelector).forEach(enhance);
      if (current) render(current);
    };
    window.__okwLocale?.observe(refresh);
    window.matchMedia('(max-width: 640px)').addEventListener('change', refresh);
    window.addEventListener('keydown', (event) => {
      if (!current || event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (current.adding) togglePicker(current, false); else close(current);
    }, true);
    refresh();
  }
}
