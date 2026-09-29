{
  const entryAnchors = '.side-footer, .sheet-body > .actions, .sheet-body > .view-tabs';
  const entryNodes = `${entryAnchors}, .okw-usage-entry, .okw-usage-mobile-entry`;

  const affectsEntries = (record) => {
    if (record.target.nodeType === 1 && record.target.closest(entryAnchors)) return true;
    return [...record.addedNodes, ...record.removedNodes].some((node) =>
      node.nodeType === 1 && (node.matches(entryNodes) || node.querySelector(entryNodes)));
  };

  window.__okwUsageObserveEntries = (mount) => {
    new MutationObserver((records) => {
      if (records.some(affectsEntries)) mount();
    }).observe(document.documentElement, { childList: true, subtree: true });
  };

  window.__okwUsageCreateRenderers = ({ by, node, fmt, rate, usd }) => {
    const setStatus = (name, message, kind = '') => {
      const status = by(name);
      status.textContent = message;
      status.dataset.kind = kind;
    };
    const renderSummary = (data) => {
      const totals = data.totals ?? {};
      by('total').textContent = fmt(totals.totalTokens);
      by('total-sub').textContent = `总输入 ${fmt(totals.totalInput)} · ${fmt(totals.requests)} 次请求`;
      by('hit').textContent = rate(totals.cacheHitRate);
      by('hit-sub').textContent = `缓存读取 ${fmt(totals.cacheRead)} / 总输入 ${fmt(totals.totalInput)}`;
      by('cost').textContent = usd(totals.costUsd);
      by('cost-sub').textContent = totals.costComplete
        ? '当前单价估算，非实际账单'
        : `${totals.costUsd == null ? '暂无可定价金额' : '已知部分小计'} · ` +
          `${fmt(totals.unpricedRequests)} 次请求、${fmt(totals.unpricedTokens)} token 未定价`;
      by('cost-sub').classList.toggle('okw-usage-warning', !totals.costComplete);
    };
    const renderBars = (host, items, labelOf) => {
      host.replaceChildren();
      const maximum = Math.max(1, ...items.map((item) => item.totalTokens ?? 0));
      for (const item of items) {
        const row = node('div', 'okw-usage-bar-row');
        const label = node('span', 'okw-usage-bar-label', labelOf(item));
        if (item.aliases?.length) label.title = `别名：${item.aliases.join('、')}`;
        const track = node('span', 'okw-usage-bar-track');
        const fill = node('span', 'okw-usage-bar-fill');
        fill.style.width = `${Math.max(0, (item.totalTokens ?? 0) / maximum * 100)}%`;
        track.append(fill);
        row.append(label, track, node('strong', 'okw-usage-bar-value', fmt(item.totalTokens)));
        host.append(row);
      }
      if (items.length === 0) host.append(node('p', 'okw-usage-muted', '所选范围内没有用量记录。'));
    };
    const showQuality = (quality) => {
      const host = by('quality');
      host.replaceChildren();
      for (const note of quality?.notes ?? []) {
        host.append(node('p', '', `${note.message}${note.count == null ? '' : `（${fmt(note.count)}）`}`));
      }
      host.hidden = host.childElementCount === 0;
    };
    return {
      setStatus: (message, kind) => setStatus('status', message, kind),
      priceStatus: (message, kind) => setStatus('price-status', message, kind),
      renderSummary, renderBars, showQuality,
    };
  };

  const field = (node, label, control) => {
    const wrapper = node('label', 'okw-usage-field');
    wrapper.append(node('span', '', label), control);
    return wrapper;
  };

  const input = (node, type) => {
    const control = node('input');
    control.type = type;
    return control;
  };

  const mark = (element, name) => { element.dataset.usage = name; return element; };

  const buildControls = ({ node, button, setPreset, loadData, fillFilterModels }) => {
    const controls = node('div', 'okw-usage-controls');
    const presets = node('div', 'okw-usage-presets');
    presets.setAttribute('role', 'group');
    presets.setAttribute('aria-label', '最近时间');
    for (const [name, days] of [['1d', 1], ['3d', 3], ['1w', 7], ['1m', 30], ['2m', 60], ['3m', 90]]) {
      const item = button('', name, () => setPreset(name, days));
      item.dataset.preset = name;
      item.title = `最近 ${days} 天`;
      presets.append(item);
    }
    controls.append(presets);
    const filters = node('div', 'okw-usage-filters');
    const from = mark(input(node, 'datetime-local'), 'from');
    const to = mark(input(node, 'datetime-local'), 'to');
    [from, to].forEach((control) => control.addEventListener('change', () => {
      controls.querySelectorAll('[data-preset]').forEach((item) => item.setAttribute('aria-pressed', 'false'));
      loadData();
    }));
    filters.append(field(node, '开始 · 本地时间', from), field(node, '结束 · 本地时间', to));
    const modelSearch = mark(input(node, 'search'), 'model-search');
    modelSearch.placeholder = '搜索模型 ID';
    modelSearch.addEventListener('input', fillFilterModels);
    const model = mark(node('select'), 'model');
    const workspace = mark(node('select'), 'workspace');
    model.addEventListener('change', loadData);
    workspace.addEventListener('change', loadData);
    filters.append(field(node, '搜索模型', modelSearch), field(node, '模型 ID', model),
      field(node, '工作区', workspace),
      mark(button('okw-usage-refresh', '刷新数据', loadData), 'refresh'));
    controls.append(filters);
    return controls;
  };

  const buildOverview = ({ node, button, showMoreModels }) => {
    const content = mark(node('div', 'okw-usage-content'), 'content');
    const summary = node('div', 'okw-usage-summary');
    for (const [name, label] of [['total', '总 token'], ['hit', '缓存命中率'], ['cost', 'API 等值费用']]) {
      const card = node('article', 'okw-usage-card');
      card.append(node('p', '', label), mark(node('strong', '', '—'), name),
        mark(node('small', '', ''), `${name}-sub`));
      summary.append(card);
    }
    content.append(summary);
    const charts = node('div', 'okw-usage-charts');
    for (const [name, label] of [['trend', '用量趋势'], ['distribution', '模型分布']]) {
      const section = node('section', 'okw-usage-section');
      section.setAttribute('aria-label', label);
      const chart = node('div', name === 'trend' ? 'okw-usage-trend' : 'okw-usage-bars');
      if (name === 'distribution') {
        chart.tabIndex = 0;
        chart.setAttribute('role', 'region');
        chart.setAttribute('aria-label', '模型分布，分批显示全部模型');
      }
      section.append(node('h3', '', label));
      if (name === 'distribution') section.append(mark(node('p', 'okw-usage-scroll-hint'), 'distribution-count'));
      section.append(mark(chart, name));
      charts.append(section);
    }
    content.append(charts);
    const detail = node('section', 'okw-usage-section okw-usage-table-section');
    detail.append(node('h3', '', '模型用量明细'));
    detail.append(node('p', 'okw-usage-disclosure',
      '基础单价：USD / 百万 token，依次为普通输入 / 缓存读取 / 缓存写入 / 输出。长上下文按每次请求选档。'));
    detail.append(mark(node('p', 'okw-usage-scroll-hint'), 'table-count'));
    const table = node('table', 'okw-usage-table');
    table.setAttribute('aria-label', '模型用量明细');
    const thead = node('thead');
    const row = node('tr');
    ['模型', '普通输入', '缓存读取', '缓存写入', '输出', '总 token', '命中率', '单价来源', '四类单价', '费用小计']
      .forEach((label) => row.append(node('th', '', label)));
    thead.append(row);
    table.append(thead, mark(node('tbody'), 'table-body'));
    const scroller = node('div', 'okw-usage-table-scroll');
    scroller.tabIndex = 0;
    scroller.setAttribute('role', 'region');
    scroller.setAttribute('aria-label', '模型用量明细，分批显示全部模型');
    scroller.append(table);
    const more = mark(button('okw-usage-more', '继续显示模型', showMoreModels), 'models-more');
    more.hidden = true;
    detail.append(scroller, more, mark(node('p', 'okw-usage-muted', '暂无模型明细。'), 'table-empty'));
    content.append(detail, mark(node('div', 'okw-usage-quality'), 'quality'));
    return content;
  };

  const buildPricing = ({ node, button, by, showMapping, fillCatalog, fillEditModels,
    showCatalogRateHint, saveMapping, refreshCatalog, confirmSuggestions, showMoreSuggestions }) => {
    const edit = node('section', 'okw-usage-section okw-usage-pricing');
    edit.append(node('h3', '', '价格与模型 ID 映射'), node('p', 'okw-usage-muted',
      '按真实模型 ID 保存映射，别名仅辅助展示。当前目录单价估算 API 等值费用；历史渠道可能不同。' +
      '目录未包含的缓存 TTL、特殊模态等计费差异不计入估算。'));
    edit.append(mark(node('p', 'okw-usage-legacy-warning'), 'legacy-warning'));
    const suggestions = mark(node('div', 'okw-usage-suggestions'), 'suggestions');
    suggestions.hidden = true;
    const suggestionActions = node('div', 'okw-usage-price-actions okw-usage-suggestion-actions');
    suggestionActions.append(mark(
      button('okw-usage-primary', '确认并保存所选建议', confirmSuggestions),
      'suggestions-save',
    ));
    suggestions.append(
      node('h4', '', '自动匹配建议'),
      mark(node('p', 'okw-usage-muted'), 'suggestions-summary'),
      suggestionActions,
      mark(node('div', 'okw-usage-suggestion-list'), 'suggestions-list'),
      mark(button('okw-usage-more', '继续查看建议', showMoreSuggestions), 'suggestions-more'),
    );
    edit.append(suggestions);
    const editor = node('div', 'okw-usage-editor');
    const editSearch = mark(input(node, 'search'), 'edit-model-search');
    editSearch.placeholder = '搜索模型 ID';
    editSearch.addEventListener('input', fillEditModels);
    const editModel = mark(node('select'), 'edit-model');
    editModel.addEventListener('change', showMapping);
    const search = mark(input(node, 'search'), 'catalog-search');
    search.placeholder = '搜索供应商或模型';
    search.addEventListener('input', fillCatalog);
    const catalog = mark(node('select'), 'catalog');
    catalog.addEventListener('change', showCatalogRateHint);
    editor.append(field(node, '搜索历史模型 ID', editSearch), field(node, '历史模型 ID', editModel),
      field(node, '搜索价格目录', search), field(node, '映射至目录模型', catalog));
    edit.append(editor, mark(node('p', 'okw-usage-muted'), 'catalog-results'),
      mark(node('p', 'okw-usage-muted'), 'catalog-rate'));
    const rates = node('div', 'okw-usage-rates');
    for (const [key, label] of [
      ['input', '普通输入'], ['cacheRead', '缓存读取'], ['cacheWrite', '缓存写入'], ['output', '输出'],
    ]) {
      const control = mark(input(node, 'number'), `rate-${key}`);
      control.min = '0';
      control.step = 'any';
      control.placeholder = '目录价';
      rates.append(field(node, `${label} · USD / 百万`, control));
    }
    edit.append(rates);
    const actions = node('div', 'okw-usage-price-actions');
    actions.append(mark(button('okw-usage-primary', '保存设置', () => saveMapping()), 'save'),
      button('', '恢复目录价格', () => {
        ['input', 'cacheRead', 'cacheWrite', 'output'].forEach((key) => { by(`rate-${key}`).value = ''; });
        saveMapping();
      }), button('', '移除映射', () => saveMapping(true)),
      mark(button('', '刷新价格目录', refreshCatalog), 'price-refresh'));
    const status = mark(node('p', 'okw-usage-muted', '价格目录尚未载入。'), 'price-status');
    status.setAttribute('role', 'status');
    edit.append(actions, status);
    return edit;
  };

  window.__okwUsageRenderTable = (body, empty, models, { node, fmt, rate, usd, tokenKeys, tokenLabels }) => {
    body.replaceChildren();
    for (const model of models) {
      const row = node('tr');
      const prices = tokenKeys.map((key) => model.price?.rates?.[key] ?? '—').join(' / ');
      const cost = model.costUsd == null ? '未定价'
        : `${usd(model.costUsd)}${model.costComplete ? '' : ' · 已知部分'}`;
      const source = model.modelId == null ? '模型 ID 未确认'
        : model.price?.source === 'manual' ? '手动单价' : model.price?.source ?? '未映射';
      const values = [model.model, ...tokenKeys.map((key) => fmt(model[key])),
        fmt(model.totalTokens), rate(model.cacheHitRate), source, prices, cost];
      const labels = ['模型', ...tokenLabels, '总 token', '命中率', '单价来源', '四类单价', '费用小计'];
      values.forEach((value, index) => {
        const cell = node(index === 0 ? 'th' : 'td', '', value);
        cell.dataset.label = labels[index];
        if (index === 0) {
          cell.scope = 'row';
          if (model.aliases?.length) cell.append(node('small', 'okw-usage-aliases', `别名：${model.aliases.join('、')}`));
        }
        row.append(cell);
      });
      body.append(row);
    }
    empty.hidden = models.length > 0;
  };

  window.__okwUsageRenderSuggestions = (host, items, selected, { node, rateText, toggleSuggestion }) => {
    host.replaceChildren();
    for (const item of items) {
      const suggestion = item.suggestion;
      const row = node('label', 'okw-usage-suggestion-row');
      const control = node('input');
      control.type = 'checkbox';
      control.checked = selected.has(item.modelId);
      control.addEventListener('change', (event) => toggleSuggestion(item.modelId, event.target.checked));
      const content = node('span', 'okw-usage-suggestion-copy');
      content.append(node('strong', '', item.modelId),
        node('span', '', `→ ${suggestion.provider} / ${suggestion.name}`),
        node('small', '', `${rateText(suggestion)} · ${suggestion.catalogKey}`));
      row.append(control, content);
      host.append(row);
    }
  };

  window.__okwUsageSetCountHints = (by, fmt, shown, count) => {
    for (const [name, limit] of [['distribution', 8], ['table', 5]]) {
      const hint = by(`${name}-count`);
      hint.textContent = shown < count
        ? `已显示 ${fmt(shown)} / ${fmt(count)} 项，可继续加载`
        : `${fmt(count)} 项`;
      hint.hidden = count <= limit;
    }
  };

  window.__okwUsageBuildPanel = (actions) => {
    const { node, button, close } = actions;
    const backdrop = node('div', 'okw-usage-backdrop');
    backdrop.hidden = true;
    backdrop.addEventListener('pointerdown', (event) => {
      if (event.target === backdrop) close();
    });
    const dialog = node('section', 'okw-usage-panel');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'okw-usage-title');
    const head = node('header', 'okw-usage-head');
    const title = node('div');
    title.append(node('p', 'okw-usage-eyebrow', 'OPEN KIMI WEB · ANALYTICS'));
    const heading = node('h2', '', '使用统计');
    heading.id = 'okw-usage-title';
    title.append(heading, node('p', 'okw-usage-muted', '本机已保存的 CLI、Web 与子 agent 用量'));
    head.append(title, button('okw-usage-close', '关闭 ×', close));
    const content = buildOverview(actions);
    content.append(buildPricing(actions));
    const note = node('p', 'okw-usage-disclosure',
      '口径：按 Kimi 已记录的数据计算。缓存未上报可能记为 0；失败或中断且未落盘的请求不计入。' +
      'API 等值费用按当前单价估算，非实际账单。');
    const status = mark(node('p', 'okw-usage-status', '等待载入…'), 'status');
    status.setAttribute('role', 'status');
    dialog.append(head, buildControls(actions), status, note, content);
    backdrop.append(dialog);
    document.body.append(backdrop);
    return backdrop;
  };
}
