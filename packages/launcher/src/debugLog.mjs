import { createHmac, randomBytes } from 'node:crypto';
import * as filesystem from 'node:fs/promises';
import { join } from 'node:path';

import { debugLogRecord } from './debugLogSchema.mjs';
import { createDebugLogSink } from './debugLogSink.mjs';
import { integrationHome } from './integration/state.mjs';

export { safeErrorCode } from './debugLogSchema.mjs';

export function debugLogEnabled(flag, env = process.env) {
  return flag === true || env.OPEN_KIMI_WEB_DEBUG_LOG === '1';
}

function warnOnce(warn) {
  let warned = false;
  return () => {
    if (warned) return;
    warned = true;
    try {
      warn('Debug logging unavailable; diagnostic records may be lost.');
    } catch {
      // A diagnostic callback must not interrupt launcher operation.
    }
  };
}

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function encodeRecord(event, fields) {
  const record = debugLogRecord(event, fields);
  return record ? Buffer.from(`${JSON.stringify(record)}\n`) : undefined;
}

function makeLogger(sink, file) {
  const salt = randomBytes(32);
  return {
    file,
    emit(event, fields) {
      try {
        const line = encodeRecord(event, fields);
        if (line) sink.enqueue(line);
      } catch {
        // Invalid caller data is ignored, never serialized as an error.
      }
    },
    tag(kind, value) {
      if (!['client', 'session', 'ip'].includes(kind) || typeof value !== 'string') return undefined;
      return createHmac('sha256', salt).update(kind).update('\0').update(value).digest('hex').slice(0, 16);
    },
    close: () => sink.close(),
  };
}

export async function createDebugLog({
  enabled = false, home, env = process.env, warn = console.error, fs = filesystem,
  maxBytes, queueBytes, closeTimeoutMs,
} = {}) {
  if (enabled !== true) return undefined;
  const failed = warnOnce(warn);
  let handle;
  try {
    const directory = join(home ?? integrationHome(env), 'logs');
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const date = new Date().toISOString().slice(0, 10);
    const file = join(directory, `debug-${date}-${process.pid}-${randomBytes(8).toString('hex')}.jsonl`);
    handle = await fs.open(file, 'wx', 0o600);
    const sink = createDebugLogSink({
      fs, file, handle, failed,
      maxBytes: positiveInteger(maxBytes, 5 * 1024 * 1024),
      queueLimit: positiveInteger(queueBytes, 256 * 1024),
      closeTimeoutMs: positiveInteger(closeTimeoutMs, 1000),
      droppedLine: (dropped) => encodeRecord('log_dropped', { dropped }),
    });
    return makeLogger(sink, file);
  } catch {
    failed();
    if (handle) void handle.close().catch(failed);
    return undefined;
  }
}
