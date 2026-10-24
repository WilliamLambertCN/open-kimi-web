import { assertCronWriteVersion } from './compatibility.mjs';
import { CronClientError } from './errors.mjs';
import { createCronTransport, loopbackOrigin } from './transport.mjs';
import {
  MAX_TASKS,
  strictRecord,
  validateCronInit,
  validateCronSchedule,
  validateCreateTaskResponse,
  validateListResponse,
  validateOperation,
  validateTaskId,
} from './validation.mjs';

export { CronClientError } from './errors.mjs';

const writes = new Map();

async function serializeWrite(key, operation) {
  const previous = writes.get(key) ?? Promise.resolve();
  const result = previous.then(operation);
  const tail = result.then(() => {}, () => {});
  writes.set(key, tail);
  try {
    return await result;
  } finally {
    if (writes.get(key) === tail) writes.delete(key);
  }
}

async function createTask(transport, args, init) {
  assertCronWriteVersion(await transport.authorize(args.authorization));
  const disabled = await transport.isDisabled(args.sessionId, args.authorization);
  if (typeof disabled !== 'boolean') throw new CronClientError('invalid-response');
  if (disabled) throw new CronClientError('disabled');
  const now = await transport.now(args.sessionId, args.authorization);
  validateCronSchedule(init, now);
  const tasks = validateListResponse(await transport.list(args.sessionId, args.authorization));
  if (tasks.length >= MAX_TASKS) throw new CronClientError('task-limit');
  return validateCreateTaskResponse(await transport.addTask(args.sessionId, args.authorization, init), init);
}

export function createCronClient(options) {
  strictRecord(options, ['target', 'fetchImpl'], ['target']);
  const origin = loopbackOrigin(options.target);
  const fetchImpl = Object.hasOwn(options, 'fetchImpl') && options.fetchImpl !== undefined
    ? options.fetchImpl : globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new CronClientError('invalid-input');
  const transport = createCronTransport(origin, fetchImpl);
  return Object.freeze({
    async list(input) {
      const args = validateOperation(input);
      await transport.authorize(args.authorization);
      return validateListResponse(await transport.list(args.sessionId, args.authorization));
    },
    async create(input) {
      const args = validateOperation(input, ['init']);
      const init = validateCronInit(args.init);
      return serializeWrite(`${origin}/${args.sessionId}`, () => createTask(transport, args, init));
    },
    async remove(input) {
      const args = validateOperation(input, ['id']);
      const id = validateTaskId(args.id);
      return serializeWrite(`${origin}/${args.sessionId}`, async () => {
        const removed = await transport.removeTask(args.sessionId, args.authorization, id);
        if (!Array.isArray(removed) || removed.length > 1 || removed.some((value) => value !== id)) {
          throw new CronClientError('invalid-response');
        }
        return removed;
      });
    },
  });
}
