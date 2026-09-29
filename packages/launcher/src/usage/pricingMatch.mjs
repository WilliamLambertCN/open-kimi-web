const CHANNEL_SUFFIXES = new Set([
  'alpha', 'beta', 'experimental', 'free', 'latest', 'preview',
]);

function normalizedId(value) {
  return value.normalize('NFKC').trim().toLowerCase()
    .replace(/[\\:]+/g, '/')
    .replace(/[\s_.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/\/+/g, '/')
    .replace(/^[-/]+|[-/]+$/g, '');
}

function withoutProvider(value) {
  const separator = value.indexOf('/');
  return separator === -1 ? value : value.slice(separator + 1);
}

function leafId(value) {
  return value.split('/').at(-1) ?? value;
}

function stripVersionSuffix(value) {
  let current = value;
  while (current) {
    const previous = current;
    current = current
      .replace(/[-/](?:latest|preview|beta|alpha|experimental|free)$/u, '')
      .replace(/[-/](?:20\d{2}(?:-\d{2}){0,2}|\d{8})$/u, '');
    if (current === previous) break;
  }
  return current || value;
}

function words(value) {
  return new Set(value.split(/[-/]+/u).filter((word) => word && !CHANNEL_SUFFIXES.has(word)));
}

function grams(value) {
  const compact = value.replace(/[-/]/gu, '');
  if (compact.length < 3) return new Set(compact ? [compact] : []);
  const result = new Set();
  for (let index = 0; index <= compact.length - 3; index += 1) {
    result.add(compact.slice(index, index + 3));
  }
  return result;
}

function variants(value) {
  const normalized = normalizedId(value);
  const body = withoutProvider(normalized);
  const leaf = leafId(body);
  return {
    normalized,
    bodies: [...new Set([body, leaf])],
    stripped: [...new Set([stripVersionSuffix(body), stripVersionSuffix(leaf)])],
    providerHint: normalized.includes('/') ? normalized.split('/')[0] : '',
  };
}

function featureOf(entry, index) {
  const value = variants(entry.modelId);
  const stripped = value.stripped[0];
  const modelProvider = value.normalized.includes('/') ? value.normalized.split('/')[0] : '';
  return {
    entry,
    index,
    key: entry.key.toLowerCase(),
    ...value,
    primary: stripped,
    words: words(stripped),
    grams: grams(stripped),
    provider: modelProvider || normalizedId(entry.providerId),
  };
}

function addIndex(index, key, feature) {
  if (!key) return;
  const values = index.get(key);
  if (values) values.push(feature);
  else index.set(key, [feature]);
}

function ratesProvided(entry) {
  return Object.values(entry.rates ?? {}).filter((value) => value !== null).length;
}

function preferred(features, providerHint) {
  return [...features].sort((left, right) => {
    const leftProvider = left.provider === providerHint ? 1 : 0;
    const rightProvider = right.provider === providerHint ? 1 : 0;
    if (leftProvider !== rightProvider) return rightProvider - leftProvider;
    const leftRouter = left.entry.providerId === 'openrouter' ? 1 : 0;
    const rightRouter = right.entry.providerId === 'openrouter' ? 1 : 0;
    if (leftRouter !== rightRouter) return rightRouter - leftRouter;
    const rateDifference = ratesProvided(right.entry) - ratesProvided(left.entry);
    return rateDifference || left.entry.key.localeCompare(right.entry.key);
  })[0];
}

function overlapSize(left, right) {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

function commonEdge(left, right, fromEnd = false) {
  const limit = Math.min(left.length, right.length);
  let count = 0;
  while (count < limit) {
    const leftIndex = fromEnd ? left.length - count - 1 : count;
    const rightIndex = fromEnd ? right.length - count - 1 : count;
    if (left[leftIndex] !== right[rightIndex]) break;
    count += 1;
  }
  return count;
}

function editSimilarity(left, right) {
  if (left === right) return 1;
  if (!left || !right) return 0;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1] +
        (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        substitution,
      );
    }
    previous = current;
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
}

function fuzzyScore(query, candidate) {
  const wordOverlap = overlapSize(query.words, candidate.words);
  const wordUnion = new Set([...query.words, ...candidate.words]).size || 1;
  const gramOverlap = overlapSize(query.grams, candidate.grams);
  const gramTotal = query.grams.size + candidate.grams.size || 1;
  const edge = Math.max(
    commonEdge(query.primary, candidate.primary),
    commonEdge(query.primary, candidate.primary, true),
  ) / Math.max(1, Math.min(8, query.primary.length, candidate.primary.length));
  const provider = query.providerHint && query.providerHint === candidate.provider ? 1 : 0;
  return editSimilarity(query.primary, candidate.primary) * 0.43 +
    gramOverlap * 2 / gramTotal * 0.29 +
    wordOverlap / wordUnion * 0.18 + edge * 0.05 + provider * 0.05;
}

