{
  const installed = Symbol.for('open-kimi-web.message-timestamps');
  if (!window[installed]) {
    window[installed] = true;
    const anchorSelector = '.u-bub[data-turn-id], .a-msg[data-turn-id]';
    const chats = new Map();
    const agents = new Map();
    const enhanced = new WeakMap();
    const wrapped = new WeakSet();
    let route;
    let generation = 0;
    let sequence = 0;
    let scheduled = false;
    const sessionId = () => {
      const match = location.pathname.match(/^\/sessions\/([^/?#]+)/);
      try { return match ? decodeURIComponent(match[1]) : null; } catch { return null; }
    };
    const panelId = () => document.querySelector('.panel-tab-bar .ptb-tab.on')?.dataset.panelTabId ?? null;
    const timestamp = (value) => {
      if (typeof value !== 'string' || !value.trim()) return undefined;
      const time = Date.parse(value);
      return Number.isFinite(time) ? time : undefined;
    };
    const earliest = (values) => {
      const times = values.map(timestamp).filter((time) => time !== undefined);
      return times.length ? Math.min(...times) : undefined;
    };
    const pad = (value) => String(value).padStart(2, '0');
    const fullDate = (time) => {
      const date = new Date(time);
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
        + `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };
    const compactDate = (time) => {
      const date = new Date(time);
      const now = new Date();
      const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
      if (date.toDateString() === now.toDateString()) return clock;
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      if (date.toDateString() === yesterday.toDateString()) {
        const chinese = (document.documentElement.lang || navigator.language).toLowerCase().startsWith('zh');
        return `${chinese ? '昨天' : 'Yesterday'} ${clock}`;
      }
      const day = `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock}`;
      return date.getFullYear() === now.getFullYear() ? day : `${date.getFullYear()}-${day}`;
    };
    const restore = (node) => {
      const entry = enhanced.get(node);
      if (!entry) return;
      enhanced.delete(node);
      if (entry.inserted) { node.remove(); return; }
      if (node.textContent === entry.full) node.textContent = entry.compact;
      node.classList.remove('okw-message-time');
      for (const [name, value] of entry.attributes) {
        if (value === null) node.removeAttribute(name);
        else node.setAttribute(name, value);
      }
    };
    const clearChat = (state) => {
      for (const anchor of state.anchors) {
        const owner = anchor.closest('.u-turn') ?? anchor;
        owner.querySelectorAll('.okw-message-time').forEach(restore);
        owner.querySelectorAll('.okw-message-meta:empty').forEach((node) => node.remove());
      }
      state.dirty.clear();
    };
    const checkRoute = () => {
      const current = sessionId();
      if (route === current) return;
      route = current;
      generation += 1;
      agents.clear();
      for (const state of chats.values()) clearChat(state);
    };
    const write = (map, id, role, time, stamp) => {
      if (typeof id !== 'string' || !id || time === undefined) return;
      const previous = map.get(id);
      if (previous && previous.stamp > stamp) return;
      map.set(id, { role, time, stamp });
      if (map.size > 2000) map.delete(map.keys().next().value);
    };
    const promptTime = (ids, prompts) => (ids ?? []).map((id) => prompts.get(id)).find((time) => time !== undefined);
    const textMessage = (frame, created, prompts) => {
      if (!frame.text?.length && !frame.attachmentIds?.length) return null;
      if (frame.role !== 'user') return { id: frame.frameId, role: 'assistant' };
      if (frame.taskId !== undefined) return null;
      return { id: frame.frameId, role: 'user', created: promptTime(frame.promptIds, prompts) ?? created };
    };
    const frameMessage = (frame, created, prompts) => {
      if (!frame || typeof frame.frameId !== 'string') return null;
      if (frame.kind === 'tool') return { id: `${frame.frameId}:call`, role: 'assistant' };
      if (frame.kind === 'thinking') return frame.text?.length ? { id: frame.frameId, role: 'assistant' } : null;
      return frame.kind === 'text' ? textMessage(frame, created, prompts) : null;
    };
    const clearValue = (map, id, stamp) => {
      if ((map.get(id)?.stamp ?? 0) <= stamp) map.delete(id);
    };
    const stepTimes = (step, context) => {
      const { map, stamp, prompts, start } = context;
      for (const frame of step.frames ?? []) {
        const message = frameMessage(frame, timestamp(step.startedAt) ?? start, prompts);
        if (!message) continue;
        if (message.role === 'user') {
          context.segment = undefined;
          write(map, message.id, 'user', message.created, stamp);
        } else if (!context.segment) {
          context.segment = message.id;
          clearValue(map, message.id, stamp);
        }
      }
    };
    const turnTimes = (turn, prompts, map, stamp) => {
      if (!Array.isArray(turn.steps) || typeof turn.turnId !== 'string') return;
      const start = earliest([turn.startedAt, ...turn.steps.map((step) => step.startedAt)]);
      write(map, `${turn.turnId}:input`, 'user', prompts.get(turn.triggerPromptId) ?? start, stamp);
      const context = { map, stamp, prompts, start, segment: undefined };
      for (const step of turn.steps) stepTimes(step, context);
      if (!['completed', 'failed', 'cancelled'].includes(turn.state)) return;
      const ended = timestamp(turn.endedAt) ?? timestamp(turn.steps.at(-1)?.endedAt);
      write(map, context.segment, 'assistant', ended, stamp);
    };
    const promptTimes = (data) => {
      const prompts = new Map();
      for (const prompt of data.prompts ?? []) {
        const time = timestamp(prompt.createdAt);
        if (typeof prompt.promptId === 'string' && time !== undefined) prompts.set(prompt.promptId, time);
      }
      return prompts;
    };
    const cacheFor = (request) => {
      let agent = agents.get(request.agent);
      if (!agent) {
        if (agents.size >= 16) return undefined;
        agent = { times: new Map(), stamp: 0, panel: request.panel };
        agents.set(request.agent, agent);
      }
      if (!request.page && request.stamp < agent.stamp) return undefined;
      if (!request.page) agent.times.clear();
      agent.stamp = Math.max(agent.stamp, request.stamp);
      agent.panel = request.panel;
      return agent;
    };
    const currentRequest = (request) => request.generation === generation && request.session === route
      && (request.agent === 'main' || request.panel === panelId());
    const readSnapshot = (body, request) => {
      checkRoute();
      if (!currentRequest(request)) return;
      const data = body?.data;
      if (!Array.isArray(data?.items) || data.agent_id !== request.agent) return;
      const agent = cacheFor(request);
      if (!agent) return;
      const prompts = promptTimes(data);
      for (const turn of data.items) {
        if (turn.kind === 'turn') turnTimes(turn, prompts, agent.times, request.stamp);
      }
      for (const state of chats.values()) state.anchors.forEach((anchor) => state.dirty.add(anchor));
      schedule();
    };
    const fetchUrl = (resource) => new URL(resource instanceof Request ? resource.url : String(resource), location.href);
    const fetchMethod = (resource, options) => (options?.method
      ?? (resource instanceof Request ? resource.method : 'GET')).toUpperCase();
    const requestInfo = (resource, options) => {
      try {
        const url = fetchUrl(resource);
        const match = url.pathname.match(/^\/api\/v1\/sessions\/([^/]+)\/transcript$/);
        if (url.origin !== location.origin || fetchMethod(resource, options) !== 'GET' || !match) return null;
        const agent = url.searchParams.get('agent_id');
        if (!agent) return null;
        checkRoute();
        const session = decodeURIComponent(match[1]);
        const page = url.searchParams.has('before_turn') || url.searchParams.has('after_turn');
        const nextRoute = agent === 'main' && !page && session !== route;
        return { session, agent, generation: generation + Number(nextRoute), stamp: ++sequence, panel: panelId(), page };
      } catch { return null; }
    };
    const observeSnapshot = (body, request) => {
      try { readSnapshot(body, request); } catch { /* Malformed metadata cannot change official delivery. */ }
    };
    const maxTextCharacters = 1024 * 1024;
    const observeText = (text, request) => {
      checkRoute();
      if (!currentRequest(request)) return;
      if (!request.page && request.stamp < (agents.get(request.agent)?.stamp ?? 0)) return;
      try { observeSnapshot(JSON.parse(text), request); } catch { /* Official parsing retains its own failure behavior. */ }
    };
    const queueText = (text, request) => {
      if (request.agent !== 'main' || typeof text !== 'string' || !text.length || text.length > maxTextCharacters) return;
      setTimeout(() => observeText(text, request), 0);
    };
    const wrapReader = (response, method, request) => {
      const native = response[method];
      response[method] = function messageTimeRead() {
        const result = native.apply(this, arguments);
        void result.then((value) => {
          if (method === 'text') queueText(value, request);
          else setTimeout(() => observeSnapshot(value, request), 0);
        }, () => {});
        return result;
      };
    };
    const nativeFetch = window.fetch;
    window.fetch = function messageTimeFetch(resource, options) {
      const request = requestInfo(resource, options);
      const result = nativeFetch.apply(this, arguments);
      if (!request) return result;
      return result.then((response) => {
        if (!response.ok || wrapped.has(response)) return response;
        wrapped.add(response);
        try {
          wrapReader(response, 'text', request);
          wrapReader(response, 'json', request);
        } catch { /* A non-extensible response remains entirely official. */ }
        return response;
      });
    };
    const agentFor = (state) => {
      if (state.root.closest('.panes.chat-scroll') && !state.root.closest('.sc, .pt-body')) return agents.get('main');
      return undefined;
    };
    const enhance = (node, time, inserted) => {
      const full = fullDate(time);
      let entry = enhanced.get(node);
      if (entry && entry.time === time && (node.textContent === entry.compact || node.textContent === entry.full)) return;
      if (entry) {
        const oldText = node.textContent;
        restore(node);
        if (inserted) node.textContent = compactDate(time);
        else if (oldText !== entry.full) node.textContent = oldText;
      }
      const attributes = ['title', 'role', 'tabindex', 'aria-label', 'aria-pressed']
        .map((name) => [name, node.getAttribute(name)]);
      entry = { time, full, compact: node.textContent, inserted, attributes };
      enhanced.set(node, entry);
      node.classList.add('okw-message-time');
      node.title = full;
      node.setAttribute('role', 'button');
      node.setAttribute('tabindex', '0');
      node.setAttribute('aria-label', full);
      node.setAttribute('aria-pressed', 'false');
    };
    const metadataFor = (anchor, user) => {
      const owner = user ? anchor.closest('.u-turn') : anchor;
      if (!owner) return null;
      const meta = owner.querySelector(user ? ':scope > .u-meta' : ':scope > .a-msg-ft');
      if (meta || !user) return meta;
      const added = document.createElement('div');
      added.className = 'u-meta okw-message-meta';
      anchor.after(added);
      return added;
    };
    const timeNode = (anchor, role, time) => {
      const user = role === 'user';
      const meta = metadataFor(anchor, user);
      if (!meta) return;
      let node = meta.querySelector(user ? '.msg-time' : '.a-time');
      if (!node) {
        node = document.createElement('span');
        node.className = `${user ? 'msg-time' : 'a-time'} okw-message-time-added`;
        node.textContent = compactDate(time);
        enhance(node, time, true);
        meta.prepend(node);
      } else {
        const inserted = enhanced.get(node)?.inserted ?? false;
        enhance(node, time, inserted);
        if (inserted && !node.isConnected) meta.prepend(node);
      }
    };
    const process = (state, anchor, agent) => {
      if (!anchor.isConnected || anchor.closest('.chat') !== state.root) {
        state.anchors.delete(anchor);
        return;
      }
      const role = anchor.matches('.u-bub') ? 'user' : 'assistant';
      const value = agent?.times.get(anchor.dataset.turnId);
      const owner = role === 'user' ? anchor.closest('.u-turn') : anchor;
      if (!value || value.role !== role) {
        owner?.querySelectorAll('.okw-message-time').forEach(restore);
        return;
      }
      timeNode(anchor, role, value.time);
    };
    function schedule() {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        checkRoute();
        for (const [root, state] of chats) {
          if (!root.isConnected) { state.observer.disconnect(); chats.delete(root); continue; }
          if (state.root.closest('.sc-body') && state.panel !== panelId()) {
            clearChat(state);
            state.panel = panelId();
          }
          const agent = agentFor(state);
          for (const anchor of state.dirty) process(state, anchor, agent);
          state.dirty.clear();
        }
      }, 0);
    }
    const addAnchor = (state, anchor) => { state.anchors.add(anchor); state.dirty.add(anchor); };
    const metadataAnchor = (target) => {
      if (target.closest('.u-meta')) return target.closest('.u-turn')?.querySelector(':scope > .u-bub[data-turn-id]');
      if (target.closest('.a-msg-ft')) return target.closest('.a-msg[data-turn-id]');
      return null;
    };
    const addedNode = (state, node, insideAnchor) => {
      if (!(node instanceof Element)) return;
      if (node.matches('.u-meta, .a-msg-ft')) {
        const anchor = metadataAnchor(node);
        if (anchor) state.dirty.add(anchor);
      }
      if (insideAnchor) return;
      if (node.matches(anchorSelector)) addAnchor(state, node);
      node.querySelectorAll(anchorSelector).forEach((anchor) => addAnchor(state, anchor));
    };
    const pruneAnchors = (state) => {
      for (const anchor of state.anchors) {
        if (!anchor.isConnected || anchor.closest('.chat') !== state.root) {
          state.anchors.delete(anchor);
          state.dirty.delete(anchor);
        }
      }
    };
    const childChanges = (state, record) => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      const meta = target && metadataAnchor(target);
      if (meta) state.dirty.add(meta);
      const inside = target?.closest(anchorSelector);
      if (!inside && record.removedNodes.length) pruneAnchors(state);
      for (const node of record.addedNodes) addedNode(state, node, inside);
    };
    const changed = (state, records) => {
      for (const record of records) {
        if (record.type === 'attributes') addAnchor(state, record.target);
        else childChanges(state, record);
      }
      if (state.dirty.size) schedule();
    };
    const discover = (node) => {
      if (!(node instanceof Element)) return;
      const roots = node.matches('.chat') ? [node] : node.querySelectorAll('.chat');
      for (const root of roots) {
        if (chats.has(root)) continue;
        const state = { root, anchors: new Set(), dirty: new Set(), panel: panelId() };
        state.observer = new MutationObserver((records) => changed(state, records));
        state.observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-turn-id'] });
        root.querySelectorAll(anchorSelector).forEach((anchor) => addAnchor(state, anchor));
        chats.set(root, state);
      }
      schedule();
    };
    const toggle = (event) => {
      const node = event.target.closest?.('.okw-message-time');
      const entry = node && enhanced.get(node);
      if (!entry || event.defaultPrevented) return;
      if (event.type === 'keydown') {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
      }
      const expanded = node.getAttribute('aria-pressed') !== 'true';
      node.textContent = expanded ? entry.full : entry.compact;
      node.setAttribute('aria-pressed', String(expanded));
    };
    document.addEventListener('click', toggle);
    document.addEventListener('keydown', toggle);
    for (const method of ['pushState', 'replaceState']) {
      const native = history[method];
      history[method] = function messageTimeHistory() {
        const result = native.apply(this, arguments);
        checkRoute();
        return result;
      };
    }
    window.addEventListener('popstate', checkRoute);
    checkRoute();
    const cleanChats = () => {
      for (const [root, state] of chats) {
        if (!root.isConnected) { state.observer.disconnect(); chats.delete(root); }
      }
    };
    const start = () => {
      discover(document.body);
      new MutationObserver((records) => {
        checkRoute();
        for (const record of records) {
          const target = record.target instanceof Element ? record.target : record.target.parentElement;
          if (target?.closest('.chat')) continue;
          if (record.removedNodes.length) cleanChats();
          record.addedNodes.forEach(discover);
        }
      }).observe(document.body, { childList: true, subtree: true });
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }
}
