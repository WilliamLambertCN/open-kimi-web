import { X509Certificate } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  generateLocalCa, generateLocalCaLeaf, LEAF_VALIDITY_MS, ROOT_VALIDITY_MS, validateLocalCa,
} from '../src/tls/localCaCertificate.mjs';
import { localCaPaths } from '../src/tls/localCaFiles.mjs';
import { disableLocalCa, ensureLocalCaTls, localCaStatus, setupLocalCa } from '../src/tls/localCaStore.mjs';

const homes = [];
const now = new Date(Math.floor(Date.now() / 1000) * 1000);
const day = 86_400_000;
const interfaces = {
  Ethernet: [{ address: '192.0.2.20', family: 'IPv4', internal: false }],
  EasyTier: [{ address: '198.51.100.7', family: 'IPv4', internal: false }],
};
let root;

beforeAll(async () => { root = await generateLocalCa(now); });
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function options(extra = {}) {
  const home = await mkdtemp(join(tmpdir(), 'okw-ca-ut-'));
  homes.push(home);
  return { home, now, interfaces, hostname: 'fixture', generateRoot: async () => root, ...extra };
}

async function storedRoot(paths) {
  return { key: await readFile(paths.rootKey, 'utf8'), cert: await readFile(paths.rootCert, 'utf8') };
}

