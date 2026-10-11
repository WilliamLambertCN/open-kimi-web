import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { Agent, request } from 'node:https';
import { basename, dirname, isAbsolute, join, resolve, win32 } from 'node:path';

const VERSION = '2.56.0.2';
const RELEASE = 'https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.2/';
const ASSETS = Object.freeze({
  x64: Object.freeze({ name: `PortableGit-${VERSION}-64-bit.7z.exe`, size: 60027568,
    digest: '075e158ef8e1f0ab80b347e245405d3eca735c2dc88fd8e032e137d0ca61f61b' }),
  arm64: Object.freeze({ name: `PortableGit-${VERSION}-arm64.7z.exe`, size: 59581088,
    digest: '0f21e681bd33e006e0348dfa1a2be6769efd77e3bfdb247320314facde23a46c' }),
});
const PREFIXES = new Set(['mingw32', 'mingw64', 'ucrt64', 'clang64', 'clangarm64']);

function envKey(env, name) {
  return Object.keys(env).find((key) => key.toLowerCase() === name.toLowerCase()) ?? name;
}

function envValue(env, name) { return env[envKey(env, name)] ?? ''; }

async function stat(path) {
  try { return await lstat(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function regularFile(path) { return (await stat(path))?.isFile() === true; }

async function safeDirectory(path) {
  if (!isAbsolute(path)) throw new Error('Git runtime directory must be absolute');
  let current = resolve(path);
  while (true) {
    const item = await stat(current);
    if (item && (!item.isDirectory() || item.isSymbolicLink())) {
      throw new Error('Git runtime directory contains a link or non-directory ancestor');
    }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function cleanProbeEnv(env) {
  const clean = { ...env };
  for (const key of Object.keys(clean)) {
    if (/^(BASH_ENV|ENV|SHELLOPTS|BASHOPTS|CDPATH|BASH_FUNC_.*)$/i.test(key)) delete clean[key];
  }
  clean.BASH_ENV = '';
  clean.ENV = '';
  return clean;
}

async function verifyPair(ctx, root, shellPath, expected = '') {
  const gitPath = join(root, 'cmd/git.exe');
  if (!await regularFile(shellPath) || !await regularFile(gitPath)) return;
  const env = cleanProbeEnv(ctx.env);
  const options = { env, timeoutMs: 10_000 };
  try {
    const version = (await ctx.run(gitPath, ['--version'], options)).trim();
    if (!/^git version \d+\.\d+\.\d+\.windows\.\d+$/.test(version)) return;
    if (expected && version !== `git version ${expected.replace(/\.(\d+)$/, '.windows.$1')}`) return;
    const marker = await ctx.run(shellPath, ['--noprofile', '--norc', '-c',
      'test -n "$BASH_VERSION" && command -v cygpath >/dev/null && /cmd/git.exe --version >/dev/null ' +
      '&& printf okw-git-bash'], options);
    if (marker.trim() !== 'okw-git-bash') return;
    return { root, shellPath, gitPath, pathDirectory: join(root, 'cmd'), version };
  } catch (error) { if (error.keepLock) throw error; }
}

async function probeRoot(ctx, root) {
  for (const relative of ['bin/bash.exe', 'usr/bin/bash.exe']) {
    const pair = await verifyPair(ctx, root, join(root, relative));
    if (pair) return pair;
  }
}

function rootFromShell(path) {
  const directory = dirname(path);
  if (basename(directory).toLowerCase() !== 'bin' || basename(path).toLowerCase() !== 'bash.exe') return;
  const parent = dirname(directory);
  return basename(parent).toLowerCase() === 'usr' ? dirname(parent) : parent;
}

async function fromGit(ctx, path) {
  if (!await regularFile(path)) return;
  const parent = dirname(path);
  if (['bin', 'cmd'].includes(basename(parent).toLowerCase())) {
    const direct = await probeRoot(ctx, dirname(parent));
    if (direct) return direct;
  }
  try {
    const output = (await ctx.run(path, ['--exec-path'], { env: cleanProbeEnv(ctx.env), timeoutMs: 5_000 })).trim();
    if (!isAbsolute(output)) return;
    const parts = output.replaceAll('\\', '/').split('/');
    const prefix = parts.findIndex((part) => PREFIXES.has(part.toLowerCase()));
    const root = prefix < 0 ? resolve(output, '../..') : resolve(parts.slice(0, prefix).join('/'));
    return await probeRoot(ctx, root);
  } catch (error) { if (error.keepLock) throw error; }
}

async function overrideGitBash(ctx, override) {
  const path = override.trim();
  const root = isAbsolute(path) && rootFromShell(path);
  const pair = root && await verifyPair(ctx, root, path);
  if (!pair) throw new Error('KIMI_SHELL_PATH is not a working Git Bash with an adjacent Git cmd directory');
  return pair;
}

function fallbackRoots(env) {
  const roots = [
    join(envValue(env, 'ProgramFiles') || 'C:\\Program Files', 'Git'),
    join(envValue(env, 'ProgramFiles(x86)') || 'C:\\Program Files (x86)', 'Git'),
  ];
  const local = envValue(env, 'LOCALAPPDATA');
  if (local && isAbsolute(local)) roots.push(join(local, 'Programs/Git'));
  return roots;
}

async function existingGitBash(ctx) {
  const override = envValue(ctx.env, 'KIMI_SHELL_PATH');
  if (override !== '') return overrideGitBash(ctx, override);
  for (const entry of envValue(ctx.env, 'PATH').split(';')) {
    const directory = entry.replace(/^"(.*)"$/, '$1');
    if (!isAbsolute(directory)) continue;
    const pair = await fromGit(ctx, join(directory, 'git.exe'));
    if (pair) return pair;
  }
  for (const root of fallbackRoots(ctx.env)) {
    const pair = await probeRoot(ctx, root);
    if (pair) return pair;
  }
}

export function assertGitDownloadUrl(value, redirected = false) {
  const url = new URL(value);
  const asset = Object.values(ASSETS).some((item) => value === RELEASE + item.name);
  const redirect = redirected && ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || (!asset && !redirect)) {
    throw new Error('Portable Git download URL is not an approved official HTTPS asset');
  }
  return url;
}

function receiveGit(response, context, finish) {
  const chunks = [];
  let count = 0;
  response.on('data', (chunk) => {
    count += chunk.length;
    if (count > context.size) finish(new Error('Portable Git download exceeds fixed asset size'));
    else chunks.push(chunk);
  });
  response.once('end', () => {
    if (!response.complete) finish(new Error('Portable Git download interrupted'));
    else finish(null, { bytes: Buffer.concat(chunks) });
  });
}

function gitResponse(url, context, redirects) {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const cancel = () => finish(new Error('Portable Git download timed out'));
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      context.signal.removeEventListener('abort', cancel);
      req.setTimeout(0);
      if (error) { req.destroy(); reject(error); } else resolvePromise(result);
    };
    const req = context.request(url, { agent: context.agent, headers: { 'User-Agent': 'open-kimi-web-installer' } }, (res) => {
      const interrupted = () => finish(new Error('Portable Git download interrupted'));
      res.once('error', interrupted);
      res.once('aborted', interrupted);
      res.once('close', () => { if (!res.complete) interrupted(); });
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();
        try {
          if (redirects >= 4 || !res.headers.location) throw new Error('too many redirects');
          finish(null, { next: assertGitDownloadUrl(new URL(res.headers.location, url).href, true) });
        } catch { finish(new Error('Portable Git download redirect refused')); }
      } else if (res.statusCode !== 200) {
        res.resume();
        finish(new Error(`Portable Git download failed (HTTP ${res.statusCode})`));
      } else receiveGit(res, context, finish);
    });
    req.once('error', () => finish(new Error('Portable Git HTTPS request failed')));
    req.once('close', () => { if (!settled) finish(new Error('Portable Git download interrupted')); });
    req.setTimeout(15_000, () => finish(new Error('Portable Git download idle timeout')));
    context.signal.addEventListener('abort', cancel, { once: true });
    if (context.signal.aborted) cancel(); else req.end();
  });
}

