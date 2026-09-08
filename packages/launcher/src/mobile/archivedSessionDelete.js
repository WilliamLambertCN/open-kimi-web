{
  const DELETE_PATH = '/__open-kimi-mobile/sessions:delete';
  const archivedSessions = new Map();
  const archivedRequestIds = new Map();
  const archivedRequestGenerations = new Map();
  const rowSessions = new WeakMap();
  const boundRows = new Set();
  const pendingIds = new Set();
  const deletedIds = new Set();
  let pageAuthorization = '';
  let pendingArchivedRequests = 0;

  const isChinese = () => {
    const language = document.documentElement.lang || navigator.language || '';
    return language.toLocaleLowerCase().startsWith('zh');
  };

  const copy = () => isChinese() ? {
    remove: '永久删除',
    removeShort: '删除',
    removing: '正在删除…',
    confirm: (title) => `永久删除会话「${title}」？\n\n此操作无法撤销，会删除该会话的消息、附件和历史记录。`,
    auth: '页面授权尚未就绪，请刷新后重试。',
    failed: '删除失败，请刷新后重试。',
  } : {
    remove: 'Delete permanently',
    removeShort: 'Delete',
    removing: 'Deleting…',
    confirm: (title) => `Permanently delete “${title}”?\n\nThis cannot be undone. Its messages, attachments, and history will be deleted.`,
    auth: 'Page authorization is not ready. Refresh and try again.',
    failed: 'Deletion failed. Refresh and try again.',
  };

  const requestUrl = (input) => new URL(input instanceof Request ? input.url : String(input), location.href);
  const requestMethod = (input, init) => String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();

  const requestHeaders = (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    return headers;
  };

  const rememberAuthorization = (input, init, url) => {
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return;
    const authorization = requestHeaders(input, init).get('authorization');
    if (authorization) pageAuthorization = authorization;
  };

  const formatMinute = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value ?? '');
    const two = (part) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
  };

  // Wire normalization deliberately rejects every malformed field independently.
  // eslint-disable-next-line complexity
  const rememberArchived = (body, requestKey) => {
    const items = body?.data?.items ?? body?.items;
    if (!Array.isArray(items)) return;
    const nextIds = new Set();
    for (const item of items) {
      const v2 = item?.meta && item?.workspace;
      const archived = v2 ? item.meta.archived : item?.archived;
      if (archived !== true || typeof item.id !== 'string') continue;
      nextIds.add(item.id);
      const title = v2 ? item.meta.title ?? item.meta.last_prompt : item.title;
      archivedSessions.set(item.id, {
        id: item.id,
        title: typeof title === 'string' && title !== '' ? title : item.id.slice(0, 12),
        cwd: v2
          ? (typeof item.workspace.cwd === 'string' ? item.workspace.cwd : '')
          : (typeof item?.metadata?.cwd === 'string' ? item.metadata.cwd : ''),
        time: formatMinute(v2
          ? item.meta.archived_at ?? item.meta.updated_at
          : item.archived_at ?? item.updated_at),
      });
    }
    archivedRequestIds.set(requestKey, nextIds);
  };

  const isArchivedListRequest = (url) => (
    url.pathname === '/api/v1/sessions' && url.searchParams.get('archived_only') === 'true'
  ) || (
    url.pathname === '/api/v2/sessions' && url.searchParams.get('meta.archived') === 'true'
  );

  const observeResponse = async (input, init, response, requestGeneration) => {
    try {
      const url = requestUrl(input);
      rememberAuthorization(input, init, url);
      if (
        url.origin !== location.origin ||
        !isArchivedListRequest(url) ||
        requestMethod(input, init) !== 'GET' ||
        !response.ok
      ) return;
      const requestKey = `${url.pathname}${url.search}`;
      const body = await response.clone().json();
      if (archivedRequestGenerations.get(requestKey) !== requestGeneration) return;
      rememberArchived(body, requestKey);
      queueMicrotask(enhance);
    } catch {
      // The official request and response stay untouched when enhancement data is unavailable.
    }
  };

  const nativeFetch = window.fetch;
  window.fetch = async function archivedSessionFetch(input, init) {
    let requestKey = null;
    let requestGeneration = null;
    try {
      const url = requestUrl(input);
      if (
        url.origin === location.origin &&
        isArchivedListRequest(url) &&
        requestMethod(input, init) === 'GET'
      ) requestKey = `${url.pathname}${url.search}`;
    } catch {
      // The original fetch handles malformed URLs.
    }
    if (requestKey !== null) {
      requestGeneration = (archivedRequestGenerations.get(requestKey) ?? 0) + 1;
      archivedRequestGenerations.set(requestKey, requestGeneration);
      archivedRequestIds.delete(requestKey);
      pendingArchivedRequests += 1;
      clearVisibleRowSessions();
    }
    let response;
    try {
      response = await nativeFetch.apply(this, arguments);
    } catch (error) {
      if (requestKey !== null) {
        pendingArchivedRequests -= 1;
        queueMicrotask(enhance);
      }
      throw error;
    }
    const observation = observeResponse(input, init, response, requestGeneration);
    if (requestKey !== null) {
      void observation.finally(() => {
        pendingArchivedRequests -= 1;
        queueMicrotask(enhance);
      });
    } else void observation;
    return response;
  };

  const rowTime = (row) => {
    const text = row.querySelector('.archive-time')?.textContent?.trim() ?? '';
    return text.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)?.[0] ?? '';
  };

  const rowKey = (cwd, title, time) => `${cwd}\u0000${title}\u0000${time}`;

  const availableByKey = () => {
    const grouped = new Map();
    for (const session of archivedSessions.values()) {
      if (deletedIds.has(session.id)) continue;
      const key = rowKey(session.cwd, session.title, session.time);
      const items = grouped.get(key) ?? [];
      items.push(session);
      grouped.set(key, items);
    }
    return grouped;
  };

  const availableByTitle = () => {
    const grouped = new Map();
    for (const session of archivedSessions.values()) {
      if (deletedIds.has(session.id)) continue;
      const items = grouped.get(session.title) ?? [];
      items.push(session);
      grouped.set(session.title, items);
    }
    return grouped;
  };

  const clearRowSession = (row) => {
    rowSessions.delete(row);
    boundRows.delete(row);
    row.querySelector('.okw-archive-actions')?.remove();
    const sidebarButton = row.querySelector('.okw-sidebar-archive-delete');
    const sidebarActions = sidebarButton?.parentElement;
    sidebarButton?.remove();
    sidebarActions?.classList.remove('okw-sidebar-archive-actions');
  };

  const clearVisibleRowSessions = () => {
    document.querySelectorAll('.archive-list .archive-row').forEach(clearRowSession);
    document.querySelectorAll('.sessions .se').forEach(clearRowSession);
  };

  const rememberedKey = (row) => {
    const session = rowSessions.get(row);
    return session && rowKey(session.cwd, session.title, session.time);
  };

  const collectArchiveRowsByKey = () => {
    const rowsByKey = new Map();
    document.querySelectorAll('.archive-list .archive-card').forEach((card) => {
      const cwd = card.querySelector('.archive-workspace .path')?.textContent?.trim() ?? '';
      card.querySelectorAll('.archive-row').forEach((row) => {
        const key = rowKey(cwd, row.querySelector('.archive-name')?.textContent?.trim() ?? '', rowTime(row));
        const remembered = rowSessions.get(row);
        if (remembered && deletedIds.has(remembered.id) && rememberedKey(row) === key) {
          removeRow(row);
          return;
        }
        const rows = rowsByKey.get(key) ?? [];
        rows.push(row);
        rowsByKey.set(key, rows);
      });
    });
    return rowsByKey;
  };

  const collectSidebarRowsByTitle = () => {
    const rowsByTitle = new Map();
    document.querySelectorAll('.sessions .se').forEach((row) => {
      if (!row.querySelector('.reopen-btn')) {
        clearRowSession(row);
        return;
      }
      const title = row.querySelector('.t')?.textContent?.trim() ?? '';
      const remembered = rowSessions.get(row);
      if (remembered && deletedIds.has(remembered.id) && remembered.title === title) {
        row.remove();
        return;
      }
      const rows = rowsByTitle.get(title) ?? [];
      rows.push(row);
      rowsByTitle.set(title, rows);
    });
    return rowsByTitle;
  };

  const activeArchivedIds = () => new Set([...archivedRequestIds.values()].flatMap((ids) => [...ids]));

  const pruneStaleSessions = (rowsByKey, activeIds) => {
    for (const [id, session] of archivedSessions) {
      const visible = rowsByKey.has(rowKey(session.cwd, session.title, session.time));
      if (!activeIds.has(id) && !visible) archivedSessions.delete(id);
    }
  };

  const uniqueActiveSession = (rows, sessions, activeIds) => {
    if (rows.length !== 1 || sessions.length !== 1) return null;
    return activeIds.has(sessions[0].id) ? sessions[0] : null;
  };

  const bindUniqueRows = (key, rows, sessions, activeIds, rememberedKeyForRow) => {
    const session = uniqueActiveSession(rows, sessions, activeIds);
    for (const row of rows) {
      const remembered = rowSessions.get(row);
      if (!session || remembered?.id !== session.id || rememberedKeyForRow(row) !== key) clearRowSession(row);
      if (session) {
        rowSessions.set(row, session);
        boundRows.add(row);
      }
    }
  };

  const matchRows = () => {
    const archiveRowsByKey = collectArchiveRowsByKey();
    const sidebarRowsByTitle = collectSidebarRowsByTitle();
    const activeIds = activeArchivedIds();
    pruneStaleSessions(archiveRowsByKey, activeIds);
    const sessionsByKey = availableByKey();
    for (const [key, rows] of archiveRowsByKey) {
      const sessions = sessionsByKey.get(key) ?? [];
      bindUniqueRows(key, rows, sessions, activeIds, rememberedKey);
    }
    const sessionsByTitle = availableByTitle();
    for (const [title, rows] of sidebarRowsByTitle) {
      const sessions = sessionsByTitle.get(title) ?? [];
      bindUniqueRows(title, rows, sessions, activeIds, (row) => rowSessions.get(row)?.title);
    }
  };

  const showError = (row, message) => {
    let error = row.querySelector('.okw-archive-delete-error');
    if (!error) {
      error = document.createElement('div');
      error.className = 'okw-archive-delete-error';
      error.setAttribute('role', 'alert');
      row.append(error);
    }
    error.textContent = message;
  };

  const removeRow = (row) => {
    const card = row.closest('.archive-card');
    row.remove();
    const rows = card?.querySelectorAll('.archive-row') ?? [];
    const count = card?.querySelector('.archive-workspace .count');
    if (count) count.textContent = isChinese() ? `${rows.length} 个会话` : `${rows.length} session${rows.length === 1 ? '' : 's'}`;
    if (card && rows.length === 0) card.remove();
  };

  const removeSessionRows = (sessionId) => {
    for (const row of [...boundRows]) {
      if (rowSessions.get(row)?.id !== sessionId) continue;
      clearRowSession(row);
      removeRow(row);
    }
  };

  // This keeps the destructive request and all of its UI rollback in one place.
  // eslint-disable-next-line complexity
  const deleteSession = async (row, session, removeButton, idleText) => {
    if (pendingIds.has(session.id)) return;
    const labels = copy();
    if (!window.confirm(labels.confirm(session.title))) return;
    if (!pageAuthorization) {
      showError(row, labels.auth);
      return;
    }

    pendingIds.add(session.id);
    removeButton.disabled = true;
    removeButton.textContent = labels.removing;
    row.classList.add('okw-archive-deleting');
    try {
      const response = await nativeFetch.call(window, DELETE_PATH, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          authorization: pageAuthorization,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ sessionId: session.id }),
      });
      let body = null;
      try {
        body = await response.json();
      } catch {
        // A readable fallback is shown below.
      }
      if (!response.ok || body?.deleted !== true) throw new Error(body?.error || labels.failed);
      deletedIds.add(session.id);
      archivedSessions.delete(session.id);
      removeSessionRows(session.id);
    } catch (error) {
      showError(row, error instanceof Error && error.message ? error.message : labels.failed);
      removeButton.disabled = false;
      removeButton.textContent = idleText;
      row.classList.remove('okw-archive-deleting');
    } finally {
      pendingIds.delete(session.id);
    }
  };

  const createDeleteButton = (row, session, className, text) => {
    const labels = copy();
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = className;
    const idleText = text ?? labels.remove;
    removeButton.textContent = idleText;
    removeButton.setAttribute('aria-label', labels.remove);
    removeButton.addEventListener('click', (event) => {
      event.stopPropagation();
      void deleteSession(row, session, removeButton, idleText);
    });
    return removeButton;
  };

  const enhanceArchiveRow = (row) => {
    const session = rowSessions.get(row);
    if (!session || deletedIds.has(session.id)) return;
    if (row.querySelector('.okw-archive-actions')) return;
    const actions = document.createElement('div');
    actions.className = 'okw-archive-actions';
    actions.addEventListener('click', (event) => event.stopPropagation());
    actions.append(createDeleteButton(row, session, 'okw-archive-delete'));
    row.append(actions);
  };

  const enhanceSidebarRow = (row) => {
    const session = rowSessions.get(row);
    if (!session || deletedIds.has(session.id)) return;
    if (row.querySelector('.okw-sidebar-archive-delete')) return;
    const reopenButton = row.querySelector('.reopen-btn');
    if (!reopenButton?.parentElement) return;
    reopenButton.parentElement.classList.add('okw-sidebar-archive-actions');
    reopenButton.parentElement.append(createDeleteButton(
      row,
      session,
      'okw-archive-delete okw-sidebar-archive-delete',
      copy().removeShort,
    ));
  };

  function enhance() {
    if (pendingArchivedRequests > 0) {
      clearVisibleRowSessions();
      return;
    }
    matchRows();
    document.querySelectorAll('.archive-list .archive-row').forEach(enhanceArchiveRow);
    document.querySelectorAll('.sessions .se').forEach(enhanceSidebarRow);
  }

  new MutationObserver(enhance).observe(document.documentElement, { childList: true, subtree: true });
  enhance();
}
