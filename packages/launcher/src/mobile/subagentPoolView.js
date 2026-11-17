{
  const shared = window.__okwMobileSubagentView;
  const { text, attr } = shared;
  const copy = () => window.__okwLocale?.current() === 'zh' ? {
    title: '子代理候选池', manage: '管理候选池', entry: '候选模型与选择说明',
    entryHint: '为主代理配置可选模型，并说明各自适合的任务。',
    intro: '说明供主代理选择子模型时参考，不是固定派发规则。现有候选和全局思考档位保持不变。',
    single: '只有一个候选时，官方固定使用该模型；多个候选时才向主代理开放模型选择。',
    inherited: '当前跟随主模型。添加候选并保存后，将启用独立的子代理模型池。',
    count: (count) => `${count} 个候选`, default: '默认候选', description: '给主代理的选择说明',
    placeholder: '说明该模型擅长什么、何时使用，以及速度或能力方面的取舍…',
    templates: '填入常用说明（可继续修改）', strong: '大哥 · 难题攻坚', fast: '小弟 · 快速执行',
    strongText: '适合复杂推理、疑难排查和方案审查；能力较强但响应较慢，简单执行任务优先交给更快的候选。',
    fastText: '适合目标明确的简单实现、批量修改与整理；执行较快但复杂推理能力有限，遇到难题及时交给更强的候选。',
    add: '添加候选模型', back: '返回候选池', choose: '从已配置模型中选择',
    search: '搜索模型或供应商…', noModels: '没有可添加的模型。请先在供应商设置中配置模型。',
    empty: '尚未配置独立候选池。添加模型后，可填写说明并选择默认候选。',
    effort: '全局思考档位', auto: '沿用模型默认',
    deletion: '官方接口暂不支持单独移除候选；此处只添加候选、编辑说明与默认选择，不先清空重建。',
    save: '保存', cancel: '取消', close: '关闭', retry: '重试', saved: '已保存并回读确认。',
    loading: '正在加载候选池…', saving: '正在保存并核对…',
    configChanged: '相同设置已在其它页面修改。草稿已保留；取消后重新打开，以读取最新配置。',
    cannotRemove: '不能从此处移除已有候选。请取消后重新打开。',
  } : {
    title: 'Subagent model pool', manage: 'Manage pool', entry: 'Candidates and selection descriptions',
    entryHint: 'Choose the available subagent models and explain when to use each one.',
    intro: 'Descriptions guide the main agent; they are not fixed dispatch rules. Existing candidates and effort are preserved.',
    single: 'With one candidate, the model is fixed. Multiple candidates let the main agent choose a subagent model.',
    inherited: 'Currently following the main model. Adding and saving a candidate enables a separate subagent pool.',
    count: (count) => `${count} candidates`, default: 'Default candidate',
    description: 'Selection description for the main agent',
    placeholder: 'Describe suitable tasks, strengths, and speed or reasoning trade-offs…',
    templates: 'Use a description template, then edit it',
    strong: 'Big brother · Hard problems', fast: 'Little brother · Fast tasks',
    strongText: 'Use for complex reasoning, difficult debugging, and design review. Stronger but slower; ' +
      'prefer a faster candidate for simple execution tasks.',
    fastText: 'Use for well-defined simple implementations, batch edits, and organization. ' +
      'Fast but weaker at complex reasoning; hand difficult problems to a stronger candidate.',
    add: 'Add candidate model', back: 'Back to pool', choose: 'Choose a configured model',
    search: 'Search models or providers…', noModels: 'No models available to add. Configure models in provider settings first.',
    empty: 'No separate pool yet. Add a model, write its description, and choose a default candidate.',
    effort: 'Global thinking effort', auto: 'Use model defaults',
    deletion: 'The official API cannot remove individual candidates. This editor adds candidates and edits descriptions or ' +
      'the default; it never clears and rebuilds the pool.',
    save: 'Save', cancel: 'Cancel', close: 'Close', retry: 'Retry', saved: 'Saved and verified with the server.',
    loading: 'Loading the model pool…', saving: 'Saving and checking…',
    configChanged: 'The same setting changed on another page. Your draft is kept; cancel and reopen to load the latest config.',
    cannotRemove: 'Existing candidates cannot be removed here. Cancel and reopen this editor.',
  };
  const node = (tag, className = '') => {
    const result = document.createElement(tag);
    result.className = className;
    return result;
  };
  const button = (className = '') => {
    const result = node('button', `ui-button ui-button--secondary ui-button--sm ${className}`.trim());
    result.type = 'button';
    return result;
  };
  const entry = (mobile) => {
    const section = node('div', `okw-pool-entry${mobile ? ' is-mobile' : ''}`);
    const main = node('div', 'okw-pool-entry-main');
    const label = node('span', 'okw-pool-entry-label');
    const hint = node('span', 'okw-pool-note');
    const trigger = button('okw-pool-trigger');
    attr(trigger, 'aria-haspopup', 'dialog');
    main.append(label, hint);
    section.append(main, trigger);
    return { section, label, hint, trigger };
  };
  const localizeEntry = (ui) => {
    const words = copy();
    text(ui.label, words.entry); text(ui.hint, words.entryHint); text(ui.trigger, words.manage);
  };
  const build = () => {
    const root = node('dialog', 'okw-pool-dialog');
    const form = node('form', 'okw-pool-form');
    const head = node('header', 'okw-pool-head');
    const heading = node('div', 'okw-pool-heading');
    const title = node('h2'); title.id = 'okw-pool-title';
    const count = node('span', 'okw-pool-note');
    const close = button('okw-pool-close'); text(close, '×');
    heading.append(title, count); head.append(heading, close);
    const body = node('div', 'okw-pool-body');
    const intro = node('p', 'okw-pool-note');
    const single = node('p', 'okw-pool-note');
    const effort = node('p', 'okw-pool-note');
    const content = node('div', 'okw-pool-content');
    const cards = node('div', 'okw-pool-cards');
    const empty = node('p', 'okw-pool-note');
    const add = button('okw-pool-add');
    const limitation = node('p', 'okw-pool-note okw-pool-limitation');
    content.append(add, empty, cards, limitation);
    const chooser = node('section', 'okw-pool-chooser');
    const back = button('okw-pool-back');
    const searchLabel = node('label', 'okw-pool-search-label');
    const picker = shared.buildPicker('okw-pool');
    picker.search.id = 'okw-pool-search'; searchLabel.htmlFor = picker.search.id;
    chooser.append(back, searchLabel, picker.picker);
    body.append(intro, single, effort, content, chooser);
    const footer = node('footer', 'okw-pool-footer');
    const status = node('p', 'okw-pool-status'); attr(status, 'role', 'status'); attr(status, 'aria-live', 'polite');
    const actions = node('div', 'okw-pool-actions');
    const retry = button('okw-pool-retry');
    const cancel = button('okw-pool-cancel');
    const save = button('ui-button--primary okw-pool-save'); save.type = 'submit';
    actions.append(retry, cancel, save); footer.append(status, actions);
    form.append(head, body, footer); root.append(form); attr(root, 'aria-labelledby', title.id);
    return { root, form, title, count, close, body, intro, single, effort, content, cards, empty, add, limitation,
      chooser, back, searchLabel, ...picker, noCandidates: empty, status, cancel, save, retry, cardNodes: new Map() };
  };
  const buildCard = (alias, index, events) => {
    const root = node('fieldset', 'okw-pool-card'); root.dataset.model = alias;
    const legend = node('legend', 'okw-pool-model');
    const identity = node('p', 'okw-pool-identity');
    const defaultLabel = node('label', 'okw-pool-default');
    const radio = node('input'); radio.type = 'radio'; radio.name = 'okw-pool-default'; radio.value = alias;
    radio.id = `okw-pool-default-${index}`; defaultLabel.htmlFor = radio.id;
    const defaultText = node('span'); defaultLabel.append(radio, defaultText);
    const descriptionLabel = node('label', 'okw-pool-description-label');
    const description = node('textarea', 'okw-pool-description');
    description.id = `okw-pool-description-${index}`; description.rows = 3; descriptionLabel.htmlFor = description.id;
    const templates = node('div', 'okw-pool-templates');
    const templateHint = node('span', 'okw-pool-note');
    const strong = button('okw-pool-template'); const fast = button('okw-pool-template');
    strong.dataset.template = 'strong'; fast.dataset.template = 'fast';
    templates.append(templateHint, strong, fast);
    root.append(legend, identity, defaultLabel, descriptionLabel, description, templates);
    radio.addEventListener('change', () => { if (radio.checked) events.default(alias); });
    description.addEventListener('input', () => events.description(alias, description.value));
    strong.addEventListener('click', () => events.template(alias, 'strongText'));
    fast.addEventListener('click', () => events.template(alias, 'fastText'));
    return { root, legend, identity, radio, defaultText, descriptionLabel, description, templateHint, strong, fast };
  };
  const renderCard = (ui, alias, state) => {
    const words = copy();
    const model = state.data.models.find((item) => item.id === alias);
    text(ui.legend, model?.label || alias);
    text(ui.identity, [model?.provider, alias].filter(Boolean).join(' · '));
    text(ui.defaultText, words.default); ui.radio.checked = alias === state.draft.defaultModel;
    text(ui.descriptionLabel, words.description); attr(ui.description, 'placeholder', words.placeholder);
    const value = state.draft.entries.get(alias);
    if (ui.description.value !== value) ui.description.value = value;
    text(ui.templateHint, words.templates); text(ui.strong, words.strong); text(ui.fast, words.fast);
    ui.root.disabled = !!state.busy;
  };
  const renderCards = (state, events) => {
    const { ui } = state;
    for (const alias of state.draft.entries.keys()) {
      let card = ui.cardNodes.get(alias);
      if (!card) {
        card = buildCard(alias, ui.cardNodes.size, events);
        ui.cardNodes.set(alias, card); ui.cards.append(card.root);
      }
      renderCard(card, alias, state);
    }
  };
  const localize = (state) => {
    const words = copy(); const { ui } = state;
    ['title', 'single', 'add', 'back', 'retry', 'cancel'].forEach((key) => text(ui[key], words[key]));
    text(ui.noCandidates, words.empty);
    text(ui.close, '×'); attr(ui.close, 'aria-label', words.close);
    text(ui.limitation, words.deletion); text(ui.searchLabel, words.choose);
    attr(ui.search, 'placeholder', words.search); attr(ui.clear, 'aria-label', shared.copy().clear);
    attr(ui.list, 'aria-label', words.choose); attr(ui.chips, 'aria-label', shared.copy().providers);
    text(ui.count, words.count(state.draft?.entries.size ?? 0));
    const effort = state.data?.section?.defaultEffort;
    text(ui.effort, `${words.effort}: ${effort ? shared.effortLabel(effort) : words.auto}`);
    text(ui.save, words[state.busy === 'saving' ? 'saving' : 'save']);
    text(ui.intro, state.draft?.entries.size === 0 ? words.inherited : words.intro);
  };
  const renderVisibility = ({ ui, draft, data, adding }) => {
    ui.content.hidden = !draft || adding;
    ui.chooser.hidden = !draft || !adding;
    ui.noCandidates.hidden = !!draft?.entries.size;
    ui.single.hidden = !draft || draft.entries.size > 1;
    ui.effort.hidden = !data;
  };
  const renderButtons = (state) => {
    const { ui, busy, draft, adding, error } = state;
    ui.save.disabled = !!busy || !draft || adding || !window.__okwSubagentPoolApi.changed(draft);
    ui.retry.hidden = !error || !!busy || error === 'configChanged';
    for (const key of ['add', 'search', 'clear', 'back']) ui[key].disabled = !!busy;
    ui.cancel.disabled = busy === 'saving'; ui.close.disabled = busy === 'saving';
  };
  const statusText = (state) => {
    const status = state.busy || state.error || (state.saved ? 'saved' : '');
    if (!status) return '';
    return copy()[status] || shared.copy()[status] || shared.copy().requestFailed;
  };
  const renderState = (state) => {
    const { ui } = state;
    text(ui.status, statusText(state));
    ui.status.classList.toggle('is-error', !!state.error && !state.busy);
    attr(ui.root, 'aria-busy', !!state.busy);
    renderVisibility(state); renderButtons(state);
  };
  window.__okwSubagentPoolView = { copy, entry, localizeEntry, build, renderCards, localize, renderState };
}
