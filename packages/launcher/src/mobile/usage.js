if (!window.__okwUsageInstalled) {
  window.__okwUsageInstalled = true;
  const API = window.__okwUsageApiPath;
  const TOKEN_KEYS = ['input', 'cacheRead', 'cacheWrite', 'output'];
  const TOKEN_LABELS = ['普通输入', '缓存读取', '缓存写入', '输出'];
  const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
  const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });
  let panel;
  let entry;
  let mobileEntry;
  let activeEntry;
  let result;
  let pricing;
  let modelPager;
  let suggestions;
  let requestGeneration = 0;
  let pricingGeneration = 0;
  let opened = false;
  let appWasInert = false;
  const api = window.__okwUsageCreateApi();
  const node = (tag, className, content) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  };
  const button = (className, content, action) => {
    const element = node('button', className, content);
    element.type = 'button';
    element.addEventListener('click', action);
    return element;
  };
  const by = (name) => panel.querySelector(`[data-usage="${name}"]`);
  const fmt = (value) => number.format(Number.isFinite(Number(value)) ? Number(value) : 0);
  const usd = (value) => value == null ? '—' : money.format(value);
  const rate = (value) => value == null ? '—' : `${(value * 100).toFixed(1)}%`;
  const shortDate = (value) => new Date(value).toLocaleString(undefined, {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const localInput = (value) => {
    const date = new Date(value);
    const pad = (part) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  const setStatus = (message, kind = '') => {
    const status = by('status');
    status.textContent = message;
    status.dataset.kind = kind;
  };
  const fillSelect = (control, choices, placeholder) => {
    const previous = control.value;
    control.replaceChildren();
    const all = node('option', '', placeholder);
    all.value = '';
    control.append(all);
    for (const choice of choices ?? []) {
      const option = node('option', '', choice.label ?? choice.id);
      option.value = choice.id;
      control.append(option);
    }
    control.value = Array.from(control.options).some((option) => option.value === previous) ? previous : '';
  };
  const matchesSearch = (item, query) => [item.id, item.label, item.modelId]
    .some((part) => String(part ?? '').toLocaleLowerCase().includes(query));
  const searchableChoices = (choices, query, selected) => {
    const found = choices.filter((item) => matchesSearch(item, query));
    const selectedChoice = choices.find((item) => item.id === selected);
    if (selectedChoice && !found.includes(selectedChoice)) found.unshift(selectedChoice);
    return found;
  };

  const fillFilterModels = () => {
    const choices = result?.modelOptions ?? [];
    const query = by('model-search').value.trim().toLocaleLowerCase();
    fillSelect(by('model'), searchableChoices(choices, query, by('model').value), '全部模型');
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

  const renderTrend = (items, bucket) => window.__okwUsageRenderTrend(
    by('trend'), items, bucket, { node, fmt, shortDate },
  );

  const renderTable = (models) => window.__okwUsageRenderTable(
    by('table-body'), by('table-empty'), models,
    { node, fmt, rate, usd, tokenKeys: TOKEN_KEYS, tokenLabels: TOKEN_LABELS },
  );

  const showQuality = (quality) => {
    const host = by('quality');
    host.replaceChildren();
    for (const note of quality?.notes ?? []) {
      host.append(node('p', '', `${note.message}${note.count == null ? '' : `（${fmt(note.count)}）`}`));
    }
    host.hidden = host.childElementCount === 0;
  };

  const renderData = (data) => {
    result = data;
    if (data.available === false) {
      by('content').hidden = true;
      setStatus(data.message ?? '当前数据源不支持使用统计。', 'error');
      return;
    }
    by('content').hidden = false;
    fillFilterModels();
    fillSelect(by('workspace'), data.workspaces, '全部工作区');
    renderSummary(data);
    renderTrend(data.buckets ?? [], data.range?.bucket);
    modelPager.reset();
    showQuality(data.quality);
    fillEditModels();
    suggestions.render();
    const requests = data.totals?.requests ?? 0;
    setStatus(requests ? `已载入 ${fmt(requests)} 次请求 · 按 Kimi 已记录的数据计算` : '所选范围内没有用量记录。');
  };

  const range = () => {
    const from = new Date(by('from').value).getTime();
    const to = new Date(by('to').value).getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
      throw new Error('请选择有效的起止时间，结束时间须晚于开始时间。');
    }
    return { from, to };
  };

  const dataQuery = (dates) => {
    const query = new URLSearchParams({
      from: String(dates.from), to: String(dates.to),
      bucket: dates.to - dates.from <= 3 * 86400000 ? 'hour' : 'day',
    });
    for (const name of ['model', 'workspace']) {
      const value = by(name).value;
      if (value) query.set(name, value);
    }
    return query;
  };

  const loadData = async () => {
    const generation = ++requestGeneration;
    let dates;
    try { dates = range(); } catch (error) { setStatus(error.message, 'error'); return; }
    setStatus('正在载入使用统计…');
    by('refresh').disabled = true;
    try {
      const data = await api(`${API}?${dataQuery(dates)}`);
      if (generation === requestGeneration && opened) renderData(data);
    } catch (error) {
      if (generation === requestGeneration && opened) setStatus(error.message, 'error');
    } finally {
      if (generation === requestGeneration) by('refresh').disabled = false;
    }
  };

  const setPreset = (name, days) => {
    const to = Date.now();
    by('from').value = localInput(to - days * 86400000);
    by('to').value = localInput(to);
    panel.querySelectorAll('[data-preset]').forEach((item) => {
      item.setAttribute('aria-pressed', String(item.dataset.preset === name));
    });
    loadData();
  };

  const priceStatus = (message, kind = '') => {
    const status = by('price-status');
    status.textContent = message;
    status.dataset.kind = kind;
  };

  const renderPricingStatus = () => {
    if (!pricing) return;
    const updated = pricing.updatedAt ? shortDate(pricing.updatedAt) : '内置快照';
    const error = pricing.lastRefreshError ? ` · 最近刷新失败：${pricing.lastRefreshError}` : '';
    priceStatus(`价格来源：${pricing.source ?? '内置快照'} · 更新：${updated}${error}`,
      pricing.lastRefreshError ? 'error' : '');
    const ignored = Number(pricing.legacyMappingsIgnored) || 0;
    by('legacy-warning').textContent = ignored
      ? `旧版别名映射 ${fmt(ignored)} 项已隔离，未用于真实模型 ID。请按实际模型 ID 重新选择价格。`
      : '';
    by('legacy-warning').hidden = ignored === 0;
  };

  const catalogMatches = () => {
    const query = by('catalog-search').value.trim().toLocaleLowerCase();
    const catalog = pricing?.catalog ?? [];
    if (query.length < 2 && catalog.length > 200) return { entries: [], total: 0 };
    const matches = catalog.filter((item) => [
      item.name, item.modelId, item.providerName, item.providerId, item.key,
    ].some((part) => String(part ?? '').toLocaleLowerCase().includes(query)));
    return { entries: matches.slice(0, 200), total: matches.length };
  };

  const catalogResultsText = (query, total, large) => {
    if (query.length < 2 && large) {
      return '输入至少 2 个字符查找公开目录；可用供应商、模型名或模型 ID 搜索。';
    }
    return total > 200 ? `找到 ${fmt(total)} 项，当前显示前 200 项；继续输入可定位后部模型。`
      : `找到 ${fmt(total)} 项。`;
  };

  const fillCatalog = () => {
    const current = by('catalog').value;
    const catalog = by('catalog');
    const { entries, total } = catalogMatches();
    catalog.replaceChildren();
    const large = (pricing?.catalog?.length ?? 0) > 200;
    const empty = node('option', '', large ? '输入至少 2 个字符搜索目录' : '选择目录模型');
    empty.value = '';
    catalog.append(empty);
    const currentItem = (pricing?.catalog ?? []).find((item) => item.key === current);
    const choices = currentItem ? [currentItem, ...entries.filter((item) => item !== currentItem)] : entries;
    for (const item of choices) {
      const option = node('option', '', `${item.providerName} / ${item.name} · ${item.modelId}`);
      option.value = item.key;
      catalog.append(option);
    }
    if (Array.from(catalog.options).some((option) => option.value === current)) catalog.value = current;
    const query = by('catalog-search').value.trim();
    by('catalog-results').textContent = catalogResultsText(query, total, large);
    showCatalogRateHint();
  };

  const showCatalogRateHint = () => {
    const item = (pricing?.catalog ?? []).find((entry) => entry.key === by('catalog').value);
    by('catalog-rate').textContent = item
      ? TOKEN_KEYS.map((key, index) => `${TOKEN_LABELS[index]} ${item.rates?.[key] ?? '未提供'}`).join(' · ')
      : '价格单位：USD / 百万 token。手动价格留空表示使用目录价格，0 表示免费。';
  };

  const fillEditModels = () => {
    const previous = by('edit-model').value;
    const choices = new Map();
    const confirmed = (result?.modelOptions ?? [])
      .filter((item) => typeof item.modelId === 'string' && item.modelId);
    for (const item of confirmed) {
      choices.set(item.modelId, { id: item.modelId, label: item.modelId, modelId: item.modelId });
    }
    for (const modelId of Object.keys(pricing?.mappings ?? {})) {
      choices.set(modelId, { id: modelId, label: modelId, modelId });
    }
    const query = by('edit-model-search').value.trim().toLocaleLowerCase();
    const all = [...choices.values()].sort((left, right) => left.id.localeCompare(right.id));
    fillSelect(by('edit-model'), searchableChoices(all, query, by('edit-model').value), '选择真实模型 ID');
    if (by('edit-model').value !== previous) showMapping();
  };

  const showMapping = () => {
    const modelId = by('edit-model').value;
    const mapping = Object.hasOwn(pricing?.mappings ?? {}, modelId) ? pricing.mappings[modelId] : null;
    by('catalog-search').value = '';
    fillCatalog();
    by('catalog').value = mapping?.catalogKey ?? '';
    if (mapping?.catalogKey && !Array.from(by('catalog').options).some((item) => item.value === mapping.catalogKey)) {
      const option = node('option', '', mapping.catalogKey);
      option.value = mapping.catalogKey;
      by('catalog').append(option);
      by('catalog').value = mapping.catalogKey;
    }
    TOKEN_KEYS.forEach((key) => { by(`rate-${key}`).value = mapping?.rates?.[key] ?? ''; });
    showCatalogRateHint();
  };

  const loadPricing = async () => {
    const generation = ++pricingGeneration;
    try {
      const data = await api(`${API}/pricing`);
      if (generation !== pricingGeneration) return;
      pricing = data;
      renderPricingStatus();
      fillCatalog();
      fillEditModels();
      suggestions.render();
    } catch (error) {
      if (generation === pricingGeneration && opened) priceStatus(error.message, 'error');
    }
  };

  const manualRates = () => {
    const rates = {};
    for (const key of TOKEN_KEYS) {
      const raw = by(`rate-${key}`).value.trim();
      if (!raw) continue;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) throw new Error('单价必须是非负数字。');
      rates[key] = parsed;
    }
    return rates;
  };

  const mappingPayload = (model, remove) => {
    if (remove) return { model, remove: true };
    const rates = manualRates();
    const catalogKey = by('catalog').value || null;
    if (!catalogKey && Object.keys(rates).length === 0) {
      throw new Error('请选择目录模型或填写手动单价。');
    }
    return { model, catalogKey, ...(Object.keys(rates).length ? { rates } : {}) };
  };

  const saveMapping = async (remove = false) => {
    const model = by('edit-model').value;
    if (!model) { priceStatus('请先选择已确认的真实模型 ID。', 'error'); return; }
    let payload;
    try { payload = mappingPayload(model, remove); }
    catch (error) { priceStatus(error.message, 'error'); return; }
    const generation = ++pricingGeneration;
    by('save').disabled = true;
    try {
      const data = await api(`${API}/pricing`, { method: 'PUT', body: JSON.stringify(payload) });
      if (generation !== pricingGeneration) return;
      pricing = data;
      renderPricingStatus();
      fillEditModels();
      by('edit-model').value = model;
      showMapping();
      priceStatus(remove ? '已移除映射和手动单价。' : '价格设置已保存。');
      await loadData();
    } catch (error) {
      if (generation === pricingGeneration && opened) priceStatus(error.message, 'error');
    } finally {
      if (generation === pricingGeneration) by('save').disabled = false;
    }
  };

  const refreshCatalog = async () => {
    const generation = ++pricingGeneration;
    by('price-refresh').disabled = true;
    priceStatus('正在刷新公开价格目录…');
    try {
      const data = await api(`${API}/pricing:refresh`, { method: 'POST' });
      if (generation !== pricingGeneration || !opened) return;
      pricing = data;
      renderPricingStatus();
      fillCatalog();
      await loadData();
    } catch (error) {
      if (generation === pricingGeneration && opened) priceStatus(error.message, 'error');
    } finally {
      if (generation === pricingGeneration) by('price-refresh').disabled = false;
    }
  };

  const saveSuggestedMappings = async (mappings) => {
    const generation = ++pricingGeneration;
    try {
      const data = await api(`${API}/pricing`, {
        method: 'PUT', body: JSON.stringify({ mappings }),
      });
      if (generation !== pricingGeneration || !opened) return false;
      pricing = data;
      renderPricingStatus();
      fillEditModels();
      await loadData();
      return true;
    } catch (error) {
      if (generation === pricingGeneration && opened) throw error;
      return false;
    }
  };

  const buildPanel = () => window.__okwUsageBuildPanel({
    node, button, close, setPreset, loadData, fillFilterModels, fillEditModels,
    showMapping, fillCatalog, showCatalogRateHint, saveMapping, refreshCatalog, by,
    showMoreModels: () => modelPager.showMore(),
    confirmSuggestions: () => suggestions.confirm(),
    showMoreSuggestions: () => suggestions.showMore(),
  });

  const initializePanel = () => {
    panel = buildPanel();
    const getModels = () => result?.models ?? [];
    modelPager = window.__okwUsageCreateModelPager({
      by, fmt, getModels,
      renderModels: (models) => {
        renderBars(by('distribution'), models, (item) => item.model);
        renderTable(models);
      },
    });
    suggestions = window.__okwUsageCreateSuggestionController({
      by, fmt, node, tokenKeys: TOKEN_KEYS, tokenLabels: TOKEN_LABELS,
      getModels, priceStatus, saveMappings: saveSuggestedMappings,
    });
  };

  function close() {
    if (!panel || !opened) return;
    opened = false;
    requestGeneration += 1;
    pricingGeneration += 1;
    panel.hidden = true;
    const app = document.querySelector('#app');
    if (app) app.inert = appWasInert;
    by('refresh').disabled = false;
    by('save').disabled = false;
    by('suggestions-save').disabled = false;
    by('price-refresh').disabled = false;
    document.documentElement.classList.remove('okw-usage-open');
    const returnTarget = activeEntry?.isConnected ? activeEntry
      : document.querySelector('.app.mobile .topbar .tb-main') ?? entry;
    returnTarget?.focus();
  }

  const open = (event) => {
    activeEntry = event?.currentTarget ?? entry;
    if (!panel) initializePanel();
    opened = true;
    panel.hidden = false;
    const app = document.querySelector('#app');
    if (app) { appWasInert = app.inert; app.inert = true; }
    document.documentElement.classList.add('okw-usage-open');
    if (!by('from').value) setPreset('1w', 7);
    else loadData();
    loadPricing();
    by('from').focus();
  };

  const mountEntry = () => {
    const footer = document.querySelector('.side .side-footer');
    if (!footer) return;
    if (entry?.isConnected && entry.nextElementSibling === footer) return;
    entry?.remove();
    entry = button('okw-usage-entry', '◫  使用统计', open);
    entry.setAttribute('aria-label', '使用统计');
    entry.setAttribute('aria-haspopup', 'dialog');
    footer.before(entry);
  };

  const mountMobileEntry = () => {
    const actions = document.querySelector('.sheet-panel .sheet-body > .actions');
    if (!actions?.querySelectorAll(':scope > .newrow').length ||
      !actions.nextElementSibling?.classList.contains('view-tabs')) return;
    if (mobileEntry?.isConnected && mobileEntry.parentElement === actions) return;
    mobileEntry?.remove();
    mobileEntry = button('okw-usage-mobile-entry', '◫  使用统计', open);
    mobileEntry.setAttribute('aria-label', '使用统计');
    mobileEntry.setAttribute('aria-haspopup', 'dialog');
    actions.append(mobileEntry);
  };

  const mountEntries = () => { mountEntry(); mountMobileEntry(); };

  document.addEventListener('keydown', (event) => {
    if (!opened) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    if (event.key !== 'Tab') return;
    const focusables = [...panel.querySelectorAll('button, input, select, summary, [tabindex]')]
      .filter((item) => {
        if (item.disabled || item.tabIndex < 0) return false;
        let ancestor = item;
        while (ancestor && ancestor !== panel) {
          if (ancestor.hidden) return false;
          ancestor = ancestor.parentElement;
        }
        return true;
      });
    const first = focusables[0];
    const last = focusables.at(-1);
    if (!panel.contains(document.activeElement)) { event.preventDefault(); first?.focus(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }, true);
  window.__okwUsageObserveEntries(mountEntries);
  mountEntries();
}
