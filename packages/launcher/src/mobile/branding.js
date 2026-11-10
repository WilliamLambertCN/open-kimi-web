{
  const installed = Symbol.for('open-kimi-web.branding');
  if (!window[installed]) {
    window[installed] = true;
    const name = 'OPEN-KIMI-WEB';
    const icon = '/__open-kimi-mobile/icons/app-192.png';
    const version = document.querySelector('meta[name="open-kimi-web-version"]')?.content ?? '';
    const brandSelector = '.side .ch-brand';
    const titleSelector = 'title, .chat-header .ch-id, .app.mobile > .topbar .tb-line';
    const brand = () => {
      for (const root of document.querySelectorAll(brandSelector)) {
        const label = root.querySelector('.ch-name');
        if (!label) continue;
        if (label.textContent !== name) label.textContent = name;
        if (!root.querySelector('.okw-app-icon')) {
          const image = document.createElement('img');
          image.className = 'okw-app-icon';
          image.src = icon;
          image.alt = '';
          image.width = image.height = 24;
          image.setAttribute('aria-hidden', 'true');
          root.prepend(image);
        }
        if (version && !root.querySelector('.okw-app-version')) {
          const detail = document.createElement('small');
          detail.className = 'okw-app-version';
          detail.textContent = `v${version}`;
          label.after(detail);
        }
      }
    };
    const title = () => {
      const heading = document.querySelector('.app:not(.mobile) > .con > .chat-header .ch-ses, ' +
        '.app.mobile > .topbar .tb-line .tt');
      if (!heading && document.querySelector('.chat-header .ch-rename')) return;
      const value = heading?.textContent.trim() || 'Open Kimi Web';
      if (document.title !== value) document.title = value;
    };
    const relevant = (record, selector) => {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (target?.closest(selector)) return true;
      return [...record.addedNodes, ...record.removedNodes].some((node) =>
        node.nodeType === 1 && (node.matches(selector) || node.querySelector(selector)));
    };
    new MutationObserver((records) => {
      if (records.some((record) => relevant(record, brandSelector))) brand();
      if (records.some((record) => relevant(record, titleSelector))) title();
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    window.addEventListener('popstate', title);
    brand();
    title();
  }
}
