import { mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { generateSelfSignedCertificate } from '../src/tlsCertificate.mjs';
import { defaultHome, ensureManagedTls, loadCustomTls, tlsPaths } from '../src/tlsStore.mjs';

const homes = [];
const interfaces = {
  Ethernet: [{ address: '192.168.1.20', family: 'IPv4', internal: false }],
};

async function tempHome() {
  const home = join(tmpdir(), `open-kimi-web-tls-${process.pid}-${Date.now()}-${homes.length}`);
  homes.push(home);
  return home;
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe('TLS storage paths', () => {
  it('honors OPEN_KIMI_WEB_HOME and keeps managed files below tls', () => {
    const home = join(tmpdir(), 'configured-open-kimi-home');
    expect(defaultHome({ OPEN_KIMI_WEB_HOME: home })).toBe(home);
    expect(tlsPaths(home)).toEqual({
      dir: join(home, 'tls'),
      key: join(home, 'tls', 'server.key'),
      cert: join(home, 'tls', 'server.crt'),
      metadata: join(home, 'tls', 'certificate.json'),
      lock: join(home, 'tls', '.generate.lock'),
    });
  });
});

describe('ensureManagedTls', () => {
  it('persists under the configured home and reuses a stable fingerprint', async () => {
    const home = await tempHome();
    const first = await ensureManagedTls({ home, interfaces, hostname: 'devbox' });
    const second = await ensureManagedTls({ home, interfaces, hostname: 'devbox' });
    const paths = tlsPaths(home);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.fingerprint).toBe(first.fingerprint);
    const metadata = JSON.parse(await readFile(paths.metadata, 'utf8'));
    expect(metadata.fingerprint).toBe(first.fingerprint);
    expect(metadata).not.toHaveProperty('key');
    expect(metadata).not.toHaveProperty('cert');
    expect(JSON.stringify(metadata)).not.toContain('PRIVATE KEY');
    expect(paths.key.startsWith(home)).toBe(true);
    if (process.platform !== 'win32') {
      await expect(stat(paths.dir).then((info) => info.mode & 0o777)).resolves.toBe(0o700);
      for (const path of [paths.key, paths.cert, paths.metadata]) {
        await expect(stat(path).then((info) => info.mode & 0o777)).resolves.toBe(0o600);
      }
    }
  });

  it('rotates for a new SAN, near expiry, or damaged persisted data', async () => {
    const home = await tempHome();
    const first = await ensureManagedTls({ home, interfaces: {}, hostname: 'devbox' });
    const sanRotation = await ensureManagedTls({ home, interfaces, hostname: 'devbox' });
    expect(sanRotation.rotated).toBe(true);
    expect(sanRotation.reason).toMatch(/SAN missing/);
    expect(sanRotation.fingerprint).not.toBe(first.fingerprint);

    const nearHome = await tempHome();
    await ensureManagedTls({
      home: nearHome,
      interfaces,
      hostname: 'devbox',
      renewBeforeMs: 0,
      generate: (names) => generateSelfSignedCertificate(names, { validDays: 20 }),
    });
    const nearRotation = await ensureManagedTls({ home: nearHome, interfaces, hostname: 'devbox' });
    expect(nearRotation.reason).toMatch(/expires within/);

    const damagedHome = await tempHome();
    await ensureManagedTls({ home: damagedHome, interfaces, hostname: 'devbox' });
    await writeFile(tlsPaths(damagedHome).cert, 'damaged certificate');
    const damagedRotation = await ensureManagedTls({ home: damagedHome, interfaces, hostname: 'devbox' });
    expect(damagedRotation.reason).toMatch(/invalid certificate or private key/);
  });

});

describe('managed TLS generation lock', () => {
  it('serializes concurrent generation and handles stale locks', async () => {
    const home = await tempHome();
    let generated = 0;
    const generate = async (names) => {
      generated += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return generateSelfSignedCertificate(names);
    };
    const [left, right] = await Promise.all([
      ensureManagedTls({ home, interfaces, hostname: 'devbox', generate }),
      ensureManagedTls({ home, interfaces, hostname: 'devbox', generate }),
    ]);
    expect(generated).toBe(1);
    expect(left.fingerprint).toBe(right.fingerprint);

    const staleHome = await tempHome();
    const paths = tlsPaths(staleHome);
    await mkdir(paths.dir, { recursive: true });
    await writeFile(paths.lock, 'stale');
    await utimes(paths.lock, new Date(0), new Date(0));
    const stale = await ensureManagedTls({ home: staleHome, interfaces, hostname: 'devbox' });
    expect(stale.created).toBe(true);
  });

  it('fails after a finite timeout when a live generation lock remains', async () => {
    const home = await tempHome();
    const paths = tlsPaths(home);
    await mkdir(paths.dir, { recursive: true });
    await writeFile(paths.lock, 'live');
    await expect(
      ensureManagedTls({
        home,
        interfaces,
        hostname: 'devbox',
        lockTimeoutMs: 30,
        lockPollMs: 5,
        staleLockMs: 60_000,
      }),
    ).rejects.toThrow(/timed out waiting for TLS certificate lock/);
  });
});

describe('loadCustomTls', () => {
  it('validates in place without copying or rotating custom files', async () => {
    const home = await tempHome();
    const pair = await generateSelfSignedCertificate(['localhost', '127.0.0.1']);
    const certFile = join(home, 'custom.crt');
    const keyFile = join(home, 'custom.key');
    await mkdir(home, { recursive: true });
    await writeFile(certFile, pair.cert);
    await writeFile(keyFile, pair.key);

    const loaded = await loadCustomTls({ certFile, keyFile });
    expect(loaded.source).toBe('custom');
    expect(loaded.created).toBe(false);
    expect(await readFile(certFile, 'utf8')).toBe(pair.cert);
  });

  it('rejects invalid custom files without an HTTP fallback', async () => {
    const home = await tempHome();
    const certFile = join(home, 'bad.crt');
    const keyFile = join(home, 'bad.key');
    await mkdir(home, { recursive: true });
    await writeFile(certFile, 'bad cert');
    await writeFile(keyFile, 'bad key');
    await expect(loadCustomTls({ certFile, keyFile })).rejects.toThrow(/invalid custom TLS/);
  });
});
