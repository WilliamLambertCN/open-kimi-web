export function uniqueDefaults(catalog) {
  const byModel = new Map();
  for (const entry of catalog) {
    if (!byModel.has(entry.modelId)) byModel.set(entry.modelId, entry.key);
    else byModel.set(entry.modelId, null);
  }
  const defaults = Object.create(null);
  for (const [modelId, key] of byModel) if (key !== null) defaults[modelId] = key;
  return defaults;
}

export function recoverDefaults(catalog, curated) {
  const defaults = uniqueDefaults(catalog);
  for (const [providerId, , modelId] of curated) {
    defaults[modelId] = `${providerId}/${modelId}`;
  }
  return defaults;
}

function boundedObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length <= 11_000;
}

function restoreDefaults(value, catalog, curated, validModel) {
  if (value === undefined) return recoverDefaults(catalog, curated);
  if (!boundedObject(value)) return null;
  const defaults = Object.create(null);
  for (const [modelId, key] of Object.entries(value)) {
    if (!validModel(modelId) || !validModel(key)) return null;
    defaults[modelId] = key;
  }
  return defaults;
}

function selectedKeys(defaults, mappings) {
  return new Set([
    ...Object.values(defaults),
    ...Object.values(mappings).map((mapping) => mapping?.catalogKey).filter(Boolean),
  ]);
}

export function selectedRetained(defaults, mappings, retained) {
  const selected = selectedKeys(defaults, mappings);
  return Object.fromEntries(Object.entries(retained).filter(([key]) => selected.has(key)));
}

function validRetained(key, value, { selected, liveKeys, validEntry }) {
  return validEntry(value?.entry) && value.entry.key === key &&
    typeof value.source === 'string' && value.source.length <= 120 &&
    selected.has(key) && !liveKeys.has(key);
}

function restoreRetained(parsed, defaults, validEntry, projectEntry) {
  const retained = Object.create(null);
  if (parsed.retainedEntries === undefined) return retained;
  if (!boundedObject(parsed.retainedEntries)) return null;
  const selected = selectedKeys(defaults, parsed.mappings ?? {});
  const liveKeys = new Set(parsed.catalog.map((entry) => entry.key));
  for (const [key, value] of Object.entries(parsed.retainedEntries)) {
    if (!validRetained(key, value, { selected, liveKeys, validEntry })) return null;
    retained[key] = { entry: projectEntry(value.entry), source: value.source };
  }
  return retained;
}

export function sanitizedContinuity(parsed, { builtIn, curated, validModel, validEntry, projectEntry }) {
  const defaults = restoreDefaults(parsed.automaticDefaults, parsed.catalog, curated, validModel);
  if (defaults === null) return null;
  const retained = restoreRetained(parsed, defaults, validEntry, projectEntry);
  if (retained === null) return null;
  const catalogKeys = new Map(parsed.catalog.map((entry) => [entry.key, entry]));
  const snapshotKeys = new Map(builtIn.map((entry) => [entry.key, entry]));
  if (!restoreMissingDefaults(defaults, retained, catalogKeys, snapshotKeys, projectEntry)) return null;
  return { automaticDefaults: defaults, retainedEntries: retained };
}

function restoreMissingDefaults(defaults, retained, catalogKeys, snapshotKeys, projectEntry) {
  for (const [modelId, key] of Object.entries(defaults)) {
    const entry = catalogKeys.get(key) ?? retained[key]?.entry ?? snapshotKeys.get(key);
    if (entry?.modelId !== modelId) return false;
    if (catalogKeys.has(key) || retained[key]) continue;
    retained[key] = { entry: projectEntry(entry), source: '内置价格快照' };
  }
  return true;
}

export function nextContinuity(state, catalog, builtIn, projectEntry) {
  const automaticDefaults = Object.assign(Object.create(null), state.automaticDefaults);
  for (const [modelId, key] of Object.entries(uniqueDefaults(catalog))) {
    if (!Object.hasOwn(automaticDefaults, modelId)) automaticDefaults[modelId] = key;
  }
  const previous = new Map(state.catalog.map((entry) => [entry.key, entry]));
  const current = new Set(catalog.map((entry) => entry.key));
  const snapshotKeys = new Map(builtIn.map((entry) => [entry.key, entry]));
  const selected = selectedKeys(automaticDefaults, state.mappings);
  const retainedEntries = Object.create(null);
  for (const key of selected) {
    if (current.has(key)) continue;
    const earlier = previous.get(key);
    if (earlier) retainedEntries[key] = { entry: projectEntry(earlier), source: state.source };
    else if (state.retainedEntries[key]) retainedEntries[key] = state.retainedEntries[key];
    else if (snapshotKeys.has(key)) {
      retainedEntries[key] = { entry: projectEntry(snapshotKeys.get(key)), source: '内置价格快照' };
    }
  }
  return { automaticDefaults, retainedEntries };
}
