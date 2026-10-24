import { CronClientError } from './errors.mjs';
import { nextCronRun, parseCronExpression } from './expression.mjs';

export const MAX_PROMPT_BYTES = 8192;
export const MAX_TASKS = 50;
const ONE_SHOT_MAX_FUTURE_MS = 350 * 24 * 60 * 60 * 1000;
const TASK_ID = /^(?:[0-9a-f]{8}|[0-9A-HJKMNP-TV-Z]{26})$/i;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function strictRecord(value, allowed, required = allowed) {
  if (value === null || typeof value !== 'object') throw new CronClientError('invalid-input');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new CronClientError('invalid-input');
  for (const key of Reflect.ownKeys(value)) {
    if (!allowed.includes(key)) throw new CronClientError('invalid-input');
    validateProperty(Object.getOwnPropertyDescriptor(value, key));
  }
  if (required.some((key) => !Object.hasOwn(value, key))) throw new CronClientError('invalid-input');
  return value;
}

function validateProperty(descriptor) {
  if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new CronClientError('invalid-input');
}

export function validateOperation(value, extra = []) {
  const args = strictRecord(value, ['sessionId', 'authorization', ...extra]);
  if (typeof args.sessionId !== 'string' || !SESSION_ID.test(args.sessionId)) {
    throw new CronClientError('invalid-input');
  }
  if (typeof args.authorization !== 'string' || args.authorization.length > 4096 ||
      !/^Bearer [A-Za-z0-9._~+/-]+=*$/i.test(args.authorization)) {
    throw new CronClientError('unauthorized');
  }
  return { ...args };
}

export function validateCronInit(value) {
  const init = strictRecord(value, ['cron', 'prompt', 'recurring'], ['cron', 'prompt']);
  if (typeof init.prompt !== 'string' || init.prompt.length > MAX_PROMPT_BYTES ||
      !init.prompt.isWellFormed() || init.prompt.trim() === '') {
    throw new CronClientError('invalid-input');
  }
  if (Buffer.byteLength(init.prompt, 'utf8') > MAX_PROMPT_BYTES) throw new CronClientError('invalid-input');
  if (Object.hasOwn(init, 'recurring') && typeof init.recurring !== 'boolean') {
    throw new CronClientError('invalid-input');
  }
  const recurring = Object.hasOwn(init, 'recurring') ? init.recurring : true;
  return { cron: parseCronExpression(init.cron).cron, prompt: init.prompt, recurring };
}

export function validateCronSchedule(init, now) {
  const first = nextCronRun(parseCronExpression(init.cron), now);
  if (first === null) throw new CronClientError('no-future-fire');
  if (!init.recurring && first - now > ONE_SHOT_MAX_FUTURE_MS) throw new CronClientError('one-shot-too-far');
}

export function validateTaskId(id) {
  if (typeof id !== 'string' || !TASK_ID.test(id)) throw new CronClientError('invalid-input');
  return id;
}

export function validateTaskResponse(task) {
  if (task === null || typeof task !== 'object' || Array.isArray(task) ||
      typeof task.id !== 'string' || !TASK_ID.test(task.id) || typeof task.cron !== 'string' ||
      typeof task.prompt !== 'string' || !Number.isSafeInteger(task.createdAt)) {
    throw new CronClientError('invalid-response');
  }
  return task;
}

export function validateCreateTaskResponse(task, init) {
  validateTaskResponse(task);
  if (task.createdAt < 0 || task.createdAt > 8.64e15 ||
      task.cron !== init.cron || task.prompt !== init.prompt || task.recurring !== init.recurring) {
    throw new CronClientError('invalid-response');
  }
  return task;
}

export function validateListResponse(tasks) {
  if (!Array.isArray(tasks)) throw new CronClientError('invalid-response');
  tasks.forEach(validateTaskResponse);
  return tasks;
}
