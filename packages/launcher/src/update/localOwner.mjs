import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { assertRealDirectory, exists, readJson } from './files.mjs';

const NAME = 'open-kimi-web';
const GROUPS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const OFFICIAL = ['@moonshot-ai/kimi-code', 'kimi-code'];

function assertSimpleOwner(owner) {
  if (owner.workspaces || owner.packageManager && !/^npm@\d+\.\d+\.\d+/.test(owner.packageManager)) {
    throw new Error('workspace or mixed-manager owner is not supported');
  }
  for (const group of GROUPS) {
    if (OFFICIAL.some((name) => Object.hasOwn(owner[group] ?? {}, name))) {
      throw new Error('owner includes official Kimi; it will not be modified');
    }
    for (const spec of Object.values(owner[group] ?? {})) {
      if (typeof spec !== 'string' || /^(?:file:|link:|workspace:)/.test(spec)) {
        throw new Error('linked or workspace owner dependencies are not supported');
      }
    }
  }
}

function dependencyCategory(owner) {
  const groups = GROUPS.filter((name) => Object.hasOwn(owner[name] ?? {}, NAME));
  if (groups.length !== 1 || !['dependencies', 'devDependencies'].includes(groups[0])) {
    throw new Error('launcher must be one simple direct dependency or devDependency');
  }
  return groups[0];
}

function assertInstalled(installed, manifest, category) {
  if (!installed || installed.link || installed.version !== manifest.version ||
      installed.bin?.[NAME] !== manifest.bin[NAME] || Boolean(installed.dev) !== (category === 'devDependencies')) {
    throw new Error('launcher lock version/bin/category does not match the installed package');
  }
}

function assertLegacy(lock, manifest) {
  if (lock.lockfileVersion === 2 && lock.dependencies?.[NAME]?.version !== manifest.version) {
    throw new Error('npm v2 legacy lock evidence is stale');
  }
}

function assertLock(owner, lock, manifest, category) {
  if (![2, 3].includes(lock.lockfileVersion) || !lock.packages?.['']) throw new Error('npm v2/v3 owner lock required');
  const root = lock.packages[''];
  for (const group of GROUPS) {
    if (!isDeepStrictEqual(root[group] ?? {}, owner[group] ?? {})) {
      throw new Error('owner manifest and lock dependency evidence is stale');
    }
  }
  assertInstalled(lock.packages[`node_modules/${NAME}`], manifest, category);
  assertLegacy(lock, manifest);
  if (Object.entries(lock.packages).some(([key, value]) => value.link || OFFICIAL.some((name) =>
    key.endsWith(`node_modules/${name}`) || value.name === name))) {
    throw new Error('owner lock contains links or official Kimi');
  }
}

export async function inspectLocalOwner(path, manifest) {
  await assertRealDirectory(path);
  for (const conflict of ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'npm-shrinkwrap.json']) {
    if (await exists(join(path, conflict))) throw new Error(`mixed-manager/shrinkwrap conflict: ${conflict}`);
  }
  const owner = await readJson(join(path, 'package.json'));
  if (OFFICIAL.includes(owner.name)) throw new Error('official Kimi owner will not be modified');
  assertSimpleOwner(owner);
  const category = dependencyCategory(owner);
  const lock = await readJson(join(path, 'package-lock.json'));
  assertLock(owner, lock, manifest, category);
  return { category, ownerManifest: owner };
}
