// Unit tests for the official-bundle machinery: version resolution, patch
// functions, and the cache/staging state machine. Downloads are fakes; the
// one real process spawn is `tar`, because the staging path genuinely
// extracts a tarball (created here with the same system tar).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  ensureOfficialBundle,
  isBundleVersion,
  isBundleComplete,
  officialCacheDir,
  officialCacheRoot,
  patchIndexHtml,
  patchRuntimeTitle,
  resolveOfficialVersion,
  tarballUrls,
  OFFICIAL_FALLBACK_VERSION,
  OFFICIAL_PAGE_TITLE,
} from '../src/officialBundle.mjs';

const tar = promisify(execFile);

// Matches the 0.41.0 minified title composer (see patchRuntimeTitle).
const BUNDLE_TITLE_SNIPPET = 'function uze(e,t){return e!==""?e:t?`${aze(t)} | Kimi Code`:"Kimi Code"}';
const INDEX_HTML = [
  '<!doctype html><html><head>',
  '<script src="/boot.js"></script>',
  '<title>Kimi Code Web</title>',
  '</head><body></body></html>',
].join('\n');

let root;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'official-bundle-ut-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function metaFetch(version, { status = 200 } = {}) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ code: 0, data: { server_version: version } }),
  }));
}

describe('resolveOfficialVersion', () => {
  it('returns the target server version from /api/v1/meta', async () => {
    const fetchImpl = metaFetch('9.8.7');
    const url = 'http://127.0.0.1:58627';
    await expect(resolveOfficialVersion(url, null, fetchImpl)).resolves.toBe('9.8.7');
    expect(fetchImpl).toHaveBeenCalledWith(`${url}/api/v1/meta`, {
      headers: {},
      signal: expect.any(AbortSignal),
    });
  });

  it('sends the bearer token when one is available', async () => {
    const fetchImpl = metaFetch('0.41.0');
    await resolveOfficialVersion('http://127.0.0.1:58627', 'tok', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:58627/api/v1/meta', {
      headers: { authorization: 'Bearer tok' },
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    ['http error', metaFetch('0.41.0', { status: 404 })],
    ['network failure', async () => { throw new Error('ECONNREFUSED'); }],
    ['missing version', metaFetch(undefined)],
    ['path-like version', metaFetch('../../etc')],
  ])('falls back to the pinned version on %s', async (_name, fetchImpl) => {
    await expect(resolveOfficialVersion('http://127.0.0.1:58627', null, fetchImpl)).resolves.toBe(
      OFFICIAL_FALLBACK_VERSION,
    );
  });
});

describe('isBundleVersion', () => {
  it.each(['0.41.0', '1.2.3-beta.1', '1.2.3+build.7'])('accepts exact package version %s', (version) => {
    expect(isBundleVersion(version)).toBe(true);
  });

  it.each(['.', '..', 'latest', '1', '1.2', '../1.2.3', '1.2.3/other', '1.2.3-'])('rejects unsafe or non-exact version %s', (version) => {
    expect(isBundleVersion(version)).toBe(false);
  });
});

describe('tarballUrls', () => {
  it('tries npmjs first and npmmirror as the mirror fallback', () => {
    expect(tarballUrls('0.41.0')).toEqual([
      'https://registry.npmjs.org/@moonshot-ai/kimi-code/-/kimi-code-0.41.0.tgz',
      'https://registry.npmmirror.com/@moonshot-ai/kimi-code/-/kimi-code-0.41.0.tgz',
    ]);
  });
});

describe('patchIndexHtml', () => {
  it('rewrites the static document title', () => {
    const { count, text } = patchIndexHtml(INDEX_HTML);
    expect(count).toBe(1);
    expect(text).toContain(`<title>${OFFICIAL_PAGE_TITLE}</title>`);
    expect(text).not.toContain('Kimi Code Web');
  });

  it('leaves everything else untouched and tolerates a missing title', () => {
    expect(patchIndexHtml('<html>no title</html>')).toEqual({ count: 0, text: '<html>no title</html>' });
  });
});

describe('patchRuntimeTitle', () => {
  it('rewrites the runtime title template and its fallback', () => {
    const { count, text } = patchRuntimeTitle(BUNDLE_TITLE_SNIPPET);
    expect(count).toBe(1);
    expect(text).toBe('function uze(e,t){return e!==""?e:t?`${aze(t)} | open Kimi-Code`:"open Kimi-Code"}');
    expect(text).not.toContain('Kimi Code');
  });

  it('leaves non-title brand strings alone (no template, no match)', () => {
    const source = 'i18n={brand:"Kimi Code",notifyTitle:"Kimi Code · Turn finished"}';
    expect(patchRuntimeTitle(source)).toEqual({ count: 0, text: source });
  });

  it('is a no-op when the template shape changed', () => {
    const source = 'function uze(e,t){return t}';
    expect(patchRuntimeTitle(source)).toEqual({ count: 0, text: source });
  });
});

describe('officialCacheDir', () => {
  it('nests the version under the cache root', () => {
    expect(officialCacheDir('0.41.0', '/home/u/.open-kimi-web/official-web')).toBe(
      join('/home/u/.open-kimi-web/official-web', '0.41.0'),
    );
    expect(officialCacheRoot('/home/u')).toBe(join('/home/u', '.open-kimi-web', 'official-web'));
  });

  it.each(['.', '..', 'latest'])('rejects unsafe cache version %s', (version) => {
    expect(() => officialCacheDir(version, '/home/u/.open-kimi-web/official-web')).toThrow(/invalid.*version/);
  });
});

describe('isBundleComplete', () => {
  it('rejects an otherwise-shaped cache with no asset files', async () => {
    const cacheDir = join(root, 'empty-assets');
    mkdirSync(join(cacheDir, 'assets'), { recursive: true });
    writeFileSync(join(cacheDir, 'index.html'), 'index');
    writeFileSync(join(cacheDir, 'boot.js'), 'boot');
    writeFileSync(join(cacheDir, 'LICENSE'), 'MIT');
    await expect(isBundleComplete(cacheDir)).resolves.toBe(false);
  });

  it('requires non-empty index, boot, and license files', async () => {
    const cacheDir = join(root, 'empty-required-file');
    mkdirSync(join(cacheDir, 'assets'), { recursive: true });
    writeFileSync(join(cacheDir, 'index.html'), 'index');
    writeFileSync(join(cacheDir, 'boot.js'), '');
    writeFileSync(join(cacheDir, 'LICENSE'), 'MIT');
    writeFileSync(join(cacheDir, 'assets', 'index.js'), 'asset');
    await expect(isBundleComplete(cacheDir)).resolves.toBe(false);
  });
});

// Builds a real npm-tarball-shaped fixture (package/dist-web + package/LICENSE)
// so the staging path — extraction, patching, boot.js, atomic rename — runs
// for real instead of being mocked away.
async function makeFixtureTarball(version) {
  const staging = join(root, `src-${version}-${Math.random().toString(36).slice(2)}`);
  const distWeb = join(staging, 'package', 'dist-web');
  mkdirSync(join(distWeb, 'assets'), { recursive: true });
  writeFileSync(join(distWeb, 'index.html'), INDEX_HTML);
  writeFileSync(join(distWeb, 'boot.js'), 'upstream boot\n');
  writeFileSync(join(distWeb, 'assets', `index-${version}.js`), BUNDLE_TITLE_SNIPPET);
  writeFileSync(join(staging, 'package', 'LICENSE'), 'MIT, Copyright (c) Moonshot AI\n');
  const tarball = join(root, `fixture-${version}.tgz`);
  // cwd + relative names: GNU tar reads `C:` as a remote host otherwise.
  await tar('tar', ['-czf', 'fixture.tgz', 'package'], { cwd: staging });
  copyFileSync(join(staging, 'fixture.tgz'), tarball);
  rmSync(staging, { recursive: true, force: true });
  return tarball;
}

describe('ensureOfficialBundle', () => {
  it('stages, patches, and drops boot.js + LICENSE into the cache on a miss', async () => {
    const tarball = await makeFixtureTarball('1.2.3');
    const cacheDir = join(root, 'official-web', '1.2.3');
    const { copyFileSync } = await import('node:fs');
    const downloadImpl = vi.fn(async (_url, dest) => copyFileSync(tarball, dest));
    const log = vi.fn();
    const result = await ensureOfficialBundle({ version: '1.2.3', cacheDir, downloadImpl, log });
    expect(result).toEqual({ dir: cacheDir, cached: false });
    expect(downloadImpl).toHaveBeenCalledOnce();
    expect(log.mock.calls.some(([line]) => line.includes('registry.npmjs.org'))).toBe(true);
    expect(await isBundleComplete(cacheDir)).toBe(true);
    expect(await import('node:fs/promises').then((fs) => fs.readFile(join(cacheDir, 'index.html'), 'utf8')))
      .toContain(`<title>${OFFICIAL_PAGE_TITLE}</title>`);
    expect(existsSync(join(cacheDir, 'LICENSE'))).toBe(true);
    expect(existsSync(join(cacheDir, 'boot.js'))).toBe(true);
    expect(await import('node:fs/promises').then((fs) => fs.readFile(join(cacheDir, 'boot.js'), 'utf8')))
      .toBe('upstream boot\n');
    const patchedJs = await import('node:fs/promises').then((fs) =>
      fs.readFile(join(cacheDir, 'assets', 'index-1.2.3.js'), 'utf8'));
    expect(patchedJs).toContain(' | open Kimi-Code');
    expect(patchedJs).not.toContain('Kimi Code');
  });

  it('hits the cache without downloading', async () => {
    const cacheDir = join(root, 'official-web', '4.5.6');
    mkdirSync(join(cacheDir, 'assets'), { recursive: true });
    writeFileSync(join(cacheDir, 'index.html'), `<title>${OFFICIAL_PAGE_TITLE}</title>`);
    writeFileSync(join(cacheDir, 'boot.js'), 'x');
    writeFileSync(join(cacheDir, 'LICENSE'), 'MIT');
    writeFileSync(join(cacheDir, 'assets', 'index.js'), 'x');
    const downloadImpl = vi.fn();
    const result = await ensureOfficialBundle({ version: '4.5.6', cacheDir, downloadImpl });
    expect(result).toEqual({ dir: cacheDir, cached: true });
    expect(downloadImpl).not.toHaveBeenCalled();
  });

  it('treats a half-written cache as a miss and restages over it', async () => {
    const tarball = await makeFixtureTarball('7.8.9');
    const cacheDir = join(root, 'official-web', '7.8.9');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, 'index.html'), 'partial');
    const downloadImpl = async (_url, dest) => {
      const { copyFileSync } = await import('node:fs');
      copyFileSync(tarball, dest);
    };
    await ensureOfficialBundle({ version: '7.8.9', cacheDir, downloadImpl });
    expect(await isBundleComplete(cacheDir)).toBe(true);
  });
});

