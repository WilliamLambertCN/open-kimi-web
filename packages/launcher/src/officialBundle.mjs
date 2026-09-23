// Official-bundle mode: serve the self-contained `dist-web` SPA shipped in
// the MIT-licensed @moonshot-ai/kimi-code npm package instead of the bundled
// OpenWeb build, with one intentional rebrand in its shared title composer. The
// bundle is cached per version under ~/.open-kimi-web/official-web/<ver>/ so
// the download happens once. Downloads shell out to the system `curl` (which
// honors HTTPS_PROXY/HTTP_PROXY) and extract with the system `tar`, keeping
// this package dependency-free.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const OFFICIAL_FALLBACK_VERSION = '2.0.2';
export const OFFICIAL_PAGE_TITLE = 'open Kimi-Code web';
export const OPEN_WEB_BRAND = 'open Kimi-Code';

const INDEX_TITLE_NEEDLE = '<title>Kimi Code Web</title>';
// The bundle composes document titles as `${name} | Kimi Code` with a bare
// "Kimi Code" fallback (verified against 2.0.2). The combined needle keeps
// the rewrite inside the shared page/sidebar title composer rather than
// replacing unrelated visible brand strings throughout the bundle.
const RUNTIME_TITLE_RE = /\| Kimi Code(`\s*:\s*)"Kimi Code"/g;
// Versions end up in URLs and cache paths. Accept exact semver-shaped package
// versions only, rather than tags or path segments such as "." and "..".
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
const META_TIMEOUT_MS = 3_000;
const LOCK_POLL_MS = 100;
const LOCK_TIMEOUT_MS = 300_000;
const LOCK_STALE_MS = 600_000;
const STAGING_SWEEP_MS = 3_600_000;

export function isBundleVersion(raw) {
  return typeof raw === 'string' && raw.length <= 32 && VERSION_RE.test(raw);
}

export function officialCacheRoot(userHome = homedir()) {
  return join(userHome, '.open-kimi-web', 'official-web');
}

export function officialCacheDir(version, root = officialCacheRoot()) {
  if (!isBundleVersion(version)) throw new Error(`invalid official web UI version: ${version}`);
  return join(root, version);
}

export function tarballUrls(version) {
  const file = `kimi-code-${version}.tgz`;
  return [
    `https://registry.npmjs.org/@moonshot-ai/kimi-code/-/${file}`,
    `https://registry.npmmirror.com/@moonshot-ai/kimi-code/-/${file}`,
  ];
}

// GET <target>/api/v1/meta for the running server's version; any failure
// (offline, auth, unexpected shape) degrades to the pinned fallback version.
export async function resolveOfficialVersion(target, token, fetchImpl = fetch) {
  try {
    const headers = token === null ? {} : { authorization: `Bearer ${token}` };
    const signal = AbortSignal.timeout(META_TIMEOUT_MS);
    const res = await fetchImpl(`${target.replace(/\/+$/, '')}/api/v1/meta`, { headers, signal });
    if (!res.ok) throw new Error(`GET /api/v1/meta returned ${res.status}`);
    const body = await res.json();
    const version = body?.data?.server_version;
    if (!isBundleVersion(version)) {
      throw new Error(`unexpected server_version: ${JSON.stringify(version)}`);
    }
    return version;
  } catch {
    return OFFICIAL_FALLBACK_VERSION;
  }
}

export function patchIndexHtml(html) {
  const count = html.split(INDEX_TITLE_NEEDLE).length - 1;
  const text = count === 0 ? html : html.replaceAll(INDEX_TITLE_NEEDLE, `<title>${OFFICIAL_PAGE_TITLE}</title>`);
  return { count, text };
}

export function patchRuntimeTitle(source) {
  let count = 0;
  const text = source.replace(RUNTIME_TITLE_RE, (_match, joiner) => {
    count += 1;
    return `| ${OPEN_WEB_BRAND}${joiner}"${OPEN_WEB_BRAND}"`;
  });
  return { count, text };
}

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, cwd }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`${command} ${args[0]} failed: ${String(stderr || err.message).trim()}`));
      else resolve();
    });
  });
}

// System curl: honors HTTPS_PROXY/HTTP_PROXY/NO_PROXY natively. -f turns
// HTTP errors into exit codes so the mirror fallback actually triggers. The
// size cap (256 MiB, ~12x the real ~20 MiB tarball) refuses runaway writes
// from a broken or hostile source before it can fill the disk.
export function curlDownload(url, destFile) {
  return runCommand('curl', [
    '-fsSL',
    '--retry',
    '2',
    '--connect-timeout',
    '15',
    '--max-time',
    '90',
    '--retry-max-time',
    '120',
    '--max-filesize',
    '268435456',
    '-o',
    destFile,
    url,
  ]);
}

