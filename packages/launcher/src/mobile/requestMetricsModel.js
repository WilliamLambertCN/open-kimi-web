{
  const installed = Symbol.for('open-kimi-web.request-metrics-model');
  if (!window[installed]) {
    window[installed] = true;
    const limit = 2000;
    const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512;
    const validSeq = (value) => Number.isSafeInteger(value) && value >= 0;
    const number = (value) => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null;
    const terminal = (state) => ['completed', 'failed', 'interrupted'].includes(state);
    const tokens = (value) => Number.isSafeInteger(value) ? number(value) : null;
    const rate = (output, duration) => duration !== null && duration >= 50 && output > 0 ? output * 1000 / duration : null;
    const cacheRate = (usage) => {
      const values = [usage?.inputOther, usage?.inputCacheRead, usage?.inputCacheCreation].map(tokens);
      if (values.includes(null)) return null;
      const total = values.reduce((sum, value) => sum + value, 0);
      return Number.isSafeInteger(total) && total > 0 ? values[1] / total : null;
    };
    const metricsFor = (step) => {
      const ttft = number(step?.llmTiming?.llmFirstTokenLatencyMs);
      const stream = number(step?.llmTiming?.llmStreamDurationMs);
      const duration = ttft !== null && stream !== null ? number(ttft + stream) : null;
      const output = tokens(step?.usage?.output);
      return { ttft, stream, duration, output, tps: rate(output, duration), cacheHitRate: cacheRate(step?.usage) };
    };
    const empty = () => ({ turns: new Map(), steps: new Map(), removed: new Map(),
      latest: 0, reset: 0, seq: null, epoch: undefined, cached: null });
    const dropTurn = (state, id) => {
      state.turns.delete(id);
      for (const [key, step] of state.steps) if (step.turnId === id) state.steps.delete(key);
    };
    const trim = (state) => {
      while (state.turns.size > limit) dropTurn(state, state.turns.keys().next().value);
      while (state.steps.size > limit) state.steps.delete(state.steps.keys().next().value);
      while (state.removed.size > limit) state.removed.delete(state.removed.keys().next().value);
    };
    const headerTurn = (state, raw, stamp) => {
      if (!validId(raw?.turnId) || !Number.isSafeInteger(raw.ordinal)) return false;
      const previous = state.turns.get(raw.turnId);
      if (previous?.stamp > stamp || state.removed.get(raw.turnId) > stamp) return false;
      state.turns.set(raw.turnId, { id: raw.turnId, ordinal: raw.ordinal, stamp });
      return true;
    };
    const incompatibleStep = (previous, turnId, stamp) => previous &&
      (previous.turnId !== turnId || previous.stamp > stamp);
    const headerStep = (state, turnId, raw, stamp) => {
      if (!validId(turnId) || !validId(raw?.stepId) || !Number.isSafeInteger(raw.ordinal)) return false;
      const previous = state.steps.get(raw.stepId);
      if (incompatibleStep(previous, turnId, stamp) || state.removed.get(turnId) > stamp) return false;
      if (!state.turns.has(turnId)) state.turns.set(turnId, { id: turnId, ordinal: 0, stamp });
      state.steps.set(raw.stepId, { id: raw.stepId, turnId, ordinal: raw.ordinal, state: raw.state,
        ...metricsFor(raw), stamp });
      state.turns.get(turnId).stamp = stamp;
      return true;
    };
    const readTurn = (state, raw, stamp) => {
      if (raw?.kind !== 'turn' || !headerTurn(state, raw, stamp)) return;
      dropTurn(state, raw.turnId); headerTurn(state, raw, stamp);
      for (const step of Array.isArray(raw.steps) ? raw.steps : []) headerStep(state, raw.turnId, step, stamp);
    };
    const invalidSeq = (seq) => seq !== undefined && !validSeq(seq);
    const stale = (state, seq) => validSeq(seq) && state.seq !== null && seq < state.seq;
    const rejectedSnapshot = (state, data, request) => {
      if (!Array.isArray(data?.items) || invalidSeq(data.seq) || request.stamp < state.reset) return true;
      return !request.page && (request.stamp < state.latest || stale(state, data.seq));
    };
    const snapshot = (state, data, request) => {
      if (rejectedSnapshot(state, data, request)) return false;
      if (!request.page) {
        state.turns.clear(); state.steps.clear(); state.removed.clear();
        state.reset = request.stamp; state.seq = validSeq(data.seq) ? data.seq : null;
      }
      for (const raw of data.items) readTurn(state, raw, request.stamp);
      state.latest = Math.max(state.latest, request.stamp);
      return true;
    };
    const remove = (state, ids, stamp) => {
      if (!Array.isArray(ids)) return false;
      for (const id of ids) if (validId(id)) { dropTurn(state, id); state.removed.set(id, stamp); }
      return true;
    };
    const resetOperation = (state, op, context, agent) => {
      if (op.agentId !== agent) return false;
      const seq = state.seq;
      const changed = snapshot(state, op.snapshot, context);
      state.seq = seq;
      return changed;
    };
    const operation = (state, op, context, agent) => {
      switch (op?.op) {
        case 'reset': return resetOperation(state, op, context, agent);
        case 'turn.upsert': return headerTurn(state, op.turn, context.stamp);
        case 'step.upsert': return headerStep(state, op.turnId, op.step, context.stamp);
        case 'items.remove': return remove(state, op.ids, context.stamp);
        default: return false;
      }
    };
    const groupsForTurn = (turn, steps) => steps.sort((a, b) => a.ordinal - b.ordinal)
      .filter((step) => terminal(step.state)).map((step) => {
        const { id, state, ttft, tps, stream, duration, output, cacheHitRate } = step;
        return { turnId: turn.id, requests: [{ id, state, ttft, tps, stream, duration, output, cacheHitRate }] };
      });
    const groups = (state) => {
      if (state.cached) return state.cached;
      const steps = new Map();
      for (const step of state.steps.values()) {
        if (!steps.has(step.turnId)) steps.set(step.turnId, []);
        steps.get(step.turnId).push(step);
      }
      state.cached = [...state.turns.values()].sort((a, b) => a.ordinal - b.ordinal)
        .flatMap((turn) => groupsForTurn(turn, steps.get(turn.id) ?? []));
      return state.cached;
    };
    const create = () => {
      const sessions = new Map();
      const get = (session, agent) => {
        if (!validId(session) || !validId(agent)) return null;
        let agents = sessions.get(session);
        if (!agents) { agents = new Map(); sessions.set(session, agents); }
        sessions.delete(session); sessions.set(session, agents);
        while (sessions.size > 4) sessions.delete(sessions.keys().next().value);
        if (!agents.has(agent)) {
          if (agents.size >= 16) return null;
          agents.set(agent, empty());
        }
        return agents.get(agent);
      };
      const update = (session, agent, callback) => {
        const state = get(session, agent);
        if (!state || !callback(state)) return false;
        trim(state); state.cached = null; return true;
      };
      const read = (session, agent, data, request) => update(session, agent, (state) =>
        data?.agent_id === agent && snapshot(state, data, request));
      const reset = (session, agent, payload, epoch, stamp) => update(session, agent, (state) => {
        if (payload?.agent_id !== agent || invalidSeq(payload.seq)) return false;
        if (epoch === state.epoch && stale(state, payload.seq)) return false;
        if (epoch !== state.epoch) state.seq = null;
        state.epoch = epoch;
        return snapshot(state, { ...payload.snapshot, seq: payload.seq }, { stamp });
      });
      const apply = (session, agent, ops, context) => update(session, agent, (state) => {
        if (!Array.isArray(ops) || invalidSeq(context.seq) || context.stamp < state.reset) return false;
        if (validSeq(context.seq) && state.seq !== null && context.seq <= state.seq) return false;
        let changed = false;
        for (const op of ops) changed = operation(state, op, context, agent) || changed;
        if (validSeq(context.seq)) state.seq = context.seq;
        state.latest = Math.max(state.latest, context.stamp);
        return changed;
      });
      return { read, reset, apply,
        items(session, agent) {
          const state = sessions.get(session)?.get(agent);
          return state ? groups(state).map((group) => ({ ...group,
            requests: group.requests.map((request) => ({ ...request })) })) : [];
        },
      };
    };
    window.__okwRequestMetricsModel = { create, metricsFor };
  }
}
