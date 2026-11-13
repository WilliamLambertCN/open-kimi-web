{
  const installed = Symbol.for('open-kimi-web.request-metrics-conversation');
  if (!window[installed]) {
    window[installed] = true;
    const records = new Map();
    const listeners = new Set();
    const api = window.__okwUsageCreateApi?.();
    const metricsFor = window.__okwRequestMetricsModel.metricsFor;
    let timer;
    let busy = false;
    let visit = '';
    let generation = 0;
    const session = () => window.__okwRequestMetrics.session();
    const notify = () => { for (const listener of listeners) { try { listener(); } catch {} } };
    const check = () => {
      const next = session();
      if (next === visit) return;
      visit = next; generation += 1; records.clear();
    };
    const usageFor = (usage) => usage === undefined ? undefined : {
      inputOther: usage.input_other, inputCacheRead: usage.input_cache_read,
      inputCacheCreation: usage.input_cache_creation, output: usage.output,
    };
    const validIdentity = (value) => typeof value.turn === 'string' && /^t_[a-f0-9]{12}$/.test(value.turn) &&
      typeof value.item === 'string' && value.item.length <= 256 && Number.isSafeInteger(value.index) && value.index > 0;
    const metadata = (slot) => {
      try {
        const raw = slot.dataset.okwConversation;
        if (!raw || raw.length > 4096) return null;
        const value = JSON.parse(raw);
        const id = JSON.stringify([value.turn, value.index, value.item]);
        return value.session === visit && id === slot.dataset.okwStepId &&
          value.state === slot.dataset.okwStepState && ['completed', 'failed', 'interrupted'].includes(value.state) &&
          validIdentity(value)
          ? { ...value, id } : null;
      } catch { return null; }
    };
    const nativeMetrics = (value) => metricsFor({ usage: usageFor(value.usage), llmTiming: {
      llmFirstTokenLatencyMs: value.timing?.first_token_ms, llmStreamDurationMs: value.timing?.stream_ms,
    } });
    const keyFor = (agent, id) => JSON.stringify([agent, id]);
    const schedule = () => {
      if (!api || busy || timer) return;
      timer = setTimeout(() => { timer = null; void load(); }, 200);
    };
    const candidates = () => [...records.values()].filter((record) => !record.done && record.attempts < 64 &&
      [...record.slots].some((slot) => slot.isConnected && slot.dataset.okwConversation === record.raw));
    const load = async () => {
      check();
      const waiting = candidates();
      if (!waiting.length) return;
      busy = true;
      const batch = waiting.filter((record) => record.agent === waiting[0].agent).slice(0, 32);
      const current = generation;
      for (const record of batch) record.attempts += 1;
      try {
        const result = await api('/__open-kimi-mobile/request-metrics', { method: 'POST',
          signal: AbortSignal.timeout(5000), body: JSON.stringify({ session: visit, agent: batch[0].agent,
            requests: batch.map((record) => record.value) }) });
        check();
        if (current === generation) apply(result, batch);
      } catch {
        for (const record of batch) record.done = record.attempts >= 3;
      } finally { busy = false; notify(); schedule(); }
    };
    const apply = (result, batch) => {
      const items = Array.isArray(result?.items) ? result.items : [];
      for (const record of batch) {
        const found = items.filter((item) => item?.id === record.value.id);
        if (found.length === 1 && result.available === true) {
          const timing = metricsFor({ usage: usageFor(record.value.usage), llmTiming: found[0].llmTiming });
          record.metrics = { ...record.metrics, ttft: timing.ttft, stream: timing.stream,
            duration: timing.duration, tps: timing.tps };
          record.done = true;
        } else record.done = result?.reason === 'unmanaged_target' ||
          (result?.pending !== true && record.attempts >= 3);
      }
    };
    const request = (slot, agent) => {
      check();
      const value = metadata(slot);
      if (!value || !agent) return null;
      const key = keyFor(agent, value.id);
      let record = records.get(key);
      if (!record || record.raw !== slot.dataset.okwConversation) {
        const metrics = nativeMetrics(value);
        record = { agent, value, raw: slot.dataset.okwConversation, metrics, attempts: 0,
          done: metrics.ttft !== null && metrics.stream !== null, slots: new Set() };
        records.set(key, record);
        while (records.size > 2000) records.delete(records.keys().next().value);
      }
      for (const previous of record.slots) if (!previous.isConnected) record.slots.delete(previous);
      record.slots.add(slot);
      if (!record.done) schedule();
      return { id: value.id, state: value.state, ...record.metrics };
    };
    window.__okwConversationMetrics = { request,
      observe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    };
  }
}
