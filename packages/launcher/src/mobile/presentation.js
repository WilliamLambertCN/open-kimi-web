const mobile = window.matchMedia('(max-width: 640px)');

{
  const enhancedWorkspaceSheets = new WeakSet();
  const workspaceSheetViews = new WeakMap();
  const sessions = new Map();
  const gitBySession = new Map();
  let workspaces = [];
  let sessionListing = null;

  const currentSessionId = () => {
    const match = location.pathname.match(/^\/sessions\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  };

  const workspaceCount = (listing, session) => {
    const groups = Array.isArray(listing?.groups) ? listing.groups : [];
    const match = groups.find((group) => {
      const workspace = group?.workspace ?? {};
      return (session?.workspace_id && workspace.id === session.workspace_id) ||
        (session?.metadata?.cwd && (workspace.cwd === session.metadata.cwd || workspace.root === session.metadata.cwd));
    });
    if (Number.isFinite(match?.total)) return match.total;
    return null;
  };

  const ensureHeaderNode = (main, className, prepend = false) => {
    let node = main.querySelector(`.${className}`);
    if (node) return node;
    node = document.createElement('span');
    node.className = className;
    if (prepend) main.prepend(node);
    else main.append(node);
    return node;
  };

  const currentStatus = (topbar, session) => {
    const live = topbar.querySelector('.st');
    if (live?.querySelector('.ui-spinner')) return '运行中';
    const label = live?.textContent?.trim();
    if (label) return label;
    if (live) return null;
    if (!session) return null;
    return '空闲';
  };

  const headerParts = (topbar, session, git, listing, workspace) => {
    const parts = [];
    const status = currentStatus(topbar, session);
    if (status) parts.push(status);
    if (git?.branch) parts.push(git.branch);
    const count = workspaceCount(listing, session ?? workspace);
    if (count !== null) parts.push(`${count} 个会话`);
    return parts;
  };

  const textOf = (node) => node ? node.textContent.trim() : '';

  const setText = (node, value) => {
    if (node.textContent !== value) node.textContent = value;
  };

  const renderHeaderState = ({ session, git, listing, workspace }) => {
    const topbar = document.querySelector('.app.mobile .topbar');
    if (!topbar) return;
    const main = topbar.querySelector('.tb-main');
    if (!main) return;
    const name = textOf(main.querySelector('.dir'));
    if (!name) return;

    const badge = ensureHeaderNode(main, 'okw-workspace-badge', true);
    badge.setAttribute('aria-hidden', 'true');
    const badgeText = Array.from(name)[0]?.toLocaleUpperCase() ?? '';
    setText(badge, badgeText);

    const status = ensureHeaderNode(main, 'okw-workspace-status');
    const parts = headerParts(topbar, session, git, listing, workspace);
    const statusText = parts.join(' · ');
    setText(status, statusText);
    if (status.hidden !== (parts.length === 0)) status.hidden = parts.length === 0;
  };

  const renderObservedHeaderState = () => {
    const sessionId = currentSessionId();
    const name = textOf(document.querySelector('.app.mobile .topbar .dir'));
    const workspace = sessionId ? null : workspaces.find((item) => item.name === name) ?? null;
    renderHeaderState({
      session: sessionId ? sessions.get(sessionId) ?? null : null,
      git: sessionId ? gitBySession.get(sessionId) ?? null : null,
      listing: sessionListing,
      workspace,
    });
  };

  const rememberSession = (id, data) => {
    sessions.set(id, {
      workspace_id: typeof data?.workspace_id === 'string' ? data.workspace_id : null,
      metadata: { cwd: typeof data?.metadata?.cwd === 'string' ? data.metadata.cwd : null },
    });
  };

  const stringOrNull = (value) => typeof value === 'string' ? value : null;

  const normalizeGroup = (group) => {
    const workspace = group?.workspace ?? {};
    return {
      workspace: {
        id: stringOrNull(workspace.id),
        cwd: stringOrNull(workspace.cwd),
        root: stringOrNull(workspace.root),
      },
      total: Number.isFinite(group?.total) ? group.total : null,
    };
  };

  const rememberV2Session = (item) => {
    if (typeof item?.id !== 'string' || typeof item?.git?.branch !== 'string') return;
    gitBySession.set(item.id, { branch: item.git.branch });
  };

  const rememberWorkspaces = (data) => {
    const items = Array.isArray(data?.items) ? data.items : [];
    workspaces = items.map((item) => ({
      workspace_id: stringOrNull(item?.id),
      name: stringOrNull(item?.name),
      metadata: { cwd: stringOrNull(item?.root ?? item?.cwd) },
    }));
  };

  const rememberListing = (data) => {
    if (Array.isArray(data?.items)) data.items.forEach(rememberV2Session);
    if (Array.isArray(data?.groups)) {
      data.groups.forEach((group) => group?.sessions?.forEach(rememberV2Session));
    }
    if (!Array.isArray(data?.groups) || data.groups.length === 0) return;
    sessionListing = {
      groups: data.groups.map(normalizeGroup),
    };
  };

  const rememberResponse = (url, method, data) => {
    const sessionMatch = url.pathname.match(/^\/api\/v1\/sessions\/([^/]+)$/);
    const gitMatch = url.pathname.match(/^\/api\/v1\/sessions\/([^/]+)\/fs:git_status$/);
    if (sessionMatch && (method === 'GET' || method === 'POST')) {
      rememberSession(decodeURIComponent(sessionMatch[1]), data);
    } else if (gitMatch) {
      gitBySession.set(decodeURIComponent(gitMatch[1]), {
        branch: typeof data?.branch === 'string' ? data.branch : null,
      });
    } else if (url.pathname === '/api/v2/sessions') {
      rememberListing(data);
    } else if (url.pathname === '/api/v1/workspaces') {
      rememberWorkspaces(data);
    }
  };

  const requestUrl = (input) => new URL(input instanceof Request ? input.url : String(input), location.href);

  const requestMethod = (input, init) => {
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    return method.toUpperCase();
  };

  const isObservedPath = (pathname) => pathname === '/api/v2/sessions' ||
    pathname === '/api/v1/workspaces' ||
    /^\/api\/v1\/sessions\/[^/]+(?:\/fs:git_status)?$/.test(pathname);

  const observeResponse = async (input, init, response) => {
    if (!mobile.matches || !response.ok) return;
    try {
      const url = requestUrl(input);
      if (url.origin !== location.origin) return;
      if (!isObservedPath(url.pathname)) return;
      const method = requestMethod(input, init);
      const body = await response.clone().json();
      rememberResponse(url, method, body?.data ?? body);
      renderObservedHeaderState();
    } catch {
      // Presentation data is optional; the official response remains untouched.
    }
  };

  const nativeFetch = window.fetch;
  window.fetch = async function observedFetch(input, init) {
    const response = await nativeFetch.apply(this, arguments);
    void observeResponse(input, init, response);
    return response;
  };

  const enhanceSettings = (root) => {
    const panel = root.querySelector('.sheet-panel[aria-label="设置"]');
    if (!panel) return;
    root.classList.add('okw-settings');
    const title = panel.querySelector('.sheet-title');
    if (title?.textContent.trim() === '设置') title.textContent = '会话设置';
    panel.querySelectorAll('.srow').forEach((row) => {
      const label = row.querySelector('.srow-label')?.textContent?.trim();
      if (label) row.dataset.okwRow = label;
    });
    const card = panel.querySelector('.group-title + .card');
    const thinking = card && Array.from(card.querySelectorAll('.srow')).find((row) => row.dataset.okwRow === '思考强度');
    const note = panel.querySelector('.cache-note');
    if (card && thinking && note && !card.querySelector('.okw-cache-note-inline')) {
      const inline = document.createElement('div');
      inline.className = 'okw-cache-note-inline';
      inline.textContent = note.textContent;
      thinking.after(inline);
    }
  };

  const enhanceWorkspaceSheet = (root) => {
    if (!root.querySelector('.actions .newrow') || !root.querySelector('.view-tabs')) return;
    root.classList.add('okw-workspaces');
    if (enhancedWorkspaceSheets.has(root)) return;
    enhancedWorkspaceSheets.add(root);
    const selected = root.querySelector('.view-tabs [role="tab"][aria-selected="true"]');
    workspaceSheetViews.set(root, selected?.textContent?.trim() ?? '');
    const grouped = Array.from(root.querySelectorAll('.view-tabs [role="tab"]'))
      .find((button) => button.textContent?.trim() === '按工作区');
    if (grouped && grouped.getAttribute('aria-selected') !== 'true') grouped.click();
  };

  const enhanceBrand = () => {
    const label = document.querySelector('.side .ch-brand .ch-name');
    if (label?.textContent.trim() === 'Kimi Code') label.textContent = 'OPEN-KIMI-WEB';
  };

  const enhance = () => {
    enhanceBrand();
    if (!mobile.matches) return;
    const main = document.querySelector('.app.mobile .topbar .tb-main');
    if (main) renderObservedHeaderState();

    document.querySelectorAll('.sheet-root').forEach((root) => {
      enhanceSettings(root);
      enhanceWorkspaceSheet(root);
    });

  };

  const restoreDesktop = () => {
    document.querySelectorAll('.okw-workspace-badge, .okw-workspace-status, .okw-cache-note-inline').forEach((node) => node.remove());
    document.querySelectorAll('.sheet-root.okw-settings').forEach((root) => {
      root.classList.remove('okw-settings');
      const sheetTitle = root.querySelector('.sheet-title');
      if (sheetTitle?.textContent.trim() === '会话设置') sheetTitle.textContent = '设置';
      root.querySelectorAll('[data-okw-row]').forEach((row) => delete row.dataset.okwRow);
    });
    document.querySelectorAll('.sheet-root.okw-workspaces').forEach((root) => {
      root.classList.remove('okw-workspaces');
      const previous = workspaceSheetViews.get(root);
      const tab = Array.from(root.querySelectorAll('.view-tabs [role="tab"]'))
        .find((button) => button.textContent?.trim() === previous);
      if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
      enhancedWorkspaceSheets.delete(root);
    });
  };

  new MutationObserver(enhance).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', enhance);
  mobile.addEventListener('change', () => {
    if (mobile.matches) enhance();
    else restoreDesktop();
  });
  enhance();
}
