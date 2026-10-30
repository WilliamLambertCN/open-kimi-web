{
  const error = (code, outcomeUnknown = false) => Object.assign(new Error(code), { code, outcomeUnknown });
  const validTask = (task) => typeof task?.id === 'string' && !!task.id && typeof task.cron === 'string' &&
    typeof task.prompt === 'string' && (typeof task.createdAt === 'number' || typeof task.createdAt === 'string');
  const required = (value, test, mutation = false) => {
    if (!test(value)) throw error('invalid-response', mutation);
    return value;
  };
  const validQuality = (value) => typeof value?.complete === 'boolean' && Array.isArray(value.reasons) &&
    value.reasons.every((reason) => typeof reason === 'string');
  const validWorkspace = (value) => typeof value?.id === 'string' && typeof value.name === 'string';
  const validSessionState = (value) => [true, false, null].includes(value.loaded) && typeof value.archived === 'boolean' &&
    (value.model === null || typeof value.model === 'string') && ['live', 'saved', 'unknown'].includes(value.modelSource);
  const validSession = (value) => typeof value?.id === 'string' && !!value.id && typeof value.title === 'string' &&
    validWorkspace(value.workspace) && validSessionState(value) && Array.isArray(value.tasks) &&
    value.tasks.every(validTask) && validQuality(value.quality);
  const validSessions = (value) => Array.isArray(value?.items) && value.items.every(validSession) &&
    typeof value.hasMore === 'boolean' && (!value.hasMore || typeof value.cursor === 'string' && !!value.cursor);
  const validModel = (value) => typeof value?.model === 'string' && typeof value.provider === 'string' &&
    ['number', 'string'].includes(typeof value.time) && (value.alias === undefined || typeof value.alias === 'string');
  const validRecordModels = (value) => value === undefined || Array.isArray(value) && value.every(validModel);
  const validRecord = (value) => value && ['string', 'number'].includes(typeof value.time) &&
    typeof value.taskId === 'string' && ['started', 'steered', 'submitted'].includes(value.kind) &&
    typeof value.inherited === 'boolean' && validRecordModels(value.models);
  const validHistory = (value) => typeof value?.available === 'boolean' && Array.isArray(value.items) &&
    value.items.every(validRecord) && typeof value.hasMore === 'boolean' && validQuality(value.quality);
  window.__okwCronCreateApi = (sources = {}) => {
    const request = (action, options) => window.__okwNavigationRequest(action, options);
    let readOnly = false;
    const assertWritable = () => { if (readOnly) throw error('read-only-version'); };
    const capabilities = async () => {
      const data = required(await request('cron-capabilities'), (value) => typeof value?.available === 'boolean');
      readOnly = data.reason === 'read-only-version' || ['2.3.1', '2.4.1'].includes(data.version);
      return data;
    };
    return {
      capabilities,
      sessions: sources.sessions ?? (async (cursor) =>
        required(await request('cron-sessions', { cursor }), validSessions)),
      history: sources.history ?? (async (sid) => required(await request('cron-history', { sid }), validHistory)),
      async list(sid) {
        const data = await request('cron-list', { sid });
        return required(data, (value) => Array.isArray(value?.tasks) && value.tasks.every(validTask));
      },
      async create(sid, input) {
        if (!input.cron.trim() || !input.prompt.trim()) throw error('required');
        if (new TextEncoder().encode(input.prompt).length > 8192) throw error('prompt-limit');
        assertWritable();
        const body = { cron: input.cron.trim(), prompt: input.prompt, recurring: input.recurring === true };
        const data = await request('cron-create', { sid, body });
        return required(data, (value) => validTask(value?.task), true);
      },
      async remove(sid, id) {
        assertWritable();
        const data = await request('cron-remove', { sid, id, body: {} });
        return required(data, (value) => Array.isArray(value?.removed) && value.removed.length <= 1 &&
          value.removed.every((removed) => removed === id), true);
      },
      async restore(sid, confirmed = false) {
        if (!confirmed) throw error('confirmation-required');
        assertWritable();
        return request('cron-restore', { sid });
      },
    };
  };
}
