{
  const defaults = new Map([
    ['kimi-web.activity-run-folding', '0'],
    ['kimi-web.notify-enabled', '0'],
  ]);

  try {
    for (const [key, value] of defaults) {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    }
  } catch {
    // The official UI remains usable when browser storage is unavailable.
  }
}
