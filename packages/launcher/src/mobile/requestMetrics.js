{
  const installed = Symbol.for('open-kimi-web.request-metrics');
  if (!window[installed]) {
    window[installed] = true;
    const api = window.__okwRequestMetrics;
    const chats = new Set();
    const enhanced = new Map();
    let pending = false;
    const words = () => window.__okwLocale?.current() === 'zh' ? {
      title: '模型请求统计', average: '平均 TPS', cache: '缓存命中',
      failed: '失败', interrupted: '已中断', missing: '未提供',
      note: 'TTFT：从本次请求构建到首段生成内容返回，流式思考也算首段。' +
        '平均 TPS：官方输出 token 数除以请求总耗时（TTFT＋后续流式耗时），不含工具执行或其它调用。' +
        '思考 token 不重复计数；缺少计时或总耗时不足 50 ms 时不估算。这不是模型纯解码速度。' +
        '缓存命中：从缓存读取的输入 token 占全部输入 token 的比例，新写入缓存不算命中；缺少用量时显示 —。',
    } : {
      title: 'Model request metrics', average: 'Avg TPS', cache: 'Cache hit',
      failed: 'Failed', interrupted: 'Interrupted', missing: 'Unavailable',
      note: 'TTFT: request build to first generated content, including streamed reasoning. ' +
        'Avg TPS: official output tokens divided by total request seconds (TTFT plus streaming). ' +
        'Tools and other calls are excluded. ' +
        'Reasoning tokens are not added again; no estimate for missing timing or totals under 50 ms. ' +
        'This is not model-only decoder speed. ' +
        'Cache hit: cached input tokens divided by all input tokens; new cache writes are not hits. Missing usage is shown as —.',
    };
    const agentFor = (chat) => {
      if (chat.closest('.sc')) return window.__okwSideChatModel?.identity(chat.closest('.sc'))?.agent ?? null;
      return chat.closest('.panes.chat-scroll') && !chat.closest('.pt-body') ? 'main' : null;
    };
    const labelFor = (request, copy) => {
      const ttft = request.ttft === null ? '—' : `${(request.ttft / 1000).toFixed(2)} s`;
      const tps = request.tps === null ? '—' : `${request.tps.toFixed(1)} tok/s`;
      const cache = request.cacheHitRate === null ? '—' : `${(request.cacheHitRate * 100).toFixed(2)}%`;
      const state = request.state === 'completed' ? '' : ` · ${copy[request.state] ?? copy.interrupted}`;
      return `TTFT ${ttft} · ${copy.average} ${tps} · ${copy.cache} ${cache}${state}`;
    };
    const render = (slot, request) => {
      let node = enhanced.get(slot);
      if (!node) {
        node = document.createElement('div'); node.className = 'okw-request-metrics';
        enhanced.set(slot, node);
      }
      const copy = words();
      const label = labelFor(request, copy);
      if (node.textContent !== label) node.textContent = label;
      if (node.title !== copy.note) node.title = copy.note;
      const missing = [request.ttft, request.tps, request.cacheHitRate].includes(null) ? ` · ${copy.missing}` : '';
      const accessible = `${copy.title} · ${label}${missing}`;
      if (node.getAttribute('aria-label') !== accessible) node.setAttribute('aria-label', accessible);
      if (node.parentElement !== slot) slot.append(node);
      if (!slot.hasAttribute('data-okw-metrics-ready')) slot.setAttribute('data-okw-metrics-ready', '');
    };
    const targetsFor = (chat, agent) => {
      const requests = new Map(api.items(agent).flatMap((group) => group.requests.map((request) => [request.id, request])));
      const slots = new Map();
      for (const slot of chat.querySelectorAll('.step-timing[data-okw-step-id]')) {
        const id = slot.dataset.okwStepId;
        slots.set(id, slots.has(id) ? null : slot);
      }
      const targets = new Map();
      for (const [id, slot] of slots) {
        const request = slot?.hasAttribute('data-okw-conversation')
          ? window.__okwConversationMetrics?.request(slot, agent) : requests.get(id);
        if (slot && request && slot.dataset.okwStepState === request.state) targets.set(slot, request);
      }
      return targets;
    };
    const refresh = () => {
      pending = false;
      const targets = new Map();
      for (const chat of chats) {
        if (!chat.isConnected) { chats.delete(chat); continue; }
        const agent = agentFor(chat);
        if (agent) for (const [slot, request] of targetsFor(chat, agent)) targets.set(slot, request);
      }
      for (const [slot, node] of enhanced) if (!slot.isConnected || !targets.has(slot)) {
        node.remove(); slot.removeAttribute('data-okw-metrics-ready'); enhanced.delete(slot);
      }
      for (const [slot, request] of targets) render(slot, request);
    };
    const schedule = () => { if (!pending) { pending = true; setTimeout(refresh, 0); } };
    const collect = (node) => {
      if (node.nodeType !== 1 || node.closest('.okw-request-metrics')) return false;
      if (node.matches('.chat')) chats.add(node);
      node.querySelectorAll('.chat').forEach((chat) => chats.add(chat));
      return node.matches('.chat, .step-timing, .sc, .pt-body') || !!node.querySelector('.chat, .step-timing');
    };
    const relevantMutation = (record) => {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (!target || target.closest('.okw-request-metrics')) return false;
      if (record.type === 'attributes') return target.matches('.step-timing, .ptb-tab, .sc');
      let dirty = false;
      for (const node of record.addedNodes) dirty = collect(node) || dirty;
      return dirty || (record.removedNodes.length > 0 && !!target.closest('.chat'));
    };
    const changed = (records) => {
      let dirty = false;
      for (const record of records) dirty = relevantMutation(record) || dirty;
      if (dirty) schedule();
    };
    const start = () => {
      collect(document.body); schedule();
      new MutationObserver(changed).observe(document.body, { childList: true, subtree: true,
        attributes: true, attributeFilter: ['data-okw-step-id', 'data-okw-step-state', 'data-okw-conversation', 'class'] });
      api.observe(schedule); window.__okwLocale?.observe(schedule);
      window.__okwConversationMetrics?.observe(schedule);
      window.addEventListener('okw-sidechat-identity', schedule);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
}
