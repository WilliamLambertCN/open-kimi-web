{
  const locale = () => {
    if (window.__okwLocale) return window.__okwLocale.current();
    let stored;
    try { stored = localStorage.getItem('kimi-locale'); } catch { stored = null; }
    if (stored === 'zh' || stored === 'en') return stored;
    return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  };
  const copy = () => locale() === 'zh' ? {
    title: '子智能体默认模型', description: '全局设置；不改变当前会话的主模型。',
    follow: '跟随主模型', unknown: '点按查看', effort: '思考档位', all: '全部',
    search: '搜索模型或供应商…', clear: '清除搜索', providers: '供应商筛选', noMatch: '没有匹配的模型',
    details: '模型详情', provider: '供应商', alias: '别名', modelId: '模型 ID', unknownProvider: '未提供供应商',
    auto: '自动', autoHint: '自动按全局思考设置／模型默认解析。',
    effortNames: { on: '开启', off: '关闭', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高' },
    save: '保存', cancel: '取消', retry: '重试', loading: '正在加载…', saving: '正在保存…',
    noModels: '没有已配置模型。可保持跟随主模型，或先在供应商设置中添加模型。',
    followHint: '未配置独立模型时，子智能体继承调用者的模型和思考档位。',
    poolHint: '保留已有模型池；思考档位必须适用于池中的所有模型。',
    authPending: '页面授权尚未就绪，请稍后重试。', authExpired: '页面授权已失效，请刷新页面。',
    requestFailed: '请求失败，请重试。', invalidResponse: '服务器返回了无法识别的配置，请重试。',
    cannotFollow: '官方配置接口无法清除已配置的子智能体模型；请通过官方 CLI 配置恢复跟随主模型。',
    modelMissing: '选择的模型已不可用，请重新打开面板。',
    effortUnsupported: '该思考档位不适用于最新模型池，请重新打开面板。',
    saveMismatch: '服务器未返回所选设置，未确认保存成功。请重新打开面板核对。',
  } : {
    title: 'Subagent default model', description: 'Global setting; leaves the current main model unchanged.',
    follow: 'Follow main model', unknown: 'Tap to view', effort: 'Thinking effort', all: 'All',
    search: 'Search models or providers…', clear: 'Clear search', providers: 'Filter by provider', noMatch: 'No matching models',
    details: 'Model details', provider: 'Provider', alias: 'Alias', modelId: 'Model ID', unknownProvider: 'Provider unavailable',
    auto: 'Auto', autoHint: 'Auto uses global thinking settings / model default.',
    effortNames: { on: 'On', off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High',
      xhigh: 'Xhigh', max: 'Max' },
    save: 'Save', cancel: 'Cancel', retry: 'Retry', loading: 'Loading…', saving: 'Saving…',
    noModels: 'No configured models. Keep following the main model, or add a model in provider settings first.',
    followHint: "Without a separate model, subagents inherit the caller's model and thinking effort.",
    poolHint: 'The existing model pool is preserved; thinking effort must work for every model in the pool.',
    authPending: 'Page authorization is not ready; try again shortly.', authExpired: 'Authorization expired; refresh the page.',
    requestFailed: 'Request failed; please retry.', invalidResponse: 'Unrecognized server configuration; please retry.',
    cannotFollow: 'The official config API cannot clear a configured subagent model; restore inheritance via CLI config.',
    modelMissing: 'The selected model is no longer available; reopen this panel.',
    effortUnsupported: 'This effort is incompatible with the latest model pool; reopen this panel.',
    saveMismatch: 'The server did not return the selected settings. Saving is not confirmed; reopen this panel to check.',
  };
  const effortLabel = (effort) => copy().effortNames[effort] ?? effort;
  const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const attr = (node, name, value) => {
    if (node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value));
  };
  const element = (tag, className = '') => {
    const node = document.createElement(tag);
    node.className = className;
    return node;
  };
  const button = (className) => {
    const node = element('button', className);
    node.type = 'button';
    return node;
  };
  const buildEntry = () => {
    const section = element('section', 'okw-subagent-section');
    section.dataset.okwSubagentModel = '';
    const card = element('div', 'card okw-subagent-card');
    const trigger = button('srow okw-subagent-trigger');
    attr(trigger, 'aria-haspopup', 'dialog');
    attr(trigger, 'aria-expanded', false);
    attr(trigger, 'aria-controls', 'okw-subagent-editor');
    const label = element('span', 'srow-label');
    const summary = element('span', 'srow-sub okw-subagent-summary');
    const main = element('span', 'srow-main');
    const chevron = element('span', 'chev');
    attr(chevron, 'aria-hidden', true);
    text(chevron, '›');
    main.append(label, summary);
    trigger.append(main, chevron);
    card.append(trigger);
    section.append(card);
    return { section, trigger, label, summary };
  };
  const buildPicker = () => {
    const picker = element('div', 'mp mp--sheet');
    const searchWrap = element('div', 'search-wrap');
    const search = element('input', 'ui-input ui-input--md okw-subagent-search');
    search.type = 'text';
    search.autocomplete = 'off';
    search.spellcheck = false;
    const clear = button('search-clear');
    clear.tabIndex = -1;
    text(clear, '×');
    searchWrap.append(search, clear);
    const chips = element('div', 'chip-strip');
    const list = element('div', 'model-list');
    list.id = 'okw-subagent-list';
    list.tabIndex = 0;
    attr(list, 'role', 'listbox');
    attr(search, 'aria-controls', list.id);
    const empty = element('div', 'empty');
    picker.append(searchWrap, chips, list, empty);
    return { picker, search, clear, chips, list, empty, rows: new Map(), tabs: new Map() };
  };
  const buildControls = () => {
    const controls = element('div', 'okw-subagent-controls');
    const effortLabelNode = element('span', 'okw-subagent-effort-label');
    effortLabelNode.id = 'okw-subagent-effort-label';
    const effort = element('div', 'ui-seg ui-seg--sm okw-subagent-effort');
    attr(effort, 'role', 'tablist');
    attr(effort, 'aria-labelledby', effortLabelNode.id);
    const hint = element('p', 'okw-subagent-note');
    const details = element('details', 'okw-subagent-model-details');
    const detailsLabel = element('summary');
    const identity = element('p');
    const description = element('p', 'okw-subagent-note');
    details.append(detailsLabel, identity, description);
    const status = element('p', 'okw-subagent-status');
    attr(status, 'role', 'status');
    attr(status, 'aria-live', 'polite');
    const actions = element('div', 'okw-subagent-actions');
    const cancel = button('okw-subagent-cancel');
    const retry = button('okw-subagent-retry');
    const save = button('okw-subagent-save');
    actions.append(cancel, retry, save);
    controls.append(effortLabelNode, effort, hint, details, status, actions);
    return { controls, effortLabelNode, effort, hint, details, detailsLabel, identity, description, status,
      cancel, retry, save, efforts: new Map() };
  };
  const build = () => {
    const overlay = element('div', 'sheet-root okw-subagent-overlay');
    const scrim = element('div', 'sheet-scrim');
    const editor = element('div', 'sheet-panel okw-subagent-editor');
    editor.id = 'okw-subagent-editor';
    editor.tabIndex = -1;
    attr(editor, 'role', 'dialog');
    attr(editor, 'aria-modal', true);
    attr(editor, 'aria-labelledby', 'okw-subagent-title');
    const grab = button('sheet-grab');
    const head = element('div', 'sheet-head');
    const title = element('span', 'sheet-title');
    title.id = 'okw-subagent-title';
    head.append(title);
    const body = element('div', 'sheet-body');
    const ui = { ...buildEntry(), ...buildPicker(), ...buildControls(), overlay, scrim, editor, grab, title, body };
    body.append(ui.picker, ui.controls);
    editor.append(grab, head, body);
    overlay.append(scrim, editor);
    return ui;
  };
  const identityFor = (model) => `${model.provider || copy().unknownProvider} · ${model.id}`;
  const aliasUnits = (id) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(id)]
    .map(({ segment }) => {
      if (/\p{Extended_Pictographic}/u.test(segment)) return segment;
      if (!/[\p{Cc}\p{Cf}\s]/u.test(segment) && !['…', '\\'].includes(segment)) return segment;
      return Array.from(segment, (char) => `\\u{${char.codePointAt(0).toString(16)}}`).join('');
    });
  const sharedEdges = (aliases) => {
    const shortest = Math.min(...aliases.map((units) => units.length));
    let start = 0;
    let end = 0;
    while (start < shortest - 1 && aliases.every((units) => units[start] === aliases[0][start])) start += 1;
    while (end < shortest - start - 1 && aliases.every((units) => units.at(-end - 1) === aliases[0].at(-end - 1))) {
      end += 1;
    }
    return { start, end };
  };
  const aliasFragment = (units, edges, size) => {
    const core = units.slice(edges.start, units.length - edges.end);
    const head = Math.ceil(size / 2);
    const tail = Math.floor(size / 2);
    const suffix = tail ? core.slice(-tail).join('') : '';
    const value = core.length <= size ? core.join('') : `${core.slice(0, head).join('')}…${suffix}`;
    return `${edges.start ? '…' : ''}${value}${edges.end ? '…' : ''}`.replace(/…+/g, '…');
  };
  const groupFragments = (models) => {
    const aliases = models.map((model) => aliasUnits(model.id));
    const edges = sharedEdges(aliases);
    let size = 1;
    let fragments = aliases.map((units) => aliasFragment(units, edges, size));
    while (new Set(fragments).size !== models.length) {
      size += 1;
      fragments = aliases.map((units) => aliasFragment(units, edges, size));
    }
    return models.map((model, index) => [model.id, fragments[index]]);
  };
  const collisionFragments = (models) => {
    const groups = new Map();
    for (const model of models) {
      const key = JSON.stringify([model.provider, model.label]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(model);
    }
    return new Map([...groups.values()].filter((group) => group.length > 1).flatMap(groupFragments));
  };
  const entriesFor = (state) => {
    const query = state.search.trim().toLowerCase();
    const models = [...state.data.models];
    if (state.choice.model && !models.some((model) => model.id === state.choice.model)) {
      models.push({ id: state.choice.model, label: state.choice.model, provider: '' });
    }
    const filtered = models.filter((model) => (state.provider === null || state.provider === model.provider) &&
      [model.label, model.provider, model.id].some((value) => value.toLowerCase().includes(query)));
    return state.provider === null && !query
      ? [{ id: '', label: copy().follow, provider: '' }, ...filtered] : filtered;
  };
  const syncChildren = (parent, nodes) => {
    if (parent.children.length === nodes.length && nodes.every((node, index) => parent.children[index] === node)) return;
    parent.replaceChildren(...nodes);
  };
  const renderChips = (state, onProvider) => {
    const { ui } = state;
    const providers = [...new Set(state.data.models.map((model) => model.provider))];
    if (state.provider !== null && !providers.includes(state.provider)) state.provider = null;
    const nodes = [null, ...providers].map((provider) => {
      let chip = ui.tabs.get(provider);
      if (!chip) {
        chip = button('chip');
        chip.addEventListener('click', () => onProvider(provider));
        ui.tabs.set(provider, chip);
      }
      text(chip, provider === null ? copy().all : provider || copy().unknownProvider);
      chip.classList.toggle('is-active', state.provider === provider);
      attr(chip, 'aria-pressed', state.provider === provider);
      chip.disabled = !!state.busy;
      return chip;
    });
    syncChildren(ui.chips, nodes);
  };
  const rowFor = (ui, model, onSelect, onHover) => {
    let row = ui.rows.get(model.id);
    if (row) return row;
    row = element('div', 'model-row');
    row.id = `okw-subagent-option-${ui.rows.size}`;
    row.dataset.model = model.id;
    row.tabIndex = -1;
    attr(row, 'role', 'option');
    const main = element('span', 'model-main');
    main.append(element('span', 'model-name'), element('span', 'model-meta'));
    const side = element('span', 'model-side');
    const check = element('span', 'model-check');
    attr(check, 'aria-hidden', true);
    text(check, '✓');
    side.append(check);
    row.append(main, side);
    row.addEventListener('click', () => onSelect(model.id));
    row.addEventListener('mouseenter', () => onHover(model.id));
    ui.rows.set(model.id, row);
    return row;
  };
  const renderActivity = (state) => {
    const { ui } = state;
    state.visible.forEach((model, index) => {
      const row = ui.rows.get(model.id);
      row.classList.toggle('is-current', model.id === state.choice.model);
      row.classList.toggle('is-selected', index === state.selected);
      attr(row, 'aria-selected', model.id === state.choice.model);
      attr(row, 'aria-disabled', !!state.busy);
      row.querySelector('.model-check').hidden = model.id !== state.choice.model;
    });
    const selected = ui.rows.get(state.visible[state.selected]?.id);
    attr(ui.list, 'aria-activedescendant', selected?.id || '');
    attr(ui.search, 'aria-activedescendant', selected?.id || '');
  };
  const renderPicker = (state, onSelect, onProvider, onHover) => {
    const { ui } = state;
    renderChips(state, onProvider);
    state.visible = entriesFor(state);
    state.selected = Math.min(state.selected, Math.max(0, state.visible.length - 1));
    const fragments = collisionFragments(state.data.models);
    const nodes = state.visible.map((model) => {
      const row = rowFor(ui, model, onSelect, onHover);
      const identity = model.id ? identityFor(model) : copy().followHint;
      const fragment = fragments.get(model.id);
      const meta = fragment ? `${fragment} · ${model.provider || copy().unknownProvider}` : identity;
      text(row.querySelector('.model-name'), model.label);
      text(row.querySelector('.model-meta'), meta);
      attr(row, 'title', `${model.label}\n${identity}\n${model.modelId || model.id}`);
      attr(row, 'aria-label', `${model.label} · ${identity}`);
      return row;
    });
    syncChildren(ui.list, nodes);
    ui.empty.hidden = nodes.length !== 0;
    text(ui.empty, copy().noMatch);
    ui.clear.classList.toggle('is-on', state.search.length > 0);
    renderActivity(state);
  };
  const renderEfforts = (state, entries, onEffort) => {
    const { ui } = state;
    const nodes = entries.map((value) => {
      let item = ui.efforts.get(value);
      if (!item) {
        item = button('ui-seg__item');
        item.dataset.effort = value;
        attr(item, 'role', 'tab');
        item.addEventListener('click', () => onEffort(value));
        ui.efforts.set(value, item);
      }
      text(item, value ? effortLabel(value) : copy().auto);
      attr(item, 'aria-selected', state.choice.effort === value);
      item.classList.toggle('is-on', state.choice.effort === value);
      item.tabIndex = state.choice.effort === value ? 0 : -1;
      item.disabled = !!state.busy || !state.choice.model;
      return item;
    });
    syncChildren(ui.effort, nodes);
    const words = copy();
    const model = state.data.models.find((item) => item.id === state.choice.model);
    ui.details.hidden = !state.choice.model;
    text(ui.identity, state.choice.model ? [
      `${words.provider}: ${model?.provider || words.unknownProvider}`,
      `${words.alias}: ${state.choice.model}`, `${words.modelId}: ${model?.modelId || state.choice.model}`,
      words.poolHint,
    ].join('\n') : '');
    text(ui.hint, !state.data.models.length ? words.noModels : state.choice.model ? words.autoHint : words.followHint);
  };
  const localize = (ui) => {
    const words = copy();
    for (const key of ['title', 'label', 'effortLabelNode', 'detailsLabel', 'description', 'cancel', 'retry', 'save']) {
      const value = { label: 'title', effortLabelNode: 'effort', detailsLabel: 'details' }[key] || key;
      text(ui[key], words[value]);
    }
    attr(ui.editor, 'aria-label', words.title);
    attr(ui.grab, 'aria-label', words.cancel);
    attr(ui.list, 'aria-label', words.title);
    attr(ui.search, 'placeholder', words.search);
    attr(ui.search, 'aria-label', words.search);
    attr(ui.clear, 'aria-label', words.clear);
    attr(ui.chips, 'aria-label', words.providers);
  };
  const renderSummary = (ui, data) => {
    if (!data) { text(ui.summary, copy().unknown); return; }
    const choice = window.__okwMobileSubagentApi.choiceFor(data.section);
    const model = data.models.find((item) => item.id === choice.model);
    const identity = model ? identityFor(model) : choice.model;
    const effort = choice.effort ? ` · ${effortLabel(choice.effort)}` : '';
    text(ui.summary, choice.model ? `${model?.label || choice.model} · ${identity}${effort}` : copy().follow);
    attr(ui.summary, 'title', ui.summary.textContent);
  };
  window.__okwMobileSubagentView = { copy, effortLabel, text, attr, build, localize, renderSummary,
    renderPicker, renderActivity, renderEfforts };
}
