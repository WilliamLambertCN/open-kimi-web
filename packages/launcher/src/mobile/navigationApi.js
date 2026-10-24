if (!window[Symbol.for('open-kimi-web.navigation-api')]) {
  const key = Symbol.for('open-kimi-web.navigation-api');
  const text = (zh, en) => window.__okwLocale?.text(zh, en) ?? en;
  const state = { authorization: '' };
  const nativeFetch = window.fetch;
  window.fetch = function navigationAuthFetch(resource, options) {
    try {
      const url = new URL(resource instanceof Request ? resource.url : String(resource), location.href);
      if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
        const headers = new Headers(resource instanceof Request ? resource.headers : undefined);
        new Headers(options?.headers).forEach((value, name) => headers.set(name, value));
        const bearer = headers.get('authorization');
        if (/^Bearer\s+\S+$/i.test(bearer ?? '')) state.authorization = bearer;
      }
    } catch { /* Preserve the official fetch validation. */ }
    return nativeFetch.apply(this, arguments);
  };
  window[key] = true;
  const segment = (value) => {
    if (typeof value !== 'string' || !value || value.length > 512) throw new Error('Invalid identifier.');
    return encodeURIComponent(value);
  };
  const cronTarget = (action, options) => {
    const prefix = '/__open-kimi-mobile/cron';
    if (action === 'cron-capabilities') return { path: prefix, method: 'GET' };
    if (action === 'cron-sessions') {
      const query = typeof options.cursor === 'string' ? `?cursor=${encodeURIComponent(options.cursor)}` : '';
      return { path: `${prefix}/sessions${query}`, method: 'GET' };
    }
    const session = segment(options.sid);
    if (action === 'cron-history') return { path: `${prefix}/sessions/${session}/history`, method: 'GET' };
    if (action === 'cron-restore') return { path: `/api/v1/sessions/${session}/status`, method: 'GET', native: true };
    const path = `${prefix}/sessions/${session}/tasks`;
    if (action === 'cron-list') return { path, method: 'GET' };
    if (action === 'cron-create') return { path, method: 'POST' };
    if (action === 'cron-remove') return { path: `${path}/${segment(options.id)}:delete`, method: 'POST' };
    throw new Error('Unsupported navigation request.');
  };
  const requestError = (code, status, outcomeUnknown = false) =>
    Object.assign(new Error(code), { code, status, outcomeUnknown });
  const parseCronResponse = async (response, mutation) => {
    let result;
    try { result = await response.json(); } catch { throw requestError('invalid-response', response.status, mutation); }
    if (!response.ok || result?.error) {
      throw requestError(result?.error?.code ?? `http-${response.status}`, response.status, result?.outcomeUnknown === true);
    }
    return result;
  };
  const cronFetch = async (target, options, mutation) => {
    const authorization = state.authorization;
    if (!authorization) throw requestError('auth', 401);
    const init = { method: target.method, signal: options.signal, cache: 'no-store',
      headers: { authorization, 'content-type': 'application/json' } };
    if (target.method === 'POST') init.body = JSON.stringify(options.body ?? {});
    try { return await window.fetch(target.path, init); } catch { throw requestError('connection', 0, mutation); }
  };
  window.__okwNavigationRequest = async (action, options = {}) => {
    const target = cronTarget(action, options);
    const mutation = target.method === 'POST' || action === 'cron-restore';
    const response = await cronFetch(target, options, mutation);
    const result = await parseCronResponse(response, mutation);
    if (!target.native) return result;
    if (result?.code !== 0) throw requestError('restore-failed', response.status);
    return result.data;
  };
  const failure = (status) => {
    if (status === 404 || status === 405) {
      return text('当前服务不支持官方全局搜索接口。', 'This server does not support the official global search API.');
    }
    if (status === 401 || status === 403) return text('页面授权已失效，请刷新页面。', 'Authorization expired. Refresh the page.');
    return text('搜索失败，请重试。', 'Search failed. Please retry.');
  };
  const validHit = (item) => typeof item?.session_id === 'string' && item.session_id.length > 0 &&
    typeof item.session_title === 'string' && typeof item.snippet === 'string' &&
    ['user', 'assistant', 'title'].includes(item.role);
  const page = (data) => {
    if (!Array.isArray(data?.items) || typeof data.has_more !== 'boolean') {
      throw new Error(text('搜索响应格式无效。', 'Invalid search response.'));
    }
    return { ...data, items: data.items.filter(validHit),
      has_more: data.has_more && typeof data.page_token === 'string' && data.page_token.length > 0 };
  };
  window.__okwNavigationSearch = async (query, { signal, pageToken } = {}) => {
    const authorization = state.authorization;
    if (!authorization) throw new Error(text('页面授权尚未就绪，请刷新后重试。', 'Authorization is not ready. Refresh and retry.'));
    const body = { query: query.query, mode: query.mode, sort: query.sort, page_size: 20 };
    if (query.role) body.role = query.role;
    if (pageToken) body.page_token = pageToken;
    const response = await window.fetch('/api/v1/search', {
      method: 'POST', signal, cache: 'no-store',
      headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    let envelope;
    try { envelope = await response.json(); } catch { envelope = null; }
    if (!response.ok || envelope?.code !== 0) throw new Error(failure(response.status));
    return page(envelope.data);
  };
  const workspaceFailure = (status, code) => {
    if (status === 401 || status === 403) return text('页面授权已失效，请刷新页面。', 'Authorization expired. Refresh the page.');
    if (code === 40001) return text('请输入运行端的绝对目录路径。', 'Enter an absolute directory path on the server.');
    if (code === 40409) return text('目录不存在、不可访问或不是文件夹。', 'The directory does not exist, is inaccessible or is not a folder.');
    return text('无法添加工作空间，请检查服务连接后重试。', 'Could not add the workspace. Check the server connection and retry.');
  };
  const workspaceRoot = (input) => {
    const root = input.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
    if (!root) throw new Error(workspaceFailure(400, 40001));
    return root;
  };
  window.__okwNavigationAddWorkspace = async (root, signal) => {
    const authorization = state.authorization;
    if (!authorization) throw new Error(text('页面授权尚未就绪，请刷新后重试。', 'Authorization is not ready. Refresh and retry.'));
    const response = await window.fetch('/api/v1/workspaces', {
      method: 'POST', signal, cache: 'no-store',
      headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify({ root: workspaceRoot(root) }),
    });
    let envelope;
    try { envelope = await response.json(); } catch { envelope = null; }
    if (!response.ok || envelope?.code !== 0) throw new Error(workspaceFailure(response.status, envelope?.code));
    const workspace = envelope.data;
    if (typeof workspace?.id !== 'string' || typeof workspace.root !== 'string') {
      throw new Error(text('工作空间响应格式无效。请刷新确认是否已添加。',
        'Invalid workspace response. Refresh to confirm whether it was added.'));
    }
    return workspace;
  };
}
