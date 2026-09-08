{
  const DELETE_PATH = '/__open-kimi-mobile/sessions:delete';
  const archivedSessions = new Map();
  const rowSessions = new WeakMap();
  const pendingIds = new Set();
  const deletedIds = new Set();
  let pageAuthorization = '';
  let openMenu = null;

  const isChinese = () => {
    const language = document.documentElement.lang || navigator.language || '';
    return language.toLocaleLowerCase().startsWith('zh');
  };

  const copy = () => isChinese() ? {
    more: '更多操作',
    remove: '永久删除',
    removing: '正在删除…',
    confirm: (title) => `永久删除会话「${title}」？\n\n此操作无法撤销，会删除该会话的消息、附件和历史记录。`,
    auth: '页面授权尚未就绪，请刷新后重试。',
    failed: '删除失败，请刷新后重试。',
  } : {
    more: 'More actions',
    remove: 'Delete permanently',
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
  const rememberArchived = (body) => {
    const items = body?.data?.items ?? body?.items;
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const v2 = item?.meta && item?.workspace;
      const archived = v2 ? item.meta.archived : item?.archived;
      if (archived !== true || typeof item.id !== 'string') continue;
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
  };

  const isArchivedListRequest = (url) => (
    url.pathname === '/api/v1/sessions' && url.searchParams.get('archived_only') === 'true'
  ) || (
    url.pathname === '/api/v2/sessions' && url.searchParams.get('meta.archived') === 'true'
  );

  const observeResponse = async (input, init, response) => {
    try {
      const url = requestUrl(input);
      rememberAuthorization(input, init, url);
      if (
        url.origin !== location.origin ||
        !isArchivedListRequest(url) ||
        requestMethod(input, init) !== 'GET' ||
        !response.ok
      ) return;
      rememberArchived(await response.clone().json());
      queueMicrotask(enhance);
    } catch {
      // The official request and response stay untouched when enhancement data is unavailable.
    }
  };

  const nativeFetch = window.fetch;
  window.fetch = async function archivedSessionFetch(input, init) {
    const response = await nativeFetch.apply(this, arguments);
    void observeResponse(input, init, response);
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

  const matchRows = () => {
    const grouped = availableByKey();
    document.querySelectorAll('.archive-list .archive-card').forEach((card) => {
      const cwd = card.querySelector('.archive-workspace .path')?.textContent?.trim() ?? '';
      card.querySelectorAll('.archive-row').forEach((row) => {
        const remembered = rowSessions.get(row);
        if (remembered && deletedIds.has(remembered.id)) {
          removeRow(row);
          return;
        }
        if (remembered && !deletedIds.has(remembered.id)) return;
        const title = row.querySelector('.archive-name')?.textContent?.trim() ?? '';
        const candidates = grouped.get(rowKey(cwd, title, rowTime(row))) ?? [];
        const session = candidates.shift();
        if (session) rowSessions.set(row, session);
      });
    });
  };

  const closeMenu = ({ restoreFocus = false } = {}) => {
    if (!openMenu) return;
    const { trigger, menu } = openMenu;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
    openMenu = null;
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

  // This keeps the destructive request and all of its UI rollback in one place.
  // eslint-disable-next-line complexity
  const deleteSession = async (row, session, trigger, removeButton) => {
    if (pendingIds.has(session.id)) return;
    const labels = copy();
    if (!window.confirm(labels.confirm(session.title))) return;
    if (!pageAuthorization) {
      showError(row, labels.auth);
      return;
    }

    pendingIds.add(session.id);
    trigger.disabled = true;
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
      closeMenu();
      removeRow(row);
    } catch (error) {
      showError(row, error instanceof Error && error.message ? error.message : labels.failed);
      trigger.disabled = false;
      removeButton.disabled = false;
      removeButton.textContent = labels.remove;
      row.classList.remove('okw-archive-deleting');
    } finally {
      pendingIds.delete(session.id);
    }
  };

  const enhanceRow = (row) => {
    const session = rowSessions.get(row);
    if (!session || deletedIds.has(session.id)) return;
    if (row.querySelector('.okw-archive-actions')) return;
    const labels = copy();
    const actions = document.createElement('div');
    actions.className = 'okw-archive-actions';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'okw-archive-more';
    trigger.textContent = '⋯';
    trigger.setAttribute('aria-label', labels.more);
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');

    const menu = document.createElement('div');
    menu.className = 'okw-archive-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'okw-archive-delete';
    removeButton.setAttribute('role', 'menuitem');
    removeButton.textContent = labels.remove;
    removeButton.addEventListener('click', () => void deleteSession(row, session, trigger, removeButton));
    menu.append(removeButton);
    actions.append(trigger, menu);
    row.append(actions);

    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const opening = menu.hidden;
      closeMenu();
      if (!opening) return;
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      openMenu = { trigger, menu };
      removeButton.focus();
    });
  };

  function enhance() {
    matchRows();
    document.querySelectorAll('.archive-list .archive-row').forEach(enhanceRow);
  }

  document.addEventListener('click', (event) => {
    if (openMenu && !openMenu.menu.contains(event.target) && event.target !== openMenu.trigger) closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && openMenu) {
      event.preventDefault();
      closeMenu({ restoreFocus: true });
    }
  });

  new MutationObserver(enhance).observe(document.documentElement, { childList: true, subtree: true });
  enhance();
}
