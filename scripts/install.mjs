import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { downloadBytes } from './install/network.mjs';
import { assertIntegrationPaths } from './install/paths.mjs';
import { assertNoSystemShadow, expandWindowsPath, windowsPaths } from './install/system.mjs';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = 'https://github.com/WilliamLambertCN/open-kimi-web';
const API = 'https://api.github.com/repos/WilliamLambertCN/open-kimi-web/releases';
import { installerCommand, wrapperEntry } from './install/wrappers.mjs';
import { integrationOptions, persistInstallerPath, preflightPersistentPath } from './install/persistentPath.mjs';
import { acquireInstallerUpdateLock } from './install/updateLock.mjs';
import { adjacentNpm, installNpmArgs, isolatedNpmEnv, nodeSupported } from './install/npm.mjs';
import { discoverOfficial, officialCommand, prepareOfficial } from './install/official.mjs';
import { normalizePathEnv, pathValue } from './install/environment.mjs';
export { adjacentNpm, installNpmArgs, isolatedNpmEnv } from './install/npm.mjs';
const ENTRY = 'bin/open-kimi-web.mjs';
const HELP = 'Usage: node scripts/install.mjs [--version <formal version>] [--switch-installation] [--no-integrate]';

export function versionParts(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-r([1-9]\d*))?$/.exec(value ?? '');
  return match ? match.slice(1).map((part) => BigInt(part ?? 0)) : null;
}

function newer(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index];
  }
  return false;
}

export function parseInstallArgs(args) {
  const options = { integrate: true, switchInstallation: false };
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (seen.has(arg)) throw new Error('duplicate installation option');
    seen.add(arg);
    if (arg === '--version') {
      const version = args[++index]?.replace(/^v/, '');
      if (!versionParts(version)) throw new Error('--version requires a formal version, e.g. 2.3.1-r1');
      options.version = version;
    } else if (arg === '--no-integrate') options.integrate = false;
    else if (arg === '--switch-installation') options.switchInstallation = true;
    else throw new Error('unknown installation option; use --help');
  }
  return options;
}

function exactAsset(value, name, url) {
  if (!Array.isArray(value.assets)) throw new Error('release assets are malformed');
  const assets = value.assets.filter((asset) => asset?.name === name || asset?.browser_download_url === url);
  if (assets.length !== 1) throw new Error('release must have one exact uploaded tgz asset');
  const asset = assets[0];
  if (asset.name !== name || asset.browser_download_url !== url || asset.state !== 'uploaded') {
    throw new Error('release must have one exact uploaded tgz asset');
  }
  if (!/^sha256:[a-fA-F0-9]{64}$/.test(asset.digest ?? '')) throw new Error('release requires a SHA256 digest');
  return asset.digest.slice(7).toLowerCase();
}

export function validateInstallRelease(value, requested) {
  if (value?.draft !== false || value.prerelease !== false) throw new Error('release is not formal');
  const version = value.tag_name?.startsWith('v') ? value.tag_name.slice(1) : '';
  if (!versionParts(version)) throw new Error('release version does not match');
  if (requested && requested !== version) throw new Error('release version does not match');
  const name = `open-kimi-web-${version}.tgz`;
  const url = `${REPO}/releases/download/v${version}/${name}`;
  if (value.html_url !== `${REPO}/releases/tag/v${version}`) throw new Error('release repository does not match');
  return { version, url, digest: exactAsset(value, name, url) };
}

export { assertDownloadUrl } from './install/network.mjs';
function pathEqual(a, b, platform) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
}

async function present(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function safeAncestors(path) {
  let current = resolve(path);
  while (true) {
    const stat = await present(current);
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error('installation directory is unsafe or linked');
    if (dirname(current) === current) return;
    current = dirname(current);
  }
}

async function jsonOrNull(path) {
  const stat = await present(path);
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) throw new Error('unsafe installation state file');
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { throw new Error('installation state is unreadable or corrupt'); }
}

