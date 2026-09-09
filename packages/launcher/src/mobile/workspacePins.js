{
  const STORAGE_KEY = 'open-kimi-web.pinned-workspaces';
  const workspaceRecords = [];
  let pinnedIds = [];
  let activeWorkspace = null;

  const isWorkspaceId = (value) => typeof value === 'string' &&
    value.length > 0 && value.length <= 256 && !/[\\/]/.test(value);

  const readPinnedIds = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
      if (!Array.isArray(stored)) return [];
      return [...new Set(stored.filter(isWorkspaceId))];
    } catch {
      return [];
    }
  };

  const persistPinnedIds = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pinnedIds));
    } catch {
      // The current page still keeps its pins when storage is unavailable.
    }
  };

  const isChinese = () => {
    const language = document.documentElement.lang || navigator.language || '';
    return language.toLocaleLowerCase().startsWith('zh');
  };

  const copy = () => isChinese() ? {
    pin: '置顶工作区',
    unpin: '取消置顶',
    pinned: '已置顶工作区',
  } : {
    pin: 'Pin workspace',
    unpin: 'Unpin workspace',
    pinned: 'Pinned workspace',
  };

  const workspaceIdOf = (node) => {
    const host = node?.closest?.('[data-ws-id], [data-okw-workspace-id]');
    const id = host?.dataset.wsId ?? host?.dataset.okwWorkspaceId;
    return isWorkspaceId(id) ? id : null;
  };

  const workspaceIdOfContainer = (container) => {
    const id = container.dataset.wsId ?? container.dataset.okwWorkspaceId;
    return isWorkspaceId(id) ? id : null;
  };

  const pinRank = (id) => {
    const index = pinnedIds.indexOf(id);
    return index === -1 ? Number.POSITIVE_INFINITY : index;
  };

  const reorderSiblings = (nodes) => {
    if (nodes.length < 2) return;
    const sorted = [...nodes].sort((left, right) =>
      pinRank(workspaceIdOfContainer(left)) - pinRank(workspaceIdOfContainer(right)));
    if (sorted.every((node, index) => node === nodes[index])) return;
    const parent = nodes[0].parentElement;
    sorted.forEach((node) => parent.append(node));
  };

  const makePinIcon = () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M8.5 3.5h7l-1 5 3 3v1.5h-4.75V20l-.75 1-.75-1v-7H6.5v-1.5l3-3-1-5Z');
    path.setAttribute('fill', 'currentColor');
    svg.append(path);
    return svg;
  };

  const syncPinMarker = (container) => {
    const id = workspaceIdOfContainer(container);
    if (!id) return;
    const header = container.matches('.ws-dir')
      ? container.querySelector(':scope > .ws-dir-row')
      : container.querySelector(':scope > .group > .gh, :scope > .gh');
    if (!header) return;
    let marker = header.querySelector(':scope > .okw-workspace-pin-mark');
    if (!pinnedIds.includes(id)) {
      marker?.remove();
      container.classList.remove('okw-workspace-pinned');
      return;
    }
    container.classList.add('okw-workspace-pinned');
    if (marker) return;
    marker = document.createElement('span');
    marker.className = 'okw-workspace-pin-mark';
    marker.title = copy().pinned;
    marker.setAttribute('aria-label', copy().pinned);
    marker.append(makePinIcon());
    const actions = header.querySelector(':scope > .gh-actions, :scope > .ws-dir-act');
    header.insertBefore(marker, actions);
  };

  const assignDirectoryIds = () => {
    const used = new Set();
    document.querySelectorAll('.ws-dir').forEach((row) => {
      const existing = workspaceIdOfContainer(row);
      if (existing) {
        used.add(existing);
        return;
      }
      const name = row.querySelector('.ws-dir-name')?.textContent?.trim() ?? '';
      const root = row.querySelector('.ws-dir-sub')?.textContent?.trim() ?? '';
      const matches = workspaceRecords.filter((workspace) =>
        !used.has(workspace.id) && workspace.root === root && (!name || workspace.name === name));
      if (matches.length !== 1) return;
      row.dataset.okwWorkspaceId = matches[0].id;
      used.add(matches[0].id);
    });
  };

  const createMenuItem = (menu) => {
    const template = menu.querySelector('.workspace-rename-item') ?? menu.querySelector('button.ui-menu-item');
    if (!template || !activeWorkspace) return null;
    const item = template.cloneNode(false);
    item.classList.remove('workspace-rename-item');
    item.classList.add('okw-workspace-pin-menu-item');
    item.removeAttribute('danger');
    item.type = 'button';
    item.dataset.okwWorkspacePinAction = '';
    const icon = makePinIcon();
    icon.classList.add('okw-workspace-pin-menu-icon');
    const label = document.createElement('span');
    label.className = 'okw-workspace-pin-menu-label';
    item.append(icon, label);
    item.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const { id, trigger } = activeWorkspace ?? {};
      if (!isWorkspaceId(id)) return;
      if (pinnedIds.includes(id)) pinnedIds = pinnedIds.filter((storedId) => storedId !== id);
      else pinnedIds = [...pinnedIds, id];
      persistPinnedIds();
      enhance();
      if (trigger?.isConnected) trigger.click();
    });
    const buttons = menu.querySelectorAll(':scope > button.ui-menu-item');
    const removeItem = buttons[buttons.length - 1];
    menu.insertBefore(item, removeItem ?? null);
    return item;
  };

  const enhanceMenus = () => {
    document.querySelectorAll('.workspace-menu').forEach((menu) => {
      if (!activeWorkspace) return;
      const item = menu.querySelector(':scope > [data-okw-workspace-pin-action]') ?? createMenuItem(menu);
      if (!item) return;
      const pinned = pinnedIds.includes(activeWorkspace.id);
      const text = pinned ? copy().unpin : copy().pin;
      const label = item.querySelector('.okw-workspace-pin-menu-label');
      if (label.textContent !== text) label.textContent = text;
      if (item.getAttribute('aria-label') !== text) item.setAttribute('aria-label', text);
    });
  };

  const enhance = () => {
    assignDirectoryIds();
    const grouped = Array.from(document.querySelectorAll('.ws-drop-target[data-ws-id]'));
    const directory = Array.from(document.querySelectorAll('.ws-dir[data-okw-workspace-id]'));
    [...grouped, ...directory].forEach(syncPinMarker);
    const parents = new Set([...grouped, ...directory].map(({ parentElement }) => parentElement));
    parents.forEach((parent) => {
      const siblings = Array.from(parent.children).filter((node) =>
        node.matches('.ws-drop-target[data-ws-id], .ws-dir[data-okw-workspace-id]'));
      reorderSiblings(siblings);
    });
    enhanceMenus();
  };

  const rememberWorkspaces = (body) => {
    const items = body?.data?.items ?? body?.items;
    if (!Array.isArray(items)) return;
    workspaceRecords.splice(0, workspaceRecords.length, ...items.flatMap((workspace) => {
      const id = workspace?.id;
      const root = workspace?.root ?? workspace?.cwd;
      if (!isWorkspaceId(id) || typeof root !== 'string') return [];
      return [{ id, root: root.trim(), name: typeof workspace.name === 'string' ? workspace.name.trim() : '' }];
    }));
    const liveIds = new Set(workspaceRecords.map(({ id }) => id));
    const current = pinnedIds.filter((id) => liveIds.has(id));
    if (current.length !== pinnedIds.length) {
      pinnedIds = current;
      persistPinnedIds();
    }
    enhance();
  };

  const requestUrl = (input) => {
    const raw = typeof input === 'string' || input instanceof URL ? input : input.url;
    const base = location.origin === 'null' ? 'http://localhost/' : location.href;
    return new URL(raw, base);
  };
  const requestMethod = (input, init) => (init?.method ??
    (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();
  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = async function workspacePinFetch(input, init) {
      const response = await nativeFetch.apply(this, arguments);
      try {
        const url = requestUrl(input);
        const sameOrigin = location.origin === 'null' || url.origin === location.origin;
        if (response.ok && sameOrigin && url.pathname === '/api/v1/workspaces' && requestMethod(input, init) === 'GET') {
          void response.clone().json().then(rememberWorkspaces).catch(() => {});
        }
      } catch {
        // Pinning remains available in grouped views that expose data-ws-id.
      }
      return response;
    };
  }

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest?.('.gh-more');
    if (!trigger) return;
    const id = workspaceIdOf(trigger);
    if (id) activeWorkspace = { id, trigger };
  }, true);

  pinnedIds = readPinnedIds();
  new MutationObserver(enhance).observe(document.documentElement, { childList: true, subtree: true });
  enhance();
}
