{
  const activityRunFoldingKey = 'kimi-web.activity-run-folding';

  try {
    if (localStorage.getItem(activityRunFoldingKey) === null) {
      localStorage.setItem(activityRunFoldingKey, '0');
    }
  } catch {
    // The official UI remains usable when browser storage is unavailable.
  }
}
