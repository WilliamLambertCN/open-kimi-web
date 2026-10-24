import { CRON_READ_VERSIONS } from './compatibility.mjs';

export const PROJECTION_LIMITS = Object.freeze({ tasks: 1024, history: 100, turns: 256, modelsPerTurn: 32 });

const END_REASONS = ['completed', 'cancelled', 'failed', 'blocked'];
const TASK_FIELDS = ['id', 'cron', 'prompt', 'createdAt', 'recurring', 'lastFiredAt', 'tags'];
const validTime = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 8.64e15;
const validTurn = (value) => Number.isSafeInteger(value) && value >= 0;
const recordOf = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 1024) => typeof value === 'string' && value.length > 0 && value.length <= max &&
  value.isWellFormed() && !/[\0\r\n]/.test(value);
const jobId = (value) => text(value, 256);

function validPrompt(value) {
  return typeof value === 'string' && value.length <= 8192 && value.isWellFormed() &&
    Buffer.byteLength(value, 'utf8') <= 8192;
}

function validTags(tags) {
  return recordOf(tags) && Object.keys(tags).length <= 32 &&
    Object.entries(tags).every(([key, value]) => text(key, 128) && text(value, 1024));
}

function validOptionalTask(task) {
  return (task.recurring === undefined || typeof task.recurring === 'boolean') &&
    (task.lastFiredAt === undefined || validTime(task.lastFiredAt)) &&
    (task.tags === undefined || validTags(task.tags));
}

function safeTask(task) {
  if (!recordOf(task) || !jobId(task.id) || !text(task.cron, 1024) ||
      !validPrompt(task.prompt) || !validTime(task.createdAt) || !validOptionalTask(task)) return null;
  const result = Object.fromEntries(TASK_FIELDS.filter((key) => Object.hasOwn(task, key)).map((key) => [key, task[key]]));
  if (task.tags !== undefined) result.tags = { ...task.tags };
  return result;
}

function addTask(state, record) {
  const task = safeTask(record.task);
  if (task === null) {
    state.reasons.add('wire-invalid-cron-add');
    return;
  }
  const previous = state.tasks.get(task.id);
  const bytes = Buffer.byteLength(JSON.stringify(task), 'utf8');
  const previousBytes = previous === undefined ? 0 : Buffer.byteLength(JSON.stringify(previous), 'utf8');
  if ((!previous && state.tasks.size >= PROJECTION_LIMITS.tasks) ||
      state.budget.retainedTaskBytes - previousBytes + bytes > state.budget.taskBytes) {
    state.reasons.add('wire-task-limit');
    return;
  }
  state.budget.retainedTaskBytes += bytes - previousBytes;
  state.tasks.set(task.id, task);
}

function deleteTask(state, id) {
  const previous = state.tasks.get(id);
  if (previous !== undefined) state.budget.retainedTaskBytes -= Buffer.byteLength(JSON.stringify(previous), 'utf8');
  state.tasks.delete(id);
}

function consumeCron(state, record) {
  if (record.type === 'cron.add') return addTask(state, record);
  if (record.type === 'cron.delete') {
    if (!Array.isArray(record.ids) || record.ids.some((id) => !jobId(id))) {
      state.reasons.add('wire-invalid-cron-delete');
      return;
    }
    for (const id of record.ids) deleteTask(state, id);
  } else if (record.type === 'cron.cursor') {
    if (!jobId(record.id) || !validTime(record.lastFiredAt)) {
      state.reasons.add('wire-invalid-cron-cursor');
      return;
    }
    const task = state.tasks.get(record.id);
    if (task !== undefined) addTask(state, { task: { ...task, lastFiredAt: record.lastFiredAt } });
  } else {
    state.reasons.add('wire-unknown-cron-schema');
  }
}

function rememberTurn(state, id) {
  if (!state.turns.has(id)) state.turns.set(id, { models: [] });
  const turn = state.turns.get(id);
  if (state.turns.size > PROJECTION_LIMITS.turns) {
    state.turns.delete(state.turns.keys().next().value);
    state.reasons.add('wire-turn-map-limit');
  }
  return turn;
}

function addHistory(state, item) {
  state.history.push(item);
  if (state.history.length > PROJECTION_LIMITS.history) {
    state.history.sort((left, right) => left.time - right.time);
    state.history.shift();
    state.hasMore = true;
    state.reasons.add('history-limit');
  }
}

function promptTurn(state, record) {
  if (validTurn(record.turnId)) return rememberTurn(state, record.turnId);
  if (record.turnId !== undefined) state.reasons.add('wire-invalid-turn-id');
  return undefined;
}

function consumePrompt(state, record) {
  if (record.agentId !== 'main') return;
  const turn = promptTurn(state, record);
  if (record.origin?.kind !== 'cron_job') return;
  if (record.turnId === undefined) state.reasons.add('wire-unassociated-turn');
  if (!jobId(record.origin.jobId) || !validTime(record.time)) {
    state.reasons.add('wire-invalid-cron-origin');
    return;
  }
  const item = {
    time: record.time, taskId: record.origin.jobId,
    kind: record.type === 'turn.prompt' ? 'started' : 'steered', inherited: false,
  };
  if (turn !== undefined) Object.assign(item, { turnId: record.turnId, turn });
  addHistory(state, item);
}