export async function downloadGitAsset(asset, env, dependencies = {}) {
  const controller = new AbortController();
  const agent = (dependencies.agentFactory ?? ((options) => new Agent(options)))({ proxyEnv: env });
  const timer = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? 180_000);
  try {
    let url = assertGitDownloadUrl(RELEASE + asset.name);
    const context = { agent, signal: controller.signal, request: dependencies.request ?? request, size: asset.size };
    for (let redirects = 0; redirects <= 4; redirects++) {
      controller.signal.throwIfAborted();
      const result = await gitResponse(url, context, redirects);
      if (!result.next) return result.bytes;
      url = result.next;
    }
  } finally { clearTimeout(timer); agent.destroy(); }
}

function isolatedEnv(ctx, stage) {
  const env = {};
  for (const name of ['SystemRoot', 'WINDIR', 'ComSpec', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_ARCHITEW6432']) {
    const value = envValue(ctx.env, name);
    if (value) env[name] = value;
  }
  return { ...env, HOME: join(stage, 'home'), USERPROFILE: join(stage, 'home'),
    LOCALAPPDATA: join(stage, 'home/AppData/Local'), APPDATA: join(stage, 'home/AppData/Roaming'),
    TEMP: stage, TMP: stage, BASH_ENV: '', ENV: '', GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(stage, 'gitconfig'), PATH: join(env.SystemRoot || 'C:\\Windows', 'System32') };
}

export function portableExtractionBytes(bytes) {
  const startTag = Buffer.from(';!@Install@!UTF-8!');
  const endTag = Buffer.from(';!@InstallEnd@!');
  const start = bytes.indexOf(startTag);
  const end = bytes.indexOf(endTag, start);
  if (start < 0 || end < start) throw new Error('Portable Git SFX configuration is missing');
  const archive = end + endTag.length;
  let payload = archive;
  while (bytes[payload] === 10 || bytes[payload] === 13) payload++;
  if (!bytes.subarray(payload, payload + 6).equals(Buffer.from('377abcaf271c', 'hex'))) {
    throw new Error('Portable Git SFX payload is not a 7z archive');
  }
  const config = ';!@Install@!UTF-8!\nTitle="Portable Git extraction"\nProgress="no"\n' +
    'RunProgram="usr\\\\bin\\\\true.exe"\n;!@InstallEnd@!\n';
  return Buffer.concat([bytes.subarray(0, start), Buffer.from(config), bytes.subarray(payload)]);
}

async function extractPortable(ctx, archive, unpacked, env) {
  if (/[%!&|<>^"\r\n\0]/.test(unpacked)) throw new Error('Portable Git extraction path cannot be safely quoted');
  const executable = join(env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  const argumentsText = `-y -o"${win32.normalize(unpacked)}"`;
  const script = `$ErrorActionPreference='Stop';$p=Start-Process -FilePath ${quote(archive)} ` +
    `-ArgumentList ${quote(argumentsText)} -PassThru -WindowStyle Hidden;$p.WaitForExit();exit $p.ExitCode`;
  await ctx.run(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')], { env, cwd: dirname(archive), timeoutMs: 180_000 });
  const shell = join(unpacked, 'usr/bin/bash.exe');
  if (!await regularFile(shell) || !await regularFile(join(unpacked, 'post-install.bat'))) {
    throw new Error('Portable Git archive has an unexpected layout');
  }
  const initialize = 'export PATH=/cmd:/usr/bin:$PATH SYSCONFDIR=/etc LC_COLLATE=C; ' +
    'for p in /etc/post-install/*.post; do test -e "$p" || continue; ' +
    'case "${p##*/}" in 01-devices.post|03-mtab.post|06-windows-files.post|' +
    '13-copy-dlls.post|99-post-install-cleanup.post) ;; ' +
    '*) echo "Unknown Portable Git initialization script" >&2; exit 1;; esac; done; ' +
    'for p in /etc/post-install/*.post; do test ! -e "$p" || . "$p" || exit; done';
  await ctx.run(shell, ['--noprofile', '--norc', '-c', initialize], { env, cwd: unpacked, timeoutMs: 60_000 });
}

async function readOwnership(path, asset) {
  if (!await regularFile(path)) return false;
  try {
    const record = JSON.parse(await readFile(path, 'utf8'));
    return record.version === VERSION && record.digest === asset.digest && record.asset === asset.name;
  } catch { return false; }
}

async function ownedPrivate(ctx, destination, asset) {
  await safeDirectory(destination);
  if (!await stat(destination)) return;
  if (!await readOwnership(join(destination, '.open-kimi-web-git.json'), asset)) {
    throw new Error('Existing private Git directory is unrecognized; it was not overwritten');
  }
  const pair = await verifyPair(ctx, destination, join(destination, 'bin/bash.exe'), VERSION);
  if (!pair) throw new Error('Existing private Git runtime is broken; it was not overwritten');
  return pair;
}

function portableArchitecture(ctx) {
  const native = envValue(ctx.env, 'PROCESSOR_ARCHITEW6432') || envValue(ctx.env, 'PROCESSOR_ARCHITECTURE');
  const arch = native ? ({ AMD64: 'x64', ARM64: 'arm64' })[native.toUpperCase()] : ctx.arch ?? process.arch;
  if (!ASSETS[arch]) throw new Error('Portable Git requires Windows x64 or arm64');
  return arch;
}

async function acquireGitLock(path) {
  try { return await open(path, 'wx'); } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Private Git runtime is locked; retry after the other installer finishes');
    throw error;
  }
}

async function stagePortable(ctx, stage, destination, asset) {
  const bytes = await (ctx.gitBashDownload ?? downloadGitAsset)(asset, ctx.env);
  if (bytes.length !== asset.size || createHash('sha256').update(bytes).digest('hex') !== asset.digest) {
    throw new Error('Portable Git SHA256 or size mismatch; nothing was extracted');
  }
  const archive = join(stage, asset.name);
  await writeFile(archive, portableExtractionBytes(bytes), { mode: 0o600 });
  const env = isolatedEnv(ctx, stage);
  await mkdir(env.HOME);
  await writeFile(env.GIT_CONFIG_GLOBAL, '', { mode: 0o600 });
  const unpacked = join(stage, 'unpacked');
  await extractPortable(ctx, archive, unpacked, env);
  await safeDirectory(unpacked);
  const pair = await verifyPair({ ...ctx, env }, unpacked, join(unpacked, 'bin/bash.exe'), VERSION);
  if (!pair) throw new Error('Extracted Portable Git version or Bash capability is invalid');
  await writeFile(join(unpacked, '.open-kimi-web-git.json'), JSON.stringify({
    version: VERSION, asset: asset.name, digest: asset.digest,
  }) + '\n', { flag: 'wx', mode: 0o600 });
  if (await stat(destination)) throw new Error('Private Git destination appeared during preparation');
  await rename(unpacked, destination);
  return ownedPrivate(ctx, destination, asset);
}

async function preparePortable(ctx) {
  const arch = portableArchitecture(ctx);
  const asset = ASSETS[arch];
  const runtime = join(ctx.home, 'runtime');
  const destination = join(runtime, `git-${VERSION}-win-${arch}`);
  await safeDirectory(runtime);
  await mkdir(runtime, { recursive: true });
  const lockPath = `${destination}.lock`;
  const lock = await acquireGitLock(lockPath);
  let stage;
  let keepLock = false;
  try {
    const existing = await ownedPrivate(ctx, destination, asset);
    if (existing) return existing;
    stage = await mkdtemp(join(runtime, '.git-stage-'));
    return await stagePortable(ctx, stage, destination, asset);
  } catch (error) { keepLock = Boolean(error.keepLock); throw error; }
  finally {
    await lock.close();
    if (!keepLock) {
      if (stage) await rm(stage, { recursive: true, force: true });
      await rm(lockPath);
    }
  }
}

export async function ensureGitBash(ctx) {
  if (ctx.platform !== 'win32') return;
  const found = await existingGitBash(ctx);
  const pair = found ?? await preparePortable(ctx);
  if (!pair) throw new Error('Unable to verify prepared Git Bash');
  const pathKey = envKey(ctx.env, 'PATH');
  const entries = envValue(ctx.env, 'PATH').split(';').filter(Boolean);
  ctx.env[pathKey] = [pair.pathDirectory, ...entries.filter((entry) =>
    resolve(entry).toLowerCase() !== resolve(pair.pathDirectory).toLowerCase())].join(';');
  ctx.env[envKey(ctx.env, 'KIMI_SHELL_PATH')] = pair.shellPath;
  ctx.gitBash = { ...pair, kind: found ? 'existing' : 'portable' };
  ctx.gitBashPathDirectories = [pair.pathDirectory];
  return ctx.gitBash;
}
