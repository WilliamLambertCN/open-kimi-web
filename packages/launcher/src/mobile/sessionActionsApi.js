{
  const installed = Symbol.for('open-kimi-web.session-actions-api');
  if (!window[installed]) {
    window[installed] = true;
    const storageKey = 'kimi-web.pinned-sessions';
    const nativeFetch = window.fetch;
    const headers = new Headers();
    const observers = new Set();
    const records = new Map();
    const pending = new Set();
    const text = (zh, en) => window.__okwLocale?.text(zh, en) ?? en;
    const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,256}$/.test(id);
    const error = (code) => Object.assign(new Error(code), { code });
    const notify = () => observers.forEach((listener) => listener());
    const pins = () => {
      let stored;
      try { stored = JSON.parse(localStorage.getItem(storageKey) ?? '[]'); } catch { throw error('storage'); }
      if (!Array.isArray(stored) || stored.some((id) => !validId(id))) throw error('storage');
      return [...new Set(stored)];
    };
    const safePins = () => { try { return pins(); } catch { return []; } };
    const displayString = (value, fallback) => typeof value === 'string' && value ? value : fallback;
    const project = (item) => {
      const meta = item.meta ?? item;
      return { id: item.id, title: displayString(meta.title ?? meta.last_prompt, item.id),
        cwd: displayString(item.workspace?.cwd ?? item.metadata?.cwd, '') };
    };
    const remember = (item) => {
      const id = item?.id;
      if (!validId(id) || !safePins().includes(id)) return;
      const next = project(item);
      if (JSON.stringify(records.get(id)) === JSON.stringify(next)) return;
      records.set(id, next); notify();
    };
    const observeBody = (body) => {
      if (body?.code !== 0) return;
      const data = body.data;
      if (Array.isArray(data?.items)) data.items.forEach(remember);
      else if (Array.isArray(data?.groups)) data.groups.forEach((group) => group.sessions?.forEach(remember));
      else remember(data);
    };
    const observedHeaders = ['authorization', 'x-kimi-client-id', 'x-kimi-client-name', 'x-kimi-client-version',
      'x-kimi-client-ui-mode'];
    const captureHeaders = (request, options) => {
      const incoming = new Headers(request?.headers);
      new Headers(options?.headers).forEach((value, name) => incoming.set(name, value));
      observedHeaders.forEach((name) => {
        const value = incoming.get(name);
        if (value && value.length <= 4096 && (name !== 'authorization' || /^Bearer\s+\S+$/i.test(value))) {
          headers.set(name, value);
        }
      });
    };
    const sessionResponsePath = (path) => ['/api/v1/sessions', '/api/v2/sessions'].includes(path) ||
      /^\/api\/v1\/sessions\/[a-zA-Z0-9_-]+$/.test(path);
    const requestMethod = (request, options) => String(options?.method ?? request?.method ?? 'GET').toUpperCase();
    const observeRequest = (input, options) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(request?.url ?? String(input), location.href);
      if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return false;
      captureHeaders(request, options);
      return requestMethod(request, options) === 'GET' && sessionResponsePath(url.pathname);
    };
    const sameOriginResponse = (response) => !response.redirected &&
      (!response.url || new URL(response.url).origin === location.origin);
    let uploads = 0;
    const fileUpload = (input, method) => {
      try {
        const url = new URL(String(input), location.href);
        return String(method).toUpperCase() === 'POST' && url.origin === location.origin && url.pathname === '/api/v1/files';
      } catch { return false; }
    };
    const fetchUpload = (input, options) => {
      const request = input instanceof Request ? input : null;
      return fileUpload(request?.url ?? input, requestMethod(request, options));
    };
    const beginUpload = () => {
      uploads += 1; let active = true;
      return () => { if (active) { active = false; uploads -= 1; } };
    };
    const observeUpload = (result, upload) => {
      if (upload) { const finish = beginUpload(); void result.then(finish, finish); }
    };
    window.fetch = function sessionActionsFetch(input, options) {
      let observe = false;
      try { observe = observeRequest(input, options); } catch { /* Keep the original request validation. */ }
      const result = nativeFetch.apply(this, arguments);
      observeUpload(result, fetchUpload(input, options));
      if (observe) void result.then((response) => {
        if (response.ok && sameOriginResponse(response)) {
          void response.clone().json().then(observeBody).catch(() => {});
        }
      }).catch(() => {});
      return result;
    };
    const trackXhrUploads = () => {
      const prototype = window.XMLHttpRequest?.prototype;
      if (!prototype) return;
      const open = prototype.open; const send = prototype.send; const targets = new WeakMap();
      prototype.open = function sessionUploadOpen(method, url) {
        const result = open.apply(this, arguments); targets.set(this, fileUpload(url, method)); return result;
      };
      prototype.send = function sessionUploadSend() {
        if (!targets.get(this)) return send.apply(this, arguments);
        const finish = beginUpload(); this.addEventListener('loadend', finish, { once: true });
        try { return send.apply(this, arguments); } catch (failure) { finish(); throw failure; }
      };
    };
    trackXhrUploads();
    const routeId = () => {
      const match = /^\/sessions\/([^/]+)\/?$/.exec(location.pathname);
      if (!match) return null;
      try { const id = decodeURIComponent(match[1]); return validId(id) ? id : null; } catch { return null; }
    };
    const routeSupported = () => location.pathname === '/' || routeId() !== null;
    const navigate = (id) => {
      if (!validId(id) || !routeSupported()) throw error('identity');
      const url = new URL(location.href);
      url.pathname = `/sessions/${encodeURIComponent(id)}`;
      history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    };
    const httpFailure = (status) => {
      if (status === 401 || status === 403) throw error('auth');
      if (status === 404 || status === 405) throw error('unavailable');
    };
    const validateResult = (body, response, id, fork) => {
      const code = body?.code;
      const failure = { 40901: 'busy', 40931: 'occupied', 40932: 'occupied', 40401: 'unavailable' }[code];
      if (failure) throw error(failure);
      if (!response.ok || code !== 0) throw error('failed');
      const resultId = body.data?.id;
      const matches = fork ? resultId !== id : resultId === id;
      if (!validId(resultId) || !matches) throw error(fork ? 'unknown' : 'invalid');
      return body.data;
    };
    const responseData = async (response, id, fork) => {
      if (!sameOriginResponse(response)) throw error(fork ? 'unknown' : 'connection');
      httpFailure(response.status);
      let body;
      try { body = await response.json(); } catch { throw error(fork ? 'unknown' : 'invalid'); }
      return validateResult(body, response, id, fork);
    };
    const requestOptions = (fork) => {
      const outgoing = new Headers(headers);
      outgoing.set('content-type', 'application/json');
      if (window.crypto?.randomUUID) outgoing.set('x-request-id', window.crypto.randomUUID());
      return { method: fork ? 'POST' : 'GET', headers: outgoing, credentials: 'same-origin', cache: 'no-store',
        redirect: 'error', signal: AbortSignal.timeout(fork ? 300000 : 10000), ...(fork ? { body: '{}' } : {}) };
    };
    const request = async (id, fork) => {
      if (!validId(id) || !routeSupported()) throw error('identity');
      if (!headers.has('authorization')) throw error('auth');
      let response;
      try {
        response = await window.fetch(`/api/v1/sessions/${encodeURIComponent(id)}${fork ? ':fork' : ''}`, requestOptions(fork));
      } catch { throw error(fork ? 'unknown' : 'connection'); }
      return responseData(response, id, fork);
    };
    window.__okwSessionActions = {
      validId, routeId, routeSupported, navigate, pins,
      hasUploads: () => uploads > 0,
      record: (id) => records.get(id),
      observe: (listener) => { observers.add(listener); },
      async read(id) { const item = await request(id, false); remember(item); return item; },
      async fork(id) {
        if (pending.has(id)) throw error('pending');
        pending.add(id);
        try { return await request(id, true); } finally { pending.delete(id); }
      },
      setPinned(id, enabled) {
        if (!validId(id)) throw error('identity');
        const current = pins();
        const next = enabled ? [...new Set([...current, id])] : current.filter((value) => value !== id);
        try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { throw error('storage'); }
        notify();
      },
      failure(failure) {
        const messages = {
          auth: ['页面授权尚未就绪或已失效，请刷新后重试。', 'Authorization is unavailable or expired. Refresh and retry.'],
          identity: ['未能确认所选会话，未执行操作。请重新打开列表后重试。',
            'The selected session could not be verified. No action was taken. Reopen the list and retry.'],
          storage: ['无法保存置顶设置，请检查浏览器存储权限。', 'Cannot save pins. Check browser storage permissions.'],
          uploading: ['附件仍在准备，请等上传完成后再修改置顶。', 'Attachments are still preparing. Wait before changing pins.'],
          busy: ['会话仍在运行，请等任务结束后再分叉。', 'The session is running. Wait until it finishes before forking.'],
          occupied: ['会话由其他进程占用或状态已变化，请先在原会话中处理。',
            'Another process owns this session, or its state changed. Resolve this in the original session first.'],
          unavailable: ['会话不存在或当前服务不支持此操作。', 'The session is unavailable or the server does not support this action.'],
          unknown: ['未能确认分叉结果，请先检查会话列表，不要立即重复操作。',
            'The fork result is unknown. Check the session list before trying again.'],
          connection: ['无法读取会话，请检查连接后重试。', 'Cannot read the session. Check the connection and retry.'],
          pending: ['正在分叉，请稍候。', 'A fork is already in progress. Please wait.'],
          failed: ['操作失败，原会话未被替换。请检查连接或服务状态。',
            'The action failed. The original session was not replaced. Check the connection or server.'],
        };
        return text(...(messages[failure?.code] ?? messages.failed));
      },
    };
    window.addEventListener('storage', (event) => { if (event.key === storageKey || event.key === null) notify(); });
  }
}
