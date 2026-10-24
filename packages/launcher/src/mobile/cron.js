{
  const failure = (error) => {
    if (error?.outcomeUnknown) return 'unknown';
    const statuses = { 401: 'auth', 403: 'auth', 429: 'busy' };
    if (statuses[error?.status]) return statuses[error.status];
    const codes = ['not-loaded', 'auth', 'busy', 'unsupported-version', 'read-only-version', 'required', 'prompt-limit'];
    return codes.includes(error?.code) ? error.code : 'error';
  };
  const inventory = (page) => {
    if (!Array.isArray(page?.items) || !page.items.every((item) => typeof item?.id === 'string' && item.id)) {
      throw new Error('Invalid session inventory.');
    }
    return page;
  };
  const validRecord = (record) => record && ['string', 'number'].includes(typeof record.time) &&
    typeof record.taskId === 'string' && typeof record.kind === 'string';
  const history = (page) => {
    if (typeof page?.available !== 'boolean' || !Array.isArray(page.items)) throw new Error('Invalid history.');
    if (!page.items.every(validRecord)) throw new Error('Invalid history records.');
    return page;
  };
  const selectTask = (state) => {
    if (!state.tasks.some((task) => task.id === state.taskId)) state.taskId = state.tasks[0]?.id ?? '';
  };
  const acceptTasks = (state, tasks, notice) => {
    state.tasks = tasks; state.tasksReady = true; state.unknown = false; state.taskSource = 'live';
    state.taskQuality = { complete: true, reasons: [] }; selectTask(state);
    state.taskStatus = notice || (tasks.length ? '' : 'empty');
  };
  const savedTasks = (state) => {
    const session = state.sessions.find((item) => item.id === state.sid);
    state.tasks = session?.tasks ?? []; state.taskSource = 'saved'; state.tasksReady = false;
    state.taskQuality = session?.quality ?? { complete: false, reasons: [] }; selectTask(state);
    state.taskStatus = state.readOnly ? 'cold-read-only' : session?.loaded === null ? 'load-unknown' : 'not-loaded';
  };
  const needsLive = (state) => state.unknown || state.sessions.find((item) => item.id === state.sid)?.loaded === true;
  const readOnlyVersion = (value) => value.reason === 'read-only-version' || value.version === '2.3.1';
  const readOnly = (state) => {
    state.readOnly = true; state.canCreate = false; state.canRemove = false; state.canRestore = false;
    state.formOpen = false; state.confirmation = null; state.globalStatus = 'read-only-version';
  };
  const writePermissions = (state, permissions) => {
    state.canCreate = state.available && permissions.create === true;
    state.canRemove = state.available && permissions.remove === true;
    state.canRestore = state.canCreate && state.canRemove;
    if (!state.canCreate) state.formOpen = false;
    if (!state.canRestore) state.confirmation = null;
  };
  const capabilities = (state, value) => {
    const permissions = value.capabilities ?? {};
    state.available = value.available && permissions.list === true;
    state.readOnly = false; state.globalStatus = state.available ? '' : 'unavailable';
    writePermissions(state, permissions);
    if (state.available && readOnlyVersion(value)) readOnly(state);
    if (!state.available) {
      state.tasksReady = false; state.sessions = []; state.tasks = []; state.history = []; state.historyMore = false;
    }
  };
  const historyStatus = (page, count) => {
    if (!page.available) return 'history-unavailable';
    if (!page.quality?.complete && !count) return 'history-unconfirmed';
    return count ? '' : 'history-empty';
  };
  const listFailure = (ctx, error, notice) => {
    const { state, reportFailure } = ctx;
    if (notice) { reportFailure({ outcomeUnknown: true }); state.taskStatus = 'reload-failed'; return; }
    if (error?.code === 'not-loaded') {
      savedTasks(state);
      if (state.readOnly) return;
    }
    reportFailure(error);
  };
  const loaders = (ctx) => {
    const { state, api, current, render } = ctx;
    const loadHistory = async (epoch) => {
      state.historyLoading = true; state.historyStatus = 'loading'; state.history = [];
      state.historyMore = false; state.historyQuality = null; render();
      try {
        const page = history(await api.history(state.sid));
        if (!current(epoch)) return;
        state.history = page.items; state.historyMore = page.hasMore === true; state.historyQuality = page.quality;
        state.historyStatus = historyStatus(page, state.history.length);
      } catch { if (current(epoch)) state.historyStatus = 'history-unavailable'; }
      if (current(epoch)) { state.historyLoading = false; render(); }
    };
    const loadTasks = async (epoch, notice = '') => {
      state.tasksReady = false; state.taskStatus = 'loading'; render();
      try {
        const page = await api.list(state.sid);
        if (current(epoch)) acceptTasks(state, page.tasks, notice);
      } catch (error) { if (current(epoch)) listFailure(ctx, error, notice); }
      if (current(epoch)) render();
    };
    const loadSessions = async (epoch, append = false) => {
      state.inventoryStatus = 'loading'; render();
      try {
        const page = inventory(await api.sessions(append ? state.sessionsCursor : undefined));
        if (!current(epoch)) return;
        state.sessions = append ? [...state.sessions, ...page.items] : page.items;
        state.sessionsMore = page.hasMore === true; state.sessionsCursor = page.cursor;
        state.inventoryStatus = state.sessions.length ? '' : 'sessions-empty';
      } catch { if (current(epoch)) state.inventoryStatus = 'sessions-unavailable'; }
      if (current(epoch)) render();
    };
    const readSession = async (epoch) => {
      if (needsLive(state)) await loadTasks(epoch);
      else { savedTasks(state); render(); }
      if (current(epoch)) await loadHistory(epoch);
    };
    return { loadTasks, loadHistory, loadSessions, readSession };
  };
  const operations = (ctx) => {
    const { state, api, current, render, reportFailure, loadTasks, loadSessions, readSession } = ctx;
    const selectSession = async (sid) => {
      if (state.busy || state.unknown) return;
      state.sid = sid; state.taskId = ''; state.tasks = []; state.history = []; state.formOpen = false;
      state.confirmation = null; state.busy = true; const epoch = ++state.epoch;
      await readSession(epoch);
      if (current(epoch)) { state.busy = false; render(); }
    };
    const reload = async () => {
      if (state.busy) return;
      state.busy = true; state.tasksReady = false; state.confirmation = null;
      state.globalStatus = 'loading'; const epoch = ++state.epoch; render();
      try {
        const result = await api.capabilities();
        if (!current(epoch)) return;
        capabilities(state, result);
        if (state.available) {
          await loadSessions(epoch);
          if (state.sid) await readSession(epoch);
        }
      } catch (error) {
        if (current(epoch)) { writePermissions(state, {}); state.globalStatus = failure(error); }
      } finally { if (current(epoch)) { state.busy = false; render(); } }
    };
    const mutate = async (operation, success) => {
      if (state.busy || state.unknown || state.readOnly) return;
      state.busy = true; state.writing = true; state.confirmation = null; state.taskStatus = 'loading'; render();
      try {
        const result = await operation();
        const notice = typeof success === 'function' ? success(result) : success;
        state.taskStatus = notice; state.formOpen = false;
        if (state.opened) await loadTasks(state.epoch, notice);
      } catch (error) { reportFailure(error); }
      finally { state.busy = false; state.writing = false; render(); }
    };
    return { selectSession, reload, mutate };
  };
  const actions = (ctx) => {
    const { state, api, render, mutate } = ctx;
    const submit = () => {
      const ui = ctx.ui;
      const input = { cron: ui.cron.value, prompt: ui.prompt.value, recurring: ui.recurring.checked };
      if (!state.tasksReady || !state.canCreate) return;
      void mutate(() => api.create(state.sid, input), 'created');
    };
    const canConfirm = (kind) => kind === 'remove' ? state.canRemove && state.tasksReady : state.canRestore;
    const confirm = (kind, id = state.sid) => {
      if (state.busy || state.unknown || !canConfirm(kind)) return;
      state.confirmation = { kind, id }; render(); ctx.ui.confirmCancel.focus();
    };
    const applyConfirm = () => {
      const confirmation = state.confirmation;
      if (!confirmation || !canConfirm(confirmation.kind)) return;
      if (confirmation.kind === 'remove') {
        void mutate(() => api.remove(state.sid, confirmation.id), (result) => result.removed.length ? 'removed' : 'absent');
      } else {
        void mutate(() => api.restore(state.sid, true), 'restored');
      }
    };
    const newTask = () => {
      if (!state.canCreate || !state.tasksReady || state.busy || state.unknown) return;
      state.formOpen = true; state.confirmation = null; render(); ctx.ui.cron.focus();
    };
    return { submit, confirm, applyConfirm, newTask };
  };
  const callbacks = (ctx) => ({
    close: ctx.close, reload: ctx.reload, session: (sid) => { void ctx.selectSession(sid); }, ...actions(ctx),
    task: (id) => { ctx.state.taskId = id; ctx.state.formOpen = false; ctx.render(); },
    cancelNew: () => { ctx.state.formOpen = false; ctx.render(); ctx.ui.create.focus(); },
    cancelConfirm: () => { ctx.state.confirmation = null; ctx.render(); ctx.ui.close.focus(); },
    sessionsMore: () => {
      if (ctx.state.busy || ctx.state.unknown) return;
      ctx.state.busy = true;
      void ctx.loadSessions(ctx.state.epoch, true).finally(() => { ctx.state.busy = false; ctx.render(); });
    },

  });
  const lifecycle = (ctx) => {
    const { state } = ctx;
    const close = () => {
      if (!state.opened) return;
      state.opened = false; state.epoch++; ctx.ui.root.hidden = true;
      if (!state.writing) state.busy = false;
      for (const [node, previous] of state.inert) if (node.isConnected) node.inert = previous;
      state.inert = []; document.documentElement.classList.remove('okw-cron-open');
      if (state.opener?.isConnected) state.opener.focus();
    };
    const open = (opener) => {
      ctx.ui ??= window.__okwCronBuildView(callbacks(ctx));
      if (state.opened) { ctx.ui.close.focus(); return; }
      state.opener = opener; state.opened = true; ctx.ui.root.hidden = false;
      state.inert = [...document.querySelectorAll('#app, .sheet-root')].map((node) => [node, node.inert]);
      for (const [node] of state.inert) node.inert = true;
      document.documentElement.classList.add('okw-cron-open');
      ctx.ui.localize(); ctx.render(); ctx.ui.close.focus(); void ctx.reload();
    };
    return { open, close };
  };
  window.__okwCronCreateController = (api) => {
    const state = { opened: false, busy: false, unknown: false, epoch: 0, sessions: [], tasks: [], history: [],
      taskSource: '', taskQuality: null, historyQuality: null,
      sid: '', taskId: '', globalStatus: '', inventoryStatus: '', taskStatus: 'choose', historyStatus: '',
      available: false, readOnly: false, canCreate: false, canRemove: false, canRestore: false,
      tasksReady: false, formOpen: false, confirmation: null, inert: [] };
    const ctx = { state, api, render: () => { ctx.ui?.render(state); },
      current: (epoch) => state.opened && state.epoch === epoch,
      reportFailure(error) {
        if (error?.code === 'read-only-version') readOnly(state);
        if (error?.outcomeUnknown) state.unknown = true;
        state.taskStatus = state.unknown ? 'unknown' : failure(error);
      } };
    Object.assign(ctx, loaders(ctx)); Object.assign(ctx, operations(ctx)); Object.assign(ctx, lifecycle(ctx));
    document.addEventListener('keydown', (event) => {
      if (!state.opened) return;
      const panel = { contains: (node) => ctx.ui.panel.contains(node),
        querySelectorAll: (selector) => [...ctx.ui.panel.querySelectorAll(selector)]
          .filter((node) => !node.closest('[hidden]')) };
      window.__okwNavigationSearchKey(event, { panel, close: ctx.close });
    }, true);
    window.__okwLocale?.observe(() => { if (ctx.ui) { ctx.ui.localize(); ctx.render(); } });
    return { open: ctx.open, close: ctx.close, reload: ctx.reload };
  };
  const key = Symbol.for('open-kimi-web.cron-ui');
  if (!window[key]) {
    window[key] = true;
    const api = window.__okwCronApi ?? window.__okwCronCreateApi();
    window.__okwCron = window.__okwCronCreateController(api);
    window.__okwNavigation?.register('cron', (event) => window.__okwCron.open(event.currentTarget));
  }
}