export async function runInstallProcess(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const env = options.env ? normalizePathEnv(options.env) : undefined;
    const child = spawn(command, args, { cwd: options.cwd, env, shell: false, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let bytes = 0;
    let failure;
    let cleanup;
    let killed = Promise.resolve();
    const stop = (message) => {
      if (failure) return;
      failure = new Error(message);
      if (process.platform === 'win32') {
        const killer = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/taskkill.exe'),
          ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killed = new Promise((done) => {
          killer.on('error', () => { failure.keepLock = true; done(); });
          killer.on('exit', (code) => { if (code !== 0) failure.keepLock = true; done(); });
        });
      } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { failure.keepLock = true; } }
      cleanup = setTimeout(() => { failure.keepLock = true; child.unref(); reject(failure); }, 5_000);
    };
    const timer = setTimeout(() => stop('installer child timed out'), options.timeoutMs ?? 30_000);
    const collect = (output) => (chunk) => {
      bytes += chunk.length;
      if (bytes > 256 * 1024) stop('installer child exceeded output limit');
      else if (output) stdout += chunk.toString();
    };
    child.stdout.on('data', collect(true));
    child.stderr.on('data', collect(false));
    child.on('error', () => { clearTimeout(timer); reject(new Error('installer could not start required executable')); });
    child.on('close', async (code) => {
      clearTimeout(timer);
      await killed;
      clearTimeout(cleanup);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`installer child failed (exit ${code}); no command output logged`));
      else resolvePromise(stdout.trim());
    });
  });
}

function commandDirs(ctx) {
  return pathValue(ctx.env, ctx.platform).split(ctx.platform === 'win32' ? ';' : ':').filter(Boolean);
}

async function findCommand(ctx, name, skip = []) {
  const names = ctx.platform === 'win32' ? [`${name}.exe`] : [name];
  for (const dir of commandDirs(ctx)) {
    if (skip.some((path) => pathEqual(path, dir, ctx.platform))) continue;
    for (const file of names) {
      const candidate = resolve(dir, file);
      try { await access(candidate, ctx.platform === 'win32' ? constants.F_OK : constants.X_OK); }
      catch { continue; }
      return realpath(candidate);
    }
  }
  throw new Error(`${name} executable is required on PATH; install it before retrying`);
}

function dependencyVersionPattern(name) {
  return name === 'tar' ? /\b(?:bsdtar|tar)\b/i : /\bcurl\b/i;
}

async function prerequisites(ctx) {
  if (!nodeSupported()) throw new Error('Node >=22.19.0 is required');
  ctx.npm = await (ctx.adjacentNpm ?? adjacentNpm)(ctx.node, ctx.platform);
  if (!/^\d+\.\d+\.\d+$/.test(await ctx.run(ctx.node, [ctx.npm, '--version'], { env: ctx.env }))) {
    throw new Error('attached npm did not report a version');
  }
  for (const name of ['curl', 'tar']) {
    const command = await findCommand(ctx, name);
    const pattern = dependencyVersionPattern(name);
    if (!pattern.test(await ctx.run(command, ['--version'], { env: ctx.env }))) {
      throw new Error(`${name} did not report a recognizable version`);
    }
  }
}

function assertIntegrationState(state, ctx, names) {
  if (!state || state.schema !== 1 || !isAbsolute(state.node ?? '') || !isAbsolute(state.realKimi ?? '')) {
    throw new Error('unknown or partial integration; inspect it manually before retrying');
  }
  if (!pathEqual(state.wrapperDir, ctx.bin, ctx.platform) || JSON.stringify(state.wrapperFiles) !== JSON.stringify(names)) {
    throw new Error('integration wrapper paths conflict');
  }
}

async function readWrapperTarget(ctx, state, name, kimi) {
  const path = join(ctx.bin, name);
  const file = await present(path);
  if (!file?.isFile() || file.isSymbolicLink() || file.size > 16 * 1024) {
    throw new Error('partial or linked integration wrapper');
  }
  const entry = wrapperEntry(await readFile(path, 'utf8'), state, ctx, kimi);
  if (!entry) throw new Error('integration wrapper ownership could not be confirmed');
  return entry;
}

async function assertWindowsTrace(ctx) {
  const paths = await (ctx.windowsPaths ?? windowsPaths)(ctx);
  const value = expandWindowsPath(`${paths.system};${paths.user}`, ctx.env);
  if (value.split(';').some((dir) => pathEqual(dir, ctx.bin, ctx.platform))) {
    throw new Error('partial persistent integration PATH trace without state; inspect manually');
  }
}