describe('ensureOfficialBundle fallback and concurrency', () => {
  it('tries npmjs then the npmmirror when the first response is not a tarball', async () => {
    const tarball = await makeFixtureTarball('0.0.1');
    const cacheDir = join(root, 'official-web', '0.0.1');
    const downloadImpl = vi.fn(async (_url, dest) => {
      if (downloadImpl.mock.calls.length === 1) writeFileSync(dest, '<html>proxy error</html>');
      else copyFileSync(tarball, dest);
    });
    await expect(ensureOfficialBundle({ version: '0.0.1', cacheDir, downloadImpl })).resolves.toEqual({
      dir: cacheDir,
      cached: false,
    });
    expect(downloadImpl.mock.calls.map(([url]) => url)).toEqual(tarballUrls('0.0.1'));
  });

  it('serializes concurrent provisioning of the same version', async () => {
    const tarball = await makeFixtureTarball('0.0.2');
    const cacheDir = join(root, 'official-web', '0.0.2');
    const downloadImpl = vi.fn(async (_url, dest) => copyFileSync(tarball, dest));
    const results = await Promise.all([
      ensureOfficialBundle({ version: '0.0.2', cacheDir, downloadImpl }),
      ensureOfficialBundle({ version: '0.0.2', cacheDir, downloadImpl }),
    ]);
    expect(downloadImpl).toHaveBeenCalledOnce();
    expect(results.map(({ cached }) => cached).sort()).toEqual([false, true]);
  });

  it('rejects an unsafe version before touching the cache path', async () => {
    const cacheDir = join(root, 'do-not-touch');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, 'sentinel'), 'keep');
    await expect(ensureOfficialBundle({ version: '..', cacheDir })).rejects.toThrow(/invalid.*version/);
    expect(existsSync(join(cacheDir, 'sentinel'))).toBe(true);
  });

  it('reports every source when all downloads fail', async () => {
    const cacheDir = join(root, 'official-web', '0.0.0');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, 'sentinel'), 'keep damaged cache until replacement is ready');
    const downloadImpl = vi.fn(async () => { throw new Error('curl: (56) recv failure'); });
    await expect(
      ensureOfficialBundle({ version: '0.0.0', cacheDir, downloadImpl }),
    ).rejects.toThrow(/registry\.npmjs\.org[\s\S]*registry\.npmmirror\.com/);
    expect(downloadImpl.mock.calls.map(([url]) => url)).toEqual(tarballUrls('0.0.0'));
    expect(await isBundleComplete(cacheDir)).toBe(false);
    expect(await import('node:fs/promises').then((fs) => fs.readFile(join(cacheDir, 'sentinel'), 'utf8')))
      .toBe('keep damaged cache until replacement is ready');
  });
});
