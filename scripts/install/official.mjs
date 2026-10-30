import { createHash } from 'node:crypto';
import { access, mkdir, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { downloadBytes } from './network.mjs';
import { fileDigest, installNpmArgs, isolatedNpmEnv, pathStat, safeDirectory, stateJson } from './npm.mjs';
import { installerCommand, shQuote } from './wrappers.mjs';
import { nodePathEnv } from './environment.mjs';
import { verifyOwnedPty } from './pty.mjs';
import { findOfficialCandidate } from './officialCandidates.mjs';
import { verifyOfficialShell } from './officialShell.mjs';

export const OFFICIAL_VERSION = '2.4.1';
export const OFFICIAL_URL = 'https://registry.npmjs.org/@moonshot-ai/kimi-code/-/kimi-code-2.4.1.tgz';
export const OFFICIAL_INTEGRITY = 'z0py3AxbV9ykOB3Pgh2FiycZbMy7XSAXH4Kb1yfyhhmk+l9xH8H9raakVvCGMYLVxxEQGitQLcgOh8clLVYUTw==';

const OWNED_RELEASES = new Map([
  [OFFICIAL_VERSION, OFFICIAL_INTEGRITY],
  ['2.3.1', 'Ikk41ROPta1eQ6gCXOZd7Ag7fg8B0vawjwA0+MVMi8CphFBbvAz8emr7Lc9cI2dAbBSmvAX16U7Jc/+mPVw7Cg=='],
  ['2.1.1', 'xClqcnTQUKgKDbeOGPU78qcwxGzL8wA2rqWuOX3CLpyQ1/NhSX7jAh6hZo/JFwThSX8obkgef3uw/li5JaJNyw=='],
]);

function equal(a, b, platform) {
  return platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
}

export function officialPaths(ctx) {
  const prefix = join(ctx.home, 'official');
  const root = join(prefix, ctx.platform === 'win32' ? 'node_modules' : 'lib/node_modules', '@moonshot-ai/kimi-code');
  const bin = ctx.platform === 'win32' ? prefix : join(prefix, 'bin');
  return { prefix, root, entry: join(root, 'dist/main.mjs'), kimi: join(bin, ctx.platform === 'win32' ? 'kimi.cmd' : 'kimi'),
    record: join(ctx.home, 'bootstrap-official.json') };
}

export { canonicalNpmCmd, canonicalNpmPs1 } from './officialShims.mjs';
import { officialEntry, runtimeCandidate } from './officialShims.mjs';

async function verifyNpmEntry(entry) {
  const root = dirname(dirname(entry));
  await safeDirectory(root);
  const manifest = await stateJson(join(root, 'package.json'));
  if (manifest?.name !== '@moonshot-ai/kimi-code' || manifest.bin?.kimi !== 'dist/main.mjs') {
    throw new Error('official npm package identity or bin target is invalid');
  }
  const file = await pathStat(entry);
  if (!file?.isFile() || file.isSymbolicLink()) throw new Error('official npm entry is missing or linked');
  return manifest.version;
}

async function assertCandidate(ctx, candidate) {
  if (!isAbsolute(candidate) || [ctx.bin, ctx.prefixBin].some((dir) => equal(dirname(candidate), dir, ctx.platform))) {
    throw new Error('official Kimi executable is invalid or points at takeover');
  }
  const target = await realpath(candidate).catch(() => candidate);
  const normalized = ctx.platform === 'win32' ? target.toLowerCase() : target;
  if ([ctx.bin, ctx.prefixBin].some((dir) => {
    const root = ctx.platform === 'win32' ? resolve(dir).toLowerCase() : resolve(dir);
    return normalized === root || normalized.startsWith(`${root}${sep}`);
  })) {
    throw new Error('official Kimi resolves into takeover or launcher prefix');
  }
  const stat = await pathStat(candidate);
  if (!stat || !stat.isFile() && !stat.isSymbolicLink()) throw new Error('official Kimi executable is missing or broken');
}

function assertVersion(version, expected) {
  const label = '^(?:kimi(?:[ -]code)?[, ]+(?:version[, ]+)?)?v?';
  const semver = '(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?)';
  const actual = new RegExp(`${label}${semver}(?:\\s.*)?$`, 'i').exec(version)?.[1];
  if (!actual || expected !== null && actual !== expected) {
    throw new Error('official Kimi did not report a recognizable matching version');
  }
}

export async function verifyOfficial(ctx, candidate) {
  await assertCandidate(ctx, candidate);
  const entry = await officialEntry(candidate, ctx);
  const expected = entry ? await verifyNpmEntry(entry) : null;
  const command = entry ? ctx.node : candidate;
  const args = entry ? [entry] : [];
  const baseEnv = nodePathEnv(ctx.env, ctx.node, ctx.platform);
  const version = await ctx.run(command, [...args, '--version'], { env: baseEnv });
  assertVersion(version, expected);
  const help = await ctx.run(command, [...args, 'web', '--help'], { env: baseEnv });
  if (!/\bweb\b/i.test(help) || !/--(?:host|port)/.test(help)) throw new Error('official Kimi web command is unavailable');
  ctx.officialInvocation = { candidate, command, args };
  return { kind: entry ? 'npm' : 'native', path: candidate, version };
}

function assertRecord(record, paths) {
  const integrity = OWNED_RELEASES.get(record?.version);
  const fields = { schema: 1, integrity, prefix: paths.prefix, entry: paths.entry, kimi: paths.kimi };
  if (!integrity || Object.entries(fields).some(([key, value]) => record[key] !== value)) {
    throw new Error('official dedicated prefix is unknown or partial; no automatic resume. ' +
      'Inspect the dedicated official prefix and bootstrap-official.json; restore a verified installation or ' +
      'move the partial prefix aside manually before retrying. Do not delete unrelated data');
  }
}

async function ownedOfficial(ctx) {
  const paths = officialPaths(ctx);
  await safeDirectory(paths.prefix);
  const record = await stateJson(paths.record);
  const contents = await pathStat(paths.prefix) ? await readdir(paths.prefix) : [];
  if (!contents.length && !record) return null;
  assertRecord(record, paths);
  if (await verifyNpmEntry(paths.entry) !== record.version || await fileDigest(paths.entry) !== record.entryDigest) {
    throw new Error('official dedicated package ownership or version changed');
  }
  if (!await pathStat(paths.kimi)) throw new Error('official dedicated npm shim missing');
  if (await fileDigest(paths.kimi) !== record.shimDigest) throw new Error('official dedicated npm shim changed');
  return paths.kimi;
}

export async function discoverOfficial(ctx) {
  const owned = await ownedOfficial(ctx);
  const candidate = await findOfficialCandidate(ctx, owned, officialEntry);
  if (!candidate) return { kind: 'missing' };
  await assertCandidate(ctx, candidate);
  if (ctx.platform !== 'win32') {
    try { await access(candidate, constants.X_OK); } catch { throw new Error('official PATH command is not executable'); }
  }
  return verifyOfficial(ctx, await runtimeCandidate(candidate, ctx));
}

async function verifyOwnedRuntime(ctx, paths) {
  if (!await ownedOfficial(ctx)) throw new Error('official dedicated prefix is missing; no automatic reinstall');
  const record = await stateJson(paths.record);
  await officialEntry(paths.kimi, ctx);
  if (record.version === OFFICIAL_VERSION) await verifyOfficialShell(ctx, paths.root);
  else await verifyOwnedPty(ctx, paths);
}

async function recordOfficial(paths, stage) {
  const record = { schema: 1, version: OFFICIAL_VERSION, integrity: OFFICIAL_INTEGRITY,
    prefix: paths.prefix, entry: paths.entry, kimi: paths.kimi,
    entryDigest: await fileDigest(paths.entry), shimDigest: await fileDigest(paths.kimi) };
  const temporary = join(stage, 'official-record.json');
  await writeFile(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  await rename(temporary, paths.record);
}

export async function prepareOfficial(ctx, discovery, stage, progress) {
  const paths = officialPaths(ctx);
  if (discovery.kind !== 'missing') {
    const selected = await realpath(discovery.path).catch(() => discovery.path);
    const owned = await realpath(paths.kimi).catch(() => paths.kimi);
    if (equal(selected, owned, ctx.platform)) await verifyOwnedRuntime(ctx, paths);
    ctx.kimi = discovery.path;
    ctx.log(`Official Kimi: reusing ${discovery.version} at ${discovery.path}; no official CLI download or upgrade.`);
    return;
  }
  const current = await discoverOfficial(ctx);
  if (current.kind !== 'missing') throw new Error('official Kimi appeared after discovery; refusing a second installation');
  ctx.log(`Official Kimi: all supported candidates are absent; downloading fixed ${OFFICIAL_VERSION}.`);
  progress.label = 'official Kimi verified download';
  const bytes = await (ctx.downloadOfficial ?? downloadBytes)(OFFICIAL_URL, { env: ctx.env });
  if (createHash('sha512').update(bytes).digest('base64') !== OFFICIAL_INTEGRITY) {
    throw new Error('official Kimi SHA512 integrity mismatch');
  }
  const archive = join(stage, 'official-kimi.tgz');
  await writeFile(archive, bytes, { mode: 0o600 });
  progress.label = 'official Kimi npm installation (may be partial)';
  await mkdir(paths.prefix, { recursive: true });
  await ctx.run(ctx.node, installNpmArgs({ ...ctx, prefix: paths.prefix }, archive), {
    env: isolatedNpmEnv(ctx.env, stage, ctx.node, ctx.platform), cwd: stage, timeoutMs: 300000 });
  progress.label = 'official Kimi runtime verification';
  if (await verifyNpmEntry(paths.entry) !== OFFICIAL_VERSION) throw new Error('official installed package version is not pinned');
  await verifyOfficial(ctx, paths.kimi);
  await verifyOfficialShell(ctx, paths.root);
  await recordOfficial(paths, stage);
  ctx.kimi = paths.kimi;
  ctx.log(`Official Kimi ${OFFICIAL_VERSION} installed in dedicated prefix; existing installations were not modified.`);
}

export function officialCommand(ctx) {
  const invocation = ctx.officialInvocation;
  if (invocation?.args.length) return installerCommand({ ...ctx, entry: invocation.args[0] }, '--version');
  const quote = ctx.platform === 'win32' ? (value) => `'${value.replaceAll("'", "''")}'` : shQuote;
  return `${ctx.platform === 'win32' ? '& ' : ''}${quote(ctx.kimi)} --version`;
}

export async function runIntegrationCommand(ctx, command, args, settings) {
  const invocation = ctx.officialInvocation;
  if (invocation && equal(command, invocation.candidate, ctx.platform)) {
    return ctx.run(invocation.command, [...invocation.args, ...args], { ...settings,
      env: nodePathEnv({ ...ctx.env, ...settings?.env }, ctx.node, ctx.platform) });
  }
  return ctx.run(command, args, settings);
}
