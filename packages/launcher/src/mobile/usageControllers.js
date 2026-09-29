{
  const MODEL_BATCH_SIZE = 40;
  const SUGGESTION_BATCH_SIZE = 40;
  const suggestionRateText = (suggestion, tokenKeys, tokenLabels) => {
    const kinds = {
      exact: '精确匹配',
      'exact-key': '目录键精确匹配',
      normalized: '标准化精确匹配',
      'provider-normalized': '供应商前缀匹配',
      'version-normalized': '版本后缀匹配',
      fuzzy: '模糊匹配',
    };
    const confidence = `${Math.round((suggestion.confidence ?? 0) * 100)}%`;
    const prices = tokenKeys.map((key, index) =>
      `${tokenLabels[index]} ${suggestion.rates?.[key] ?? '未提供'}`).join(' / ');
    return `${kinds[suggestion.matchKind] ?? '自动匹配'} ${confidence} · ${prices}`;
  };

  window.__okwUsageCreateModelPager = ({ by, fmt, getModels, renderModels }) => {
    let limit = MODEL_BATCH_SIZE;
    const render = () => {
      const models = getModels();
      const visible = models.slice(0, limit);
      renderModels(visible);
      window.__okwUsageSetCountHints(by, fmt, visible.length, models.length);
      const more = by('models-more');
      more.hidden = visible.length >= models.length;
      more.textContent = `继续显示 ${fmt(Math.min(MODEL_BATCH_SIZE, models.length - visible.length))} 项`;
    };
    return {
      render,
      reset() { limit = MODEL_BATCH_SIZE; render(); },
      showMore() { limit += MODEL_BATCH_SIZE; render(); },
    };
  };

  window.__okwUsageCreateSuggestionController = ({
    by, fmt, node, tokenKeys, tokenLabels, getModels, priceStatus, saveMappings,
  }) => {
    let limit = SUGGESTION_BATCH_SIZE;
    let signature = '';
    let selection = new Set();

    const items = () => getModels()
      .filter((model) => typeof model.modelId === 'string' && model.suggestion?.catalogKey);

    const updateSummary = (models) => {
      const selected = models.filter((item) => selection.has(item.modelId)).length;
      by('suggestions-summary').textContent =
        `已为 ${fmt(models.length)} 个真实模型 ID 生成建议，当前选择 ${fmt(selected)} 项。`;
      by('suggestions-save').disabled = selected === 0;
    };

    const toggle = (modelId, checked) => {
      if (checked) selection.add(modelId);
      else selection.delete(modelId);
      updateSummary(items());
    };

    const render = () => {
      const models = items();
      const current = models.map((item) => `${item.modelId}\0${item.suggestion.catalogKey}`).join('\n');
      if (current !== signature) {
        signature = current;
        selection = new Set(models.map((item) => item.modelId));
        limit = SUGGESTION_BATCH_SIZE;
      }
      const section = by('suggestions');
      section.hidden = models.length === 0;
      if (!models.length) return;
      const visible = models.slice(0, limit);
      window.__okwUsageRenderSuggestions(by('suggestions-list'), visible, selection, {
        node,
        rateText: (suggestion) => suggestionRateText(suggestion, tokenKeys, tokenLabels),
        toggleSuggestion: toggle,
      });
      const more = by('suggestions-more');
      more.hidden = visible.length >= models.length;
      more.textContent =
        `继续查看 ${fmt(Math.min(SUGGESTION_BATCH_SIZE, models.length - visible.length))} 项建议`;
      updateSummary(models);
    };

    const confirm = async () => {
      const selected = items().filter((item) => selection.has(item.modelId));
      if (!selected.length) {
        priceStatus('请至少选择一项自动匹配建议。', 'error');
        return;
      }
      const mappings = selected.map((item) => ({
        model: item.modelId,
        catalogKey: item.suggestion.catalogKey,
      }));
      by('suggestions-save').disabled = true;
      priceStatus(`正在保存 ${fmt(mappings.length)} 项模型映射…`);
      try {
        const outcome = await saveMappings(mappings);
        if (outcome.saved) {
          const message = `已一次保存 ${fmt(mappings.length)} 项模型映射。`;
          const failed = !outcome.redraw.ok && outcome.redraw.stage !== 'stale';
          const failure = outcome.redraw.error?.message ?? '请重新打开或刷新统计面板。';
          const failedMessage = `已一次保存 ${fmt(mappings.length)} 项模型映射，但统计面板重绘失败：${failure}`;
          priceStatus(failed ? failedMessage : message, failed ? 'error' : '');
        }
      } catch (error) {
        priceStatus(error.message, 'error');
      } finally {
        by('suggestions-save').disabled = false;
      }
    };

    return {
      render,
      confirm,
      showMore() { limit += SUGGESTION_BATCH_SIZE; render(); },
    };
  };
}
