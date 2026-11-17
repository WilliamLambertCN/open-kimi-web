{
  const installed = Symbol.for('open-kimi-web.subagent-pool-api');
  const subagent = window.__okwMobileSubagentApi;
  if (!window[installed] && subagent) {
    window[installed] = true;
    const { load, supportedEffort, writeSection } = subagent;
    const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
    const sectionOf = (value) => (object(value) && Object.hasOwn(value, 'section') ? value.section : value);
    const ownKeys = (record) => Object.keys(record ?? {});
    const textAt = (record, key) => (object(record) && typeof record[key] === 'string' ? record[key] : '');
    const findModel = (latestData, alias) => (Array.isArray(latestData?.models) ? latestData.models : [])
      .find((model) => model?.id === alias);
    const poolOf = (section) => {
      const container = object(section?.models) ? section.models : undefined;
      const explicit = new Set(container ? ownKeys(container) : []);
      const entries = new Map([...explicit].map((alias) => [alias, textAt(container, alias)]));
      const declared = textAt(section, 'defaultModel');
      const alias = declared || textAt(section, 'model');
      if (alias && !entries.has(alias)) entries.set(alias, textAt(container, alias));
      return { entries, explicit, default: alias, declared: declared !== '' };
    };
    const sectionEffort = (value) => textAt(sectionOf(value), 'defaultEffort');
    const draftFor = (data) => {
      const pool = poolOf(sectionOf(data));
      return { base: data, entries: new Map(pool.entries), defaultModel: pool.default };
    };
    const changed = (draft) => {
      const base = poolOf(sectionOf(draft.base));
      if (draft.defaultModel !== base.default || draft.entries.size !== base.entries.size) return true;
      for (const [alias, description] of draft.entries) {
        if (base.entries.get(alias) !== description) return true;
      }
      return false;
    };
    const assertPoolKept = (base, latest, draft) => {
      for (const alias of base.entries.keys()) {
        if (!draft.entries.has(alias)) throw new Error('cannotRemove');
        if (!latest.entries.has(alias)) throw new Error('configChanged');
      }
    };
    const assertDefaultAgrees = (base, latest, draft) => {
      if (draft.defaultModel === base.default || latest.default === base.default) return;
      if (latest.default !== draft.defaultModel) throw new Error('configChanged');
    };
    const descriptionAgrees = (latestDescription, baseDescription, description) => (
      latestDescription === baseDescription || latestDescription === description
    );
    const addNewEntry = (models, latestData, alias, description, effort) => {
      const known = findModel(latestData, alias);
      if (!known) throw new Error('modelMissing');
      if (effort && !supportedEffort(known, effort)) throw new Error('effortUnsupported');
      models[alias] = description;
    };
    const carryLatestEntries = (models, latest) => {
      if (!ownKeys(models).length || latest.explicit.size) return;
      for (const [alias, description] of latest.entries) models[alias] ??= description;
    };
    const changedEntries = (base, latest, draft, latestData, effort) => {
      const models = Object.create(null);
      for (const [alias, description] of draft.entries) {
        if (!latest.entries.has(alias)) {
          addNewEntry(models, latestData, alias, description, effort);
        } else if (description !== base.entries.get(alias)) {
          const latestDescription = latest.entries.get(alias);
          if (!descriptionAgrees(latestDescription, base.entries.get(alias), description)) {
            throw new Error('configChanged');
          }
          if (description !== latestDescription) models[alias] = description;
        }
      }
      carryLatestEntries(models, latest);
      return models;
    };
    const assertDefaultInPool = (expected, latest, draft) => {
      if (!expected || (!latest.entries.has(expected) && !draft.entries.has(expected))) {
        throw new Error('modelMissing');
      }
    };
    const mustSetDefaultModel = (latest, defaultChanging, hasModels, expected) => (
      (defaultChanging && expected !== latest.default) || (hasModels && !latest.declared)
    );
    const sectionPatchFor = (models, latest, draft, defaultChanging, latestData) => {
      const expected = defaultChanging ? draft.defaultModel : latest.default;
      assertDefaultInPool(expected, latest, draft);
      const hasModels = ownKeys(models).length > 0;
      if (hasModels && !latest.explicit.has(expected)) {
        models[expected] = draft.entries.get(expected) ?? '';
      }
      const section = Object.create(null);
      if (hasModels) section.models = models;
      if (mustSetDefaultModel(latest, defaultChanging, hasModels, expected)) {
        if (!findModel(latestData, expected)) throw new Error('modelMissing');
        section.defaultModel = expected;
      }
      if (!ownKeys(section).length) return null;
      return section;
    };
    const patchFor = (draft, latest) => {
      const base = poolOf(sectionOf(draft.base));
      const latestPool = poolOf(sectionOf(latest));
      assertPoolKept(base, latestPool, draft);
      assertDefaultAgrees(base, latestPool, draft);
      const models = changedEntries(base, latestPool, draft, latest, sectionEffort(latest));
      const defaultChanging = draft.defaultModel !== base.default;
      if (!defaultChanging && !ownKeys(models).length) return null;
      return sectionPatchFor(models, latestPool, draft, defaultChanging, latest);
    };
    const verifySaved = (latest, next, section) => {
      const current = poolOf(sectionOf(latest));
      const saved = poolOf(sectionOf(next));
      if (saved.default !== (section.defaultModel ?? current.default)) return false;
      if (sectionEffort(next) !== sectionEffort(latest)) return false;
      const models = section.models ?? {};
      const aliases = new Set([...current.entries.keys(), ...ownKeys(models)]);
      for (const alias of aliases) {
        const expected = Object.hasOwn(models, alias) ? models[alias] : current.entries.get(alias);
        if (saved.entries.get(alias) !== expected) return false;
      }
      return true;
    };
    const save = async (draft, signal) => {
      const latest = await load(signal);
      if (!changed(draft)) return latest;
      const patch = patchFor(draft, latest);
      if (!patch) return latest;
      if (signal?.aborted) throw new Error('requestFailed');
      await writeSection(patch, signal);
      const next = await load(signal);
      if (!verifySaved(latest, next, patch)) throw new Error('saveMismatch');
      return next;
    };
    window.__okwSubagentPoolApi = { load, draftFor, changed, patchFor, save };
  }
}
