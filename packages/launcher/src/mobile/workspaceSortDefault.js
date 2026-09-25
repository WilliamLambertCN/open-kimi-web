{
  const sortKey = 'kimi-web.workspace-sort';

  try {
    if (localStorage.getItem(sortKey) === null) {
      localStorage.setItem(sortKey, 'recent');
    }
  } catch {
    // The official workspace list remains usable when browser storage is unavailable.
  }
}
