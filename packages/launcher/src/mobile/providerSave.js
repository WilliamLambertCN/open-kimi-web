{
  window.__okwProviderCreateSave = ({ currentForm, isReady, rowsOf, inputsOf, baseInput, providerOf,
    dispatchInput, mapModels, serialize, copy }) => {
    const isProviderSave = (url, method) => (method === 'POST' && url.pathname === '/api/v1/providers') ||
      (method === 'PUT' && /^\/api\/v1\/providers\/[^/]+$/.test(url.pathname));
    const isCatalogImport = (url, method) => method === 'POST' && url.pathname === '/api/v1/providers:import_catalog';
    const hasEditableOptions = (form) => rowsOf(form).some((row) =>
      !inputsOf(row)[0]?.disabled && row.querySelector('.okw-model-options'));
    const saveButton = (target) => {
      const button = target?.closest?.('.pf-foot button');
      return button && !button.disabled && ['Save', '保存'].includes(button.textContent?.trim()) ? button : null;
    };
    document.addEventListener?.('click', (event) => {
      const button = saveButton(event.target);
      if (!button || !isReady()) return;
      const form = currentForm();
      if (!form || button.closest('.pf-form, .pf') !== form || !hasEditableOptions(form)) return;
      const base = baseInput(form);
      if (base && !base.disabled) dispatchInput(base, base.value);
    }, true);

    const readBody = async (input, init) => {
      const text = init?.body ?? (input instanceof Request ? await input.clone().text() : null);
      if (typeof text !== 'string') return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    };
    const matchesProvider = (provider, body, url, method) => method === 'POST' ? body.id === provider :
      body.new_id === provider || (!body.new_id && url.pathname === `/api/v1/providers/${encodeURIComponent(provider)}`);
    const matchingModels = (form, models) => {
      if (!Array.isArray(models) || rowsOf(form).length !== models.length) return null;
      const mapped = mapModels(form, models);
      return mapped.every(({ model, row }) => row && model?.model === inputsOf(row)[0]?.value?.trim()) ? mapped : null;
    };
    const rewrite = (input, init, body) => {
      const nextInit = { ...init, body: JSON.stringify(body) };
      return input instanceof Request ? [new Request(input, nextInit), undefined] : [input, nextInit];
    };
    const rejectSave = (msg) => Response.json({ code: 409, msg, data: null }, { status: 409 });
    const merge = (input, init, request, form, body) => {
      const { url, method } = request;
      const provider = providerOf(form);
      if (isCatalogImport(url, method)) {
        if ((body.id ?? body.catalog_id) === provider && hasEditableOptions(form)) return rejectSave(copy().catalogMismatch);
        return [input, init];
      }
      if (!matchesProvider(provider, body, url, method) || !Array.isArray(body.models)) return [input, init];
      const mapped = matchingModels(form, body.models);
      if (!mapped) return rejectSave(copy().modelMismatch);
      body.models = mapped.map(({ model, row }) => inputsOf(row)[0].disabled ? model : serialize(model, row, provider));
      return rewrite(input, init, body);
    };
    return async (input, init, url, method) => {
      if (url.origin !== location.origin || !isReady()) return [input, init];
      if (!isCatalogImport(url, method) && !isProviderSave(url, method)) return [input, init];
      const form = currentForm();
      if (!form) return [input, init];
      const body = await readBody(input, init);
      return body ? merge(input, init, { url, method }, form, body) : [input, init];
    };
  };
}
