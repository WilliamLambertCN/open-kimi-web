{
  const DEFAULTS = {
    capabilities: ['image_in', 'tool_use', 'thinking', 'always_thinking'],
    supportEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], adaptiveThinking: true,
  };
  const OPTIONS = { capabilities: [...DEFAULTS.capabilities, 'image_out', 'video_in'], supportEfforts: DEFAULTS.supportEfforts };
  const FIELDS = [['capabilities', 'capabilities'], ['supportEfforts', 'support_efforts'],
    ['adaptiveThinking', 'adaptive_thinking']];
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const valueFor = (value, camel, snake) => own(value, snake) ? value[snake] : value[camel];

  const create = (saved) => ({
    saved,
    capabilities: new Set(saved?.capabilities ?? DEFAULTS.capabilities),
    supportEfforts: new Set(saved?.supportEfforts ?? DEFAULTS.supportEfforts),
    adaptiveThinking: saved?.adaptiveThinking ?? DEFAULTS.adaptiveThinking,
    dirty: new Set(),
    changes: { capabilities: new Map(), supportEfforts: new Map() },
  });

  const update = (state, field, value, checked) => {
    if (checked) state[field].add(value);
    else state[field].delete(value);
    state.changes[field].set(value, checked);
    state.dirty.add(field);
  };

  const changedList = (state, field, native) => {
    if (!state.saved) return [...state[field], ...(native ?? []).filter((value) => !OPTIONS[field].includes(value))];
    const values = new Set(native ?? state.saved[field] ?? DEFAULTS[field]);
    for (const [value, checked] of state.changes[field]) {
      if (checked) values.add(value);
      else values.delete(value);
    }
    return [...values];
  };

  const serialize = (model, state) => {
    const patch = {};
    for (const [field, wire] of FIELDS) {
      if (!state.saved || state.dirty.has(field)) {
        patch[wire] = field === 'adaptiveThinking' ? state.adaptiveThinking :
          changedList(state, field, valueFor(model, field, wire));
      } else if (!own(model, field) && !own(model, wire) && state.saved[field] != null) {
        patch[wire] = state.saved[field];
      }
    }
    return Object.keys(patch).length ? { ...model, ...patch } : model;
  };

  window.OpenKimiProviderModelState = Object.freeze({ create, serialize, update });
}
