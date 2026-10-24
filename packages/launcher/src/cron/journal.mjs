import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

export const JOURNAL_LIMITS = Object.freeze({
  highWaterMark: 64 * 1024,
  lineBytes: 1024 * 1024,
  bytes: 128 * 1024 * 1024,
  lines: 1_000_000,
  durationMs: 5000,
  taskBytes: 16 * 1024 * 1024,
});

export function safeCronPathId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(value) &&
    !value.endsWith('.') && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value);
}

export function createScanBudget(limits = {}) {
  const settings = { ...JOURNAL_LIMITS, ...limits };
  return { ...settings, remainingBytes: settings.bytes, remainingLines: settings.lines,
    deadline: Date.now() + settings.durationMs, retainedTaskBytes: 0 };
}

function samePath(left, right) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function inside(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

async function inspect(path, directory) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw new Error('unsafe-path');
  const actual = await realpath(path);
  if (!samePath(resolve(path), actual)) throw new Error('unsafe-path');
  return { path: actual, stat };
}

async function inspectHome(home) {
  if (typeof home !== 'string' || !isAbsolute(home) || home.includes('\0')) throw new Error('unsafe-path');
  const absolute = resolve(home);
  const root = parse(absolute).root;
  let path = root;
  await inspect(root, true);
  for (const segment of relative(root, absolute).split(sep).filter(Boolean)) {
    path = join(path, segment);
    await inspect(path, true);
  }
  return absolute;
}

async function inspectJournal(home, segments) {
  const root = await inspectHome(home);
  let path = root;
  let result;
  for (let index = 0; index < segments.length; index += 1) {
    path = join(path, segments[index]);
    result = await inspect(path, index < segments.length - 1);
    if (!inside(root, result.path)) throw new Error('unsafe-path');
  }
  return result;
}

function unchanged(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function limitReason(budget, ignoreBytes = false) {
  if (Date.now() >= budget.deadline) return 'time-limit';
  if (!ignoreBytes && budget.remainingBytes <= 0) return 'byte-limit';
  if (budget.remainingLines <= 0) return 'line-limit';
  return null;
}

function appendFragment(state, fragment, budget) {
  if (state.skipping || fragment.length === 0) return;
  if (state.line.length + fragment.length > budget.lineBytes) {
    state.reasons.add('oversized-line');
    state.line = Buffer.alloc(0);
    state.skipping = true;
    return;
  }
  state.line = state.line.length === 0 ? Buffer.from(fragment) : Buffer.concat([state.line, fragment]);
}

function consumeLine(state, consume) {
  if (state.skipping || state.line.length === 0) return;
  let record;
  try {
    record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(state.line));
  } catch {
    state.reasons.add('bad-line');
    return;
  }
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    state.reasons.add('bad-line');
    return;
  }
  consume(record);
}

function consumeChunk(state, chunk, budget, consume) {
  let start = 0;
  for (let index = 0; index < chunk.length; index += 1) {
    if (chunk[index] !== 10) continue;
    const reason = limitReason(budget, true);
    if (reason !== null) {
      state.reasons.add(reason);
      return false;
    }
    appendFragment(state, chunk.subarray(start, index), budget);
    consumeLine(state, consume);
    budget.remainingLines -= 1;
    state.line = Buffer.alloc(0);
    state.skipping = false;
    start = index + 1;
  }
  appendFragment(state, chunk.subarray(start), budget);
  return true;
}

function canScan(state, budget, size) {
  const reason = limitReason(budget);
  if (reason !== null) {
    state.reasons.add(reason);
    return false;
  }
  if (size > budget.remainingBytes) state.reasons.add('byte-limit');
  return true;
}

async function scanHandle(handle, state, budget, consume, size) {
  if (!canScan(state, budget, size)) return;
  const stream = handle.createReadStream({
    highWaterMark: JOURNAL_LIMITS.highWaterMark, autoClose: false, end: budget.remainingBytes - 1,
  });
  const timer = setTimeout(() => {
    state.reasons.add('time-limit');
    stream.destroy();
  }, Math.max(1, budget.deadline - Date.now()));
  timer.unref?.();
  try {
    for await (const raw of stream) {
      const reason = limitReason(budget);
      if (reason !== null) {
        state.reasons.add(reason);
        break;
      }
      budget.remainingBytes -= raw.length;
      if (!consumeChunk(state, raw, budget, consume)) break;
    }
  } catch {
    if (!state.reasons.has('time-limit')) state.reasons.add('unreadable');
  } finally {
    clearTimeout(timer);
    stream.destroy();
  }
  if (state.line.length > 0 || state.skipping) state.reasons.add('truncated-tail');
}

function failureReason(error) {
  if (error?.code === 'ENOENT') return 'missing';
  if (error?.message === 'unsafe-path' || error?.code === 'ELOOP') return 'unsafe-path';
  return 'unreadable';
}

async function scanJournal(home, segments, budget, consume, source) {
  const state = { line: Buffer.alloc(0), skipping: false, reasons: new Set() };
  let handle;
  let available = false;
  try {
    const before = await inspectJournal(home, segments);
    handle = await open(before.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (!unchanged(before.stat, opened)) throw new Error('unsafe-path');
    available = true;
    await scanHandle(handle, state, budget, consume, before.stat.size);
    const after = await inspectJournal(home, segments);
    if (!unchanged(before.stat, after.stat)) {
      state.reasons.add('changed');
    }
  } catch (error) {
    state.reasons.add(failureReason(error));
  } finally {
    await handle?.close().catch(() => {});
  }
  const reasons = [...state.reasons].map((reason) => `${source}-${reason}`);
  return { available, quality: { complete: reasons.length === 0, reasons } };
}

export async function readCronWire({ home, workspaceId, sessionId, budget = createScanBudget(), consume }) {
  if (!safeCronPathId(workspaceId) || !safeCronPathId(sessionId)) {
    return { available: false, quality: { complete: false, reasons: ['wire-invalid-id'] } };
  }
  return scanJournal(home, ['sessions', workspaceId, sessionId, 'agents', 'main', 'wire.jsonl'], budget, consume, 'wire');
}

export async function readCronServerJournal({ home, sessionId, budget = createScanBudget(), consume }) {
  if (!safeCronPathId(sessionId)) {
    return { available: false, quality: { complete: false, reasons: ['server-invalid-id'] } };
  }
  return scanJournal(home, ['server', 'events', `${sessionId}.jsonl`], budget, consume, 'server');
}