describe('local CA storage', () => {
  it('is opt-in and status/disable on an absent home do not create storage', async () => {
    const opts = await options();
    opts.home = join(opts.home, 'absent');
    expect(await ensureLocalCaTls(opts)).toBeNull();
    expect(await localCaStatus(opts)).toEqual({ enabled: false });
    expect(await disableLocalCa(opts)).toEqual({ enabled: false });
    await expect(stat(opts.home)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('creates independent RSA/SHA256 server TLS with constrained CA and both network SANs', async () => {
    const opts = await options();
    const result = await setupLocalCa(opts);
    const paths = localCaPaths(opts.home);
    const ca = validateLocalCa(await storedRoot(paths), now);
    const leaf = new X509Certificate(result.cert);
    expect(ca.ca).toBe(true);
    expect(ca.subject).toBe(ca.issuer);
    expect(ca.verify(ca.publicKey)).toBe(true);
    expect(ca.publicKey.asymmetricKeyDetails.modulusLength).toBe(2048);
    expect(Date.parse(ca.validTo) - now.getTime()).toBe(ROOT_VALIDITY_MS);
    expect(leaf.publicKey.asymmetricKeyDetails.modulusLength).toBe(2048);
    expect(leaf.ca).toBe(false);
    expect(leaf.keyUsage).toEqual(['1.3.6.1.5.5.7.3.1']);
    expect(leaf.verify(ca.publicKey)).toBe(true);
    expect(leaf.publicKey.equals(ca.publicKey)).toBe(false);
    expect(Date.parse(leaf.validTo) - now.getTime()).toBe(LEAF_VALIDITY_MS);
    expect(leaf.checkIP('192.0.2.20')).toBe('192.0.2.20');
    expect(leaf.checkIP('198.51.100.7')).toBe('198.51.100.7');
    expect(result).toMatchObject({ source: 'local-ca', created: true, rotated: false, reason: null });
    expect(result.publicCa.certificate).toEqual(ca.raw);
    expect(result.publicCa.fingerprint).toBe(ca.fingerprint256);
    expect(new X509Certificate(result.publicCa.certificate).fingerprint256).toBe(ca.fingerprint256);
    expect(Object.keys(result.publicCa).sort()).toEqual(['certificate', 'expiresAt', 'fingerprint']);
    expect(result.key).not.toBe(root.key);
    expect(Object.keys(result).sort()).toEqual([
      'cert', 'created', 'expiresAt', 'fingerprint', 'key', 'publicCa', 'reason', 'rotated', 'source',
    ]);
    expect(await localCaStatus(opts)).toEqual({
      enabled: true, fingerprint: ca.fingerprint256, expiresAt: new Date(ca.validTo).toISOString(),
    });
    expect((await readdir(paths.dir)).sort()).toEqual(['enabled.json', 'root.crt', 'root.key', 'server.crt', 'server.key']);
    if (process.platform !== 'win32') {
      expect((await stat(paths.dir)).mode & 0o777).toBe(0o700);
      for (const name of await readdir(paths.dir)) expect((await stat(join(paths.dir, name))).mode & 0o777).toBe(0o600);
    }
  });

});

describe('local CA linked legacy home compatibility', () => {
  it.each(['home', 'tls'])('keeps an unconfigured linked %s read-only and rejects it after enabling CA', async (member) => {
    const fixture = await options();
    const realHome = join(fixture.home, 'real');
    const linkedHome = join(fixture.home, 'linked');
    await mkdir(realHome);
    const target = member === 'home' ? realHome : join(realHome, 'tls');
    if (member === 'tls') {
      await mkdir(target);
      await mkdir(linkedHome);
    }
    const link = member === 'home' ? linkedHome : join(linkedHome, 'tls');
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    const legacy = join(target, 'legacy-fixture');
    await writeFile(legacy, 'unchanged legacy data');
    const linked = { ...fixture, home: linkedHome };
    expect(await ensureLocalCaTls(linked)).toBeNull();
    expect(await localCaStatus(linked)).toEqual({ enabled: false });
    expect(await readdir(target)).toEqual(['legacy-fixture']);
    await expect(setupLocalCa(linked)).rejects.toThrow(/directories must not be symbolic links/);
    await expect(disableLocalCa(linked)).rejects.toThrow(/directories must not be symbolic links/);
    const configured = { ...fixture, home: realHome };
    await setupLocalCa(configured);
    const paths = localCaPaths(realHome);
    const original = await storedRoot(paths);
    const marker = await readFile(paths.marker, 'utf8');
    await expect(ensureLocalCaTls(linked)).rejects.toThrow(/directories must not be symbolic links/);
    await expect(localCaStatus(linked)).rejects.toThrow(/directories must not be symbolic links/);
    expect(await storedRoot(paths)).toEqual(original);
    expect(await readFile(paths.marker, 'utf8')).toBe(marker);
    expect(await readFile(legacy, 'utf8')).toBe('unchanged legacy data');
  });
});

describe('stable local CA lifecycle', () => {
  it('reuses setup and renews only the leaf for new SANs, nearing expiry and damaged leaf', async () => {
    const opts = await options({ interfaces: {} });
    const first = await setupLocalCa(opts);
    const repeated = await setupLocalCa(opts);
    expect(repeated.created).toBe(false);
    expect(repeated.fingerprint).toBe(first.fingerprint);
    const changed = await ensureLocalCaTls({ ...opts, interfaces });
    expect(changed).toMatchObject({ created: true, rotated: true, reason: 'certificate SAN coverage changed' });
    expect(changed.publicCa).toEqual(first.publicCa);
    const renewed = await ensureLocalCaTls({ ...opts, interfaces, now: new Date(now.getTime() + 340 * day) });
    expect(renewed.reason).toMatch(/renewal window/);
    expect(renewed.fingerprint).not.toBe(changed.fingerprint);
    expect(renewed.publicCa).toEqual(first.publicCa);
    await writeFile(localCaPaths(opts.home).leafCert, 'broken leaf');
    const repaired = await ensureLocalCaTls({ ...opts, interfaces });
    expect(repaired.reason).toMatch(/invalid local CA leaf/);
    expect(await storedRoot(localCaPaths(opts.home))).toEqual(root);
  });

  it('clips the leaf expiry to the root but refuses the root renewal window', async () => {
    const opts = await options({ now: new Date(now.getTime() + 1600 * day) });
    const tls = await setupLocalCa(opts);
    expect(tls.expiresAt).toBe(tls.publicCa.expiresAt);
    await expect(ensureLocalCaTls({ ...opts, now: new Date(now.getTime() + 1800 * day) }))
      .rejects.toThrow(/insufficient remaining lifetime/);
    await expect(ensureLocalCaTls({ ...opts, now: new Date(now.getTime() + 1826 * day) }))
      .rejects.toThrow(/expired or invalid/);
    expect(await storedRoot(localCaPaths(opts.home))).toEqual(root);
  });

  it('keeps CA files and legacy TLS unchanged when disabling and re-enabling', async () => {
    const opts = await options();
    const first = await setupLocalCa(opts);
    const paths = localCaPaths(opts.home);
    const legacy = join(opts.home, 'tls', 'server.key');
    await writeFile(legacy, 'legacy fixture');
    const before = await storedRoot(paths);
    await disableLocalCa(opts);
    expect(await ensureLocalCaTls(opts)).toBeNull();
    expect(await localCaStatus(opts)).toEqual({ enabled: false });
    expect(await storedRoot(paths)).toEqual(before);
    expect(await readFile(legacy, 'utf8')).toBe('legacy fixture');
    expect((await setupLocalCa(opts)).publicCa).toEqual(first.publicCa);
  });

  it('honors the explicit environment home without consulting the user home', async () => {
    const opts = await options();
    const home = opts.home;
    delete opts.home;
    const tls = await setupLocalCa({ ...opts, env: { OPEN_KIMI_WEB_HOME: home } });
    expect(tls.source).toBe('local-ca');
    expect(await localCaStatus({ home, now })).toMatchObject({ enabled: true });
  });
});

describe('local CA fail-closed storage', () => {
  it.each(['rootKey', 'rootCert'])('rejects a half-created root containing only %s', async (member) => {
    const opts = await options();
    const paths = localCaPaths(opts.home);
    await mkdir(paths.dir, { recursive: true });
    await writeFile(paths[member], member === 'rootKey' ? root.key : root.cert);
    await expect(setupLocalCa(opts)).rejects.toThrow(/Local CA/);
    expect(await readdir(paths.dir)).toEqual([member === 'rootKey' ? 'root.key' : 'root.crt']);
    expect(await ensureLocalCaTls(opts)).toBeNull();
  });

  it.each(['rootKey', 'rootCert'])('never recreates enabled missing or damaged %s', async (member) => {
    const opts = await options();
    await setupLocalCa(opts);
    const paths = localCaPaths(opts.home);
    const marker = await readFile(paths.marker, 'utf8');
    await writeFile(paths[member], 'damaged');
    await expect(ensureLocalCaTls(opts)).rejects.toThrow(/Local CA/);
    await expect(setupLocalCa(opts)).rejects.toThrow(/Local CA/);
    await expect(localCaStatus(opts)).rejects.toThrow(/Local CA/);
    await rm(paths[member]);
    await expect(ensureLocalCaTls(opts)).rejects.toThrow(/Local CA/);
    expect(await readFile(paths.marker, 'utf8')).toBe(marker);
    await expect(stat(paths[member])).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not recreate a missing full root or adopt another valid root behind the marker', async () => {
    const opts = await options();
    await setupLocalCa(opts);
    const paths = localCaPaths(opts.home);
    await Promise.all([rm(paths.rootKey), rm(paths.rootCert)]);
    await expect(setupLocalCa(opts)).rejects.toThrow(/Local CA/);
    await expect(ensureLocalCaTls(opts)).rejects.toThrow(/Local CA/);
    const replacement = await generateLocalCa(now);
    await writeFile(paths.rootKey, replacement.key);
    await writeFile(paths.rootCert, replacement.cert);
    await expect(ensureLocalCaTls(opts)).rejects.toThrow(/fingerprint differs/);
  });

  it('rejects corrupt markers but permits explicit disable without reading root keys', async () => {
    const opts = await options();
    await setupLocalCa(opts);
    const paths = localCaPaths(opts.home);
    await writeFile(paths.marker, '{bad json');
    await writeFile(paths.rootKey, 'broken');
    await expect(ensureLocalCaTls(opts)).rejects.toThrow(/marker is invalid/);
    await disableLocalCa(opts);
    expect(await localCaStatus(opts)).toEqual({ enabled: false });
    expect(await readFile(paths.rootKey, 'utf8')).toBe('broken');
  });

  it('never persists an invalid generated root or replaces lost roots after disabling', async () => {
    const opts = await options({ generateRoot: async () => ({ key: 'bad', cert: 'bad' }) });
    await expect(setupLocalCa(opts)).rejects.toThrow(/Local CA/);
    const paths = localCaPaths(opts.home);
    expect(await readdir(paths.dir)).toEqual([]);
    opts.generateRoot = async () => root;
    await setupLocalCa(opts);
    await disableLocalCa(opts);
    await Promise.all([rm(paths.rootKey), rm(paths.rootCert)]);
    await expect(setupLocalCa(opts)).rejects.toThrow(/root is missing but leaf files remain/);
    expect(await ensureLocalCaTls(opts)).toBeNull();
  });

  it('writes the marker only after successful leaf validation and reuses the root after a failed setup', async () => {
    const opts = await options({ generateLeaf: async () => ({ key: 'bad', cert: 'bad' }) });
    await expect(setupLocalCa(opts)).rejects.toThrow(/leaf failed validation/);
    const paths = localCaPaths(opts.home);
    expect(await storedRoot(paths)).toEqual(root);
    expect(await ensureLocalCaTls(opts)).toBeNull();
    expect(await readdir(paths.dir)).toEqual(['root.crt', 'root.key']);
    delete opts.generateLeaf;
    expect((await setupLocalCa(opts)).created).toBe(true);
    expect(await storedRoot(paths)).toEqual(root);
  });
});

describe('local CA operation lock', () => {
  it('serializes concurrent setup/ensure and keeps one root and leaf', async () => {
    let roots = 0;
    let leaves = 0;
    const opts = await options({
      generateRoot: async () => { roots++; return root; },
      generateLeaf: async (...args) => { leaves++; return generateLocalCaLeaf(...args); },
    });
    const [first, second] = await Promise.all([setupLocalCa(opts), setupLocalCa(opts)]);
    expect(roots).toBe(1);
    expect(leaves).toBe(1);
    expect(first.fingerprint).toBe(second.fingerprint);
    const ensured = await Promise.all([ensureLocalCaTls(opts), ensureLocalCaTls(opts)]);
    expect(ensured.map((tls) => tls.fingerprint)).toEqual([first.fingerprint, first.fingerprint]);
    expect(leaves).toBe(1);
  });

  it('serializes disable after a setup whose marker has not been written yet', async () => {
    let release;
    let entered;
    const ready = new Promise((resolve) => { entered = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    const opts = await options({ generateLeaf: async (...args) => {
      entered();
      await gate;
      return generateLocalCaLeaf(...args);
    } });
    const settingUp = setupLocalCa(opts);
    await ready;
    expect(await ensureLocalCaTls(opts)).toBeNull();
    await expect(stat(localCaPaths(opts.home).marker)).rejects.toMatchObject({ code: 'ENOENT' });
    const disabling = disableLocalCa(opts);
    release();
    await settingUp;
    await disabling;
    expect(await localCaStatus(opts)).toEqual({ enabled: false });
  });

  it('bounds lock waiting without deleting or stealing a lock based on its age', async () => {
    const opts = await options({ lockTimeoutMs: 20, lockPollMs: 5 });
    const paths = localCaPaths(opts.home);
    await mkdir(paths.dir, { recursive: true });
    await writeFile(paths.lock, 'held fixture');
    await expect(setupLocalCa(opts)).rejects.toMatchObject({ code: 'ELOCALCALOCKTIMEOUT' });
    await expect(disableLocalCa(opts)).rejects.toMatchObject({ code: 'ELOCALCALOCKTIMEOUT' });
    expect(await readFile(paths.lock, 'utf8')).toBe('held fixture');
    expect(await readdir(paths.dir)).toEqual(['.operation.lock']);
  });
});