// Extracts `bundle.tgz` (staged inside destDir) into destDir. Runs with cwd +
// relative names so Windows drive letters never reach tar (GNU tar parses
// `C:` as a remote hostname).
function extractTarball(destDir) {
  return runCommand('tar', ['-xzf', 'bundle.tgz', '-C', '.', 'package/dist-web', 'package/LICENSE'], destDir);
}

async function patchJsAssets(webDir) {
  const assetsDir = join(webDir, 'assets');
  const entries = await readdir(assetsDir, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const file = join(assetsDir, entry.name);
    const { text, count: patched } = patchRuntimeTitle(await readFile(file, 'utf8'));
    if (patched > 0) {
      await writeFile(file, text, 'utf8');
      count += patched;
    }
  }
  return count;
}

// Patches are best-effort rewrites of string literals only; a missing needle
// means the bundle shape changed, and we still serve it unpatched (with a
// warning) instead of failing the launch.
export async function patchBundleDir(webDir) {
  const indexPath = join(webDir, 'index.html');
  const index = patchIndexHtml(await readFile(indexPath, 'utf8'));
  if (index.count > 0) await writeFile(indexPath, index.text, 'utf8');
  const runtime = await patchJsAssets(webDir);
  return { indexTitle: index.count, runtime };
}

// Each tarball is verified against the sha512 integrity published by its own
// registry (packument `versions[<ver>].dist.integrity`, an SRI string). A
// mismatch fails that source like any download error so the mirror fallback
// still runs; unreachable metadata only warns and the launch proceeds
// unverified, since availability beats a hard failure on locked-down networks.
// The metadata fetch uses global fetch (no proxy-env support): proxy users
// simply get the unverified warning, matching resolveOfficialVersion.
async function expectedIntegrity(metadataUrl, version, fetchImpl) {
  try {
    const res = await fetchImpl(metadataUrl, { signal: AbortSignal.timeout(META_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`registry metadata returned ${res.status}`);
    const packument = await res.json();
    const integrity = packument?.versions?.[version]?.dist?.integrity;
    return typeof integrity === 'string' && integrity.startsWith('sha512-') ? integrity : null;
  } catch {
    return null;
  }
}

async function sha512Integrity(file) {
  return `sha512-${createHash('sha512').update(await readFile(file)).digest('base64')}`;
}

async function downloadAndExtract({ version, urls, staging, downloadImpl, fetchImpl, log, warn }) {
  const failures = [];
  for (const url of urls) {
    const tarball = join(staging, 'bundle.tgz');
    try {
      await rm(join(staging, 'package'), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      await rm(tarball, { force: true, maxRetries: 5, retryDelay: 100 });
      const integrity = await expectedIntegrity(url.replace(/\/-\/[^/]+$/, ''), version, fetchImpl);
      if (integrity === null) {
        warn(`official web UI: tarball integrity metadata unavailable for ${url} — downloading unverified`);
      }
      log(`official web UI: downloading ${url}`);
      await downloadImpl(url, tarball);
      if (integrity !== null && (await sha512Integrity(tarball)) !== integrity) {
        throw new Error('downloaded tarball does not match the registry sha512 integrity');
      }
      await extractTarball(staging);
      const extracted = join(staging, 'package', 'dist-web');
      await cp(join(staging, 'package', 'LICENSE'), join(extracted, 'LICENSE'));
      if (!(await isBundleComplete(extracted))) {
        throw new Error('downloaded bundle is missing required files or assets');
      }
      return extracted;
    } catch (err) {
      failures.push(`${url}: ${err?.message ?? String(err)}`);
    }
  }
  throw new Error(`no official web UI source succeeded:\n${failures.join('\n')}`);
}

async function stageOfficialBundle({ version, cacheDir, downloadImpl, fetchImpl, log, warn }) {
  const staging = await mkdtemp(join(dirname(cacheDir), '.tmp-'));
  try {
    const extracted = await downloadAndExtract({
      version,
      urls: tarballUrls(version),
      staging,
      downloadImpl,
      fetchImpl,
      log,
      warn,
    });
    let patches;
    try {
      patches = await patchBundleDir(extracted);
    } catch (err) {
      throw new Error(`official web UI: failed to patch downloaded bundle: ${err.message}`, { cause: err });
    }
    if (patches.indexTitle === 0) {
      warn('official web UI: index title not found — the document title stays unpatched');
    }
    if (patches.runtime === 0) {
      warn('official web UI: runtime title template not found — the document title stays unpatched');
    }
    await replaceCacheDir(extracted, cacheDir, warn);
    log(
      `official web UI: cached ${version} in ${cacheDir} ` +
        `(title patches: index=${patches.indexTitle}, runtime=${patches.runtime})`,
    );
  } finally {
    await rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      .catch((err) => warn(`official web UI: could not remove staging directory ${staging}: ${err.message}`));
  }
}

async function existsAs(path, wantDir) {
  const info = await stat(path).catch(() => null);
  return info !== null && (wantDir ? info.isDirectory() : info.isFile());
}

async function isNonEmptyFile(path) {
  const info = await stat(path).catch(() => null);
  return info?.isFile() === true && info.size > 0;
}

async function hasAssets(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.some((entry) => entry.isFile());
}

// A cache is a hit only when visibly complete; anything half-written counts
// as a miss and is replaced wholesale.
export async function isBundleComplete(dir) {
  const [index, boot, license, assetsDir] = await Promise.all([
    isNonEmptyFile(join(dir, 'index.html')),
    isNonEmptyFile(join(dir, 'boot.js')),
    isNonEmptyFile(join(dir, 'LICENSE')),
    existsAs(join(dir, 'assets'), true),
  ]);
  return index && boot && license && assetsDir && (await hasAssets(join(dir, 'assets')));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireCacheLock(lockDir) {
  const started = Date.now();
  for (;;) {
    try {
      await mkdir(lockDir);
      return;
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
    }
    const lock = await stat(lockDir).catch(() => null);
    if (lock !== null && Date.now() - lock.mtimeMs > LOCK_STALE_MS) {
      await rm(lockDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      continue;
    }
    if (Date.now() - started >= LOCK_TIMEOUT_MS) {
      throw new Error(`official web UI: timed out waiting for cache lock ${lockDir}`);
    }
    await delay(LOCK_POLL_MS);
  }
}

async function replaceCacheDir(stagedDir, cacheDir, warn) {
  const previous = `${cacheDir}.old-${process.pid}-${Date.now()}`;
  const hadPrevious = (await stat(cacheDir).catch(() => null)) !== null;
  if (hadPrevious) await rename(cacheDir, previous);
  try {
    await rename(stagedDir, cacheDir);
  } catch (err) {
    let restoreFailure = '';
    if (hadPrevious) {
      try {
        await rename(previous, cacheDir);
      } catch (restoreError) {
        restoreFailure = `; restoring the previous cache also failed: ${restoreError.message}`;
      }
    }
    throw new Error(`official web UI: failed to publish cache ${cacheDir}: ${err.message}${restoreFailure}`, {
      cause: err,
    });
  }
  if (hadPrevious) {
    try {
      await rm(previous, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (err) {
      warn(`official web UI: could not remove replaced cache ${previous}: ${err.message}`);
    }
  }
}

// mkdtemp staging dirs normally clean up in `finally`; a hard-killed launcher
// can leave one behind, so sweep siblings older than an hour (far beyond the
// 5-minute cache-lock timeout, so an in-flight staging is never removed).
async function sweepStaleStagingDirs(root, warn) {
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || !entry.name.startsWith('.tmp-')) continue;
    const dir = join(root, entry.name);
    const info = await stat(dir).catch(() => null);
    if (info === null || Date.now() - info.mtimeMs <= STAGING_SWEEP_MS) continue;
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      .catch((err) => warn(`official web UI: could not remove stale staging ${dir}: ${err.message}`));
  }
}

export async function ensureOfficialBundle(options) {
  const { version, cacheDir, downloadImpl = curlDownload, fetchImpl = fetch } = options;
  const { log = () => {}, warn = () => {} } = options;
  if (!isBundleVersion(version)) throw new Error(`invalid official web UI version: ${version}`);
  await sweepStaleStagingDirs(dirname(cacheDir), warn);
  if (await isBundleComplete(cacheDir)) {
    log(`official web UI: using cached bundle ${version}`);
    return { dir: cacheDir, cached: true };
  }
  await mkdir(dirname(cacheDir), { recursive: true });
  const lockDir = `${cacheDir}.lock`;
  await acquireCacheLock(lockDir);
  try {
    if (await isBundleComplete(cacheDir)) {
      log(`official web UI: using cached bundle ${version}`);
      return { dir: cacheDir, cached: true };
    }
    await stageOfficialBundle({ version, cacheDir, downloadImpl, fetchImpl, log, warn });
    return { dir: cacheDir, cached: false };
  } finally {
    await rm(lockDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      .catch((err) => warn(`official web UI: could not release cache lock ${lockDir}: ${err.message}`));
  }
}
