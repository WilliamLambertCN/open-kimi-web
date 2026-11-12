{
  const el = (tag, className = '') => { const node = document.createElement(tag); node.className = className; return node; };
  const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const attr = (node, name, value) => {
    if (node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value));
  };
  const button = (className = '') => { const node = el('button', className); node.type = 'button'; return node; };
  const copy = () => window.__okwLocale?.current() === 'zh' ? {
    title: '侧聊模型', follow: '跟随主模型', description: '只用于此侧聊；刷新页面后恢复跟随主模型。',
    search: '搜索模型或供应商…', all: '全部', provider: '供应商', unknown: '未提供供应商',
    effort: '思考档位', auto: '跟随兼容档位', hint: '沿用主模型的兼容档位；不支持时自动开启或关闭思考。',
    apply: '使用', cancel: '取消', retry: '重试', loading: '正在加载…', empty: '没有匹配的模型',
    noModels: '尚未配置模型；仍可跟随主模型。',
    authPending: '页面授权尚未就绪，请稍后重试。', authExpired: '授权已失效，请刷新页面。',
    requestFailed: '模型列表加载失败，请重试。', invalidResponse: '无法识别模型列表，请重试。',
    identityLost: '侧聊正在切换，请稍后再选。', modelMissing: '所选模型已不可用，请重新选择。',
    effortUnsupported: '所选思考档位不受支持，请重新选择。',
    efforts: { off: '关闭', on: '开启', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高' },
  } : {
    title: 'Side chat model', follow: 'Follow main model',
    description: 'Only for this side chat; reload to follow the main model.',
    search: 'Search models or providers…', all: 'All', provider: 'Provider', unknown: 'Provider unavailable',
    effort: 'Thinking effort', auto: 'Auto',
    hint: 'Uses the main effort when supported; otherwise turns thinking on or off.',
    apply: 'Use model', cancel: 'Cancel', retry: 'Retry', loading: 'Loading…', empty: 'No matching models',
    noModels: 'No configured models; you can still follow the main model.',
    authPending: 'Page authorization is not ready; try again shortly.', authExpired: 'Authorization expired; refresh this page.',
    requestFailed: 'Could not load models; please retry.', invalidResponse: 'Unrecognized model list; please retry.',
    identityLost: 'Side chat is switching; try again shortly.',
    modelMissing: 'Selected model is unavailable; choose another model.',
    effortUnsupported: 'This thinking effort is unsupported; choose another effort.',
    efforts: { off: 'Off', on: 'On', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Xhigh', max: 'Max' },
  };
  const build = () => {
    const dialog = el('dialog', 'okw-sidechat-picker');
    const title = el('h2'); title.id = 'okw-sidechat-model-title';
    const description = el('p', 'okw-sidechat-description');
    const search = el('input', 'ui-input'); search.type = 'search'; search.autocomplete = 'off';
    const chips = el('div', 'chip-strip');
    const list = el('div', 'model-list'); list.id = 'okw-sidechat-model-list'; list.tabIndex = 0;
    attr(list, 'role', 'listbox'); attr(search, 'aria-controls', list.id);
    const empty = el('p', 'okw-sidechat-empty');
    const effortLabel = el('label', 'okw-sidechat-effort-label'); effortLabel.htmlFor = 'okw-sidechat-effort';
    const effort = el('select', 'ui-input'); effort.id = 'okw-sidechat-effort';
    const hint = el('p', 'okw-sidechat-hint');
    const status = el('p', 'okw-sidechat-status'); attr(status, 'role', 'status');
    const actions = el('div', 'okw-sidechat-actions');
    const cancel = button('ui-button ui-button--ghost');
    const retry = button('ui-button ui-button--ghost');
    const apply = button('ui-button ui-button--primary');
    actions.append(cancel, retry, apply);
    dialog.append(title, description, search, chips, list, empty, effortLabel, effort, hint, status, actions);
    attr(dialog, 'aria-labelledby', title.id);
    return { dialog, title, description, search, chips, list, empty, effortLabel, effort, hint, status, cancel, retry, apply };
  };
  const row = (model, selected, index, choose) => {
    const item = el('div', 'model-row'); item.id = `okw-sidechat-option-${index}`; item.dataset.model = model.id;
    attr(item, 'role', 'option'); attr(item, 'aria-selected', model.id === selected);
    item.classList.toggle('is-current', model.id === selected);
    const main = el('span', 'model-main');
    const name = el('span', 'model-name'); text(name, model.label);
    const meta = el('span', 'model-meta');
    text(meta, model.id ? `${model.provider || copy().unknown} · ${model.id}` : copy().description);
    main.append(name, meta);
    const check = el('span', 'model-check'); text(check, model.id === selected ? '✓' : ''); attr(check, 'aria-hidden', true);
    item.append(main, check); item.title = `${model.label}\n${meta.textContent}`;
    item.addEventListener('click', () => choose(model.id));
    return item;
  };
  const localize = (ui) => {
    const words = copy();
    for (const name of ['title', 'description', 'cancel', 'retry', 'apply', 'hint']) text(ui[name], words[name]);
    text(ui.effortLabel, words.effort);
    attr(ui.search, 'placeholder', words.search); attr(ui.search, 'aria-label', words.search);
    attr(ui.list, 'aria-label', words.title); attr(ui.chips, 'aria-label', words.provider);
  };
  const entries = (state) => {
    const query = state.ui.search.value.trim().toLowerCase();
    const items = state.models.filter((model) => (!state.provider || model.provider === state.provider) &&
      `${model.id} ${model.label} ${model.provider}`.toLowerCase().includes(query));
    return !query && !state.provider ? [{ id: '', label: copy().follow }, ...items] : items;
  };
  const renderModels = (state, choose, provider) => {
    const { ui } = state;
    const providers = ['', ...new Set(state.models.map((model) => model.provider))].filter((value, index, all) =>
      all.indexOf(value) === index);
    ui.chips.replaceChildren(...providers.map((value) => {
      const chip = button('chip'); text(chip, value || copy().all); attr(chip, 'aria-pressed', state.provider === value);
      chip.classList.toggle('is-active', state.provider === value); chip.addEventListener('click', () => provider(value));
      return chip;
    }));
    state.visible = entries(state);
    state.active = Math.min(state.active, Math.max(0, state.visible.length - 1));
    ui.list.replaceChildren(...state.visible.map((model, index) => row(model, state.choice.model, index, choose)));
    ui.empty.hidden = state.visible.length > 0;
    text(ui.empty, !state.models.length ? copy().noModels : copy().empty);
  };
  const renderEffort = (state) => {
    const { ui } = state;
    const model = state.models.find((item) => item.id === state.choice.model);
    const values = ['', ...window.__okwEffortOrder.sort(window.__okwSideChatModelApi.efforts(model))];
    ui.effort.replaceChildren(...values.map((value) => {
      const option = el('option'); option.value = value; text(option, copy().efforts[value] ?? (value || copy().auto));
      return option;
    }));
    ui.effort.value = state.choice.effort; ui.effort.disabled = !model;
  };
  const activity = (state) => {
    [...state.ui.list.children].forEach((item, index) => item.classList.toggle('is-selected', index === state.active));
    const selected = state.ui.list.children[state.active];
    for (const node of [state.ui.list, state.ui.search]) attr(node, 'aria-activedescendant', selected?.id || '');
  };
  window.__okwSideChatModelView = { el, text, attr, button, copy, build, localize, renderModels, renderEffort, activity };
}