async function assertNoIntegrationTrace(ctx) {
  if (commandDirs(ctx).some((dir) => pathEqual(dir, ctx.bin, ctx.platform))) {
    throw new Error('partial integration PATH trace without state; inspect manually');
  }
  if (ctx.platform === 'win32') return assertWindowsTrace(ctx);
  const home = ctx.env.HOME || ctx.env.USERPROFILE || homedir();
  for (const name of ['.bashrc', '.zshrc', '.profile']) {
    const file = join(home, name);
    if (!await present(file)) continue;
    if ((await readFile(file, 'utf8')).includes('# >>> open-kimi-web >>>')) {
      throw new Error('partial integration shell trace without state; inspect manually');
    }
  }
}

async function integrationEvidence(ctx) {
  const state = await jsonOrNull(join(ctx.home, 'integration.json'));
  const names = ctx.platform === 'win32' ? ['kimi.cmd', 'open-kimi-web.cmd'] : ['kimi', 'open-kimi-web'];
  if (await present(ctx.bin)) await safeAncestors(ctx.bin);
  const files = await Promise.all(names.map((name) => present(join(ctx.bin, name))));
  if (!state && files.every((file) => !file)) {
    await assertNoIntegrationTrace(ctx);
    return { kind: 'none' };
  }
  assertIntegrationState(state, ctx, names);
  const targets = await Promise.all(names.map((name, index) => readWrapperTarget(ctx, state, name, index === 0)));
  if (!pathEqual(targets[0], targets[1], ctx.platform)) throw new Error('integration wrapper targets conflict');
  const target = targets[0];
  if (!await present(target)) throw new Error('integration target is missing; inspect partial installation manually');
  return { kind: pathEqual(target, ctx.entry, ctx.platform) ? 'same' : 'foreign', target, state };
}

async function commandEvidence(ctx, switching) {
  for (const dir of commandDirs(ctx)) {
    for (const name of ctx.platform === 'win32' ? ['open-kimi-web.exe', 'open-kimi-web.cmd', 'open-kimi-web.ps1',
      'open-kimi-web'] : ['open-kimi-web']) {
      if (!await present(join(dir, name))) continue;
      if ([ctx.bin, ctx.prefixBin].some((path) => pathEqual(dir, path, ctx.platform))) continue;
      if (!switching) throw new Error('another open-kimi-web command is on PATH; use --switch-installation explicitly');
    }
  }
}

function assertPrefixRecord(record, ctx) {
  if (record?.schema !== 1 || !versionParts(record.version)) throw new Error('dedicated npm prefix is unknown or partial');
  if (!pathEqual(record.prefix, ctx.prefix, ctx.platform) || !pathEqual(record.entry, ctx.entry, ctx.platform)) {
    throw new Error('dedicated npm prefix ownership conflicts');
  }
}

function assertManifest(manifest) {
  if (manifest?.name !== 'open-kimi-web' || manifest.bin?.['open-kimi-web'] !== ENTRY || !versionParts(manifest.version)) {
    throw new Error('existing dedicated package identity is invalid');
  }
}

async function prefixEvidence(ctx) {
  await safeAncestors(ctx.prefix);
  const record = await jsonOrNull(ctx.recordFile);
  const contents = await present(ctx.prefix) ? await readdir(ctx.prefix) : [];
  if (contents.length === 0 && !record) return null;
  assertPrefixRecord(record, ctx);
  await safeAncestors(ctx.root);
  const manifest = await jsonOrNull(join(ctx.root, 'package.json'));
  assertManifest(manifest);
  await safeAncestors(dirname(ctx.entry));
  const entry = await present(ctx.entry);
  if (!entry?.isFile() || entry.isSymbolicLink()) throw new Error('existing dedicated package is incomplete or linked');
  return manifest.version;
}

export async function preflightInstall(ctx, options) {
  await safeAncestors(ctx.home);
  const installedVersion = await prefixEvidence(ctx);
  const integration = await integrationEvidence(ctx);
  if (integration.kind === 'foreign' && !options.switchInstallation) {
    throw new Error('integration targets another installation; use --switch-installation explicitly');
  }
  await commandEvidence(ctx, options.switchInstallation);
  ctx.kimi = integration.state?.realKimi;
  if (options.integrate) {
    assertIntegrationPaths(ctx);
    await preflightPersistentPath(ctx, integration.state);
  }
  await prerequisites(ctx);
  const official = await (ctx.discoverOfficial ?? discoverOfficial)(ctx);
  ctx.kimi = official.path;
  if (options.integrate) assertIntegrationPaths(ctx);
  return { installedVersion, integration, official };
}

