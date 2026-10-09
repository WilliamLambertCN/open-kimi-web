import { cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkedRun } from '../../packages/launcher/src/update/process.mjs';
import { resolveTool } from '../../packages/launcher/src/update/toolResolver.mjs';

export const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
export const launcherRoot = join(projectRoot, 'packages/launcher');
export const officialOrigin = 'https://github.com/WilliamLambertCN/open-kimi-web.git';

export async function put(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

async function dependencyRoot(name, from) {
  const require = createRequire(join(from, 'package.json'));
  let path = dirname(await realpath(require.resolve(name)));
  while (dirname(path) !== path) {
    try {
      if (JSON.parse(await readFile(join(path, 'package.json'), 'utf8')).name === name) return path;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    path = dirname(path);
  }
  throw new Error(`fixture cannot resolve ${name}`);
}

export async function copyDependencies(from, to, names, copied = new Set()) {
  for (const name of names) {
    if (copied.has(name)) continue;
    copied.add(name);
    const root = await dependencyRoot(name, from);
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    const target = join(to, 'node_modules', name);
    await cp(root, target, { recursive: true, dereference: true, filter: (path) => path !== join(root, 'node_modules') });
    await copyDependencies(root, to, Object.keys(manifest.dependencies ?? {}), copied);
  }
}

export async function packageFixture(directory, version) {
  const root = join(directory, `package-${version}`);
  await cp(join(launcherRoot, 'src'), join(root, 'src'), { recursive: true });
  await cp(join(launcherRoot, 'bin'), join(root, 'bin'), { recursive: true });
  const manifest = JSON.parse(await readFile(join(launcherRoot, 'package.json'), 'utf8'));
  manifest.version = version;
  manifest.scripts = { install: 'node -e "require(\'fs\').writeFileSync(\'UNSAFE-LIFECYCLE\',\'ran\')"' };
  manifest.bundledDependencies = Object.keys(manifest.dependencies);
  await copyDependencies(launcherRoot, root, manifest.bundledDependencies);
  await put(join(root, 'package.json'), manifest);
  const tool = await resolveTool('npm');
  await checkedRun(tool.command, [...tool.args, 'pack', '--ignore-scripts', '--pack-destination', directory], {
    cwd: root, timeoutMs: 60_000,
  });
  return join(directory, `open-kimi-web-${version}.tgz`);
}

export async function git(repo, args) {
  return checkedRun('git', ['-C', repo, ...args], { timeoutMs: 30_000 });
}

export async function sourceFixture(directory) {
  const remote = join(directory, 'remote');
  const checkout = join(directory, 'checkout');
  await mkdir(remote);
  await git(remote, ['init', '-b', 'main']);
  await git(remote, ['config', 'core.autocrlf', 'false']);
  await git(remote, ['config', 'user.name', 'Update fixture']);
  await git(remote, ['config', 'user.email', 'fixture@example.invalid']);
  await put(join(remote, '.gitignore'), 'node_modules/\n');
  await put(join(remote, 'package.json'), { name: 'open-kimi-web-monorepo', private: true,
    type: 'module', packageManager: 'pnpm@10.33.0', engines: { node: '>=22.0.0' } });
  await put(join(remote, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  await cp(join(launcherRoot, 'src'), join(remote, 'packages/launcher/src'), { recursive: true });
  await cp(join(launcherRoot, 'bin'), join(remote, 'packages/launcher/bin'), { recursive: true });
  const manifest = JSON.parse(await readFile(join(launcherRoot, 'package.json'), 'utf8'));
  manifest.version = '2.1.1-r9';
  manifest.dependencies = {};
  delete manifest.scripts;
  await put(join(remote, 'packages/launcher/package.json'), manifest);
  const corepack = await resolveTool('corepack');
  await checkedRun(corepack.command, [...corepack.args, 'pnpm', 'install', '--lockfile-only'], {
    cwd: remote, timeoutMs: 60_000,
  });
  await git(remote, ['add', '.']);
  await git(remote, ['commit', '-m', 'fixture initial']);
  await checkedRun('git', ['-c', 'core.autocrlf=false', 'clone', '--no-hardlinks', remote, checkout]);
  await git(checkout, ['config', 'core.autocrlf', 'false']);
  await git(checkout, ['remote', 'set-url', 'origin', officialOrigin]);
  manifest.version = '2.1.1-r10';
  await put(join(remote, 'packages/launcher/package.json'), manifest);
  await git(remote, ['add', '.']);
  await git(remote, ['commit', '-m', 'fixture updated']);
  return { remote, checkout, sha: await git(remote, ['rev-parse', 'HEAD']) };
}

export function identityOptions(root) {
  return { modulePath: join(root, 'src/update/installation.mjs'), entryPath: join(root, 'bin/open-kimi-web.mjs'), env: {} };
}

export function networkInjectedRun(remote, tgz) {
  return async (command, args, options) => {
    const copy = [...args];
    if (command === 'git' && (copy.includes('fetch') || copy.includes('ls-remote'))) {
      copy[copy.indexOf('origin')] = remote;
    }
    if (tgz && copy.at(-1)?.startsWith('https://github.com/WilliamLambertCN/open-kimi-web/releases/download/')) {
      copy[copy.length - 1] = tgz;
    }
    return checkedRun(command, copy, options);
  };
}

export async function supportFixture(directory) {
  const root = join(directory, 'support');
  await put(join(root, 'package.json'), { name: 'fixture-support', version: '1.0.0' });
  await put(join(root, 'index.js'), 'module.exports = "support remains installed";');
  const tool = await resolveTool('npm');
  await checkedRun(tool.command, [...tool.args, 'pack', '--ignore-scripts', '--pack-destination', directory], { cwd: root });
  return join(directory, 'fixture-support-1.0.0.tgz');
}

export function globalRoot(prefix) {
  return resolve(prefix, process.platform === 'win32' ? 'node_modules/open-kimi-web' : 'lib/node_modules/open-kimi-web');
}
