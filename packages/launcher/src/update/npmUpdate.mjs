import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readJson } from './files.mjs';
import { downloadRelease } from './githubRelease.mjs';
import { identifyInstallation, sameInstallationTarget } from './installation.mjs';
import { checkedRun } from './process.mjs';
import { resolveTool } from './toolResolver.mjs';

export function npmArguments(installation, artifact) {
  const args = ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--engine-strict',
    '--dry-run=false', '--bin-links=true', '--force=false', '--package-lock-only=false', '--replace-registry-host=never'];
  if (installation.kind === 'global') args.push('--global', '--prefix', installation.prefix);
  else if (installation.kind === 'local') {
    args.push('--global=false', '--location=project', '--save=true', '--prefix', installation.owner,
      '--include=dev', '--package-lock=true', '--workspaces=false');
    args.push(installation.category === 'devDependencies' ? '--save-dev' : '--save-prod');
  } else throw new Error('npm update requires an identified npm installation');
  return [...args, artifact];
}

async function assertUnchanged(installation, context) {
  const fresh = await (context.reidentify ?? identifyInstallation)({
    modulePath: `${installation.root}/src/update/installation.mjs`, entryPath: installation.entry, env: context.env,
  });
  if (!sameInstallationTarget(fresh, installation) || fresh.version !== installation.version ||
      !isDeepStrictEqual(fresh.ownerManifest, installation.ownerManifest) ||
      !isDeepStrictEqual(fresh.ownerLock, installation.ownerLock)) {
    throw new Error('npm installation changed before replacement');
  }
}

async function cacheVerifiedTarball(tool, cache, { url, bytes }) {
  const require = createRequire(tool.args[0]);
  const path = join(cache, '_cacache');
  const key = `make-fetch-happen:request-cache:${url}`;
  const time = Date.now();
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
  try {
    await require('cacache').put(path, key, bytes, { integrity, metadata: {
      time, url, reqHeaders: {}, resHeaders: { 'cache-control': 'public,max-age=3600',
        'content-type': 'application/octet-stream', date: new Date(time).toUTCString() }, options: { compress: true },
    } });
  } catch { throw new Error('could not prepare a verified npm cache; use a standard npm distribution'); }
  return integrity;
}

async function prepareNpm(installation, release, run, tool, stage) {
  const tarball = join(stage, 'release.tgz');
  await writeFile(tarball, release.bytes, { mode: 0o600 });
  if (installation.kind !== 'local') return { args: npmArguments(installation, tarball) };

  const cache = join(stage, 'cache');
  await run(['install', '--global=false', '--location=project', '--prefix', stage, '--no-save', '--package-lock=false',
    '--package-lock-only=false', '--dry-run=false', '--force=false', '--bin-links=false', '--ignore-scripts',
    '--workspaces=false', '--engine-strict', '--no-audit', '--no-fund', '--cache', cache, '--offline=false', tarball], stage);
  const integrity = await cacheVerifiedTarball(tool, cache, release);
  const args = npmArguments(installation, release.url);
  args.splice(-1, 0, '--cache', cache, '--offline', '--prefer-online=false',
    '--lockfile-version', String(installation.ownerLock.lockfileVersion));
  return { args, integrity };
}

async function assertSavedArchive(installation, release, integrity) {
  const lock = await readJson(join(installation.owner, 'package-lock.json'));
  const entry = lock.packages?.['node_modules/open-kimi-web'];
  if (!entry || entry.resolved !== release.url || entry.integrity !== integrity) {
    throw new Error('npm did not record the verified release archive');
  }
}

async function replaceNpm(installation, release, tool, context) {
  const run = (args, cwd) => (context.run ?? checkedRun)(tool.command, [...tool.args, ...args], {
    cwd, signal: context.signal, timeoutMs: 300_000, quietFailure: true,
  });
  const stage = await mkdtemp(join(tmpdir(), 'okw-update-'));
  let keepStage = false;
  try {
    context.stage?.('npm preparation');
    const prepared = await prepareNpm(installation, release, run, tool, stage);
    await assertUnchanged(installation, context);
    context.stage?.('npm replacement', true);
    await run(prepared.args, installation.owner ?? installation.prefix);
    if (prepared.integrity) await assertSavedArchive(installation, release, prepared.integrity);
  } catch (error) {
    keepStage = error.cleanupUnconfirmed === true;
    throw error;
  } finally {
    if (!keepStage) await rm(stage, { recursive: true, force: true });
  }
}

export async function updateNpm(installation, plan, context = {}) {
  const tool = await (context.resolveTool ?? resolveTool)('npm');
  await assertUnchanged(installation, context);
  context.stage?.('verified release download');
  const release = await downloadRelease(plan, context);
  if (release.downloadedViaProxy) context.log?.('Verified the release downloaded via the GitHub download proxy.');
  await replaceNpm(installation, release, tool, context);
  return { version: plan.version };
}
