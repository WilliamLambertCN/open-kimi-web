{
  const installed = Symbol.for('open-kimi-web.mobile-toc-metadata');
  if (!window[installed]) {
    window[installed] = true;
    const listeners = new Set();
    const sessions = new Map();
    const limit = 2000;
    const maxBody = 2 * 1024 * 1024;
    let route;
    let active = null;
    let generation = 0;
    let sequence = 0;
    const validId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 512;
    const validSeq = (seq) => Number.isSafeInteger(seq) && seq >= 0;
    const validTurn = (turn) => turn?.kind === 'turn' && validId(turn.turnId) && Number.isSafeInteger(turn.ordinal);
    const validStep = (step) => validId(step?.stepId) && Number.isSafeInteger(step.ordinal);
    const invalidSeq = (seq) => seq !== undefined && !validSeq(seq);
    const oldSeq = (state, seq) => validSeq(seq) && state.seq !== null && seq < state.seq;
    const compact = (value) => typeof value === 'string'
      ? value.slice(0, 2048).replace(/\s+/g, ' ').trim().slice(0, 240) : '';
    const notify = () => {
      for (const listener of listeners) {
        try { listener(); } catch { /* Observers cannot interrupt native delivery. */ }
      }
    };
    const currentId = () => {
      try { return decodeURIComponent(location.pathname.match(/^\/sessions\/([^/?#]+)$/)?.[1] ?? ''); }
      catch { return ''; }
    };
    const empty = () => ({ turns: new Map(), steps: new Map(), entries: new Map(), labels: new Map(), removed: new Map(),
      latest: 0, reset: 0, moreStamp: 0, hasMore: false, seq: null, epoch: undefined, ordered: null });
    const checkRoute = () => {
      const next = currentId();
      if (next === route) return;
      route = next; generation += 1; active = null;
      if (next) {
        active = sessions.get(next) ?? empty();
        sessions.delete(next); sessions.set(next, active);
        if (sessions.size > 4) sessions.delete(sessions.keys().next().value);
      }
      notify();
    };
    const originFor = (origin) => {
      if (['cron', 'task', 'hook', 'compaction', 'side'].includes(origin?.kind)) return origin;
      return origin?.payload ?? origin;
    };
    const userOrigin = (origin) => origin?.kind === undefined || origin.kind === 'user' ||
      (['skill_activation', 'plugin_command'].includes(origin.kind) && origin.trigger === 'user-slash');
    const skillLabel = (origin) => {
      if (origin?.kind === 'skill_activation') return compact(`/${compact(origin.skillName)}`);
      if (origin?.kind === 'plugin_command') return compact(`/${compact(origin.pluginId)}:${compact(origin.commandName)}`);
      if (!Array.isArray(origin?.skillActivations)) return '';
      return compact(origin.skillActivations.slice(0, 16).map((item) => compact(item?.skillName))
        .filter(Boolean).map((name) => `/${name}`).join(' '));
    };
    const allowedOrigin = (origin) => origin?.taskId === undefined && userOrigin(originFor(origin));
    const entryFor = (id, text, rawOrigin, attachments) => {
      const origin = originFor(rawOrigin);
      if (!validId(id) || !allowedOrigin(rawOrigin) || origin?.taskId !== undefined) return null;
      const label = skillLabel(origin) || compact(text);
      if (label) return { id, label };
      return Array.isArray(attachments) && attachments.length ? { id, label: 'Attachment', attachmentOnly: true } : null;
    };
    const opening = (turn) => turn.taskId === undefined
      ? entryFor(`${turn.turnId}:input`, turn.prompt, turn.origin, turn.attachmentIds) : null;
    const frameEntry = (frame) => frame?.kind === 'text' && frame.role === 'user' && frame.taskId === undefined
      ? entryFor(frame.frameId, frame.text, frame.origin, frame.attachmentIds) : null;
    const dropEntries = (state, matches) => {
      let changed = false;
      for (const [id, entry] of state.entries) if (matches(entry)) {
        state.entries.delete(id); changed = true;
      }
      return changed;
    };
    const dropTurn = (state, id) => {
      if (!state.turns.delete(id)) return false;
      for (const [stepId, step] of state.steps) if (step.turnId === id) state.steps.delete(stepId);
      return dropEntries(state, (entry) => entry.turnId === id);
    };
    const trim = (state) => {
      let changed = false;
      while (state.turns.size > limit) changed = dropTurn(state, state.turns.keys().next().value) || changed;
      while (state.steps.size > limit) {
        const id = state.steps.keys().next().value;
        state.steps.delete(id); changed = dropEntries(state, (entry) => entry.stepId === id) || changed;
      }
      while (state.entries.size > limit) {
        state.entries.delete(state.entries.keys().next().value); changed = true;
      }
      for (const map of [state.labels, state.removed]) while (map.size > limit) map.delete(map.keys().next().value);
      return changed;
    };
    const writeEntry = (state, entry, position) => {
      const previous = state.entries.get(position.id);
      if (!entry) {
        if (!previous) return false;
        state.entries.delete(previous.id); state.labels.delete(previous.id); return true;
      }
      const next = { ...entry, ...position };
      state.entries.set(entry.id, next);
      return !previous || previous.label !== next.label || previous.attachmentOnly !== next.attachmentOnly ||
        previous.turnId !== next.turnId || previous.stepId !== next.stepId || previous.index !== next.index;
    };
    const stepMoved = (state, previous, step) => previous && previous.ordinal !== step.ordinal &&
      [...state.entries.values()].some((entry) => entry.stepId === step.stepId);
    const rememberStep = (state, turnId, step) => {
      if (!state.turns.has(turnId) || !validStep(step)) return false;
      const previous = state.steps.get(step.stepId);
      if (previous && previous.turnId !== turnId) return false;
      state.steps.set(step.stepId, { turnId, ordinal: step.ordinal, next: previous?.next ?? 0 });
      return stepMoved(state, previous, step);
    };
    const samePosition = (entry, turnId, stepId) => !entry || (entry.turnId === turnId && entry.stepId === stepId);
    const frameIndex = (index, previous, step) => index ?? previous?.index ?? step.next++;
    const rememberFrame = (state, turnId, stepId, frame, index) => {
      const step = state.steps.get(stepId);
      if (step?.turnId !== turnId || !validId(frame?.frameId)) return false;
      const previous = state.entries.get(frame.frameId);
      if (!samePosition(previous, turnId, stepId)) return false;
      const entry = frameEntry(frame);
      if (!entry && !previous) return false;
      const position = { id: frame.frameId, turnId, stepId, index: frameIndex(index, previous, step) };
      return writeEntry(state, entry, position);
    };
    const rememberTurn = (state, turn, stamp) => {
      if (!validTurn(turn)) return false;
      const previous = state.turns.get(turn.turnId);
      if (previous?.stamp > stamp) return false;
      state.turns.set(turn.turnId, { ordinal: turn.ordinal, stamp });
      const entry = opening(turn);
      const position = { id: `${turn.turnId}:input`, turnId: turn.turnId, stepId: null, index: -1 };
      return writeEntry(state, entry, position) || (previous && previous.ordinal !== turn.ordinal);
    };
    const oldTurn = (state, id, stamp) => state.turns.get(id)?.stamp > stamp || state.removed.get(id) > stamp;
    const readTurn = (state, turn, stamp) => {
      if (!validTurn(turn) || oldTurn(state, turn.turnId, stamp)) return;
      dropTurn(state, turn.turnId); rememberTurn(state, turn, stamp);
      for (const step of turn.steps ?? []) {
        rememberStep(state, turn.turnId, step);
        if (!Array.isArray(step?.frames)) continue;
        step.frames.forEach((frame, index) => rememberFrame(state, turn.turnId, step.stepId, frame, index));
        const stored = state.steps.get(step.stepId);
        if (stored) stored.next = step.frames.length;
      }
    };
    const rejectedSnapshot = (state, data, request) => {
      if (data?.agent_id !== 'main' || !Array.isArray(data.items) || request.stamp < state.reset) return true;
      if (invalidSeq(data.seq)) return true;
      return !request.page && (request.stamp < state.latest || oldSeq(state, data.seq));
    };
    const snapshot = (state, data, request) => {
      if (rejectedSnapshot(state, data, request)) return false;
      if (!request.page) {
        state.turns.clear(); state.steps.clear(); state.entries.clear(); state.removed.clear(); state.reset = request.stamp;
        state.seq = validSeq(data.seq) ? data.seq : null;
      }
      for (const turn of data.items) readTurn(state, turn, request.stamp);
      if (request.page !== 'after' && request.stamp >= state.moreStamp) {
        state.hasMore = data.has_more === true; state.moreStamp = request.stamp;
      }
      state.latest = Math.max(state.latest, request.stamp);
      return true;
    };
    const resetOp = (state, op, stamp) => {
      if (op.agentId !== 'main') return false;
      const seq = state.seq;
      const changed = snapshot(state,
        { ...op.snapshot, agent_id: 'main', has_more: op.snapshot?.hasMoreOlder }, { stamp });
      state.seq = seq;
      return changed;
    };
    const frameOp = (state, op, stamp) => {
      const changed = rememberFrame(state, op.turnId, op.stepId, op.frame);
      if (changed) state.turns.get(op.turnId).stamp = stamp;
      return changed;
    };
    const stepOp = (state, op, stamp) => {
      const changed = rememberStep(state, op.turnId, op.step);
      if (changed) state.turns.get(op.turnId).stamp = stamp;
      return changed;
    };
    const removeOp = (state, op, stamp) => {
      if (!Array.isArray(op.ids)) return false;
      let changed = false;
      for (const id of op.ids) {
        if (!validId(id)) continue;
        state.removed.set(id, stamp); changed = dropTurn(state, id) || changed;
      }
      state.latest = stamp;
      return changed;
    };
    const applyOp = (state, op, stamp) => {
      switch (op?.op) {
        case 'reset': return resetOp(state, op, stamp);
        case 'turn.upsert': return rememberTurn(state, op.turn, stamp);
        case 'step.upsert': return stepOp(state, op, stamp);
        case 'frame.upsert': return frameOp(state, op, stamp);
        case 'items.remove': return removeOp(state, op, stamp);
        default: return false;
      }
    };
    const duplicateSeq = (state, seq) => validSeq(seq) && state.seq !== null && seq <= state.seq;
    const applyOps = (state, ops, seq) => {
      if (!Array.isArray(ops) || invalidSeq(seq) || duplicateSeq(state, seq)) return false;
      const stamp = ++sequence;
      let changed = false;
      for (const op of ops) changed = applyOp(state, op, stamp) || changed;
      if (validSeq(seq)) state.seq = seq;
      if (changed) state.latest = stamp;
      return changed;
    };
    const finish = (state, changed) => {
      const trimmed = trim(state);
      if (!changed && !trimmed) return;
      state.ordered = null; notify();
    };
    const sameRequest = (request) => request.generation === generation && request.session === route;
    const readOps = (data) => {
      if (data?.agent_id !== 'main' || data.complete !== true || !Array.isArray(data.batches)) return;
      let changed = false;
      for (const batch of data.batches) {
        if (validSeq(batch?.seq)) changed = applyOps(active, batch.ops, batch.seq) || changed;
      }
      finish(active, changed);
    };
    const read = (body, request) => {
      if (body?.code !== undefined && body.code !== 0) return;
      if (request.ops) readOps(body?.data);
      else finish(active, snapshot(active, body?.data, request));
    };
    const requestParts = (resource, options) => {
      const isRequest = typeof Request === 'function' && resource instanceof Request;
      return { url: new URL(isRequest ? resource.url : String(resource), location.href),
        method: options?.method ?? (isRequest ? resource.method : 'GET') };
    };
    const requestPage = (url) => url.searchParams.has('before_turn') ? 'before'
      : url.searchParams.has('after_turn') ? 'after' : false;
    const targetGeneration = (session, page, ops) => generation + Number(!page && !ops && session !== route);
    const requestFor = (resource, options) => {
      try {
        const { url, method } = requestParts(resource, options);
        if (method.toUpperCase() !== 'GET' || url.origin !== location.origin || url.searchParams.get('agent_id') !== 'main') {
          return null;
        }
        const match = url.pathname.match(/^\/api\/v1\/sessions\/([^/]+)\/transcript(\/ops)?$/);
        if (!match || (url.searchParams.has('before_turn') && url.searchParams.has('after_turn'))) return null;
        checkRoute();
        const session = decodeURIComponent(match[1]);
        const page = requestPage(url);
        return { session, page, ops: !!match[2], stamp: ++sequence, generation: targetGeneration(session, page, match[2]) };
      } catch { return null; }
    };
    const stringBytes = (text) => {
      if (text.length > maxBody) return maxBody + 1;
      let size = 0;
      for (let i = 0; i < text.length && size <= maxBody; i += 1) {
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
        if (pending.length + nodes > 20000) return maxBody + 1;
        size += stringBytes(key) + 3; pending.push(value[key]);
      }
      return size;
    };
    const bounded = (body) => {
      const pending = [body];
      let size = 0; let nodes = 0;
      while (pending.length) {
        const value = pending.pop();
        if (++nodes > 20000) return false;
        if (typeof value === 'string') size += stringBytes(value);
        else if (value && typeof value === 'object') size += objectBytes(value, pending, nodes);
        if (size > maxBody) return false;
      }
      return true;
    };
    const queue = (value, request, method) => {
      if (method === 'text' && (typeof value !== 'string' || value.length > maxBody)) return;
      setTimeout(() => {
        try {
          checkRoute();
          if (!sameRequest(request) || !active || request.stamp < active.reset) return;
          if (method === 'text' && stringBytes(value) > maxBody) return;
          const body = method === 'text' ? JSON.parse(value) : value;
          if (bounded(body)) read(body, request);
        } catch { /* Malformed metadata cannot change native delivery. */ }
      }, 0);
    };
    const wrapReader = (response, method, request) => {
      const native = response[method];
      if (typeof native !== 'function') return;
      response[method] = function mobileTocRead() {
        const result = native.apply(this, arguments);
        try {
          void result.then((value) => {
            try { queue(value, request, method); } catch { /* Keep native delivery. */ }
          }, () => {});
        } catch { /* Keep native delivery. */ }
        return result;
      };
    };
    const wrapped = new WeakSet();
    const observeResponse = (response, request) => {
      try {
        if (!response.ok || wrapped.has(response) || Number(response.headers?.get('content-length')) > maxBody) return;
        wrapped.add(response);
        for (const method of ['json', 'text']) {
          try { wrapReader(response, method, request); } catch { /* Frozen readers remain native. */ }
        }
      } catch { /* Keep native delivery. */ }
    };
    const nativeFetch = window.fetch;
    window.fetch = function mobileTocFetch(resource, options) {
      const request = requestFor(resource, options);
      const result = nativeFetch.apply(this, arguments);
      try { if (request) void result.then((response) => observeResponse(response, request), () => {}); }
      catch { /* Keep native delivery. */ }
      return result;
    };
    const receiveReset = (frame) => {
      const payload = frame.payload;
      if (!bounded(payload) || invalidSeq(payload.seq)) return;
      const changedEpoch = frame.epoch !== undefined && frame.epoch !== active.epoch;
      if (!changedEpoch && oldSeq(active, payload.seq)) return;
      if (changedEpoch) active.seq = null;
      active.epoch = frame.epoch;
      finish(active, snapshot(active, { ...payload.snapshot, agent_id: 'main', seq: payload.seq,
        has_more: payload.has_more_older }, { stamp: ++sequence }));
    };
    const relevantFrame = (frame) => active && frame.session_id === route && frame.payload?.agent_id === 'main';
    const receive = (event) => {
      try {
        if (typeof event.data !== 'string' || stringBytes(event.data) > maxBody || !event.data.includes('"transcript.')) return;
        checkRoute();
        const frame = JSON.parse(event.data);
        if (!relevantFrame(frame)) return;
        if (frame.type === 'transcript.reset') receiveReset(frame);
        else if (frame.type === 'transcript.ops') finish(active, applyOps(active, frame.payload.ops, frame.payload.seq));
      } catch { /* Socket observers cannot change native event delivery. */ }
    };
    if (typeof window.WebSocket === 'function') {
      const Native = window.WebSocket;
      window.WebSocket = new Proxy(Native, { construct(target, args, newTarget) {
        const socket = Reflect.construct(target, args, newTarget);
        try {
          const url = new URL(args[0], location.href);
          if (url.origin.replace(/^ws/, 'http') === location.origin && url.pathname === '/api/v1/ws') {
            socket.addEventListener('message', receive);
          }
        } catch { /* Unrelated sockets remain native. */ }
        return socket;
      } });
    }
    for (const method of ['pushState', 'replaceState']) {
      const native = history[method];
      history[method] = function mobileTocHistory() {
        const result = native.apply(this, arguments);
        try { checkRoute(); } catch { /* Keep native navigation. */ }
        return result;
      };
    }
    const ordered = (state) => {
      state.ordered ??= [...state.entries.values()].sort((a, b) =>
        state.turns.get(a.turnId).ordinal - state.turns.get(b.turnId).ordinal ||
        (a.stepId === null ? -1 : state.steps.get(a.stepId).ordinal) -
        (b.stepId === null ? -1 : state.steps.get(b.stepId).ordinal) || a.index - b.index);
      return state.ordered.map((item) => {
        const fallback = item.attachmentOnly ? window.__okwLocale?.text('附件', 'Attachment') ?? 'Attachment' : item.label;
        return { id: item.id, label: state.labels.get(item.id) ?? fallback };
      });
    };
    window.addEventListener('popstate', checkRoute);
    window.__okwMobileTocMetadata = {
      session: () => { checkRoute(); return route; },
      observe(listener) {
        if (typeof listener === 'function') listeners.add(listener);
        return () => listeners.delete(listener);
      },
      items: () => { checkRoute(); return active ? ordered(active) : []; },
      hasMore: () => { checkRoute(); return active?.hasMore ?? false; },
      label(id, value) {
        checkRoute();
        const label = compact(value);
        if (!active || !validId(id) || !label || active.labels.get(id) === label) return;
        const previous = active.labels.get(id) ?? active.entries.get(id)?.label;
        active.labels.set(id, label); trim(active);
        if (active.entries.has(id) && previous !== label) notify();
      },
    };
    checkRoute();
  }
}
