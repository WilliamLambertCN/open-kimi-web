import { dirname, join, relative, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { fileDigest, pathStat, safeDirectory, stateJson } from './npm.mjs';

export const PTY_INTEGRITY = 'sha512-20JqtutY6JPXTUnL0ij1uad7Qe1baT46lyolh2sSENDd4sTzKZ4nmAFkeAARDKwmlLjPx6XKRlwRUxwjOy+lUg==';
export const PTY_SOURCE_URL = 'https://registry.npmjs.org/node-pty/-/node-pty-1.1.0.tgz';
const HASHES = {
  'node-pty': {
    'package.json': 'f8b6a14f7022c14f1cd5d109486f5dacd32bffb63a9a63e38eced37dacb47439',
    'binding.gyp': '2e6fdfd713f8b3485dd4e2f4efe93bf5436a5ff4eec4deb45533b09b6932efff',
    'scripts/prebuild.js': '7e604b10f7769d7dc95947d3481c00513b9e3bb6c561d5264506350a16a0381a',
    'scripts/post-install.js': 'b15bb24cd3388b05392eeb200aa805e2827356818d111b93847e1b0f6a6ada46',
    'src/unix/pty.cc': '5e1005d6bdcfbe97b486ee415419fe7adae99035047f07340fbad36419e0bae6',
  },
  'node-addon-api': {
    'package.json': 'e4947cf10e432c42459e60a00947ccd1ad2501e16cf1a530b3d39f0c2de5c83f',
    'index.js': 'be71328f325cf541f37704a644e53cd04af1b69bc119b39733d64589e64dffdb',
    'node_addon_api.gyp': 'a1f080ca22f191902d118bc2a169984a9e761af091ca6d0ea456197bf7b6543c',
    'except.gypi': 'ddbc09f5b66fe24dd898fbe659085a6ff72e9575025004fc3762271dba781e8b',
    'noexcept.gypi': '494060b87197c489497a038504147c435b1d09306152048add42ba0d7d16e747',
    'napi.h': '2f2f5d1e4ca96f315c51ad96c292c18294dbb999b98f8b2f33b80816a3189fb0',
    'napi-inl.h': '4b053c184dfed740fbd802fdcf97e85fb8c7b0eb1d83322000d932d31662eda7',
    'napi-inl.deprecated.h': 'b66ed1e565e735bbfabcc2f72d466ab7c5414d3ef8851d1af440b81be7f2375c',
  },
};

export function dependencyRoot(root, name) {
  return dirname(createRequire(join(root, 'package.json')).resolve(`${name}/package.json`));
}

function assertLifecycle(manifest) {
  if (manifest.name !== 'node-pty' || manifest.version !== '1.1.0' ||
    manifest.scripts.install !== 'node scripts/prebuild.js || node-gyp rebuild' ||
    manifest.scripts.postinstall !== 'node scripts/post-install.js' || manifest.scripts.preinstall) {
    throw new Error('unsupported PTY package lifecycle');
  }
}

export async function auditPtyFile(root, file, hash, name) {
  const target = join(root, file);
  await safeDirectory(dirname(target));
  const stat = await pathStat(target);
  if (!stat?.isFile() || stat.isSymbolicLink() || await fileDigest(target) !== hash) {
    throw new Error(`audited PTY build file changed: ${name}/${file}`);
  }
}

export async function auditPtyBuild(paths) {
  const pty = dependencyRoot(paths.root, 'node-pty');
  const addon = dependencyRoot(pty, 'node-addon-api');
  for (const [name, root] of [['node-pty', pty], ['node-addon-api', addon]]) {
    const within = relative(paths.root, root);
    if (!within || within.startsWith('..') || isAbsolute(within)) {
      throw new Error('PTY build dependency escapes official package');
    }
    await safeDirectory(root);
    for (const [file, hash] of Object.entries(HASHES[name])) await auditPtyFile(root, file, hash, name);
  }
  assertLifecycle(await stateJson(join(pty, 'package.json')));
  return pty;
}
