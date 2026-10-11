{
  const installed = Symbol.for('open-kimi-web.mobile-subagent-api');
  if (!window[installed]) {
    window[installed] = true;
    const state = { authorization: '' };
    const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
    const inherited = (section) => !section?.defaultModel && !section?.model && section?.models === undefined;
    const remember = (authorization) => {
      if (/^Bearer\s+\S+$/i.test(authorization ?? '')) state.authorization = authorization;
    };
    const apiUrl = (resource) => {
      try {
        const url = new URL(resource instanceof Request ? resource.url : String(resource), location.href);
        return url.origin === location.origin && url.pathname.startsWith('/api/');
      } catch { return false; }
    };
    const nativeFetch = window.fetch;
    window.fetch = function subagentAuthFetch(resource, options) {
      try {
        if (apiUrl(resource)) {
          const headers = new Headers(resource instanceof Request ? resource.headers : undefined);
          new Headers(options?.headers).forEach((value, key) => headers.set(key, value));
          remember(headers.get('authorization'));
        }
      } catch {}
      return nativeFetch.apply(this, arguments);
    };
    const xhr = window.XMLHttpRequest?.prototype;
    if (xhr) {
      const requests = new WeakMap();
      const open = xhr.open;
      const setHeader = xhr.setRequestHeader;
      xhr.open = function subagentAuthOpen(method, url) {
        requests.set(this, apiUrl(url));
        return open.apply(this, arguments);
      };
      xhr.setRequestHeader = function subagentAuthHeader(name, value) {
        if (requests.get(this) && String(name).toLowerCase() === 'authorization') remember(value);
        return setHeader.apply(this, arguments);
      };
    }

    const responseData = async (response) => {
      if (response.redirected || (response.url && !apiUrl(response.url))) throw new Error('invalidResponse');
      if ([401, 403].includes(response.status)) throw new Error('authExpired');
      let envelope;
      try { envelope = await response.json(); } catch { throw new Error('invalidResponse'); }
      if (!response.ok || envelope?.code !== 0) throw new Error('requestFailed');
      if (!object(envelope.data)) throw new Error('invalidResponse');
      return envelope.data;
    };
    const request = async (path, options = {}) => {
      if (!state.authorization) throw new Error('authPending');
      let response;
      try {
        response = await window.fetch(`/api/v1/${path}`, {
          ...options, credentials: 'same-origin', redirect: 'error',
          headers: { authorization: state.authorization, 'content-type': 'application/json' },
        });
      } catch { throw new Error('requestFailed'); }
      return responseData(response);
    };
    const modelInfo = (id, raw) => ({
      id, label: typeof raw.displayName === 'string' ? raw.displayName : id,
      provider: typeof raw.provider === 'string' ? raw.provider : '',
      modelId: typeof raw.model === 'string' ? raw.model : id,
      capabilities: Array.isArray(raw.capabilities) ? raw.capabilities : [],
      supportEfforts: Array.isArray(raw.supportEfforts) ? raw.supportEfforts : [],
      adaptiveThinking: raw.adaptiveThinking === true,
      alwaysThinking: raw.alwaysThinking === true,
    });
    const catalogModel = (raw, previous) => {
      const model = previous ?? modelInfo(raw.model, {});
      return {
        ...model, label: raw.display_name ?? model.label,
        provider: typeof raw.provider === 'string' ? raw.provider : model.provider,
        capabilities: raw.capabilities ?? model.capabilities,
        supportEfforts: raw.support_efforts ?? model.supportEfforts,
      };
    };
    const modelsFor = (config, catalog) => {
      const models = new Map();
      for (const [id, raw] of Object.entries(config.models ?? {})) {
        if (id !== 'primary' && object(raw)) models.set(id, modelInfo(id, raw));
      }
      for (const raw of catalog.items ?? []) {
        if (!object(raw) || typeof raw.model !== 'string' || raw.model === 'primary') continue;
        models.set(raw.model, catalogModel(raw, models.get(raw.model)));
      }
      return [...models.values()].sort((a, b) => a.label.localeCompare(b.label));
    };
    const effortsFor = (model) => {
      if (!model) return [];
      const always = model.alwaysThinking || model.capabilities.includes('always_thinking');
      const thinking = always || model.adaptiveThinking || model.capabilities.includes('thinking');
      const efforts = model.supportEfforts.filter((value) => typeof value === 'string' && value.length > 0);
      if (thinking && efforts.length) return [...new Set(always ? ['on', ...efforts] : ['off', 'on', ...efforts])];
      return always ? ['on'] : thinking ? ['on', 'off'] : ['off'];
    };
    const supportedEffort = (model, effort) => {
      if (!model) return false;
      if (effort === 'off') return !model.alwaysThinking && !model.capabilities.includes('always_thinking');
      const thinking = model.alwaysThinking || model.adaptiveThinking ||
        model.capabilities.includes('thinking') || model.capabilities.includes('always_thinking');
      return thinking && (!model.supportEfforts.length || effort === 'on' || model.supportEfforts.includes(effort));
    };
    const availableEfforts = (section, id, models) => {
      const ids = [...new Set([id, ...Object.keys(section?.models ?? {})])];
      return effortsFor(models.find((model) => model.id === id)).filter((effort) =>
        ids.every((alias) => supportedEffort(models.find((model) => model.id === alias), effort)));
    };
    const choiceFor = (section) => ({
      model: section?.defaultModel ?? section?.model ?? '', effort: section?.defaultEffort ?? '',
    });
    const validateChoice = (section, choice, models) => {
      if (!models.some((model) => model.id === choice.model)) throw new Error('modelMissing');
      if (choice.effort && !availableEfforts(section, choice.model, models).includes(choice.effort)) {
        throw new Error('effortUnsupported');
      }
    };
    const patchFor = (section, choice, models) => {
      if (!choice.model) {
        if (!inherited(section)) throw new Error('cannotFollow');
        return null;
      }
      validateChoice(section, choice, models);
      const current = choiceFor(section);
      if (current.model === choice.model && current.effort === choice.effort) return null;
      const patch = { defaultModel: choice.model, defaultEffort: choice.effort };
      if (section?.models !== undefined && !Object.hasOwn(section.models, choice.model)) {
        patch.models = { ...section.models, [choice.model]: '' };
      }
      return { secondary_model: patch };
    };
    const verifySaved = (config, choice) => {
      const saved = choiceFor(config.secondary_model);
      if (saved.model !== choice.model || config.secondary_model?.defaultEffort !== choice.effort) {
        throw new Error('saveMismatch');
      }
      return config;
    };
    const load = async (signal) => {
      const [config, catalog] = await Promise.all([request('config', { signal }), request('models', { signal })]);
      return { section: config.secondary_model, models: modelsFor(config, catalog) };
    };
    const save = async (choice, signal) => {
      const latest = await load(signal);
      const patch = patchFor(latest.section, choice, latest.models);
      if (!patch) return latest;
      if (signal?.aborted) throw new Error('requestFailed');
      const config = await request('config', { method: 'POST', body: JSON.stringify(patch), signal });
      verifySaved(config, choice);
      return { section: config.secondary_model, models: latest.models };
    };
    window.__okwMobileSubagentApi = {
      load, save, inherited, choiceFor, modelsFor, effortsFor, availableEfforts, patchFor, verifySaved,
    };
  }
}
