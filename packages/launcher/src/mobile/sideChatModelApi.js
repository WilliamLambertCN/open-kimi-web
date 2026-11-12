{
  const installed = Symbol.for('open-kimi-web.sidechat-model-api');
  if (!window[installed]) {
    window[installed] = true;
    const identity = window.__okwSideChatIdentity;
    const choices = new Map();
    let models = [];
    const key = (session, agent) => JSON.stringify([session, agent]);
    const choice = (session, agent) => ({ model: '', effort: '', ...choices.get(key(session, agent)) });
    const load = async (signal) => {
      const data = await window.__okwMobileSubagentApi.load(signal);
      if (signal?.aborted) throw new Error('requestFailed');
      models = data.models;
      return models;
    };
    const efforts = (model) => window.__okwMobileSubagentApi.effortsFor(model);
    const select = (session, agent, value) => {
      if (!identity.has(session, agent)) throw new Error('identityLost');
      const model = models.find((item) => item.id === value.model);
      if (value.model && !model) throw new Error('modelMissing');
      if (value.effort && !efforts(model).includes(value.effort)) throw new Error('effortUnsupported');
      const id = key(session, agent);
      choices.delete(id);
      if (value.model) choices.set(id, { model: value.model, effort: value.effort || '' });
      while (choices.size > 64) choices.delete(choices.keys().next().value);
    };
    const thinking = (model, selected, inherited) => {
      const available = efforts(model);
      if (selected && available.includes(selected)) return selected;
      if (available.includes(inherited)) return inherited;
      return available.includes('on') ? 'on' : 'off';
    };
    const route = (resource, options) => {
      try {
        const request = resource instanceof Request;
        const url = new URL(request ? resource.url : String(resource), location.href);
        const match = /^\/api\/v1\/sessions\/([\w-]{1,200})\/prompts$/.exec(url.pathname);
        const method = options?.method ?? (request ? resource.method : 'GET');
        return url.origin === location.origin && method.toUpperCase() === 'POST' && match ? match[1] : null;
      } catch { return null; }
    };
    const patch = (session, raw, selection) => {
      let body;
      try { body = JSON.parse(raw); } catch { return null; }
      const selected = selection.get(key(session, body?.agent_id));
      if (!selected) return null;
      const model = models.find((item) => item.id === selected.model);
      if (!model) throw new Error('modelMissing');
      return JSON.stringify({ ...body, model: selected.model, thinking: thinking(model, selected.effort, body.thinking) });
    };
    const snapshot = (session) => new Map([...choices].filter(([id]) => {
      const [parent, agent] = JSON.parse(id);
      return parent === session && identity.has(parent, agent);
    }));
    const nativeFetch = window.fetch;
    const send = (context, args, session, raw, selection) => {
      const body = typeof raw === 'string' ? patch(session, raw, selection) : null;
      return nativeFetch.apply(context, body ? [args[0], { ...args[1], body }] : args);
    };
    window.fetch = function sideChatModelFetch(resource, options) {
      const session = route(resource, options);
      if (!session || !choices.size) return nativeFetch.apply(this, arguments);
      const selection = snapshot(session);
      if (!selection.size) return nativeFetch.apply(this, arguments);
      const args = arguments;
      if (options?.body === undefined && resource instanceof Request) {
        return resource.clone().text().then((raw) => send(this, args, session, raw, selection));
      }
      try { return send(this, args, session, options?.body, selection); }
      catch (error) { return Promise.reject(error); }
    };
    window.__okwSideChatModelApi = { load, select, choice, efforts, thinking, models: () => models };
  }
}
