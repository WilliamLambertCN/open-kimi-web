{
  const current = () => {
    let stored;
    try { stored = window.localStorage?.getItem('kimi-locale'); } catch { stored = null; }
    if (stored === 'zh' || stored === 'en') return stored;
    return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  };
  const listeners = new Set();
  let previous = current();
  const refresh = () => {
    const next = current();
    if (next === previous) return;
    previous = next;
    listeners.forEach((listener) => listener());
  };
  window.__okwLocale = {
    current,
    text: (zh, en) => current() === 'zh' ? zh : en,
    observe: (listener) => { listeners.add(listener); },
  };
  new MutationObserver(refresh).observe(document.documentElement, {
    childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['lang'],
  });
  window.addEventListener('storage', (event) => { if (event.key === 'kimi-locale' || event.key === null) refresh(); });
}
