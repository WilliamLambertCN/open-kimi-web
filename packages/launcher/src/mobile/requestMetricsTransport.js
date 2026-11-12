{
  const installed = Symbol.for('open-kimi-web.request-metrics-transport');
  if (!window[installed]) {
    window[installed] = true;
    const model = window.__okwRequestMetricsModel.create();
    const listeners = new Set();
    const maxBody = 2 * 1024 * 1024;
    const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512;
    let route;
    let generation = 0;
    let sequence = 0;
    const notify = () => { for (const listener of listeners) { try { listener(); } catch {} } };
    const currentId = () => {
      try { return decodeURIComponent(location.pathname.match(/^\/sessions\/([^/?#]+)$/)?.[1] ?? ''); }
      catch { return ''; }
    };
    const checkRoute = () => {
      const next = currentId();
      if (next === route) return;
      route = next; generation += 1; notify();
    };
    const objectBytes = (value, pending, nodes) => {
      let size = 0;
      for (const key in value) if (Object.hasOwn(value, key)) {
        size += key.length * 3;
        if (pending.length + nodes > 20000) return maxBody + 1;
        pending.push(value[key]);
      }
      return size;
    };
    const bounded = (body) => {
      const pending = [body];
      let size = 0;
      let nodes = 0;
      while (pending.length) {
        const value = pending.pop();
        if (++nodes > 20000) return false;
        if (typeof value === 'string') size += value.length * 3;
        else if (value && typeof value === 'object') size += objectBytes(value, pending, nodes);
        if (size > maxBody) return false;
      }
      return true;
    };
    const sameVisit = (request) => request.session === route && request.generation === generation;
    const validEnvelope = (body) => body?.code === undefined || body.code === 0;
    const readOps = (data, request) => {
      if (data?.agent_id !== request.agent || data.complete !== true || !Array.isArray(data.batches)) return false;
      let changed = false;
      for (const batch of data.batches) {
        if (!Number.isSafeInteger(batch?.seq) || batch.seq < 0) continue;
        changed = model.apply(request.session, request.agent, batch.ops, { seq: batch.seq, stamp: request.stamp }) || changed;
      }
      return changed;
    };
    const read = (body, request) => {
      if (!sameVisit(request) || !validEnvelope(body) || !bounded(body)) return;
      const changed = request.ops ? readOps(body?.data, request)
        : model.read(request.session, request.agent, body?.data, request);
      if (changed) notify();
    };
    const requestParts = (resource, options) => {
      const isRequest = typeof Request === 'function' && resource instanceof Request;
      return { url: new URL(isRequest ? resource.url : String(resource), location.href),
        method: options?.method ?? (isRequest ? resource.method : 'GET') };
    };
    const validTarget = (url, method) => url.origin === location.origin && method.toUpperCase() === 'GET' &&
      !(url.searchParams.has('before_turn') && url.searchParams.has('after_turn'));
    const targetGeneration = (session, agent, page, ops) =>
      generation + Number(agent === 'main' && !page && !ops && session !== route);
    const requestFor = (resource, options) => {
      try {
        const { url, method } = requestParts(resource, options);
        const match = url.pathname.match(/^\/api\/v1\/sessions\/([^/]+)\/transcript(\/ops)?$/);
        if (!validTarget(url, method) || !match) return null;
        const agent = url.searchParams.get('agent_id');
        const session = decodeURIComponent(match[1]);
        if (!validId(agent) || !validId(session)) return null;
        checkRoute();
        const page = url.searchParams.has('before_turn') || url.searchParams.has('after_turn');
        return { session, agent, page, ops: !!match[2], stamp: ++sequence,
          generation: targetGeneration(session, agent, page, match[2]) };
      } catch { return null; }
    };
    const queue = (value, request, method) => {
      if (method === 'text' && (typeof value !== 'string' || value.length > maxBody)) return;
      setTimeout(() => {
        try {
          checkRoute();
          if (sameVisit(request)) read(method === 'text' ? JSON.parse(value) : value, request);
        } catch {}
      }, 0);
    };
    const wrapReader = (response, method, request) => {
      const native = response[method];
      if (typeof native !== 'function') return;
      response[method] = function requestMetricsRead() {
        const result = native.apply(this, arguments);
        try { void result.then((value) => queue(value, request, method), () => {}); } catch {}
        return result;
      };
    };
    const wrapped = new WeakSet();
    const eligibleResponse = (response) => {
      if (!response.ok || response.redirected || wrapped.has(response)) return false;
      if (response.url && new URL(response.url, location.href).origin !== location.origin) return false;
      return Number(response.headers?.get('content-length')) <= maxBody;
    };
    const observeResponse = (response, request) => {
      try {
        if (!eligibleResponse(response)) return;
        wrapped.add(response);
        for (const method of ['json', 'text']) { try { wrapReader(response, method, request); } catch {} }
      } catch {}
    };
    const nativeFetch = window.fetch;
    window.fetch = function requestMetricsFetch(resource, options) {
      const request = requestFor(resource, options);
      const result = nativeFetch.apply(this, arguments);
      try { if (request) void result.then((response) => observeResponse(response, request), () => {}); } catch {}
      return result;
    };
    let socketEpoch = 0;
    const receiveFrame = (frame, epoch) => {
      const payload = frame.payload;
      if (frame.session_id !== route || !validId(payload?.agent_id) || !bounded(payload)) return false;
      if (frame.type === 'transcript.reset') return model.reset(route, payload.agent_id, payload, epoch, ++sequence);
      if (frame.type === 'transcript.ops') {
        return model.apply(route, payload.agent_id, payload.ops, { seq: payload.seq, stamp: ++sequence });
      }
      return false;
    };
    const receive = (event, epoch) => {
      if (epoch !== socketEpoch) return;
      try {
        if (typeof event.data !== 'string' || event.data.length > maxBody || !event.data.includes('"transcript.')) return;
        checkRoute();
        if (receiveFrame(JSON.parse(event.data), epoch)) notify();
      } catch {}
    };
    if (typeof window.WebSocket === 'function') {
      window.WebSocket = new Proxy(window.WebSocket, { construct(target, args, newTarget) {
        const socket = Reflect.construct(target, args, newTarget);
        try {
          const url = new URL(args[0], location.href);
          if (url.origin.replace(/^ws/, 'http') === location.origin && url.pathname === '/api/v1/ws') {
            const epoch = ++socketEpoch;
            socket.addEventListener('message', (event) => receive(event, epoch));
          }
        } catch {}
        return socket;
      } });
    }
    for (const method of ['pushState', 'replaceState']) {
      const native = history[method];
      history[method] = function requestMetricsHistory() {
        const result = native.apply(this, arguments);
        try { checkRoute(); } catch {}
        return result;
      };
    }
    window.addEventListener('popstate', checkRoute);
    window.__okwRequestMetrics = {
      session: () => { checkRoute(); return route; },
      items: (agent = 'main') => { checkRoute(); return model.items(route, agent); },
      observe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    };
    checkRoute();
  }
}
