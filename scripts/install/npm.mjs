import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { nodePathEnv } from './environment.mjs';

export function nodeSupported(version = process.versions.node) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  const [major, minor] = version.split('.').map(Number);
  return major > 22 || major === 22 && minor >= 19;
}

export async function adjacentNpm(node, platform = process.platform) {
  const root = platform === 'win32' ? join(dirname(node), 'node_modules/npm') : resolve(dirname(node), '../lib/node_modules/npm');
  const manifest = await stateJson(join(root, 'package.json'));
  if (manifest?.name !== 'npm' || manifest.bin?.npm !== 'bin/npm-cli.js') {
    throw new Error('selected Node has no attached npm CLI');
  }
  return realpath(join(root, 'bin/npm-cli.js'));
}

export function isolatedNpmEnv(env, stage, node, platform = process.platform) {
  const denied = /^npm_config_|^node_options$|^node_extra_ca_certs$|^node_tls_reject_unauthorized$/i;
  const safe = nodePathEnv(Object.fromEntries(Object.entries(env).filter(([key]) => !denied.test(key))), node, platform);
  for (const key of ['proxy', 'https_proxy', 'noproxy', 'registry', 'cafile']) {
    const source = Object.keys(env).find((name) => name.toLowerCase() === `npm_config_${key}`);
    if (source) safe[`npm_config_${key}`] = env[source];
  }
  if (safe.npm_config_registry && !safe.npm_config_registry.startsWith('https://')) {
    throw new Error('npm registry must use HTTPS');
  }
  safe.npm_config_userconfig = join(stage, 'user.npmrc');
  safe.npm_config_globalconfig = join(stage, 'global.npmrc');
  safe.npm_config_cache = join(stage, 'cache');
  safe.npm_config_strict_ssl = 'true';
  return safe;
}

export function installNpmArgs(ctx, archive) {
  return [ctx.npm, 'install', '--global', '--prefix', ctx.prefix, '--ignore-scripts', '--no-audit', '--no-fund',
    '--engine-strict', '--dry-run=false', '--bin-links=true', '--force=false', '--package-lock-only=false',
    '--replace-registry-host=never', '--strict-ssl=true', archive];
}

export async function pathStat(file) {
  try { return await lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function safeDirectory(file) {
  for (let current = resolve(file); ; current = dirname(current)) {
    const stat = await pathStat(current);
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
      throw new Error('official installation directory is unsafe or linked');
    }
    if (dirname(current) === current) return;
  }
}

export async function stateJson(file) {
  const stat = await pathStat(file);
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw new Error('unsafe official installation state');
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { throw new Error('official installation state is corrupt'); }
}

export async function fileDigest(file) {
  const target = await realpath(file);
  const stat = await pathStat(target);
  if (!stat?.isFile() || stat.size > 128 * 1024 * 1024) throw new Error('official package file is unsafe or too large');
  return createHash('sha256').update(await readFile(target)).digest('hex');
}