async function verifyInstalled(ctx, version) {
  const module = join(ctx.root, 'src/update/installation.mjs');
  const updater = await import(pathToFileURL(module).href);
  const identity = await updater.identifyInstallation({
    modulePath: module, entryPath: ctx.entry, env: {}, platform: ctx.platform,
  });
  if (identity.kind !== 'global' || !pathEqual(identity.prefix, ctx.prefix, ctx.platform) || identity.version !== version) {
    throw new Error('installed package update identity does not match dedicated prefix/version');
  }
  const reported = await ctx.run(ctx.node, [ctx.entry, '--version'], { env: ctx.env });
  if (reported !== version) throw new Error('installed CLI version does not match release');
  const deps = await import(pathToFileURL(join(ctx.root, 'src/launcherDependencies.mjs')).href);
  if ((await deps.missingLauncherDependencies()).length) throw new Error('installed runtime dependencies are incomplete');
}

async function integrateInstalled(ctx, before) {
  const integration = await import(pathToFileURL(join(ctx.root, 'src/integration/integrate.mjs')).href);
  const method = before.kind === 'none' ? integration.installIntegration : integration.repairIntegration;
  const result = await method(integrationOptions(ctx));
  if (result.code !== 0) throw new Error('package installed, but integration failed');
  const after = await integrationEvidence(ctx);
  if (after.kind !== 'same' || !pathEqual(after.state.node, ctx.node, ctx.platform)) {
    throw new Error('package installed, but integration target/runtime verification failed');
  }
  await persistInstallerPath(ctx, after.state);
  if (ctx.platform === 'win32') await assertNoSystemShadow(ctx);
  ctx.log('Persistent PATH and exact integration wrapper target verified for the selected shell.');
}

function homeDirectory(env) {
  return env.OPEN_KIMI_WEB_HOME || join(env.HOME || env.USERPROFILE || homedir(), '.open-kimi-web');
}

export function makeInstallContext(dependencies = {}) {
  const sourceEnv = dependencies.env ?? process.env;
  const denied = /^node_options$|^node_tls_reject_unauthorized$/i;
  const platform = dependencies.platform ?? process.platform;
  const env = normalizePathEnv(Object.fromEntries(Object.entries(sourceEnv).filter(([key]) => !denied.test(key))), platform);
  const home = homeDirectory(env);
  if (!isAbsolute(home) || /[\r\n\0]/.test(home)) throw new Error('installation home must be an absolute safe path');
  const prefix = join(home, 'npm');
  const root = join(prefix, platform === 'win32' ? 'node_modules/open-kimi-web' : 'lib/node_modules/open-kimi-web');
  return { ...dependencies, env, platform, home, prefix, root, entry: join(root, ENTRY), bin: join(home, 'bin'),
    prefixBin: platform === 'win32' ? prefix : join(prefix, 'bin'), recordFile: join(home, 'bootstrap-install.json'),
    node: process.execPath, run: dependencies.run ?? runInstallProcess, log: dependencies.log ?? console.log };
}

async function selectRelease(ctx, options, before) {
  const api = options.version ? `${API}/tags/v${options.version}` : `${API}/latest`;
  const metadata = await (ctx.releaseMetadata ?? (async (url) => JSON.parse((await downloadBytes(url,
    { env: ctx.env, metadata: true })).toString('utf8'))))(api);
  const release = validateInstallRelease(metadata, options.version);
  if (before.installedVersion && newer(before.installedVersion, release.version)) {
    throw new Error('refusing to downgrade newer installation');
  }
  return release;
}

async function stageArchive(ctx, release, progress) {
  progress.label = 'verified release download';
  progress.stage = await mkdtemp(join(ctx.home, '.bootstrap-stage-'));
  const bytes = await (ctx.download ?? downloadBytes)(release.url, { env: ctx.env });
  if (createHash('sha256').update(bytes).digest('hex') !== release.digest) throw new Error('release SHA256 digest mismatch');
  const archive = join(progress.stage, 'release.tgz');
  await writeFile(archive, bytes, { mode: 0o600 });
  for (const name of ['user.npmrc', 'global.npmrc']) await writeFile(join(progress.stage, name), '', { mode: 0o600 });
  return archive;
}

