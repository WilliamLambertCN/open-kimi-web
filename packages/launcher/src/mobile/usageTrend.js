{
  window.__okwUsageRenderTrend = (host, items, bucket, { node, fmt, shortDate }) => {
    host.replaceChildren();
    if (items.length === 0) {
      host.append(node('p', 'okw-usage-muted', '所选范围内没有用量记录。'));
      return;
    }
    const width = 720;
    const baseline = 135;
    const maximum = Math.max(1, ...items.map((item) => item.totalTokens ?? 0));
    const barWidth = Math.max(1, width / items.length - 2);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} 140`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${items.length} 个时间段的 token 用量趋势`);
    items.forEach((item, index) => {
      const value = Math.max(0, Number(item.totalTokens) || 0);
      const barHeight = value / maximum * 115;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(index * width / items.length + 1));
      rect.setAttribute('y', String(baseline - barHeight));
      rect.setAttribute('width', String(barWidth));
      rect.setAttribute('height', String(barHeight));
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${shortDate(item.time)}：${fmt(value)} token`;
      rect.append(title);
      svg.append(rect);
    });
    host.append(svg);
    const labels = node('div', 'okw-usage-trend-labels');
    const count = Math.min(5, items.length);
    labels.style.gridTemplateColumns = `repeat(${count}, minmax(0, 1fr))`;
    for (let index = 0; index < count; index += 1) {
      const item = items[Math.round(index * (items.length - 1) / Math.max(1, count - 1))];
      const date = new Date(item.time);
      const text = bucket === 'hour'
        ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
        : date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
      const label = node('span', '', text);
      label.title = shortDate(item.time);
      labels.append(label);
    }
    host.append(labels, node('p', 'okw-usage-trend-zone', 'UTC 分桶 · 刻度按本地时间显示'));
    const details = node('details', 'okw-usage-trend-data');
    details.append(node('summary', '', '查看逐时段数据'));
    const list = node('ol');
    items.forEach((item) => list.append(node('li', '', `${shortDate(item.time)}：${fmt(item.totalTokens)} token`)));
    details.append(list);
    host.append(details);
  };
}
