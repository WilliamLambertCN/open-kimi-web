import { rm } from 'node:fs/promises';
import { defaultHome } from '../tlsStore.mjs';
import { DEFAULT_RENEW_BEFORE_MS, requiredSanNames } from '../tlsCertificate.mjs';
import {
  assertCaRenewalWindow,
  generateLocalCa,
  generateLocalCaLeaf,
  publicCa,
  validateLocalCa,
  validateLocalCaLeaf,
} from './localCaCertificate.mjs';
import {
  assertLocalCaDirectories,
  atomicLocalCaWrite,
  localCaPaths,
  localCaStorageExists,
  readLocalCaFile,
  withLocalCaLock,
} from './localCaFiles.mjs';

function pathsFor(options) {
  return localCaPaths(options.home ?? defaultHome(options.env));
}

async function readMarker(paths) {
  const content = await readLocalCaFile(paths.marker);
  if (content === null) return null;
  try {
    const marker = JSON.parse(content);
    if (marker.version !== 1 || typeof marker.fingerprint !== 'string') throw new Error('invalid marker');
    return marker;
  } catch {
    throw new Error('Local CA enable marker is invalid; restore it or explicitly disable Local CA.');
  }
}

async function createRoot(paths, options) {
  const leftovers = await Promise.all([readLocalCaFile(paths.leafKey), readLocalCaFile(paths.leafCert)]);
  if (leftovers.some((value) => value !== null)) {
    throw new Error('Local CA root is missing but leaf files remain; restore the original CA.');
  }
  const now = options.now ?? new Date();
  const pair = await (options.generateRoot ?? generateLocalCa)(now);
  const certificate = validateLocalCa(pair, now);
  assertCaRenewalWindow(certificate, now, options.renewBeforeMs);
  await atomicLocalCaWrite(paths.rootKey, pair.key);
  await atomicLocalCaWrite(paths.rootCert, pair.cert);
  return { pair, certificate };
}

async function readRoot(paths, options, marker, allowCreate) {
  const [key, cert] = await Promise.all([
    readLocalCaFile(paths.rootKey), readLocalCaFile(paths.rootCert),
  ]);
  if (key === null && cert === null && allowCreate && !marker) return createRoot(paths, options);
  const pair = { key, cert };
  const certificate = validateLocalCa(pair, options.now ?? new Date());
  if (marker && marker.fingerprint !== certificate.fingerprint256) {
    throw new Error('Local CA fingerprint differs from the enabled CA; restore the original CA.');
  }
  return { pair, certificate };
}

function leafResult(pair, validation, ca, created, previous) {
  const rotated = created && Boolean(previous);
  return {
    ...pair,
    fingerprint: validation.fingerprint,
    expiresAt: validation.expiresAt,
    source: 'local-ca',
    created,
    rotated,
    reason: rotated ? previous : null,
    publicCa: publicCa(ca),
  };
}

async function ensureLeaf(paths, options, root) {
  const now = options.now ?? new Date();
  const renewal = options.renewBeforeMs ?? DEFAULT_RENEW_BEFORE_MS;
  assertCaRenewalWindow(root.certificate, now, renewal);
  const names = requiredSanNames({ ...options, host: options.host ?? '0.0.0.0' });
  const [key, cert] = await Promise.all([
    readLocalCaFile(paths.leafKey), readLocalCaFile(paths.leafCert),
  ]);
  const pair = { key, cert };
  const validation = validateLocalCaLeaf(pair, root.certificate, names, now, renewal);
  if (validation.valid) return leafResult(pair, validation, root.certificate, false, null);
  const generated = await (options.generateLeaf ?? generateLocalCaLeaf)(names, root.pair, now);
  const checked = validateLocalCaLeaf(generated, root.certificate, names, now, renewal);
  if (!checked.valid) throw new Error(`Generated Local CA leaf failed validation: ${checked.reason}`);
  await atomicLocalCaWrite(paths.leafKey, generated.key);
  await atomicLocalCaWrite(paths.leafCert, generated.cert);
  const previous = key !== null || cert !== null ? validation.reason : null;
  return leafResult(generated, checked, root.certificate, true, previous);
}

export async function ensureLocalCaTls(options = {}) {
  const paths = pathsFor(options);
  if (!(await readMarker(paths))) return null;
  await assertLocalCaDirectories(paths);
  return withLocalCaLock(paths, options, async () => {
    const marker = await readMarker(paths);
    if (!marker) return null;
    const root = await readRoot(paths, options, marker, false);
    return ensureLeaf(paths, options, root);
  });
}

export async function setupLocalCa(options = {}) {
  const paths = pathsFor(options);
  return withLocalCaLock(paths, options, async () => {
    const marker = await readMarker(paths);
    const root = await readRoot(paths, options, marker, true);
    const result = await ensureLeaf(paths, options, root);
    await atomicLocalCaWrite(paths.marker, `${JSON.stringify({ version: 1, fingerprint: result.publicCa.fingerprint })}\n`);
    return result;
  });
}

export async function localCaStatus(options = {}) {
  const paths = pathsFor(options);
  if (!(await readMarker(paths))) return { enabled: false };
  await assertLocalCaDirectories(paths);
  return withLocalCaLock(paths, options, async () => {
    const marker = await readMarker(paths);
    if (!marker) return { enabled: false };
    const root = await readRoot(paths, options, marker, false);
    const ca = publicCa(root.certificate);
    return { enabled: true, fingerprint: ca.fingerprint, expiresAt: ca.expiresAt };
  });
}

export async function disableLocalCa(options = {}) {
  const paths = pathsFor(options);
  await assertLocalCaDirectories(paths);
  if (!(await localCaStorageExists(paths))) return { enabled: false };
  return withLocalCaLock(paths, options, async () => {
    await rm(paths.marker, { force: true });
    return { enabled: false };
  });
}