function result(feature, matchKind, confidence) {
  return {
    entry: feature.entry,
    matchKind,
    confidence: Math.round(confidence * 100) / 100,
  };
}

function exactFrom(index, keys, query, matchKind, confidence) {
  const matches = new Set();
  for (const key of keys) {
    for (const feature of index.get(key) ?? []) matches.add(feature);
  }
  if (matches.size === 0) return null;
  return result(preferred(matches, query.providerHint), matchKind, confidence);
}

function appendLengthBucket(state, length, providerOnly) {
  if (state.candidates.length >= 240) return true;
  for (const feature of state.lengthIndex.get(length) ?? []) {
    const wrongProvider = providerOnly && feature.provider !== state.providerHint;
    if (state.seen.has(feature) || wrongProvider) continue;
    state.seen.add(feature);
    state.candidates.push(feature);
    if (state.candidates.length >= 240) return true;
  }
  return false;
}

function appendNearbyLengths(query, state, providerOnly) {
  for (let difference = 0; difference <= 256; difference += 1) {
    const shorter = query.primary.length - difference;
    if (appendLengthBucket(state, shorter, providerOnly)) return;
    if (difference === 0) continue;
    const longer = query.primary.length + difference;
    if (appendLengthBucket(state, longer, providerOnly)) return;
  }
}

function lengthCandidates(query, features, lengthIndex) {
  const state = {
    candidates: [],
    lengthIndex,
    providerHint: query.providerHint,
    seen: new Set(),
  };
  if (query.providerHint) appendNearbyLengths(query, state, true);
  appendNearbyLengths(query, state, false);
  return state.candidates.length ? state.candidates : features.slice(0, 240);
}

function fuzzyCandidates(query, features, gramIndex, lengthIndex) {
  const counts = new Map();
  for (const gram of query.grams) {
    for (const feature of gramIndex.get(gram) ?? []) {
      counts.set(feature, (counts.get(feature) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return lengthCandidates(query, features, lengthIndex);
  return [...counts].sort((left, right) =>
    right[1] - left[1] || left[0].entry.key.localeCompare(right[0].entry.key))
    .slice(0, 240)
    .map(([feature]) => feature);
}

function fuzzyMatch(query, features, gramIndex, lengthIndex) {
  let best = null;
  let bestScore = -1;
  for (const feature of fuzzyCandidates(query, features, gramIndex, lengthIndex)) {
    const score = fuzzyScore(query, feature);
    if (score > bestScore) {
      best = feature;
      bestScore = score;
      continue;
    }
    if (score === bestScore) best = preferred([best, feature], query.providerHint);
  }
  if (best === null) return null;
  return result(best, 'fuzzy', Math.max(0.2, Math.min(0.89, bestScore)));
}

export function createCatalogMatcher(catalog) {
  const features = catalog.map(featureOf);
  const keys = new Map();
  const models = new Map();
  const normalized = new Map();
  const bodies = new Map();
  const stripped = new Map();
  const gramIndex = new Map();
  const lengthIndex = new Map();
  for (const feature of features) {
    addIndex(keys, feature.key, feature);
    addIndex(models, feature.entry.modelId.toLowerCase(), feature);
    addIndex(normalized, feature.normalized, feature);
    feature.bodies.forEach((value) => addIndex(bodies, value, feature));
    feature.stripped.forEach((value) => addIndex(stripped, value, feature));
    feature.grams.forEach((value) => addIndex(gramIndex, value, feature));
    addIndex(lengthIndex, feature.primary.length, feature);
  }
  for (const values of lengthIndex.values()) {
    values.sort((left, right) => {
      const router = Number(right.entry.providerId === 'openrouter') -
        Number(left.entry.providerId === 'openrouter');
      return router || left.entry.key.localeCompare(right.entry.key);
    });
  }
  const cache = new Map();
  return (modelId) => {
    if (cache.has(modelId)) return cache.get(modelId);
    const query = { ...variants(modelId) };
    query.primary = query.stripped[0];
    query.words = words(query.primary);
    query.grams = grams(query.primary);
    const normalizedMatch = query.providerHint
      ? exactFrom(normalized, [query.normalized], query, 'normalized', 0.98) : null;
    const match = exactFrom(keys, [modelId.toLowerCase()], query, 'exact-key', 1) ??
      exactFrom(models, [modelId.toLowerCase()], query, 'exact', 1) ??
      normalizedMatch ??
      exactFrom(bodies, query.bodies, query, 'provider-normalized', 0.94) ??
      exactFrom(stripped, query.stripped, query, 'version-normalized', 0.88) ??
      fuzzyMatch(query, features, gramIndex, lengthIndex);
    cache.set(modelId, match);
    return match;
  };
}
