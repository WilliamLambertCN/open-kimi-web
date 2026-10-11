{
  const labels = new Map([
    ['普通输入', 'Input'], ['缓存读取', 'Cache read'], ['缓存写入', 'Cache write'], ['输出', 'Output'],
    ['全部模型', 'All models'], ['全部工作区', 'All workspaces'], ['使用统计', 'Usage statistics'],
    ['所选范围内没有用量记录。', 'No usage records in the selected range.'],
    ['趋势图资源未加载，请刷新页面。', 'Trend resources did not load; refresh the page.'],
    ['趋势图暂不可用；汇总、分布和明细仍可查看。请刷新页面。',
      'Trend unavailable; summary, distribution and details remain available. Refresh the page.'],
    ['当前数据源不支持使用统计。', 'Usage statistics are unavailable for this data source.'],
    ['当前目标不是受管本机 Kimi 后端，无法确认本机历史数据属于该服务。',
      'Not a managed local Kimi backend; local history cannot be attributed to this service.'],
    ['请选择有效的起止时间，结束时间须晚于开始时间。', 'Choose valid times; the end must be after the start.'],
    ['正在载入使用统计…', 'Loading usage statistics…'], ['内置快照', 'Built-in snapshot'],
    ['输入至少 2 个字符查找公开目录；可用供应商、模型名或模型 ID 搜索。',
      'Enter at least 2 characters to search by provider, model name or model ID.'],
    ['输入至少 2 个字符搜索目录', 'Enter at least 2 characters to search'], ['选择目录模型', 'Choose a catalog model'],
    ['未提供', 'Unavailable'], ['价格单位：USD / 百万 token。手动价格留空表示使用目录价格，0 表示免费。',
      'Prices: USD / million tokens. Leave manual prices blank to use catalog prices; 0 means free.'],
    ['选择真实模型 ID', 'Choose a confirmed model ID'], ['单价必须是非负数字。', 'Prices must be non-negative numbers.'],
    ['请先选择已确认的真实模型 ID。', 'Choose a confirmed model ID first.'],
    ['请选择目录模型或填写手动单价。', 'Choose a catalog model or enter manual prices.'],
    ['请重新打开或刷新统计面板。', 'Reopen or refresh the statistics panel.'],
    ['已移除映射和手动单价。', 'Mapping and manual prices removed.'], ['价格设置已保存。', 'Price settings saved.'],
    ['正在刷新公开价格目录…', 'Refreshing the public price catalog…'], ['价格目录已刷新。', 'Price catalog refreshed.'],
    ['精确匹配', 'Exact match'], ['目录键精确匹配', 'Exact catalog key'], ['标准化精确匹配', 'Normalized exact match'],
    ['供应商前缀匹配', 'Provider prefix match'], ['版本后缀匹配', 'Version suffix match'], ['模糊匹配', 'Fuzzy match'],
    ['自动匹配', 'Automatic match'], ['请至少选择一项自动匹配建议。', 'Select at least one match suggestion.'],
    ['当前单价估算，非实际账单', 'Estimated at current prices, not an actual bill'],
    ['暂无可定价金额', 'No priced amount'], ['已知部分小计', 'Known subtotal'], ['已知部分', 'Known portion'],
    ['最近时间', 'Recent range'], ['开始 · 本地时间', 'Start · Local time'], ['结束 · 本地时间', 'End · Local time'],
    ['搜索模型 ID', 'Search model ID'], ['搜索模型', 'Search models'], ['模型 ID', 'Model ID'], ['工作区', 'Workspace'],
    ['刷新数据', 'Refresh data'], ['总 token', 'Total tokens'], ['缓存命中率', 'Cache hit rate'],
    ['API 等值费用', 'API equivalent cost'], ['用量趋势', 'Usage trend'], ['模型分布', 'Model distribution'],
    ['模型分布，分批显示全部模型', 'Model distribution; all models shown in batches'], ['模型用量明细', 'Model usage details'],
    ['基础单价：USD / 百万 token，依次为普通输入 / 缓存读取 / 缓存写入 / 输出。长上下文按每次请求选档。',
      'Base prices: USD / million tokens, input / cache read / cache write / output. Long-context tiers apply per request.'],
    ['模型', 'Model'], ['命中率', 'Hit rate'], ['单价来源', 'Price source'], ['四类单价', 'Four token prices'],
    ['费用小计', 'Subtotal'], ['模型用量明细，分批显示全部模型', 'Model usage details; all models shown in batches'],
    ['继续显示模型', 'Show more models'], ['暂无模型明细。', 'No model details.'],
    ['价格与模型 ID 映射', 'Prices and model ID mappings'],
    ['按真实模型 ID 保存映射，别名仅辅助展示。当前目录单价估算 API 等值费用；历史渠道可能不同。' +
      '目录未包含的缓存 TTL、特殊模态等计费差异不计入估算。',
    'Mappings use actual model IDs; aliases are display-only. Costs use current catalog prices; ' +
      'historical providers may differ. ' +
      'Unlisted cache TTL and modality-specific charges are excluded.'],
    ['确认并保存所选建议', 'Confirm and save selected suggestions'], ['自动匹配建议', 'Automatic match suggestions'],
    ['继续查看建议', 'Show more suggestions'], ['搜索供应商或模型', 'Search providers or models'],
    ['搜索历史模型 ID', 'Search historical model IDs'], ['历史模型 ID', 'Historical model ID'],
    ['搜索价格目录', 'Search price catalog'], ['映射至目录模型', 'Map to catalog model'], ['目录价', 'Catalog price'],
    ['保存设置', 'Save settings'], ['恢复目录价格', 'Restore catalog prices'], ['移除映射', 'Remove mapping'],
    ['刷新价格目录', 'Refresh price catalog'], ['价格目录尚未载入。', 'Price catalog not loaded yet.'],
    ['未定价', 'Unpriced'], ['模型 ID 未确认', 'Unconfirmed model ID'], ['手动单价', 'Manual prices'], ['未映射', 'Unmapped'],
    ['本机已保存的 CLI、Web 与子 agent 用量', 'Locally saved CLI, Web and subagent usage'], ['关闭 ×', 'Close ×'],
    ['口径：按 Kimi 已记录的数据计算。缓存未上报可能记为 0；失败或中断且未落盘的请求不计入。' +
      'API 等值费用按当前单价估算，非实际账单。',
    'Based on Kimi recorded data. Unreported cache usage may be 0; unsaved failed or interrupted requests are excluded. ' +
      'API equivalent costs use current prices and are not an actual bill.'],
    ['等待载入…', 'Waiting to load…'], ['UTC 分桶 · 刻度按本地时间显示', 'UTC buckets · Labels use local time'],
    ['查看逐时段数据', 'View per-period data'], ['页面授权尚未就绪，请刷新页面后重试。', 'Authorization not ready; refresh and retry.'],
    ['页面授权已失效，请刷新页面。', 'Authorization expired; refresh the page.'],
    ['会话目录不可安全读取', 'Session directory cannot be read safely'], ['部分记录格式无效', 'Some records are invalid'],
    ['部分记录过大', 'Some records are oversized'], ['部分文件尾行未写完', 'Some trailing records are incomplete'],
    ['部分用量文件暂时不可读', 'Some usage files are unreadable'], ['达到扫描上限', 'Scan limit reached'],
    ['已排除 fork 继承的重复记录', 'Inherited fork duplicates excluded'], ['部分 fork 来源会话已不存在', 'Some fork sources are missing'],
    ['部分 fork 来源信息不可确认', 'Some fork sources are unverified'], ['部分调用的模型 ID 无法确认', 'Some model IDs are unconfirmed'],
    ['使用统计暂时不可用', 'Usage statistics temporarily unavailable'], ['单价格式无效', 'Invalid price format'],
    ['目录模型无效', 'Invalid catalog model'], ['目录模型不存在', 'Catalog model not found'], ['模型 ID 无效', 'Invalid model ID'],
    ['请选择目录模型或填写单价', 'Choose a catalog model or enter prices'], ['批量映射数量无效', 'Invalid batch size'],
    ['批量映射包含重复模型 ID', 'Duplicate model ID in batch'], ['请求内容过大', 'Request too large'],
    ['请求不是有效 JSON', 'Invalid request JSON'], ['公开价格目录暂时无法连接', 'Public price catalog unreachable'],
    ['公开价格目录响应过大', 'Public price catalog response too large'], ['公开价格目录响应为空', 'Empty public price catalog response'],
    ['公开价格目录 JSON 格式无效', 'Invalid public price catalog JSON'], ['公开价格目录格式无效', 'Invalid public price catalog'],
    ['models.dev 目录格式无效', 'Invalid models.dev catalog'], ['models.dev 目录为空', 'Empty models.dev catalog'],
    ['OpenRouter 目录格式无效', 'Invalid OpenRouter catalog'], ['OpenRouter 目录为空', 'Empty OpenRouter catalog'],
    ['时间分组无效', 'Invalid time grouping'], ['时间分组过多', 'Too many time groups'],
    ['查询参数无效', 'Invalid query parameters'], ['时间范围无效', 'Invalid time range'],
    ['模型 格式无效', 'Invalid model format'], ['工作区 格式无效', 'Invalid workspace format'],
    ['内置价格快照', 'Built-in price snapshot'],
  ]);
  const patterns = [
    [/^◫  使用统计$/, () => '◫  Usage statistics'],
    [/^手动单价 \+ (.+)$/, (_, source) => `Manual prices + ${english(source)}`],
    [/^(.+)（旧目录价格，目录项已消失）$/, (_, source) => `${english(source)} (retained price; catalog entry removed)`],
    [/^最近 (.+) 天$/, (_, days) => `Last ${days} days`],
    [/^(.+) · USD \/ 百万$/, (_, label) => `${english(label)} · USD / million`],
    [/^总输入 (.+) · (.+) 次请求$/, (_, input, requests) => `Total input ${input} · ${requests} requests`],
    [/^缓存读取 (.+) \/ 总输入 (.+)$/, (_, read, total) => `Cache read ${read} / Total input ${total}`],
    [/^(.+) · (.+) 次请求、(.+) token 未定价$/, (_, label, requests, tokens) =>
      `${english(label)} · ${requests} requests, ${tokens} tokens unpriced`],
    [/^(.+) · 已知部分$/, (_, value) => `${value} · Known portion`],
    [/^别名：(.+)$/, (_, aliases) => `Aliases: ${aliases}`],
    [/^(.+) 个时间段的 token 用量趋势$/, (_, count) => `Token usage trend for ${count} periods`],
    [/^继续显示 (.+) 项$/, (_, count) => `Show ${count} more`],
    [/^继续查看 (.+) 项建议$/, (_, count) => `Show ${count} more suggestions`],
    [/^已显示 (.+) \/ (.+) 项，可继续加载$/, (_, shown, count) => `${shown} / ${count} shown; load more`],
    [/^(.+) 项$/, (_, count) => `${count} items`],
    [/^已为 (.+) 个真实模型 ID 生成建议，当前选择 (.+) 项。$/, (_, total, selected) =>
      `Suggestions for ${total} model IDs; ${selected} selected.`],
    [/^正在保存 (.+) 项模型映射…$/, (_, count) => `Saving ${count} model mappings…`],
    [/^已一次保存 (.+) 项模型映射。$/, (_, count) => `Saved ${count} model mappings together.`],
    [/^已一次保存 (.+) 项模型映射，但统计面板重绘失败：(.+)$/, (_, count, failure) =>
      `Saved ${count} model mappings, but panel redraw failed: ${english(failure)}`],
    [/^已载入 (.+) 次请求 · 按 Kimi 已记录的数据计算$/, (_, count) => `Loaded ${count} requests · Based on Kimi recorded data`],
    [/^统计数据已载入，但面板重绘失败：(.+)$/, (_, failure) => `Data loaded, but panel redraw failed: ${english(failure)}`],
    [/^统计面板重绘失败：(.+)$/, (_, failure) => `Panel redraw failed: ${english(failure)}`],
    [/^(.+)，但统计面板重绘失败：(.+)$/, (_, success, failure) =>
      `${english(`${success}。`)} Panel redraw failed: ${english(failure)}`],
    [/^价格来源：(.+) · 更新：(.+)$/, (_, source, updated) => `Price source: ${english(source)} · Updated: ${english(updated)}`],
    [/^(.+) · 最近刷新失败：(.+)$/, (_, value, failure) => `${english(value)} · Last refresh failed: ${english(failure)}`],
    [/^旧版别名映射 (.+) 项已隔离，未用于真实模型 ID。请按实际模型 ID 重新选择价格。$/, (_, count) =>
      `${count} legacy alias mappings isolated, not applied to model IDs. Select prices by actual model ID.`],
    [/^找到 (.+) 项，当前显示前 200 项；继续输入可定位后部模型。$/, (_, count) =>
      `${count} results; showing the first 200. Refine your search for later models.`],
    [/^找到 (.+) 项。$/, (_, count) => `${count} results.`],
    [/^请求失败（(.+)）。$/, (_, status) => `Request failed (${status}).`],
    [/^公开价格目录返回 HTTP (.+)$/, (_, status) => `Public price catalog returned HTTP ${status}`],
  ];
  function english(value) {
    if (typeof value !== 'string') return value;
    if (labels.has(value)) return labels.get(value);
    const counted = value.match(/^(.*) \(([\d,.]+)\)$/);
    if (counted) return `${english(counted[1])} (${counted[2]})`;
    for (const [pattern, replace] of patterns) if (pattern.test(value)) return value.replace(pattern, replace);
    return value;
  }
  const text = (value) => window.__okwLocale?.current() === 'en' ? english(value) : value;
  const bindings = new Map();
  const bind = (node, value, attribute) => {
    let fields = bindings.get(node);
    if (!fields) { fields = new Map(); bindings.set(node, fields); }
    fields.set(attribute, value);
    const translated = text(value);
    if (attribute) {
      if (node.getAttribute(attribute) !== translated) node.setAttribute(attribute, translated);
    } else if (node.textContent !== translated) node.textContent = translated;
    return node;
  };
  window.__okwUsageText = text;
  window.__okwUsageBind = bind;
  window.__okwUsageCreateNode = (tag, className, content, localized = true) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) {
      if (localized && /\p{Script=Han}/u.test(String(content))) bind(node, content);
      else node.textContent = content;
    }
    return node;
  };
  window.__okwUsageObserveCopy = (refresh) => window.__okwLocale?.observe(() => {
    window.__okwUsageRefreshCopy();
    refresh();
  });
  window.__okwUsageRefreshCopy = () => {
    bindings.forEach((fields, node) => {
      if (!node.isConnected) { bindings.delete(node); return; }
      fields.forEach((value, attribute) => bind(node, value, attribute));
    });
  };
}
