import { realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBinTarget } from './binEvidence.mjs';
import { assertRealDirectory, exists, readJson, samePath } from './files.mjs';
import { inspectLocalOwner } from './localOwner.mjs';
import { parseVersion } from './version.mjs';

const ENTRY = 'bin/open-kimi-web.mjs';

function reject(message) {
  throw new Error(`${message}. Use a verified main checkout or reinstall the official GitHub Release tgz manually`);
}

async function sourceInstallation(root, manifest) {
  const repo = resolve(root, '../..');
  const owner = await readJson(join(repo, 'package.json'));
  if (owner.name !== 'open-kimi-web-monorepo' || owner.private !== true ||
      !/^pnpm@\d+\.\d+\.\d+$/.test(owner.packageManager || '')) reject('source monorepo identity is invalid');
  for (const name of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', '.git']) {
    if (!await exists(join(repo, name))) reject('source monorepo evidence is incomplete');
  }
  await assertRealDirectory(repo);
  return { kind: 'source', root, repo, manifest, version: manifest.version, entry: join(root, ENTRY) };
}

async function npmInstallation(root, manifest, platform) {
  const modules = dirname(root);
  if (basename(root) !== 'open-kimi-web' || basename(modules) !== 'node_modules') {
    reject('arbitrary extracted or renamed package is not an npm installation');
  }
  await assertRealDirectory(modules);
  const owner = dirname(modules);
  const extension = platform === 'win32' ? '.cmd' : '';
  const common = { root, manifest, version: manifest.version, entry: join(root, ENTRY) };
  if (await exists(join(owner, 'package.json'))) {
    const local = await inspectLocalOwner(owner, manifest);
    await assertBinTarget(join(modules, '.bin', `open-kimi-web${extension}`), common.entry, platform);
    return { ...common, kind: 'local', owner, ...local };
  }
  if (platform !== 'win32' && basename(owner) !== 'lib') reject('unverified global prefix layout');
  const prefix = platform === 'win32' ? owner : dirname(owner);
  const bin = join(platform === 'win32' ? prefix : join(prefix, 'bin'), `open-kimi-web${extension}`);
  await assertRealDirectory(prefix);
  await assertBinTarget(bin, common.entry, platform);
  return { ...common, kind: 'global', prefix };
}

function assertExecution(root, env) {
  if (/[\\/]_npx[\\/]/i.test(root) || env.npm_command === 'exec' || env.npm_lifecycle_event === 'npx') {
    reject('npx/cache execution is not updateable');
  }
}

function assertManifest(manifest) {
  if (manifest.name !== 'open-kimi-web' || manifest.bin?.['open-kimi-web'] !== ENTRY || !parseVersion(manifest.version)) {
    reject('launcher manifest identity is invalid');
  }
}

export function sameInstallationTarget(fresh, installation) {
  if (fresh.kind !== installation.kind) return false;
  for (const key of ['root', 'entry', 'owner', 'prefix', 'repo']) {
    if (fresh[key] === undefined && installation[key] === undefined) continue;
    if (typeof fresh[key] !== 'string' || typeof installation[key] !== 'string' ||
        !samePath(fresh[key], installation[key])) return false;
  }
  return installation.kind !== 'local' || fresh.category === installation.category;
}

export async function identifyInstallation(options = {}) {
  const modulePath = options.modulePath ?? fileURLToPath(import.meta.url);
  const moduleReal = await realpath(modulePath);
  const root = resolve(dirname(moduleReal), '../..');
  await assertRealDirectory(resolve(dirname(modulePath), '../..'));
  const entryPath = options.entryPath ?? process.argv[1];
  if (!entryPath || !samePath(await realpath(entryPath), join(root, ENTRY))) reject('entry and module identities conflict');
  await assertRealDirectory(root);
  assertExecution(root, options.env ?? process.env);
  const manifest = await readJson(join(root, 'package.json'));
  assertManifest(manifest);
  if (basename(root) === 'launcher' && basename(dirname(root)) === 'packages') {
    return sourceInstallation(root, manifest);
  }
  return npmInstallation(root, manifest, options.platform ?? process.platform);
}
