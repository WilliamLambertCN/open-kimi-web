{
  const guardKey = Symbol.for('open-kimi-web.fork-title-guard');

  if (!window[guardKey]) {
    window[guardKey] = true;
    const nativeFetch = window.fetch;
    const titlePath = /^\/api\/v1\/sessions\/([^/]+)\/title\/generate$/;
    const titleSuffix = '/title/generate';

    const requestMethod = (input, init) => (
      String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    );

    const requestBody = async (input, init) => {
      if (init?.body !== undefined) return typeof init.body === 'string' ? init.body : null;
      if (input instanceof Request) return input.clone().text();
      return '';
    };

    const requestHeaders = (input, init) => {
      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      if (init?.headers) new Headers(init.headers).forEach((value, name) => headers.set(name, value));
      return headers;
    };

    const validTitleOptions = (options) => {
      if (options === null || typeof options !== 'object' || Array.isArray(options)) return false;
      if (Object.keys(options).some((key) => key !== 'force' && key !== 'source')) return false;
      if (options.force !== undefined && typeof options.force !== 'boolean') return false;
      if (options.source !== undefined && !['user_prompts', 'first_turn', 'digest'].includes(options.source)) {
        return false;
      }
      return options.force !== true;
    };

    const isAutomaticTitleRequest = (body) => {
      if (body === null) return false;
      try {
        const options = body.trim() === '' ? {} : JSON.parse(body);
        return validTitleOptions(options);
      } catch {
        return false;
      }
    };

    const titleRequest = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.origin !== location.origin || url.search !== '' || requestMethod(input, init) !== 'POST') return null;
      const match = titlePath.exec(url.pathname);
      return match ? { url, id: decodeURIComponent(match[1]) } : null;
    };

    const requestOption = (input, init, name, fallback) => init?.[name] ?? input?.[name] ?? fallback;

    const readSession = async (input, init, url, headers, receiver) => {
      const lookupHeaders = new Headers();
      for (const name of ['authorization', 'x-kimi-client-id', 'x-kimi-client-name']) {
        const value = headers.get(name);
        if (value !== null) lookupHeaders.set(name, value);
      }
      const sessionUrl = `${url.origin}${url.pathname.slice(0, -titleSuffix.length)}`;
      const response = await nativeFetch.call(receiver, sessionUrl, {
        headers: lookupHeaders,
        credentials: requestOption(input, init, 'credentials', 'same-origin'),
        signal: requestOption(input, init, 'signal'),
      });
      if (!response.ok) return null;
      const envelope = await response.json();
      return envelope?.code === 0 ? envelope.data : null;
    };

    const preservedTitleResponse = async (input, init, receiver) => {
      const request = titleRequest(input, init);
      if (request === null || !isAutomaticTitleRequest(await requestBody(input, init))) return null;
      const headers = requestHeaders(input, init);
      const session = await readSession(input, init, request.url, headers, receiver);
      const title = session?.title;
      if (session?.id !== request.id || typeof title !== 'string' || !title.startsWith('Fork: ')) return null;
      return new Response(JSON.stringify({
        code: 0,
        msg: 'success',
        data: { title },
        request_id: headers.get('x-request-id') ?? '',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    window.fetch = async function forkTitleFetch(input, init) {
      try {
        const response = await preservedTitleResponse(input, init, this);
        if (response !== null) return response;
      } catch {
        // If the lookup or compatibility check fails, use the official request.
      }
      return nativeFetch.call(this, input, init);
    };
  }
}
