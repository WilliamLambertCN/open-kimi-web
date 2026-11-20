{
  const OFFICIAL_LOCALE_KEY = 'kimi-locale';
  const archivedSessions = new Map();
  const archivedRequestIds = new Map();
  const archivedRequestGenerations = new Map();
  let archivedListing = null;
  const rowSessions = new WeakMap();
  const boundRows = new Set();
  const pendingIds = new Set();
  const deletedIds = new Set();
  let pageAuthorization = '';
  let pendingArchivedRequests = 0;

  const currentLocale = () => {
    let persisted = null;
    try {
      persisted = window.localStorage?.getItem(OFFICIAL_LOCALE_KEY) ?? null;
    } catch {
      // Match the official locale fallback when browser storage is unavailable.
    }
    if (persisted === 'en' || persisted === 'zh') return persisted;
    return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  };

  const isChinese = () => currentLocale() === 'zh';
  const deletePath = (sessionId) => `/api/v1/sessions/${encodeURIComponent(sessionId)}:delete`;
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
    confirm: (title) => (
      `Permanently delete “${title}”?\n\n` +
      'This cannot be undone. Its messages, attachments, and history will be deleted.'
    ),
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
    const two = (part) => String(part).padStart(2, '0');
    const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
    return `${day} ${two(date.getHours())}:${two(date.getMinutes())}`;
  };

  const archivedWire = (item) => item?.meta && item?.workspace
    ? { ...item.meta, id: item.id, metadata: { cwd: item.workspace.cwd } } : item;
  const validArchived = (item) => item?.archived === true && typeof item.id === 'string' && /^[\w-]{1,256}$/.test(item.id);
  const archivedTitle = (item) => {
    const title = item.title ?? item.last_prompt;
    return typeof title === 'string' && title ? title : item.id.slice(0, 12);
  };
  const projectArchived = (item) => {
    if (!validArchived(item) || item.host_id) return null;
    const cwd = item.cwd ?? item.metadata?.cwd;
    const time = item.archived_at ?? item.updated_at;
    if (typeof cwd !== 'string' || !cwd || !time || !Number.isFinite(new Date(time).getTime())) return null;
    return { id: item.id, title: archivedTitle(item), cwd, time: formatMinute(time) };
  };
  const completeGroups = (groups) => !groups || groups.every((group) => !group.host_id && group.total === group.sessions?.length);
  const completePage = (data, groups, items, sessions) => sessions.length === items.length &&
    completeGroups(groups) && !data.unavailable_hosts?.length;
  const singleLegacyPage = (data, groups, requestKey) => archivedListing.legacy && !groups &&
    data.total === undefined && data.has_more === false && requestKey === archivedListing.firstRequest;
  const rememberArchived = (body, requestKey) => {
    if (!body || (body.code !== undefined && body.code !== 0)) return;
    const data = body.data ?? body;
    if (typeof data.has_more === 'boolean') archivedListing.paginated = true;
    const groups = Array.isArray(data.groups) ? data.groups : null;
    const items = groups ? groups.flatMap((group) => group.sessions ?? []) : data.items;
    if (!Array.isArray(items)) return;
    const sessions = items.map(archivedWire).map(projectArchived).filter(Boolean);
    sessions.forEach((session) => archivedSessions.set(session.id, session));
    archivedRequestIds.set(requestKey, {
      ids: new Set(sessions.map((session) => session.id)),
      keys: new Set(groups ? groups.map((group) => group.workspace_id ?? group.workspace?.id) : items.map((item) => item.id)),
      full: completePage(data, groups, items, sessions),
      total: data.total, more: data.has_more, singlePage: singleLegacyPage(data, groups, requestKey),
    });
  };
  const isArchivedListRequest = (url) => {
    if (url.searchParams.get('fields')) return false;
    if (url.pathname === '/api/v1/sessions') {
      return url.searchParams.get('archived_only') === 'true' || url.searchParams.get('archived') === 'true';
    }
    return url.pathname === '/api/v2/sessions' && url.searchParams.get('meta.archived') === 'true';
  };
  const beginListing = (url) => {
    const query = new URL(url);
    const cursors = ['page_token', 'page', 'before_id', 'after_id', 'cursor'];
    const continuation = cursors.some((key) => url.searchParams.has(key) &&
      (key !== 'page' || Number(url.searchParams.get(key)) > 1));
    cursors.forEach((key) => query.searchParams.delete(key));
    query.searchParams.sort();
    if (archivedListing?.query !== query.href || !continuation) {
      archivedRequestIds.clear();
      const filters = ['workspace_id', 'has_prompt', 'exclude_empty', 'busy', 'activity', 'updated_after', 'updated_before',
        'workspace.id', 'meta.has_prompt', 'activity.status', 'meta.updated_after', 'meta.updated_before'];
      const unfiltered = !filters.some((key) => url.searchParams.has(key));
      archivedListing = { query: query.href, paginated: url.searchParams.get('archived') === 'true',
        legacy: url.pathname === '/api/v1/sessions' && url.searchParams.get('archived_only') === 'true',
        start: !continuation && unfiltered, firstRequest: `${url.pathname}${url.search}` };
    }
    return archivedListing;
  };

  const sameOriginResponse = (response) => !response.redirected &&
    (!response.url || new URL(response.url).origin === location.origin);
  const observeResponse = async (input, init, response, request) => {
    try {
      const url = requestUrl(input);
      rememberAuthorization(input, init, url);
      if (
        url.origin !== location.origin ||
        !isArchivedListRequest(url) ||
        requestMethod(input, init) !== 'GET' || !response.ok || !sameOriginResponse(response)
      ) return;
      const requestKey = `${url.pathname}${url.search}`;
      const body = await response.clone().json();
      if (request?.listing !== archivedListing || archivedRequestGenerations.get(requestKey) !== request.generation) return;
      rememberArchived(body, requestKey);
      queueMicrotask(enhance);
    } catch {
      // The official request and response stay untouched when enhancement data is unavailable.
    }
  };

  const nativeFetch = window.fetch;
  window.fetch = async function archivedSessionFetch(input, init) {
    let requestKey = null;
    let request = null;
    try {
      const url = requestUrl(input);
      if (
        url.origin === location.origin &&
        isArchivedListRequest(url) &&
        requestMethod(input, init) === 'GET'
      ) {
        requestKey = `${url.pathname}${url.search}`;
        request = { listing: beginListing(url) };
      }
    } catch {
      // The original fetch handles malformed URLs.
    }
    if (requestKey !== null) {
      request.generation = (archivedRequestGenerations.get(requestKey) ?? 0) + 1;
      archivedRequestGenerations.set(requestKey, request.generation);
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
    const observation = observeResponse(input, init, response, request);
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
        if (row.querySelector('button.ui-button--danger')) return clearRowSession(row);
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

  const activeArchivedIds = () => {
    const pages = [...archivedRequestIds.values()];
    if (archivedListing?.paginated) {
      const keys = new Set(pages.flatMap((page) => [...page.keys]));
      const singlePage = pages.length === 1 && pages[0].singlePage;
      const complete = archivedListing.start && pages.length > 0 && pages.some((page) => page.more === false) &&
        pages.every((page) => page.full && (singlePage || page.total === keys.size));
      if (!complete) return new Set();
    }
    return new Set(pages.flatMap((page) => [...page.ids]));
  };

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
    pruneStaleSessions(archiveRowsByKey, new Set([...archivedRequestIds.values()].flatMap((page) => [...page.ids])));
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

  const responseError = (response, body, labels) => {
    if (response.status === 204 || (response.ok && body?.code === 0)) return null;
    if (response.status === 401 || response.status === 403) return labels.auth;
    const message = typeof body?.msg === 'string' ? body.msg.trim() : '';
    return message || labels.failed;
  };

  const idleButtonText = (button, labels) => (
    button.className.includes('okw-sidebar-archive-delete') ? labels.removeShort : labels.remove
  );

  const canDelete = (row, id) => {
    if (pendingArchivedRequests > 0 || row.isConnected === false) return false;
    matchRows();
    return !pendingIds.has(id) && activeArchivedIds().has(id) && rowSessions.get(row)?.id === id;
  };
  const deleteSession = async (row, session, removeButton) => {
    if (!canDelete(row, session.id)) return;
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
      const response = await nativeFetch.call(window, deletePath(session.id), {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          authorization: pageAuthorization,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      let body = null;
      try {
        body = await response.json();
      } catch {
        // A readable fallback is shown below.
      }
      const message = responseError(response, body, labels);
      if (message) throw new Error(message);
      deletedIds.add(session.id);
      archivedSessions.delete(session.id);
      removeSessionRows(session.id);
      window.location.reload();
    } catch (error) {
      showError(row, error instanceof Error && error.message ? error.message : labels.failed);
      removeButton.disabled = false;
      removeButton.textContent = idleButtonText(removeButton, copy());
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
    removeButton.textContent = text ?? labels.remove;
    removeButton.setAttribute('aria-label', labels.remove);
    removeButton.addEventListener('click', (event) => {
      event.stopPropagation();
      void deleteSession(row, session, removeButton);
    });
    return removeButton;
  };

  const enhanceArchiveRow = (row) => {
    const session = rowSessions.get(row);
    if (!session || deletedIds.has(session.id)) return;
    const existing = row.querySelector('.okw-archive-delete');
    if (existing) {
      const label = copy().remove;
      if (!existing.disabled && existing.textContent !== label) existing.textContent = label;
      if (existing.getAttribute('aria-label') !== label) existing.setAttribute('aria-label', label);
      return;
    }
    const actions = document.createElement('div');
    actions.className = 'okw-archive-actions';
    actions.addEventListener('click', (event) => event.stopPropagation());
    actions.append(createDeleteButton(row, session, 'okw-archive-delete'));
    row.append(actions);
  };

  const enhanceSidebarRow = (row) => {
    const session = rowSessions.get(row);
    if (!session || deletedIds.has(session.id)) return;
    const existing = row.querySelector('.okw-sidebar-archive-delete');
    if (existing) {
      const labels = copy();
      if (!existing.disabled && existing.textContent !== labels.removeShort) existing.textContent = labels.removeShort;
      if (existing.getAttribute('aria-label') !== labels.remove) existing.setAttribute('aria-label', labels.remove);
      return;
    }
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

  let renderedLocale = currentLocale();
  function enhance() {
    if (pendingArchivedRequests > 0) {
      clearVisibleRowSessions();
      renderedLocale = currentLocale();
      return;
    }
    matchRows();
    document.querySelectorAll('.archive-list .archive-row').forEach(enhanceArchiveRow);
    document.querySelectorAll('.sessions .se').forEach(enhanceSidebarRow);
    renderedLocale = currentLocale();
  }

  const archiveChanged = (records) => records.some(({ target, addedNodes, removedNodes }) => (
    target.closest?.('.archive-list, .sessions') ||
    [...addedNodes, ...removedNodes].some((node) => node.nodeType === 1 && (
      node.matches('.archive-list, .sessions') || node.querySelector('.archive-list, .sessions')
    ))
  ));
  new MutationObserver((records) => {
    if (renderedLocale !== currentLocale() || archiveChanged(records)) enhance();
  }).observe(document.documentElement, { childList: true, subtree: true });
  enhance();
}
