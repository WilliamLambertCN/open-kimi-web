{
  const DISCOVERY_PATH = '/__open-kimi-mobile/models:discover';
  const CAPABILITIES = [
    ['image_in', '图片输入', 'Image input'],
    ['image_out', '图片输出', 'Image output'],
    ['video_in', '视频输入', 'Video input'],
    ['tool_use', '工具调用', 'Tool use'],
    ['thinking', '思考', 'Thinking'],
    ['always_thinking', '始终思考', 'Always thinking'],
  ];
  const EFFORTS = [
    ['none', '无', 'None'],
    ['low', '低', 'Low'],
    ['medium', '中', 'Medium'],
    ['high', '高', 'High'],
    ['xhigh', '极高', 'Extra high'],
    ['max', '最大', 'Max'],
  ];
  const ALL_CAPABILITIES = CAPABILITIES.map(([value]) => value);
  const ALL_EFFORTS = EFFORTS.map(([value]) => value);
  const modelConfigs = new Map();
  const rowStates = new WeakMap();
  const enhancedForms = new WeakSet();
  let configLoaded = false;
  let pageAuthorization = '';

  const isChinese = () => {
    const language = document.documentElement.lang || navigator.language || '';
    return language.toLocaleLowerCase().startsWith('zh');
  };

  const copy = () => isChinese() ? {
    capabilities: '模型能力',
    efforts: '思考档位',
    adaptive: '自适应思考',
    adaptiveTitle: '允许模型根据任务复杂度调整思考方式',
    discover: '拉取模型',
    discovering: '正在拉取…',
    choose: '选择已发现的模型',
    add: '添加选中模型',
    baseRequired: '请先填写 Base URL',
    authPending: '页面授权尚未就绪，请稍后重试',
    none: '端点没有返回可用模型',
    found: (count) => `已发现 ${count} 个模型`,
    added: (id) => `已添加 ${id}，请补充上下文长度`,
    duplicate: '该模型已经在列表中',
    failed: '模型拉取失败',
    drag: '拖动调整模型顺序',
  } : {
    capabilities: 'Model capabilities',
    efforts: 'Thinking efforts',
    adaptive: 'Adaptive thinking',
    adaptiveTitle: 'Allow the model to adjust its thinking to task complexity',
    discover: 'Fetch models',
    discovering: 'Fetching…',
    choose: 'Choose a discovered model',
    add: 'Add selected model',
    baseRequired: 'Enter a Base URL first',
    authPending: 'Page authorization is not ready; try again shortly',
    none: 'The endpoint returned no usable models',
    found: (count) => `Found ${count} models`,
    added: (id) => `Added ${id}; enter its context size`,
    duplicate: 'That model is already in the list',
    failed: 'Could not fetch models',
    drag: 'Drag to reorder model',
  };

  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const valueOf = (value, camel, snake) => own(value, camel) ? value[camel] : value[snake];
  const hasValue = (value, camel, snake) => own(value, camel) || own(value, snake);
  const keyOf = (provider, model) => `${provider}\u0000${model}`;

  const mergedList = (raw, camel, snake, previous) => {
    if (!hasValue(raw, camel, snake)) return previous ?? null;
    const value = valueOf(raw, camel, snake);
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : null;
  };

  const mergedBoolean = (raw, camel, snake, previous) => {
    if (!hasValue(raw, camel, snake)) return previous ?? null;
    const value = valueOf(raw, camel, snake);
    return typeof value === 'boolean' ? value : null;
  };

  const rememberModel = (raw) => {
    if (raw === null || typeof raw !== 'object') return;
    const provider = valueOf(raw, 'provider', 'provider');
    const model = valueOf(raw, 'model', 'model');
    if (typeof provider !== 'string' || typeof model !== 'string') return;
    const key = keyOf(provider, model);
    const previous = modelConfigs.get(key);
    modelConfigs.set(key, {
      capabilities: mergedList(raw, 'capabilities', 'capabilities', previous?.capabilities),
      supportEfforts: mergedList(raw, 'supportEfforts', 'support_efforts', previous?.supportEfforts),
      adaptiveThinking: mergedBoolean(raw, 'adaptiveThinking', 'adaptive_thinking', previous?.adaptiveThinking),
    });
  };

  const rememberConfigModels = (body) => {
    const models = body?.data?.models ?? body?.models;
    if (models && typeof models === 'object') Object.values(models).forEach(rememberModel);
  };

  const rememberListedModels = (body) => {
    const items = body?.data?.items ?? body?.items;
    if (Array.isArray(items)) items.forEach(rememberModel);
  };

  const rememberResponse = (url, method, body) => {
    if (method !== 'GET') return;
    const readers = new Map([
      ['/api/v1/config', rememberConfigModels],
      ['/api/v1/models', rememberListedModels],
    ]);
    const read = readers.get(url.pathname);
    if (!read) return;
    read(body);
    configLoaded = true;
    resetUntouchedRows();
    queueMicrotask(enhance);
  };

  const requestUrl = (input) => new URL(input instanceof Request ? input.url : String(input), location.href);
  const requestMethod = (input, init) => String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();

  const rememberAuthorization = (input, init, url) => {
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return;
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    const authorization = headers.get('authorization');
    if (authorization) pageAuthorization = authorization;
  };

  const modelRows = (form) => Array.from(form.querySelectorAll('.pf-models > .pf-model-grid:not(.pf-model-head)'));
  const textInputs = (row) => Array.from(row.querySelectorAll('input:not([type="checkbox"])'));
  const sorting = window.OpenKimiProviderSorting;

  const savedList = (saved, field, fallback) => Array.isArray(saved?.[field]) ? saved[field] : fallback;

  const stateFor = (row, provider) => {
    let state = rowStates.get(row);
    if (state) return state;
    const model = textInputs(row)[0]?.value?.trim() ?? '';
    const saved = modelConfigs.get(keyOf(provider, model));
    const capabilities = savedList(saved, 'capabilities', ALL_CAPABILITIES);
    const supportEfforts = savedList(saved, 'supportEfforts', ALL_EFFORTS);
    state = {
      capabilities: new Set(capabilities),
      supportEfforts: new Set(supportEfforts),
      extraCapabilities: capabilities.filter((value) => !ALL_CAPABILITIES.includes(value)),
      extraEfforts: supportEfforts.filter((value) => !ALL_EFFORTS.includes(value)),
      adaptiveThinking: saved?.adaptiveThinking ?? true,
      dirty: false,
    };
    rowStates.set(row, state);
    return state;
  };

  const checkbox = ({ value, label, checked, disabled, title, onChange }) => {
    const wrapper = document.createElement('label');
    wrapper.className = 'okw-model-option';
    if (title) wrapper.title = title;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = value;
    input.checked = checked;
    input.disabled = disabled;
    input.addEventListener('change', () => onChange(input.checked));
    const text = document.createElement('span');
    text.textContent = label;
    wrapper.append(input, text);
    return wrapper;
  };

  const optionGroup = (title) => {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'okw-model-option-group';
    const legend = document.createElement('legend');
    legend.textContent = title;
    const list = document.createElement('div');
    list.className = 'okw-model-option-list';
    fieldset.append(legend, list);
    return { fieldset, list };
  };

  const enhanceModelRow = (row, form, provider) => {
    const inputs = textInputs(row);
    if (inputs.length < 2) return;
    sorting.enhanceRow(form, row, inputs[0].disabled, copy().drag);
    if (row.querySelector('.okw-model-options')) return;
    const model = inputs[0].value.trim();
    if (model && !configLoaded) return;
    const disabled = inputs[0].disabled;
    const state = stateFor(row, provider);
    const labels = copy();
    const options = document.createElement('div');
    options.className = 'okw-model-options';

    const capabilities = optionGroup(labels.capabilities);
    for (const [value, zh, en] of CAPABILITIES) {
      capabilities.list.append(checkbox({
        value,
        label: isChinese() ? zh : en,
        checked: state.capabilities.has(value),
        disabled,
        onChange: (checked) => {
          if (checked) state.capabilities.add(value);
          else state.capabilities.delete(value);
          state.dirty = true;
        },
      }));
    }

    const efforts = optionGroup(labels.efforts);
    for (const [value, zh, en] of EFFORTS) {
      efforts.list.append(checkbox({
        value,
        label: isChinese() ? zh : en,
        checked: state.supportEfforts.has(value),
        disabled,
        onChange: (checked) => {
          if (checked) state.supportEfforts.add(value);
          else state.supportEfforts.delete(value);
          state.dirty = true;
        },
      }));
    }
    efforts.list.append(checkbox({
      value: 'adaptive_thinking',
      label: labels.adaptive,
      title: labels.adaptiveTitle,
      checked: state.adaptiveThinking,
      disabled,
      onChange: (checked) => {
        state.adaptiveThinking = checked;
        state.dirty = true;
      },
    }));

    options.append(capabilities.fieldset, efforts.fieldset);
    row.append(options);
  };

  const fieldByLabel = (form, expected) => Array.from(form.querySelectorAll('.pf-field')).find((field) => {
    const text = field.querySelector('label')?.textContent?.replace('*', '').trim();
    return expected.includes(text);
  });

  const protocolValue = (form) => {
    const field = fieldByLabel(form, ['API 协议', 'API Protocol']);
    const select = field?.querySelector('select');
    if (select?.value) return select.value;
    const text = field?.querySelector('[role="combobox"], button')?.textContent?.trim() ?? '';
    return new Map([
      ['Kimi', 'kimi'], ['OpenAI', 'openai'], ['OpenAI Responses', 'openai_responses'],
      ['Anthropic', 'anthropic'], ['Google GenAI', 'google-genai'], ['Vertex AI', 'vertexai'],
    ]).get(text) ?? 'openai';
  };

  const inputValue = (form, labels) => fieldByLabel(form, labels)?.querySelector('input')?.value?.trim() ?? '';
  const dispatchInput = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const addDiscoveredModel = (form, id, status) => {
    const labels = copy();
    const rows = modelRows(form);
    if (rows.some((row) => textInputs(row)[0]?.value?.trim() === id)) {
      status.dataset.state = 'error';
      status.textContent = labels.duplicate;
      return;
    }
    const fill = () => {
      const row = modelRows(form).find((candidate) => !textInputs(candidate)[0]?.value?.trim());
      const input = row && textInputs(row)[0];
      if (!input) return false;
      dispatchInput(input, id);
      enhanceModelRow(row, form, inputValue(form, ['名称', 'Name']));
      status.dataset.state = 'success';
      status.textContent = labels.added(id);
      return true;
    };
    if (fill()) return;
    const addButton = Array.from(form.querySelectorAll('button')).find((button) => {
      const text = button.textContent?.trim();
      return text === '添加模型' || text === 'Add model';
    });
    addButton?.click();
    queueMicrotask(() => fill());
  };

  const createDiscoveryControls = (labels) => {
    const panel = document.createElement('div');
    panel.className = 'okw-model-discovery';
    const fetchButton = document.createElement('button');
    fetchButton.type = 'button';
    fetchButton.className = 'okw-discovery-button';
    fetchButton.textContent = labels.discover;
    const select = document.createElement('select');
    select.className = 'okw-discovery-select';
    select.disabled = true;
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = labels.choose;
    select.append(placeholder);
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'okw-discovery-add';
    addButton.textContent = labels.add;
    addButton.disabled = true;
    const status = document.createElement('div');
    status.className = 'okw-discovery-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    panel.append(fetchButton, select, addButton, status);
    return { addButton, fetchButton, panel, placeholder, select, status };
  };

  const setDiscoveryStatus = (status, state, message) => {
    status.dataset.state = state;
    status.textContent = message;
  };

  const renderDiscoveredModels = (controls, models, labels) => {
    controls.select.replaceChildren(controls.placeholder);
    for (const id of models) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = id;
      controls.select.append(option);
    }
    controls.select.disabled = models.length === 0;
    controls.addButton.disabled = true;
    setDiscoveryStatus(
      controls.status,
      models.length === 0 ? 'error' : 'success',
      models.length === 0 ? labels.none : labels.found(models.length),
    );
  };

  const loadDiscoveredModels = async (form, controls, disabled, labels) => {
    const baseUrl = inputValue(form, ['Base URL']);
    const message = !baseUrl ? labels.baseRequired : !pageAuthorization ? labels.authPending : '';
    if (message) {
      setDiscoveryStatus(controls.status, 'error', message);
      return;
    }
    controls.fetchButton.disabled = true;
    controls.fetchButton.textContent = labels.discovering;
    setDiscoveryStatus(controls.status, '', '');
    try {
      const response = await window.fetch(DISCOVERY_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: pageAuthorization },
        body: JSON.stringify({
          base_url: baseUrl,
          api_key: inputValue(form, ['API Key']),
          type: protocolValue(form),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : labels.failed);
      renderDiscoveredModels(controls, Array.isArray(body.models) ? body.models : [], labels);
    } catch (error) {
      controls.select.disabled = true;
      controls.addButton.disabled = true;
      setDiscoveryStatus(controls.status, 'error', error instanceof Error ? error.message : labels.failed);
    } finally {
      controls.fetchButton.disabled = disabled;
      controls.fetchButton.textContent = labels.discover;
    }
  };

  const enhanceDiscovery = (form) => {
    if (form.querySelector('.okw-model-discovery')) return;
    const baseField = fieldByLabel(form, ['Base URL']);
    const modelsField = fieldByLabel(form, ['模型', 'Models']);
    if (!baseField || !modelsField) return;
    const labels = copy();
    const controls = createDiscoveryControls(labels);
    modelsField.before(controls.panel);
    const disabled = baseField.querySelector('input')?.disabled === true;
    controls.fetchButton.disabled = disabled;
    controls.select.addEventListener('change', () => {
      controls.addButton.disabled = controls.select.value === '';
    });
    controls.addButton.addEventListener('click', () => {
      if (controls.select.value) addDiscoveredModel(form, controls.select.value, controls.status);
    });
    controls.fetchButton.addEventListener('click', () => {
      void loadDiscoveredModels(form, controls, disabled, labels);
    });
  };

  function resetUntouchedRows() {
    document.querySelectorAll('.pf-form').forEach((form) => {
      modelRows(form).forEach((row) => {
        const state = rowStates.get(row);
        if (!state || state.dirty) return;
        rowStates.delete(row);
        row.querySelector('.okw-model-options')?.remove();
      });
    });
  }

  function enhance() {
    document.querySelectorAll('.pf-form').forEach((form) => {
      sorting.reconcile(form);
      const provider = inputValue(form, ['名称', 'Name']);
      modelRows(form).forEach((row) => enhanceModelRow(row, form, provider));
      enhanceDiscovery(form);
      enhancedForms.add(form);
    });
  }

  const isProviderSave = (url, method) => (method === 'POST' && url.pathname === '/api/v1/providers') ||
    (method === 'PUT' && /^\/api\/v1\/providers\/[^/]+$/.test(url.pathname));

  const parseBody = (text) => {
    if (typeof text !== 'string') return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };

  const serializeModelState = (model, state) => ({
    ...model,
    capabilities: [
      ...ALL_CAPABILITIES.filter((value) => state.capabilities.has(value)),
      ...state.extraCapabilities,
    ],
    support_efforts: [
      ...ALL_EFFORTS.filter((value) => state.supportEfforts.has(value)),
      ...state.extraEfforts,
    ],
    adaptive_thinking: state.adaptiveThinking,
  });

  const orderedModels = (form, models, provider) => {
    return sorting.mapModels(form, models).map(({ model, row }) => (
      row ? serializeModelState(model, stateFor(row, provider)) : model
    ));
  };

  const mergeProviderFields = async (input, init, url, method) => {
    if (!isProviderSave(url, method)) return [input, init];
    const form = Array.from(document.querySelectorAll('.pf-form')).find((candidate) => enhancedForms.has(candidate));
    if (!form) return [input, init];
    enhance();
    const originalBody = init?.body ?? (input instanceof Request ? await input.clone().text() : null);
    const body = parseBody(originalBody);
    if (!Array.isArray(body?.models)) return [input, init];
    body.models = orderedModels(form, body.models, inputValue(form, ['名称', 'Name']));
    const nextInit = { ...init, body: JSON.stringify(body) };
    if (input instanceof Request) return [new Request(input, nextInit), undefined];
    return [input, nextInit];
  };

  const nativeFetch = window.fetch;
  window.fetch = async function enhancedProviderFetch(input, init) {
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    rememberAuthorization(input, init, url);
    const [forwardedInput, forwardedInit] = await mergeProviderFields(input, init, url, method);
    const response = await nativeFetch.call(this, forwardedInput, forwardedInit);
    if (response.ok && url.origin === location.origin) {
      void response.clone().json().then((body) => rememberResponse(url, method, body)).catch(() => {});
    }
    return response;
  };

  new MutationObserver(enhance).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', enhance);
  enhance();
}