function consumeEnded(state, record) {
  if (record.agentId !== 'main') return;
  if (!validTurn(record.turnId) || !validTime(record.time) || !END_REASONS.includes(record.reason)) {
    state.reasons.add('wire-invalid-turn-ended');
    return;
  }
  const turn = state.turns.get(record.turnId);
  if (turn === undefined) return;
  turn.ending = { endReason: record.reason, endedAt: record.time };
  if (record.durationMs !== undefined) {
    if (validTime(record.durationMs)) turn.ending.durationMs = record.durationMs;
    else state.reasons.add('wire-invalid-duration');
  }
}

function requestTurn(record) {
  const step = typeof record.turnStep === 'string' ? /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(record.turnStep) : null;
  return step !== null && validTurn(Number(step[1])) ? Number(step[1]) : null;
}

function validRequestModel(record) {
  return text(record.model) && text(record.provider) && validTime(record.time) &&
    (record.modelAlias === undefined || text(record.modelAlias));
}

function consumeRequest(state, record) {
  if (record.agentId !== 'main') return;
  if (!['loop', 'compaction'].includes(record.kind)) {
    state.reasons.add('wire-invalid-request-kind');
    return;
  }
  const turnId = requestTurn(record);
  if (turnId === null) {
    state.reasons.add('wire-unassociated-model');
    return;
  }
  if (!validRequestModel(record)) {
    state.reasons.add('wire-invalid-request-model');
    return;
  }
  const turn = rememberTurn(state, turnId);
  if (turn.models.length >= PROJECTION_LIMITS.modelsPerTurn) {
    state.reasons.add('wire-model-limit');
    return;
  }
  const model = { model: record.model, provider: record.provider, time: record.time };
  if (record.modelAlias !== undefined) model.alias = record.modelAlias;
  turn.models.push(model);
}

function consumeFork(state, record) {
  if (record.agentId !== 'main' || !validTime(record.time)) {
    state.reasons.add('wire-invalid-fork');
    return;
  }
  for (const item of state.history) item.inherited = true;
  state.turns.clear();
  if (state.version !== '2.1.1') {
    for (const id of state.tasks.keys()) deleteTask(state, id);
  }
}

function consumeModel(state, record) {
  if (record.agentId !== 'main' || record.modelAlias === undefined) return;
  if (!text(record.modelAlias)) {
    state.reasons.add('wire-invalid-saved-model');
    return;
  }
  state.model = record.modelAlias;
}

const WIRE_CONSUMERS = {
  forked: consumeFork, 'profile.bind': consumeModel, 'config.update': consumeModel,
};
const HISTORY_CONSUMERS = {
  'turn.prompt': consumePrompt, 'turn.steer': consumePrompt, 'turn.ended': consumeEnded, 'llm.request': consumeRequest,
};

function consumeWire(state, record) {
  if (typeof record.type !== 'string') {
    state.reasons.add('wire-unknown-schema');
    return;
  }
  if (record.type.startsWith('cron.')) return consumeCron(state, record);
  if (Object.hasOwn(WIRE_CONSUMERS, record.type)) return WIRE_CONSUMERS[record.type](state, record);
  if (state.withHistory && Object.hasOwn(HISTORY_CONSUMERS, record.type)) HISTORY_CONSUMERS[record.type](state, record);
}

function submittedItem(envelope, sessionId) {
  const origin = envelope.payload?.origin;
  const time = typeof envelope.timestamp === 'string' ? Date.parse(envelope.timestamp) : NaN;
  if (envelope.session_id !== undefined && envelope.session_id !== sessionId) return null;
  if (origin?.kind !== 'cron_job' || !jobId(origin.jobId) || !validTime(time) ||
      typeof envelope.payload.prompt !== 'string') return null;
  return { time, taskId: origin.jobId, kind: 'submitted', inherited: false };
}

function consumeServer(state, record, sessionId) {
  if (record.kind === 'journal_header') {
    if (record.version !== 1 || !text(record.epoch, 256) || !validTime(record.created_at)) {
      state.reasons.add('server-unknown-header-schema');
    }
    return;
  }
  if (record.kind !== 'event' || !recordOf(record.envelope) || typeof record.envelope.type !== 'string') {
    state.reasons.add('server-unknown-schema');
    return;
  }
  if (record.envelope.type !== 'cron.fired') return;
  const item = submittedItem(record.envelope, sessionId);
  if (item === null) {
    state.reasons.add('server-invalid-cron-fired');
    return;
  }
  addHistory(state, item);
}

function publicHistory(item) {
  const { turn, ...result } = item;
  if (turn?.ending !== undefined) Object.assign(result, turn.ending);
  if (turn?.models.length > 0) result.models = turn.models.map((model) => ({ ...model }));
  return result;
}

export function createCronProjection({ version, budget, withHistory = false }) {
  if (!CRON_READ_VERSIONS.includes(version)) throw new Error('Unsupported Cron journal version.');
  const state = {
    version, budget, withHistory, tasks: new Map(), turns: new Map(), model: null,
    history: [], hasMore: false, reasons: new Set(),
  };
  return {
    consume: (record) => consumeWire(state, record),
    consumeServer: (record, sessionId) => consumeServer(state, record, sessionId),
    result() {
      return {
        tasks: [...state.tasks.values()], model: state.model,
        items: state.history.map(publicHistory).sort((left, right) => right.time - left.time),
        hasMore: state.hasMore, quality: { complete: state.reasons.size === 0, reasons: [...state.reasons] },
      };
    },
  };
}
