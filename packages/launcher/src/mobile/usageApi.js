{
  const API = '/__open-kimi-mobile/usage';
  const stateKey = Symbol.for('open-kimi-web.usage-api');
  let state = window[stateKey];

  if (state === undefined) {
    state = { authorization: '' };
    const nativeFetch = window.fetch;
    window.fetch = function usageAuthFetch(resource, options) {
      try {
        const url = new URL(resource instanceof Request ? resource.url : String(resource), location.href);
        if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
          const headers = new Headers(resource instanceof Request ? resource.headers : undefined);
          if (options?.headers) {
            new Headers(options.headers).forEach((value, key) => headers.set(key, value));
          }
          const bearer = headers.get('authorization');
          if (/^Bearer\s+\S+$/i.test(bearer ?? '')) state.authorization = bearer;
        }
      } catch {
        // The official fetch retains its normal validation and error behavior.
      }
      return nativeFetch.apply(this, arguments);
    };
    window[stateKey] = state;
  }

  window.__okwUsageCreateApi = () => {
    return async (path, options = {}) => {
      if (!state.authorization) throw new Error('页面授权尚未就绪，请刷新页面后重试。');
      const response = await window.fetch(path, {
        ...options,
        headers: {
          authorization: state.authorization,
          ...(options.body ? { 'content-type': 'application/json' } : {}),
        },
      });
      let body;
      try { body = await response.json(); } catch { body = null; }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('页面授权已失效，请刷新页面。');
        }
        throw new Error(typeof body?.error === 'string' ? body.error : `请求失败（${response.status}）。`);
      }
      return body;
    };
  };

  window.__okwUsageApiPath = API;
}
