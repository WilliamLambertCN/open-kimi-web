{
  const installed = Symbol.for('open-kimi-web.sidechat-model');
  if (!window[installed]) {
    window[installed] = true;
    const identity = window.__okwSideChatIdentity;
    const api = window.__okwSideChatModelApi;
    const view = window.__okwSideChatModelView;
    const entries = new Map();
    let current = null;
    let pending = false;
    const same = (a, b) => !!a && !!b && a.session === b.session && a.agent === b.agent;
    const close = (focus = false) => {
      const state = current;
      if (!state) return;
      current = null; state.controller?.abort();
      state.ui.dialog.close(); state.ui.dialog.remove();
      view.attr(state.trigger, 'aria-expanded', false);
      if (focus && state.trigger.isConnected) state.trigger.focus({ preventScroll: true });
    };
    const valid = (state) => current === state && same(state.target, identity.identity(state.sc));
    const status = (state) => {
      const unavailable = state.choice.model && !state.models.some((model) => model.id === state.choice.model);
      const error = state.error || (unavailable ? 'modelMissing' : '');
      view.text(state.ui.status, state.loading ? view.copy().loading : (view.copy()[error] ?? ''));
      state.ui.status.classList.toggle('is-error', !!error);
      state.ui.retry.hidden = !state.error || state.loading;
      state.ui.apply.disabled = state.loading || !!error;
    };
    const render = (state) => {
      const { ui } = state;
      view.localize(ui); status(state);
      for (const node of [ui.search, ui.effort]) node.disabled = state.loading;
      for (const node of [ui.chips, ui.list, ui.empty, ui.effortLabel, ui.effort, ui.hint]) node.hidden = state.loading;
      view.attr(ui.dialog, 'aria-busy', state.loading);
      if (state.loading) return;
      view.renderModels(state, (id) => choose(state, id), (provider) => {
        state.provider = provider; state.active = 0; render(state);
      });
      view.renderEffort(state); view.activity(state);
    };
    const choose = (state, id) => {
      if (!valid(state) || state.loading) return;
      state.choice.model = id;
      const efforts = api.efforts(state.models.find((model) => model.id === id));
      if (!efforts.includes(state.choice.effort)) state.choice.effort = '';
      state.error = ''; render(state);
    };
    const load = async (state) => {
      state.controller?.abort();
      const controller = new AbortController(); state.controller = controller;
      state.loading = true; state.error = ''; render(state);
      try {
        const models = await api.load(controller.signal);
        if (!valid(state) || controller.signal.aborted) return;
        state.models = models; state.loading = false; render(state);
      } catch (error) {
        if (!valid(state) || controller.signal.aborted) return;
        state.loading = false; state.error = error.message; render(state);
      }
    };
    const apply = (state) => {
      if (!valid(state) || state.ui.apply.disabled) return;
      try { api.select(state.target.session, state.target.agent, state.choice); close(true); refresh(); }
      catch (error) { state.error = error.message; render(state); }
    };
    const move = (state, key) => {
      const length = state.visible.length;
      if (key === 'Home') state.active = 0;
      else if (key === 'End') state.active = Math.max(0, length - 1);
      else state.active = (state.active + (key === 'ArrowUp' ? -1 : 1) + length) % (length || 1);
      view.activity(state); state.ui.list.children[state.active]?.scrollIntoView({ block: 'nearest' });
    };
    const navigate = (state, event) => {
      if (state.loading || event.isComposing || ![state.ui.search, state.ui.list].includes(event.target)) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        const item = state.visible[state.active];
        if (item) choose(state, item.id);
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); move(state, event.key);
      }
    };
    const outside = (dialog, event) => {
      if (event.target !== dialog) return false;
      const rect = dialog.getBoundingClientRect();
      return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    };
    const connect = (state) => {
      const { ui } = state;
      ui.cancel.addEventListener('click', () => close(true));
      ui.retry.addEventListener('click', () => load(state));
      ui.apply.addEventListener('click', () => apply(state));
      ui.dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(true); });
      ui.dialog.addEventListener('click', (event) => { if (outside(ui.dialog, event)) close(true); });
      ui.search.addEventListener('input', () => { state.active = 0; render(state); });
      ui.effort.addEventListener('change', () => { state.choice.effort = ui.effort.value; });
    };
    const open = (sc, trigger) => {
      const target = identity.identity(sc);
      if (!target) return;
      close();
      const state = { sc, trigger, target, ui: view.build(), models: [], choice: api.choice(target.session, target.agent),
        loading: true, error: '', active: 0, provider: '', visible: [] };
      current = state; connect(state); render(state);
      document.body.append(state.ui.dialog); state.ui.dialog.showModal();
      view.attr(trigger, 'aria-expanded', true);
      state.ui.cancel.focus({ preventScroll: true });
      void load(state);
    };
    const enhance = (sc) => {
      const host = sc.querySelector('.sc-composer .toolbar-right');
      if (!host) return;
      let trigger = entries.get(sc);
      if (!trigger) {
        trigger = view.button('okw-sidechat-model-trigger');
        view.attr(trigger, 'aria-haspopup', 'dialog'); view.attr(trigger, 'aria-expanded', false);
        trigger.addEventListener('click', () => open(sc, trigger)); entries.set(sc, trigger);
      }
      const target = identity.identity(sc);
      const selected = target ? api.choice(target.session, target.agent) : { model: '' };
      const model = api.models().find((item) => item.id === selected.model);
      const label = selected.model ? model?.label || selected.model : view.copy().follow;
      view.text(trigger, label + ' ⌄'); trigger.disabled = !target;
      const title = !target ? view.copy().identityLost : `${view.copy().title}: ${label}`;
      view.attr(trigger, 'title', title); view.attr(trigger, 'aria-label', title);
      if (trigger.parentElement !== host) host.prepend(trigger);
    };
    const refresh = () => {
      pending = false;
      if (current && !valid(current)) close();
      for (const [sc, trigger] of entries) if (!sc.isConnected) { trigger.remove(); entries.delete(sc); }
      document.querySelectorAll('.sc').forEach(enhance);
    };
    const schedule = () => { if (!pending) { pending = true; queueMicrotask(refresh); } };
    const relevantNode = (node) => node.nodeType === 1 &&
      (node.matches('.sc, .toolbar-right, .pt-body, .okw-sidechat-model-trigger') || !!node.querySelector('.sc, .toolbar-right'));
    const relevant = (record) => {
      if (record.type === 'attributes') return record.target.matches('.ptb-tab');
      if (record.target.closest?.('.okw-sidechat-picker, .okw-sidechat-model-trigger')) return false;
      return [...record.addedNodes, ...record.removedNodes].some(relevantNode);
    };
    const keydown = (event) => {
      if (!current) return;
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault(); event.stopImmediatePropagation(); close(true);
      } else if (current.ui.dialog.contains(event.target)) { event.stopImmediatePropagation(); navigate(current, event); }
    };
    const start = () => {
      refresh();
      new MutationObserver((records) => { if (records.some(relevant)) schedule(); }).observe(document.body,
        { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      window.addEventListener('okw-sidechat-identity', schedule);
      window.__okwLocale?.observe(() => { refresh(); if (current) render(current); });
      window.addEventListener('keydown', keydown, true);
    };
    window.__okwSideChatModel = { identity: identity.identity };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
}
