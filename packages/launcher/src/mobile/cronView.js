{
  const text = (zh, en) => window.__okwLocale?.text(zh, en) ?? en;
  const el = (tag, className = '', content) => {
    const node = document.createElement(tag); node.className = className;
    if (content !== undefined) node.textContent = String(content);
    return node;
  };
  const messages = {
    loading: ['正在加载…', 'Loading…'], empty: ['此会话没有定时任务。', 'This session has no scheduled tasks.'],
    choose: ['选择一个原会话以查看任务。', 'Select an existing session to view its tasks.'],
    'sessions-empty': ['没有可列出的会话。', 'No sessions were returned.'],
    'sessions-unavailable': ['原会话清单暂不可用，未将其视为无任务。', 'Session inventory is unavailable, not an empty task list.'],
    'history-unavailable': ['触发历史暂不可用；最近触发时间不代表执行成功。',
      'Trigger history is unavailable. Last fired time does not prove successful execution.'],
    'history-empty': ['没有已保存的触发记录。', 'No saved trigger records.'],
    'history-unconfirmed': ['读取证据不完整，无法确认是否存在触发记录。',
      'Reading evidence is incomplete; trigger records cannot be confirmed.'],
    unavailable: ['定时任务未启用。请在原数据的官方后端运行 kimi web --scheduled-tasks；网页不会自动重启服务。',
      'Scheduled tasks are not enabled. Run kimi web --scheduled-tasks with the original data and official backend. ' +
      'This page will not restart the server.'],
    'not-loaded': ['此会话的主代理尚未加载。恢复会话会重新启动原定时任务，须明确确认。',
      'The session main agent is not loaded. Restoring it restarts its existing scheduled tasks and requires confirmation.'],
    'load-unknown': ['会话加载状态无法确认。恢复会话会重新启动原定时任务，须明确确认。',
      'The session load state is unknown. Restoring it restarts its existing scheduled tasks and requires confirmation.'],
    unknown: ['写入结果未知。不要重试；先重新读取任务确认结果。',
      'The write outcome is unknown. Do not retry. Reload tasks first to check the result.'],
    created: ['任务已创建。', 'Task created.'], removed: ['任务已删除。', 'Task removed.'],
    absent: ['该精确 ID 已不存在。', 'That exact ID is already absent.'], restored: ['会话已恢复，任务已重新读取。',
      'Session restored; tasks reloaded.'],
    auth: ['页面授权不可用或已失效，请刷新页面。', 'Page authorization is unavailable or expired. Refresh the page.'],
    busy: ['服务忙，请稍后手动重试。', 'The server is busy. Retry manually later.'],
    'reload-failed': ['写入已确认，但任务回读失败。请重新读取，勿重复写入。',
      'The write was confirmed, but task reload failed. Reload tasks; do not repeat the write.'],
    'unsupported-version': ['当前官方版本不支持此受限接口。', 'This official version is not supported by this restricted API.'],
    'read-only-version': ['当前官方版本没有经验证可同时保证会话归属与新鲜度的原子任务写入接口，仅支持只读；未写入。' +
      '此面板不新建或删除任务、不恢复会话，不会自动启动任务。',
    'This official version has no verified atomic task write API for session ownership and freshness. Read-only access only; ' +
      'no write was sent. This panel cannot create or remove tasks, or restore sessions; it will not start tasks automatically.'],
    'cold-read-only': ['当前仅显示保存记录，未恢复会话或启动任务。可自行打开原会话，按官方原生方式进入。',
      'Showing saved records only; no session was restored or tasks started. You may open the original session natively.'],
    required: ['请填写 cron 和提示词。', 'Enter a cron expression and prompt.'],
    'prompt-limit': ['提示词超过 8 KiB（8192 字节）限制。', 'The prompt exceeds the 8 KiB (8192-byte) limit.'],
    error: ['请求失败，未报告成功。请检查连接或重新读取。', 'The request failed. No success is claimed. Check or reload.'],
  };
  const message = (code) => text(...(messages[code] ?? messages.error));
  const status = (node, code) => {
    node.textContent = code ? message(code) : '';
    node.dataset.state = code ?? ''; node.dataset.error = String(['error', 'unknown', 'auth', 'busy'].includes(code));
  };
  const timestamp = (value) => {
    if (value === undefined || value === null) return text('未知', 'Unknown');
    const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString() : String(value);
  };
  const qualityText = (quality) => {
    if (quality?.complete === true) return '';
    const reasons = quality?.reasons ?? [];
    const detail = reasons.map((reason) => {
      if (/limit|oversized/.test(reason)) return text('达到有界读取限额', 'Bounded read limit reached');
      if (/missing|not-found|unreadable/.test(reason)) return text('记录缺失或不可读，无法确认', 'Records missing or unreadable; unconfirmed');
      if (/changed|truncated/.test(reason)) return text('记录变化或不完整', 'Records changed or incomplete');
      return text('部分证据无法确认', 'Some evidence could not be confirmed');
    });
    return text('读取不完整；不能据此确认没有任务或记录。', 'Incomplete read; absence of tasks or records is not confirmed.') +
      (detail.length ? ' ' + [...new Set(detail)].join(text('；', '; ')) : '');
  };
  const workspaceText = (workspace) => {
    if (typeof workspace === 'string') return workspace;
    return workspace?.name || workspace?.id || text('工作空间未知', 'Unknown workspace');
  };
  const sessionState = (session) => {
    if (session.loaded === true) return text('会话已加载（主代理仍可能未就绪）', 'Session loaded (main agent may still be unavailable)');
    return session.loaded === false ? text('未加载 · 保存记录', 'Not loaded · saved records') :
      text('加载状态未知 · 保存记录', 'Load state unknown · saved records');
  };
  const taskCount = (session) => {
    const count = session.tasks?.length ?? 0;
    return session.quality?.complete === true ? text(`保存任务 ${count}`, `${count} saved tasks`) :
      text(`已知保存任务 ${count}，总数无法确认`, `${count} known saved tasks; total unconfirmed`);
  };
  const modelText = (session) => {
    const labels = { live: ['当前会话模型', 'Live session model'], saved: ['保存的会话模型', 'Saved session model'],
      unknown: ['会话模型未知', 'Session model unknown'] };
    const label = text(...(labels[session?.modelSource] ?? labels.unknown));
    return session?.model ? `${label}: ${session.model}` : label;
  };
  const field = (list, label, value) => { list.append(el('dt', '', label), el('dd', '', value)); };
  const renderTask = (ui, state, callbacks) => {
    ui.tasks.replaceChildren(); ui.details.replaceChildren();
    for (const task of state.tasks) {
      const button = el('button', 'okw-cron-task'); button.type = 'button'; button.dataset.taskId = task.id;
      button.setAttribute('aria-pressed', String(state.taskId === task.id));
      button.append(el('strong', '', task.cron), el('span', '', task.prompt), el('small', '', task.id));
      button.addEventListener('click', () => callbacks.task(task.id)); ui.tasks.append(button);
    }
    const task = state.tasks.find((item) => item.id === state.taskId);
    if (!task) return;
    const list = el('dl', 'okw-cron-fields');
    field(list, 'ID', task.id); field(list, 'Cron', task.cron);
    field(list, text('提示词', 'Prompt'), task.prompt);
    const recurring = typeof task.recurring === 'boolean' ? text(task.recurring ? '是' : '否', task.recurring ? 'Yes' : 'No') :
      text('原生未提供', 'Not provided by native runtime');
    field(list, text('重复', 'Recurring'), recurring);
    field(list, text('创建时间', 'Created'), timestamp(task.createdAt));
    field(list, text('最近触发（不代表运行结果）', 'Last fired (not an execution result)'), timestamp(task.lastFiredAt));
    const remove = el('button', '', text('删除此任务', 'Remove this task')); remove.type = 'button';
    remove.dataset.cronAction = 'remove';
    remove.disabled = !state.canRemove || !state.tasksReady || state.busy || state.unknown;
    remove.addEventListener('click', () => callbacks.confirm('remove', task.id)); ui.details.append(list, remove);
  };
  const renderSessions = (ui, state, callbacks) => {
    ui.sessions.replaceChildren();
    for (const session of state.sessions) {
      const button = el('button', 'okw-cron-session'); button.type = 'button'; button.dataset.sessionId = session.id;
      button.setAttribute('aria-pressed', String(session.id === state.sid)); button.disabled = state.busy || state.unknown;
      button.append(el('strong', '', session.title || session.id), el('small', '', workspaceText(session.workspace)),
        el('small', '', taskCount(session)), el('small', '', sessionState(session)), el('small', '', modelText(session)));
      if (session.archived) button.append(el('small', '', text('已归档', 'Archived')));
      if (session.quality?.complete !== true) button.append(el('small', 'okw-cron-quality', qualityText(session.quality)));
      button.addEventListener('click', () => callbacks.session(session.id)); ui.sessions.append(button);
    }
    status(ui.inventoryStatus, state.inventoryStatus);
    ui.sessionsMore.hidden = !state.sessionsMore; ui.sessionsMore.disabled = state.busy || state.unknown;
  };
  const recordKind = (kind) => {
    const labels = { started: ['原生回合已开始', 'Native turn started'], steered: ['已插入当前回合', 'Steered into current turn'],
      submitted: ['已提交（未确认关联回合）', 'Submitted (turn association unconfirmed)'] };
    return text(...(labels[kind] ?? ['记录类型未知', 'Unknown record kind']));
  };
  const endText = (record) => {
    const labels = { completed: ['原生回合完成（不代表业务成功）', 'Native turn completed (not business success)'],
      cancelled: ['原生回合已取消', 'Native turn cancelled'], failed: ['原生回合失败', 'Native turn failed'],
      blocked: ['原生回合被阻止', 'Native turn blocked'] };
    if (record.endedAt === undefined || record.endedAt === null) {
      return text('结束状态未知；不能据此判断仍在运行。', 'End state unknown; this does not prove it is running.');
    }
    const label = text(...(labels[record.endReason] ?? ['原生结束原因未知', 'Native end reason unknown']));
    return `${label} · ${timestamp(record.endedAt)}`;
  };
  const renderRecord = (record) => {
    const item = el('li', '', `${timestamp(record.time)} · ${record.taskId} · ${recordKind(record.kind)}`);
    if (record.kind !== 'submitted' && record.turnId !== undefined) {
      item.append(el('small', '', `${text('原生回合', 'Native turn')}: ${record.turnId}`));
    }
    item.append(el('small', '', endText(record)));
    if (Number.isFinite(record.durationMs) && record.durationMs >= 0) {
      item.append(el('small', '', text(`原生回合耗时：${record.durationMs} 毫秒`, `Native turn duration: ${record.durationMs} ms`)));
    }
    if (record.inherited) item.append(el('small', '', text('继承的历史记录', 'Inherited history record')));
    for (const model of record.models ?? []) {
      const alias = model.alias ? ` · ${text('别名', 'Alias')}: ${model.alias}` : '';
      item.append(el('small', '', `${text('实际请求模型', 'Actual request model')}: ${model.model}${alias} · ` +
        `${text('供应商', 'Provider')}: ${model.provider} · ${timestamp(model.time)}`));
    }
    return item;
  };
  const renderHistory = (ui, state) => {
    ui.history.replaceChildren(); status(ui.historyStatus, state.historyStatus);
    for (const record of state.history) ui.history.append(renderRecord(record));
    ui.historyQuality.textContent = state.sid ? qualityText(state.historyQuality) : '';
    ui.historyLimit.hidden = !state.historyMore;
    ui.historyLimit.textContent = text('仅显示最近最多 100 条记录，较早记录已截断。此接口不支持翻页。',
      'Only the latest 100 records are shown; earlier records are truncated. This API does not support pagination.');
  };
  const renderConfirmation = (ui, state) => {
    ui.confirmation.hidden = !state.confirmation;
    ui.confirmation.setAttribute('aria-label', text('确认操作', 'Confirm action'));
    ui.confirmCancel.disabled = state.busy; ui.confirmApply.disabled = state.busy;
    if (!state.confirmation) return;
    ui.confirmationText.textContent = state.confirmation.kind === 'remove' ?
      text('确定永久删除以下精确 ID 的任务？', 'Permanently remove the task with this exact ID?') :
      text('恢复会话会重新启动原定时任务。是否恢复并管理？',
        'Restoring the session restarts its existing scheduled tasks. Restore and manage?');
    ui.confirmationId.textContent = state.confirmation.id;
  };
  const renderSessionHeading = (ui, state) => {
    const session = state.sessions.find((item) => item.id === state.sid);
    ui.sessionTitle.textContent = session?.title || state.sid || text('原会话任务', 'Existing session tasks');
    ui.sessionId.textContent = state.sid;
    ui.link.hidden = !state.sid; ui.link.href = `/sessions/${encodeURIComponent(state.sid)}`;
    ui.model.textContent = text('任务跟随所属会话的模型，不提供独立任务模型。',
      'Tasks follow their owning session model; there is no independent task model.') + ' ' + modelText(session);
    ui.taskQuality.textContent = state.sid ? qualityText(state.taskQuality) : '';
    const source = { saved: ['保存的只读任务投影；不代表当前引擎状态。',
      'Saved read-only task projection; not the current engine state.'],
    live: ['当前后端主代理内存中的只读快照；不保证与其它进程或磁盘实时一致。',
      'Read-only snapshot of this backend main-agent memory; not guaranteed current across processes or on disk.'] };
    ui.taskSource.textContent = state.taskSource ? text(...source[state.taskSource]) : '';
    if (session) ui.taskSource.textContent += ' ' + text('目录快照：', 'Directory snapshot: ') + sessionState(session);
  };
  window.__okwCronBuildView = (callbacks) => {
    const copies = [];
    const copy = (tag, zh, en, className = '') => {
      const node = el(tag, className, text(zh, en)); copies.push({ node, zh, en }); return node;
    };
    const button = (action, zh, en, handler) => {
      const node = copy('button', zh, en); node.type = 'button'; node.dataset.cronAction = action;
      node.addEventListener('click', handler); return node;
    };
    const root = el('div', 'okw-cron-backdrop'); root.hidden = true;
    const panel = el('section', 'okw-cron-panel'); panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'okw-cron-title');
    const heading = copy('h2', '定时任务', 'Scheduled tasks'); heading.id = 'okw-cron-title';
    const close = button('close', '关闭', 'Close', callbacks.close);
    const reload = button('reload', '重新读取', 'Reload', callbacks.reload);
    const header = el('header'); header.append(heading, reload, close);
    const globalStatus = el('p', 'okw-cron-status'); globalStatus.setAttribute('role', 'status');
    const columns = el('div', 'okw-cron-columns');
    const inventory = el('nav', 'okw-cron-inventory');
    const inventoryStatus = el('p', 'okw-cron-status'); const sessions = el('div', 'okw-cron-sessions');
    const sessionsMore = button('sessions-more', '更多会话', 'More sessions', callbacks.sessionsMore);
    inventory.append(copy('h3', '原会话', 'Existing sessions'), inventoryStatus, sessions, sessionsMore);
    const main = el('div', 'okw-cron-main'); const sessionTitle = el('h3'); const sessionId = el('p', 'okw-cron-id');
    const link = copy('a', '打开原会话', 'Open original session'); link.dataset.cronAction = 'open-session';
    link.addEventListener('click', callbacks.close);
    const model = el('p', 'okw-cron-hint'); const taskStatus = el('p', 'okw-cron-status');
    taskStatus.setAttribute('role', 'status');
    const restore = button('restore', '恢复并管理', 'Restore and manage', () => callbacks.confirm('restore'));
    const create = button('new', '新建任务', 'New task', callbacks.newTask);
    const tasks = el('div', 'okw-cron-tasks'); const details = el('div', 'okw-cron-details');
    const taskColumns = el('div', 'okw-cron-task-columns'); taskColumns.append(tasks, details);
    const formUi = buildForm(copy, button, callbacks);
    const confirmUi = buildConfirmation(button, callbacks);
    const history = el('ol', 'okw-cron-history'); const historyStatus = el('p', 'okw-cron-status');
    const taskQuality = el('p', 'okw-cron-quality okw-cron-task-quality');
    const taskSource = el('p', 'okw-cron-hint okw-cron-task-source');
    const historyQuality = el('p', 'okw-cron-quality okw-cron-history-quality');
    const historyLimit = el('p', 'okw-cron-hint okw-cron-history-limit');
    main.append(sessionTitle, sessionId, link, model, taskSource, taskQuality, taskStatus, restore, create,
      taskColumns, formUi.form,
      confirmUi.confirmation, copy('h3', '已保存的触发记录', 'Saved trigger records'), historyStatus, historyQuality,
      history, historyLimit);
    columns.append(inventory, main); panel.append(header, globalStatus, columns); root.append(panel); document.body.append(root);
    root.addEventListener('click', (event) => { if (event.target === root) callbacks.close(); });
    const ui = { root, panel, close, reload, globalStatus, inventoryStatus, sessions, sessionsMore, sessionTitle, sessionId,
      link, model, taskStatus, taskQuality, taskSource, restore, create, tasks, details, history, historyStatus,
      historyQuality, historyLimit, ...formUi, ...confirmUi };
    ui.localize = () => { for (const { node, zh, en } of copies) node.textContent = text(zh, en); };
    ui.render = (state) => render(ui, state, callbacks);
    ui.bytes = () => { ui.byteCount.textContent = `${new TextEncoder().encode(ui.prompt.value).length} / 8192 ` +
      text('字节（8 KiB）', 'bytes (8 KiB)'); };
    ui.prompt.addEventListener('input', ui.bytes); ui.bytes(); return ui;
  };
  function buildForm(copy, button, callbacks) {
    const form = el('form', 'okw-cron-form'); form.hidden = true;
    const cron = el('input'); cron.name = 'cron'; cron.autocomplete = 'off'; cron.required = true;
    const cronLabel = el('label');
    cronLabel.append(copy('span', 'Cron 表达式（运行端本地时间）', 'Cron expression (server local time)'), cron);
    const prompt = el('textarea'); prompt.name = 'prompt'; prompt.rows = 5; prompt.required = true;
    const promptLabel = el('label'); promptLabel.append(copy('span', '提示词', 'Prompt'), prompt);
    const byteCount = el('p', 'okw-cron-hint');
    const recurring = el('input'); recurring.type = 'checkbox'; recurring.name = 'recurring';
    const recurringLabel = el('label', 'okw-cron-checkbox');
    recurringLabel.append(recurring, copy('span', '重复运行', 'Recurring'));
    const save = button('save', '创建任务', 'Create task', () => {}); save.type = 'submit';
    const cancel = button('cancel-new', '取消', 'Cancel', callbacks.cancelNew);
    form.append(copy('h4', '新建任务', 'New task'), cronLabel, promptLabel, byteCount, recurringLabel, save, cancel);
    form.addEventListener('submit', (event) => { event.preventDefault(); callbacks.submit(); });
    return { form, cron, prompt, recurring, byteCount, save, cancel };
  }
  function buildConfirmation(button, callbacks) {
    const confirmation = el('section', 'okw-cron-confirmation'); confirmation.hidden = true;
    confirmation.setAttribute('role', 'group'); confirmation.setAttribute('aria-label', text('确认操作', 'Confirm action'));
    const confirmationText = el('p'); const confirmationId = el('code', 'okw-cron-id');
    const confirmCancel = button('cancel-confirm', '取消', 'Cancel', callbacks.cancelConfirm);
    const confirmApply = button('confirm', '确认', 'Confirm', callbacks.applyConfirm);
    confirmation.append(confirmationText, confirmationId, confirmCancel, confirmApply);
    return { confirmation, confirmationText, confirmationId, confirmCancel, confirmApply };
  }
  function render(ui, state, callbacks) {
    status(ui.globalStatus, state.globalStatus); status(ui.taskStatus, state.taskStatus);
    renderSessions(ui, state, callbacks); renderSessionHeading(ui, state); renderTask(ui, state, callbacks);
    renderHistory(ui, state); renderConfirmation(ui, state);
    ui.root.dataset.state = state.globalStatus || state.taskStatus || 'ready';
    renderControls(ui, state);
  }
  function renderRestore(ui, state) {
    ui.restore.hidden = !state.canRestore || !['not-loaded', 'load-unknown'].includes(state.taskStatus);
    ui.restore.disabled = !state.canRestore || state.busy || state.unknown;
  }
  function renderControls(ui, state) {
    ui.reload.disabled = state.busy;
    renderRestore(ui, state);
    ui.create.hidden = !state.sid || !state.canCreate || !state.tasksReady;
    ui.create.disabled = !state.canCreate || state.busy || state.unknown;
    ui.form.hidden = !state.formOpen || !state.canCreate;
    ui.save.disabled = state.busy || state.unknown || !state.tasksReady || !state.canCreate;
    ui.cancel.disabled = state.busy; ui.cron.disabled = state.busy; ui.prompt.disabled = state.busy;
    ui.recurring.disabled = state.busy; ui.bytes();
  }
}
