// Backend discovery: after spawning `kimi web` on loopback, find
// the new instance in the official server registry ($KIMI_CODE_HOME/server/
// instances/*.json) and verify it over HTTP. Ambiguity, timeout or a failed
// verification all fail closed (the caller kills the backend).
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { IntegrateError } from './state.mjs';

export const DEFAULT_DISCOVERY_TIMEOUT_MS = 15_000;
export const DEFAULT_DISCOVERY_POLL_MS = 200;
export const DEFAULT_VERIFY_TIMEOUT_MS = 3_000;
export const DEFAULT_VERIFY_POLL_MS = 200;

export function kimiCodeHome(env = process.env) {
  const base = env.KIMI_CODE_HOME || env.HOME || env.USERPROFILE || homedir();
  return env.KIMI_CODE_HOME || join(base, '.kimi-code');
}

export function instancesDir(env = process.env) {
  return join(kimiCodeHome(env), 'server', 'instances');
}

async function readInstances(dir, io) {
  let names;
  try {
    names = await io.readdir(dir);
  } catch {
    return [];
  }
  const instances = [];
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    try {
      instances.push(JSON.parse(await io.readFile(join(dir, name), 'utf8')));
    } catch {
      // A partially written instance file is ignored; the writer rewrites it.
    }
  }
  return instances;
}

export async function snapshotInstanceIds(dir, io = { readdir, readFile }) {
  const ids = new Set();
  for (const instance of await readInstances(dir, io)) {
    if (typeof instance?.server_id === 'string') ids.add(instance.server_id);
  }
  return ids;
}

/** The official registry writes started_at as epoch milliseconds; an ISO
 *  string is accepted too, so a format change cannot silently break
 *  discovery. Anything else is NaN and never matches `>= sinceMs`. */
function startedAtMs(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value);
  return Number.NaN;
}

/**
 * Poll the registry until exactly one new instance appears that started at
 * or after `sinceMs` and listens on a real port. Throws IntegrateError on
 * timeout or ambiguity (more than one candidate).
 * options: { dir, sinceMs, previousIds, timeoutMs, pollMs, io, sleep }
 */
export async function awaitNewInstance(options) {
  const io = options.io ?? { readdir, readFile };
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const timeoutMs = options.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_DISCOVERY_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const candidates = (await readInstances(options.dir, io)).filter(
      (instance) =>
        typeof instance?.server_id === 'string' &&
        !options.previousIds.has(instance.server_id) &&
        typeof instance.port === 'number' &&
        instance.port > 0 &&
        startedAtMs(instance.started_at) >= options.sinceMs,
    );
    if (candidates.length > 1) {
      throw new IntegrateError(
        'multiple new kimi web instances appeared in the registry; refusing to guess',
      );
    }
    if (candidates.length === 1) return candidates[0];
    if (Date.now() >= deadline) {
      throw new IntegrateError('timed out waiting for the kimi web instance registry entry');
    }
    await sleep(pollMs);
  }
}

function sameRegistration(row, instance) {
  return row.server_id === instance.server_id && row.pid === instance.pid && row.started_at === instance.started_at;
}

function movedPort(current, instance) {
  return current.port !== instance.port && Number.isInteger(current.port) && current.port > 0;
}

export async function verifyRegisteredInstance(instance, options) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
  const signal = options.signal ?? AbortSignal.timeout(timeoutMs);
  const deadline = Date.now() + timeoutMs;
  const verify = (row) => verifyInstance({ ...options, signal, pid: row.pid, port: row.port });
  try { await verify(instance); return instance; }
  catch (error) {
    while (!signal.aborted && Date.now() < deadline) {
      const records = await readInstances(options.dir, options.io ?? { readdir, readFile });
      const current = records.find((row) => sameRegistration(row, instance));
      if (!current) throw error;
      if (movedPort(current, instance)) {
        await verify(current); return current;
      }
      await (options.sleep ?? delay)(Math.min(DEFAULT_VERIFY_POLL_MS, Math.max(0, deadline - Date.now())));
    }
    throw error;
  }
}

/** Mirror of the official registry's liveness probe: signal 0 only checks
 *  for existence. ESRCH is the one definitive "gone" answer — every other
 *  error (e.g. EPERM) means the process still exists. */
export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

class BackendNetworkError extends IntegrateError {}

async function verifyHttp(fetchImpl, base, token, signal) {
  let health;
  try {
    health = await fetchImpl(`${base}/api/v1/healthz`, { signal });
  } catch (error) {
    throw new BackendNetworkError(`backend healthz unreachable: ${error.message}`);
  }
  if (!health.ok) throw new IntegrateError(`backend healthz answered HTTP ${health.status}`);
  let meta;
  try {
    meta = await fetchImpl(`${base}/api/v1/meta`, {
      headers: { authorization: `Bearer ${token}` },
      signal,
    });
  } catch (error) {
    throw new BackendNetworkError(`backend meta unreachable: ${error.message}`);
  }
  if (!meta.ok) throw new IntegrateError(`backend meta answered HTTP ${meta.status}`);
}

function verificationOptions(options) {
  return {
    fetchImpl: options.fetchImpl ?? fetch,
    alive: options.pidAlive ?? pidAlive,
    signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS),
    pause: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    pollMs: options.pollMs ?? DEFAULT_VERIFY_POLL_MS,
    base: `http://${options.host ?? '127.0.0.1'}:${options.port}`,
  };
}

/**
 * Verify the discovered backend: the pid recorded in the registry entry must
 * still be alive, unauthenticated healthz must answer, and authenticated
 * /api/v1/meta must succeed. The registry entry and the meta endpoint each
 * mint their own server_id per start (two independent id spaces), so ids are
 * never compared — the binding is pid liveness + port + token auth.
 * A registry entry can be written shortly before the HTTP listener accepts
 * connections, so transient network failures are retried within the bounded
 * verification window. HTTP responses are definitive and still fail closed.
 * options: { port, pid, token, fetchImpl, host, pidAlive, signal, timeoutMs,
 *            pollMs, sleep }
 */
export async function verifyInstance(options) {
  const { fetchImpl, alive, signal, pause, pollMs, base } = verificationOptions(options);
  for (;;) {
    if (!alive(options.pid)) {
      throw new IntegrateError(`registered backend pid ${options.pid} is not alive`);
    }
    try {
      await verifyHttp(fetchImpl, base, options.token, signal);
      return;
    } catch (error) {
      if (!(error instanceof BackendNetworkError) || signal.aborted) throw error;
    }
    await pause(pollMs);
  }
}
