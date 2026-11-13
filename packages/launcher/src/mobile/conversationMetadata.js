{
  const installed = Symbol.for('open-kimi-web.mobile-toc-metadata');
  if (!window[installed]) {
    window[installed] = true;
    const listeners = new Set();
    const sessions = new Map();
    const limit = 2000;
    const maxBytes = 2 * 1024 * 1024;
    const wrapped = new WeakSet();
    let route;
    let active;
    let generation = 0;
    let sequence = 0;
    let socketGeneration = 0;
    const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512;
    const validTurn = (value) => validId(value?.turn_id) && Number.isSafeInteger(value.ordinal) && value.ordinal >= 0;
    const compact = (value) => typeof value === 'string' ? value.slice(0, 2048).replace(/\s+/g, ' ').trim().slice(0, 240) : '';
    const time = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : undefined;
    const notify = () => { for (const fn of listeners) { try { fn(); } catch {} } };
    const currentId = () => {
      try { return decodeURIComponent(location.pathname.match(/^\/sessions\/([^/?#]+)$/)?.[1] ?? ''); }
      catch { return ''; }
    };
    const empty = () => ({ turns: new Map(), entries: new Map(), labels: new Map(), removed: new Map(), times: new Map(),
      reset: 0, moreStamp: 0, hasMore: false, ordered: null });
    const checkRoute = () => {
      const next = currentId();
      if (next === route) return;
      route = next; generation += 1; active = null;
      if (next) {
        active = sessions.get(next) ?? empty();
        sessions.delete(next); sessions.set(next, active);
        while (sessions.size > 4) sessions.delete(sessions.keys().next().value);
      }
      notify();
    };
    const trimMap = (map) => { while (map.size > limit) map.delete(map.keys().next().value); };
    const dropTurn = (state, id) => {
      state.turns.delete(id);
      for (const [key, entry] of state.entries) if (entry.turn === id) {
        state.entries.delete(key); state.labels.delete(key);
      }
      for (const [key, entry] of state.times) if (entry.turn === id) state.times.delete(key);
    };
    const finish = (state) => {
      while (state.turns.size > limit) dropTurn(state, state.turns.keys().next().value);
      for (const map of [state.entries, state.labels, state.removed, state.times]) trimMap(map);
      state.ordered = null; notify();
    };
    const rememberTurn = (state, turn, stamp) => {
      if (!validTurn(turn) || (state.removed.get(turn.turn_id) ?? 0) > stamp) return false;
      const old = state.turns.get(turn.turn_id);
      if (old?.stamp > stamp) return false;
      state.turns.set(turn.turn_id, { ordinal: turn.ordinal, stamp, count: old?.count ?? 0,
        ended: turn.status === 'ended' ? time(turn.ended_at) : undefined });
      return true;
    };
    const itemLabel = (item) => {
      switch (item.origin?.kind) {
        case 'skill': return compact('/' + compact(item.origin.name));
        case 'plugin_command': return compact(`/${compact(item.origin.plugin_id)}:${compact(item.origin.command)}`);
        case 'user': return compact(item.text) || compact(item.skills?.slice(0, 16)
          .map((skill) => compact(skill?.name)).filter(Boolean).map((name) => '/' + name).join(' '));
        default: return null;
      }
    };
    const entryIndex = (state, previous, index, turn) => index ?? previous?.index ?? state.turns.get(turn).count++;
    const rememberUser = (state, turn, item, index) => {
      const label = itemLabel(item);
      if (label === null) return;
      const attachmentOnly = !label && Array.isArray(item.attachments) && item.attachments.length > 0;
      if (!label && !attachmentOnly) return;
      const previous = state.entries.get(item.item_id);
      if (previous && previous.turn !== turn) return;
      state.entries.set(item.item_id, { id: item.item_id, turn, index: entryIndex(state, previous, index, turn),
        label, attachmentOnly });
    };
    const rememberItem = (state, turn, item, index) => {
      if (!validId(item?.item_id) || !state.turns.has(turn)) return;
      const role = item.type === 'user_message' ? 'user' : 'assistant';
      const created = time(item.created_at);
      if (created !== undefined) state.times.set(item.item_id, { turn, role, time: created });
      if (item.type === 'user_message') rememberUser(state, turn, item, index);
    };
    const readTurn = (state, turn, stamp) => {
      if (!validTurn(turn) || !Array.isArray(turn.items) || state.turns.get(turn.turn_id)?.stamp > stamp ||
          (state.removed.get(turn.turn_id) ?? 0) > stamp) return;
      dropTurn(state, turn.turn_id);
      if (!rememberTurn(state, turn, stamp)) return;
      state.turns.get(turn.turn_id).count = turn.items.length;
      turn.items.forEach((item, index) => rememberItem(state, turn.turn_id, item, index));
    };
    const resetPage = (state, data, stamp) => {
      const pivot = data.turns[0];
      const retained = pivot && state.turns.has(pivot.turn_id) ? pivot.ordinal : -1;
      for (const [id, turn] of state.turns) if (turn.ordinal >= retained && turn.stamp <= stamp) dropTurn(state, id);
      state.reset = stamp;
    };
    const readPage = (state, data, request) => {
      if (!Array.isArray(data?.turns) || typeof data.has_more !== 'boolean' || request.stamp < state.reset) return;
      if (!request.page) resetPage(state, data, request.stamp);
      for (const turn of data.turns) readTurn(state, turn, request.stamp);
      const boundary = request.page || state.turns.size === data.turns.length;
      if (boundary && request.stamp >= state.moreStamp) { state.hasMore = data.has_more; state.moreStamp = request.stamp; }
      finish(state);
    };
    const removeItem = (state, frame, stamp) => {
      const entry = state.entries.get(frame.item_id) ?? state.times.get(frame.item_id);
      if (entry?.turn !== frame.turn_id) return false;
      state.entries.delete(frame.item_id); state.labels.delete(frame.item_id); state.times.delete(frame.item_id);
      state.turns.get(frame.turn_id).stamp = stamp;
      return true;
    };
    const remove = (state, frame, stamp) => {
      if (frame.type === 'turns.removed' && Array.isArray(frame.turn_ids)) {
        for (const id of frame.turn_ids) if (validId(id)) { dropTurn(state, id); state.removed.set(id, stamp); }
      } else if (frame.type !== 'item.removed' || !removeItem(state, frame, stamp)) return;
      finish(state);
    };
    const readFrame = (frame) => {
      if (!active || frame.session_id !== route || frame.agent_id !== 'main') return;
      const stamp = ++sequence;
      if (frame.type === 'turns') { readPage(active, frame, { stamp, page: false }); return; }
      if (['turn.started', 'turn.ended'].includes(frame.type)) {
        if (rememberTurn(active, frame.turn, stamp)) finish(active);
      } else if (['item.started', 'item.ended'].includes(frame.type)) {
        if (!active.turns.has(frame.turn_id)) return;
        rememberItem(active, frame.turn_id, frame.item); active.turns.get(frame.turn_id).stamp = stamp; finish(active);
      } else remove(active, frame, stamp);
    };
    const byteSize = (text) => {
      if (text.length > maxBytes) return maxBytes + 1;
      let size = 0;
      for (let i = 0; i < text.length && size <= maxBytes; i += 1) {
        const code = text.charCodeAt(i);
        if (code < 128) size += 1;
        else if (code < 2048) size += 2;
        else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) { size += 4; i += 1; }
        else size += 3;
      }
      return size;
    };
    const objectBytes = (value, pending, nodes) => {
      let size = 0;
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        if (pending.length + nodes > 20000) return maxBytes + 1;
        size += byteSize(key) + 3; pending.push(value[key]);
      }
      return size;
    };
    const bounded = (body) => {
      const pending = [body]; let nodes = 0; let size = 0;
      while (pending.length) {
        const value = pending.pop();
        if (++nodes > 20000) return false;
        if (typeof value === 'string') size += byteSize(value);
        else if (value && typeof value === 'object') size += objectBytes(value, pending, nodes);
        if (size > maxBytes) return false;
      }
      return true;
    };
    const requestFor = (resource, options) => {
      try {
        const isRequest = resource instanceof Request;
        const url = new URL(isRequest ? resource.url : String(resource), location.href);
        if ((options?.method ?? (isRequest ? resource.method : 'GET')).toUpperCase() !== 'GET' ||
            url.origin !== location.origin) return null;
        const match = /^\/api\/v1\/sessions\/([^/]+)\/agents\/main\/turns$/.exec(url.pathname);
        if (!match) return null;
        checkRoute();
        const session = decodeURIComponent(match[1]); const page = url.searchParams.has('before_ordinal');
        return { session, page, stamp: ++sequence, generation: generation + Number(!page && session !== route) };
      } catch { return null; }
    };
    const sameRequest = (request) => active && request.session === route && request.generation === generation
      && request.stamp >= active.reset;
    const readObserved = (body, request, method) => {
      checkRoute();
      if (!sameRequest(request) || (method === 'text' && byteSize(body) > maxBytes)) return;
      const envelope = method === 'text' ? JSON.parse(body) : body;
      if (envelope?.code === 0 && bounded(envelope.data)) readPage(active, envelope.data, request);
    };
    const observe = (body, request, method) => {
      if (method === 'text' && (typeof body !== 'string' || body.length > maxBytes)) return;
      setTimeout(() => { try { readObserved(body, request, method); } catch {} }, 0);
    };
    const wrapReader = (response, method, request) => {
      const native = response[method];
      if (typeof native !== 'function') return;
      response[method] = function conversationRead() {
        const result = native.apply(this, arguments);
        try { void result.then((body) => observe(body, request, method), () => {}); } catch {}
        return result;
      };
    };
    const nativeFetch = window.fetch;
    window.fetch = function conversationFetch(resource, options) {
      const request = requestFor(resource, options);
      const result = nativeFetch.apply(this, arguments);
      if (request) void result.then((response) => {
        if (!response.ok || wrapped.has(response) || Number(response.headers?.get('content-length')) > maxBytes) return;
        wrapped.add(response);
        for (const method of ['text', 'json']) { try { wrapReader(response, method, request); } catch {} }
      }, () => {});
      return result;
    };
    const receive = (event, socket) => {
      try {
        if (socket !== socketGeneration || typeof event.data !== 'string' || byteSize(event.data) > maxBytes) return;
        const header = event.data.slice(0, 512);
        if (!/"type"\s*:\s*"(?:turns|turns\.removed|turn\.started|turn\.ended|item\.started|item\.ended|item\.removed)"/
          .test(header)) return;
        checkRoute(); readFrame(JSON.parse(event.data));
      } catch {}
    };
    if (typeof window.WebSocket === 'function') {
      window.WebSocket = new Proxy(window.WebSocket, { construct(target, args, newTarget) {
        const socket = Reflect.construct(target, args, newTarget);
        try {
          const url = new URL(args[0], location.href);
          if (url.origin.replace(/^ws/, 'http') === location.origin && url.pathname === '/api/v1/ws') {
            const epoch = ++socketGeneration;
            socket.addEventListener('message', (event) => receive(event, epoch));
          }
        } catch {}
        return socket;
      } });
    }
    for (const method of ['pushState', 'replaceState']) {
      const native = history[method];
      history[method] = function conversationHistory() {
        const result = native.apply(this, arguments); try { checkRoute(); } catch {} return result;
      };
    }
    const items = () => {
      checkRoute(); if (!active) return [];
      active.ordered ??= [...active.entries.values()].sort((a, b) =>
        active.turns.get(a.turn).ordinal - active.turns.get(b.turn).ordinal || a.index - b.index);
      return active.ordered.map((entry) => ({ id: entry.id, label: active.labels.get(entry.id) ??
        (entry.attachmentOnly ? window.__okwLocale?.text('附件', 'Attachment') ?? 'Attachment' : entry.label) }));
    };
    window.__okwMobileTocMetadata = {
      session: () => { checkRoute(); return route; }, items,
      observe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      hasMore: () => { checkRoute(); return active?.hasMore ?? false; },
      time(id) {
        checkRoute(); const entry = active?.times.get(id);
        if (!entry) return undefined;
        const value = entry.role === 'user' ? entry.time : active.turns.get(entry.turn)?.ended;
        return value === undefined ? undefined : { role: entry.role, time: value };
      },
      label(id, value) {
        checkRoute(); const text = compact(value);
        if (!active || !validId(id) || !text || active.labels.get(id) === text) return;
        active.labels.set(id, text); trimMap(active.labels);
        if (active.entries.has(id)) notify();
      },
    };
    window.addEventListener('popstate', checkRoute); checkRoute();
  }
}
