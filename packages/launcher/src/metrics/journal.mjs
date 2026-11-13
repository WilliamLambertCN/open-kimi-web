import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { safeCronPathId } from '../cron/journal.mjs';

const CHUNK = 256 * 1024;
const LINE = 1024 * 1024;
const LIMIT = 4096;
const fingerprint = (s) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
const numeric = (n) => Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER ? n : undefined;
const validKey = (value) => typeof value === 'string' && value.length > 0 && value.length <= 256;
const boundedSet = (map, key, value) => {
  map.set(key, value);
  while (map.size > LIMIT) map.delete(map.keys().next().value);
};

async function inspect(path, directory) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw Error('unsafe-path');
  const actual = await realpath(path);
  const equal = process.platform === 'win32' ? actual.toLowerCase() === resolve(path).toLowerCase() : actual === resolve(path);
  if (!equal) throw Error('unsafe-path');
  return stat;
}

async function journalPath(home, ids) {
  if (typeof home !== 'string' || !isAbsolute(home) || !ids.every(safeCronPathId)) throw Error('unsafe-path');
  const root = parse(home).root;
  const segments = [...relative(root, resolve(home)).split(sep).filter(Boolean), 'sessions', ids[0], ids[1],
    'agents', ids[2], 'wire.jsonl'];
  let path = root;
  await inspect(path, true);
  for (let i = 0; i < segments.length; i += 1) {
    path = join(path, segments[i]);
    await inspect(path, i < segments.length - 1);
  }
  return path;
}

function recordStep(state, record) {
  const event = record.event;
  if (!validKey(event.uuid) || !Number.isSafeInteger(event.step) || numeric(record.time) === undefined) return;
  const key = JSON.stringify([record.time, event.step, event.uuid]);
  if (state.steps.has(key)) { state.steps.set(key, null); return; }
  boundedSet(state.steps, key, { llmTiming: {
    llmFirstTokenLatencyMs: numeric(event.llmFirstTokenLatencyMs),
    llmStreamDurationMs: numeric(event.llmStreamDurationMs),
  } });
}

function recordEvent(state, record) {
  const event = record.event;
  if (event?.type === 'tool.call') {
    if (validKey(event.toolCallId) && validKey(event.stepUuid)) boundedSet(state.tools, event.toolCallId, event.stepUuid);
  }
  if (event?.type === 'step.end') recordStep(state, record);
}

function consume(state, bytes, agent) {
  if (bytes.length > LINE || !bytes.includes('context.append_loop_event')) return;
  if (!bytes.includes('step.end') && !bytes.includes('tool.call')) return;
  let record;
  try { record = JSON.parse(bytes.toString('utf8')); } catch { return; }
  if (record?.type !== 'context.append_loop_event' || record.agentId !== agent) return;
  recordEvent(state, record);
}

function matching(state, request) {
  const suffix = /^(.*):([0-9]+)$/.exec(request.item);
  const uuid = request.type === 'tool_call' ? state.tools.get(request.item) : suffix?.[1];
  if (!uuid) return null;
  const metric = state.steps.get(JSON.stringify([Date.parse(request.ended), request.index, uuid]));
  return metric ? { id: request.id, ...metric } : null;
}

function lines(state, raw, agent) {
  let end = raw.length;
  for (;;) {
    const begin = raw.lastIndexOf(10, end - 1);
    if (begin < 0) break;
    if (!state.skipping) consume(state, raw.subarray(begin + 1, end), agent);
    state.skipping = false;
    end = begin;
    if (end === 0) break;
  }
  const remainder = raw.subarray(0, end);
  if (remainder.length > LINE) { state.skipping = true; state.remainder = Buffer.alloc(0); }
  else state.remainder = Buffer.from(remainder);
  if (state.cursor === 0 && !state.skipping) {
    consume(state, state.remainder, agent); state.remainder = Buffer.alloc(0);
  }
}

async function scan(handle, state, requests, agent) {
  let bytes = 0;
  const deadline = Date.now() + 750;
  if (requests.every((request) => matching(state, request))) return 0;
  while (state.cursor > 0 && bytes < 8 * 1024 * 1024 && Date.now() < deadline) {
    const size = Math.min(CHUNK, state.cursor);
    const buffer = Buffer.allocUnsafe(size);
    const start = state.cursor - size;
    const read = await handle.read(buffer, 0, size, start);
    if (read.bytesRead !== size) throw Error('changed');
    state.cursor = start; bytes += size;
    lines(state, Buffer.concat([buffer, state.remainder]), agent);
    if (requests.every((request) => matching(state, request))) break;
  }
  return bytes;
}

const requestKey = (request) => JSON.stringify([request.type, request.item, request.index, request.ended]);

function fresh(stat, requests) {
  return { signature: fingerprint(stat), cursor: stat.size, skipping: true,
    remainder: Buffer.alloc(0), steps: new Map(), tools: new Map(), requested: new Set(requests.map(requestKey)) };
}

function cachedState(cache, path, stat, requests) {
  const previous = cache.get(path);
  const reusable = previous?.signature === fingerprint(stat) && requests.every((request) =>
    matching(previous, request) || (previous.cursor > 0 && previous.requested.has(requestKey(request))));
  const state = reusable ? previous : fresh(stat, requests);
  cache.delete(path); cache.set(path, state);
  while (cache.size > 8) cache.delete(cache.keys().next().value);
  return state;
}

export function createRequestMetricsReader(home) {
  const cache = new Map();
  let pending = Promise.resolve();
  async function read(workspace, session, agent, requests) {
    let handle;
    let path;
    try {
      path = await journalPath(home, [workspace, session, agent]);
      handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stat = await handle.stat();
      if (fingerprint(stat) !== fingerprint(await inspect(path, false))) throw Error('changed');
      const state = cachedState(cache, path, stat, requests);
      const bytesRead = await scan(handle, state, requests, agent);
      const after = await journalPath(home, [workspace, session, agent]);
      if (after !== path || fingerprint(await inspect(path, false)) !== state.signature) throw Error('changed');
      const items = requests.map((request) => matching(state, request)).filter(Boolean);
      return { available: true, items, pending: items.length < requests.length && state.cursor > 0, bytesRead };
    } catch {
      cache.delete(path);
      return { available: false, reason: 'unreadable', items: [], pending: false };
    } finally { await handle?.close().catch(() => {}); }
  }
  return { read(...args) {
    const result = pending.then(() => read(...args));
    pending = result.catch(() => {});
    return result;
  } };
}