async function recordInstalled(ctx, version, stage) {
  const temporary = join(stage, 'record.json');
  const record = { schema: 1, prefix: ctx.prefix, entry: ctx.entry, version };
  await writeFile(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  await rename(temporary, ctx.recordFile);
}

async function prepareDependencies(ctx, before, options, progress) {
  if (ctx.platform === 'win32') {
    progress.label = 'Git Bash preparation';
    await (ctx.ensureGitBash ?? (async (context) => (await import('./install/gitBash.mjs')).ensureGitBash(context)))(ctx);
    ctx.env = normalizePathEnv(ctx.env, ctx.platform);
    const after = await preflightInstall(ctx, options);
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      throw new Error('installation changed during Git Bash preparation; refusing replacement');
    }
  }
  await (ctx.prepareOfficial ?? prepareOfficial)(ctx, before.official, progress.stage, progress);
  if (options.integrate) assertIntegrationPaths(ctx);
}

async function installLocked(ctx, options, progress) {
  const before = await preflightInstall(ctx, options);
  progress.updateRelease = await (ctx.acquireUpdateLock ?? acquireInstallerUpdateLock)(ctx, before.installedVersion);
  const release = await selectRelease(ctx, options, before);
  const archive = await stageArchive(ctx, release, progress);
  const again = await preflightInstall(ctx, options);
  if (JSON.stringify(again) !== JSON.stringify(before)) {
    throw new Error('installation changed during download; refusing replacement');
  }
  await prepareDependencies(ctx, before, options, progress);
  progress.label = 'npm replacement (may be partial)';
  await mkdir(ctx.prefix, { recursive: true });
  await ctx.run(ctx.node, installNpmArgs(ctx, archive), { cwd: progress.stage,
    env: isolatedNpmEnv(ctx.env, progress.stage, ctx.node, ctx.platform), timeoutMs: 300_000 });
  progress.label = 'installed package verification';
  await (ctx.verifyInstalled ?? verifyInstalled)(ctx, release.version);
  await recordInstalled(ctx, release.version, progress.stage);
  if (options.integrate) {
    progress.label = 'integration (package installed)';
    const current = await integrationEvidence(ctx);
    if (JSON.stringify(current) !== JSON.stringify(before.integration)) {
      throw new Error('integration changed during package installation; refusing takeover');
    }
    await (ctx.integrateInstalled ?? integrateInstalled)(ctx, before.integration);
  }
  ctx.log(`Installed open-kimi-web ${release.version} in ${ctx.prefix}.`);
  if (!options.integrate) {
    ctx.log('Package only: kimi web takeover was NOT installed or changed (--no-integrate).');
    ctx.log(`Official Kimi: ${officialCommand(ctx)}`);
    ctx.log('Prepared dependencies are not added to persistent PATH in package-only mode.');
  } else {
    ctx.log('Open a new terminal: open-kimi-web --version; kimi web --host. No service was started.');
    ctx.log('integrate status is diagnostic; r9 may report stale shell rc selection even when the selected shell works.');
  }
  ctx.log(`Update: ${installerCommand(ctx, 'update')}`);
  ctx.log(`Undo takeover: ${installerCommand(ctx, 'integrate uninstall')}`);
  return { version: release.version, prefix: ctx.prefix, entry: ctx.entry, integrated: options.integrate };
}

export async function installRelease(options, dependencies = {}) {
  const ctx = makeInstallContext(dependencies);
  await safeAncestors(ctx.home);
  await mkdir(ctx.home, { recursive: true });
  const lock = join(ctx.home, '.bootstrap-install.lock');
  let handle;
  try { handle = await open(lock, 'wx', 0o600); }
  catch { throw new Error('installer lock exists or cannot be acquired; verify prior installer stopped before manual cleanup'); }
  const progress = { label: 'preflight', stage: null, updateRelease: null };
  let keepLock = false;
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid }));
    return await installLocked(ctx, options, progress);
  } catch (error) {
    keepLock = Boolean(error.keepLock);
    throw new Error(`Installation failed at ${progress.label}: ${error.message}. No rollback or old-install deletion.`);
  } finally {
    await handle.close();
    if (!keepLock) {
      await progress.updateRelease?.();
      if (progress.stage) await rm(progress.stage, { recursive: true, force: true });
      await rm(lock, { force: true });
    }
  }
}

export async function installMain(args, dependencies = {}) {
  const log = dependencies.log ?? console.log;
  const error = dependencies.error ?? console.error;
  let options;
  try { options = parseInstallArgs(args); } catch (failure) { error(failure.message); return 2; }
  if (options.help) { log(HELP); return 0; }
  try { await installRelease(options, dependencies); return 0; }
  catch (failure) { error(failure.message); return 1; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await installMain(process.argv.slice(2));
}
