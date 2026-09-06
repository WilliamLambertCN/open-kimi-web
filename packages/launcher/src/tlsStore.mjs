import { constants } from 'node:fs';
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_RENEW_BEFORE_MS,
  generateSelfSignedCertificate,
  requiredSanNames,
  validateCustomCertificate,
  validateManagedCertificate,
} from './tlsCertificate.mjs';

const DEFAULT_LOCK_TIMEOUT_MS = 10_000;
const DEFAULT_LOCK_POLL_MS = 100;
const DEFAULT_STALE_LOCK_MS = 60_000;

export function defaultHome(env = process.env) {
  return env.OPEN_KIMI_WEB_HOME || join(homedir(), '.open-kimi-web');
}

export function tlsPaths(home = defaultHome()) {
  const dir = join(home, 'tls');
  return {
    dir,
    key: join(dir, 'server.key'),
    cert: join(dir, 'server.crt'),
    metadata: join(dir, 'certificate.json'),
    lock: join(dir, '.generate.lock'),
  };
}

async function readPair(paths) {
  try {
    const [key, cert] = await Promise.all([
      readFile(paths.key, 'utf8'),
      readFile(paths.cert, 'utf8'),
    ]);
    return { key, cert };
  } catch {
    return null;
  }
}

async function atomicWrite(path, content, mode) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, { mode });
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function persist(paths, pair, metadata) {
  await mkdir(paths.dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await chmod(paths.dir, 0o700);
  await atomicWrite(paths.key, pair.key, 0o600);
  await atomicWrite(paths.cert, pair.cert, 0o600);
  await atomicWrite(paths.metadata, `${JSON.stringify(metadata, null, 2)}\n`, 0o600);
  if (process.platform !== 'win32') {
    await Promise.all([chmod(paths.key, 0o600), chmod(paths.cert, 0o600), chmod(paths.metadata, 0o600)]);
  }
}

function lockOptions(options) {
  return {
    timeoutMs: options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS,
    pollMs: options.lockPollMs ?? DEFAULT_LOCK_POLL_MS,
    staleMs: options.staleLockMs ?? DEFAULT_STALE_LOCK_MS,
  };
}

async function removeStaleLock(path, staleMs) {
  try {
    const info = await stat(path);
    if (Date.now() - info.mtimeMs <= staleMs) return false;
    await rm(path, { force: true });
    return true;
  } catch (error) {
    return error?.code === 'ENOENT';
  }
}

async function acquireLock(path, options) {
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    try {
      const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      await handle.writeFile(`${process.pid}\n`);
      await handle.close();
      return;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (await removeStaleLock(path, options.staleMs)) continue;
      if (Date.now() >= deadline) throw new Error('timed out waiting for TLS certificate lock');
      await new Promise((resolve) => setTimeout(resolve, options.pollMs));
    }
  }
}

async function withLock(paths, options, action) {
  await mkdir(paths.dir, { recursive: true, mode: 0o700 });
  await acquireLock(paths.lock, lockOptions(options));
  try {
    return await action();
  } finally {
    await rm(paths.lock, { force: true });
  }
}

async function currentState(paths, names, now, renewBeforeMs) {
  const pair = await readPair(paths);
  if (!pair) return { pair: null, validation: { valid: false, reason: 'certificate files missing' } };
  return { pair, validation: validateManagedCertificate(pair, names, now, renewBeforeMs) };
}

export async function ensureManagedTls(options = {}) {
  const paths = tlsPaths(options.home);
  const names = requiredSanNames(options);
  const now = options.now ?? new Date();
  const renewBeforeMs = options.renewBeforeMs ?? DEFAULT_RENEW_BEFORE_MS;
  const initial = await currentState(paths, names, now, renewBeforeMs);
  if (initial.validation.valid) return managedResult(initial.pair, initial.validation, false, null);
  return withLock(paths, options, async () => {
    const lockedNow = options.now ?? new Date();
    const locked = await currentState(paths, names, lockedNow, renewBeforeMs);
    if (locked.validation.valid) return managedResult(locked.pair, locked.validation, false, null);
    const generate = options.generate ?? generateSelfSignedCertificate;
    const pair = await generate(names);
    const validationNow = options.now ?? new Date();
    const validation = validateManagedCertificate(pair, names, validationNow, renewBeforeMs);
    if (!validation.valid) throw new Error(`generated TLS certificate failed validation: ${validation.reason}`);
    await persist(paths, pair, {
      fingerprint: validation.fingerprint,
      expiresAt: validation.expiresAt,
      sans: names,
    });
    const rotated = Boolean(locked.pair);
    return managedResult(pair, validation, true, rotated ? locked.validation.reason : null);
  });
}

function managedResult(pair, validation, created, reason) {
  return {
    ...pair,
    fingerprint: validation.fingerprint,
    expiresAt: validation.expiresAt,
    source: 'managed',
    created,
    rotated: created && Boolean(reason),
    reason,
  };
}

export async function loadCustomTls({ certFile, keyFile }) {
  const [cert, key] = await Promise.all([readFile(certFile, 'utf8'), readFile(keyFile, 'utf8')]);
  const validation = validateCustomCertificate({ cert, key });
  return {
    cert,
    key,
    fingerprint: validation.fingerprint,
    expiresAt: validation.expiresAt,
    source: 'custom',
    created: false,
    rotated: false,
    reason: null,
  };
}
