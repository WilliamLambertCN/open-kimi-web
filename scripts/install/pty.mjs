import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodePathEnv, pathValue } from './environment.mjs';
import { isolatedNpmEnv, safeDirectory } from './npm.mjs';
import { auditPtyBuild } from './ptyAudit.mjs';

const PROBE = fileURLToPath(new URL('./ptyProbe.mjs', import.meta.url));

function probeEnv(ctx) {
  const denied = /^(?:BASH_ENV|ENV|SHELLOPTS|BASHOPTS|CDPATH|BASH_FUNC_.*|NODE_OPTIONS|NODE_PATH|LD_PRELOAD|LD_LIBRARY_PATH)$/i;
  return nodePathEnv(Object.fromEntries(Object.entries(ctx.env).filter(([key]) => !denied.test(key))), ctx.node, ctx.platform);
}

export async function verifyPty(ctx, root) {
  const shell = ctx.platform === 'win32' ? ctx.env.KIMI_SHELL_PATH : '/bin/sh';
  if (!shell) throw new Error('official PTY verification requires prepared Git Bash');
  const text = await ctx.run(ctx.node, [PROBE, root, shell, ctx.platform], { env: probeEnv(ctx), timeoutMs: 20000 });
  let result;
  try { result = JSON.parse(text); } catch {}
  if (result?.status === 'unconfirmed') {
    throw Object.assign(new Error('official PTY child exit unconfirmed; staging and lock retained for manual inspection'),
      { keepLock: true });
  }
  if (['ok', 'missing', 'failed'].includes(result?.status)) return result.status;
  throw new Error('official PTY verification returned an invalid result');
}

async function tool(ctx, names) {
  for (const dir of pathValue(ctx.env, ctx.platform).split(process.platform === 'win32' ? ';' : ':').filter(Boolean)) {
    for (const name of names) {
      const file = resolve(dir, name);
      try { await access(file, constants.X_OK); return file; } catch {}
    }
  }
  throw new Error(`Linux PTY build requires ${names.join(' or ')} on PATH; ` +
    'standard Python, C/C++ compiler and make are prerequisites; no sudo or toolchain installation was attempted');
}

async function buildEnv(ctx, stage) {
  const denied = /^(PYTHON.*|NODE_GYP.*|GYP.*|CC|CXX|MAKE.*|.*FLAGS|.*_INCLUDE_PATH|CPATH|.*LIBRARY_PATH|COMPILER_PATH|GCC_.*)$/i;
  const source = Object.fromEntries(Object.entries(probeEnv(ctx)).filter(([key]) => !denied.test(key)));
  const env = isolatedNpmEnv(source, stage, ctx.node, ctx.platform);
  const python = await tool(ctx, ['python3', 'python']);
  const make = await tool(ctx, ['make']);
  const cc = await tool(ctx, ['cc', 'gcc', 'clang']);
  const cxx = await tool(ctx, ['c++', 'g++', 'clang++']);
  if (!/^3\.\d+\.\d+$/.test(await ctx.run(python, ['-c', 'import sys;print(".".join(map(str,sys.version_info[:3])))'],
    { env, timeoutMs: 10000 }))) throw new Error('Linux PTY build requires Python 3');
  return { ...env, PYTHON: python, NODE_GYP_FORCE_PYTHON: python, npm_config_python: python, CC: cc, CXX: cxx,
    MAKE: make, npm_config_devdir: join(stage, 'node-gyp'), npm_config_disturl: 'https://nodejs.org/download/release',
    npm_config_script_shell: '/bin/sh' };
}

export async function preparePty(ctx, paths, stage, progress) {
  const status = await verifyPty(ctx, paths.root);
  if (status === 'ok') return;
  if (status !== 'missing' || ctx.platform !== 'linux') {
    throw new Error('official PTY spawn failed; no unapproved native build was attempted; inspect installation manually');
  }
  progress.label = 'audited node-pty Linux rebuild (requires standard build tools)';
  await safeDirectory(paths.prefix);
  await safeDirectory(paths.root);
  const pty = await auditPtyBuild(paths);
  const env = await buildEnv(ctx, stage);
  await ctx.run(ctx.node, [ctx.npm, 'rebuild', pty, '--prefix', paths.root, '--global=false', '--ignore-scripts=false',
    '--rebuild-bundle=false', '--bin-links=false', '--workspaces=false', '--script-shell=/bin/sh', '--strict-ssl=true'],
  { cwd: paths.root, env, timeoutMs: 300000 });
  if (await verifyPty(ctx, paths.root) !== 'ok') throw new Error('official PTY verification failed after audited rebuild');
}

export async function verifyOwnedPty(ctx, paths) {
  if (await verifyPty(ctx, paths.root) !== 'ok') {
    throw new Error('owned official PTY is broken; inspect and repair manually; no automatic rebuild or reinstall');
  }
}
