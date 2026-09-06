// `open-kimi-web integrate status`: health report for the takeover — real
// kimi resolution, wrapper files, PATH ordering, recursion, TLS fingerprint.
// Any hard issue makes the command exit non-zero; environment lag (a shell
// that predates the install) is only a note.
import { readFile, stat } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

import { tlsPaths } from '../tlsStore.mjs';
import { makeContext } from './integrate.mjs';
import { pickRcFile, removeRcBlock, windowsPathHasEntry } from './pathInstall.mjs';
import { canonicalPath, isInsideWrapperDir, kimiCandidateNames, resolveRealKimi } from './realKimi.mjs';
import { integrationHome, loadState } from './state.mjs';
import { isOurWrapper } from './wrapperGen.mjs';

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function pathsEqual(a, b) {
  const [ca, cb] = await Promise.all([canonicalPath(a), canonicalPath(b)]);
  return ca === cb;
}

/** Index of the wrapper dir and of the first PATH entry containing a kimi. */
async function pathOrder(ctx) {
  const raw = ctx.env.PATH ?? ctx.env.Path ?? '';
  const entries = raw.split(delimiter).filter((entry) => entry !== '');
  let wrapperIndex = -1;
  let firstKimiIndex = -1;
  for (const [index, dir] of entries.entries()) {
    if (wrapperIndex === -1 && (await pathsEqual(dir, ctx.paths.bin))) wrapperIndex = index;
    if (firstKimiIndex === -1) {
      for (const name of kimiCandidateNames(ctx.platform)) {
        if (await isFile(join(dir, name))) {
          firstKimiIndex = index;
          break;
        }
      }
    }
  }
  return { entries, wrapperIndex, firstKimiIndex };
}

async function checkPathOrder(ctx, report) {
  const { entries, wrapperIndex, firstKimiIndex } = await pathOrder(ctx);
  if (firstKimiIndex === -1) {
    report.notes.push('this shell has no kimi on PATH yet (open a new shell or run `hash -r`)');
    return;
  }
  if (wrapperIndex === -1) {
    report.notes.push('this shell predates the install; open a new shell or run `hash -r`');
    return;
  }
  if (wrapperIndex <= firstKimiIndex) {
    report.lines.push('PATH order: the wrapper shadows the official kimi in this shell');
    return;
  }
  const remedy = ctx.platform === 'win32'
    ? '; if it comes from the Windows System PATH, add the wrapper there first or adjust PATH order'
    : '';
  report.issues.push(`PATH order: ${entries[firstKimiIndex]} shadows the wrapper in this shell${remedy}`);
}

async function checkRealKimi(ctx, state, report) {
  try {
    const real = await resolveRealKimi({
      env: { ...ctx.env, OPEN_KIMI_REAL_KIMI: state.realKimi },
      platform: ctx.platform,
      wrapperDir: ctx.paths.bin,
      run: ctx.run,
    });
    report.lines.push(`real kimi: ${real.path} (${real.version})`);
    if (real.version !== state.realKimiVersion) {
      report.notes.push(
        `official kimi was updated since install (${state.realKimiVersion} → ${real.version}); \`integrate repair\` refreshes the record`,
      );
    }
    if (await isInsideWrapperDir(state.realKimi, ctx.paths.bin)) {
      report.issues.push('recursion: the recorded real kimi points into the wrapper directory');
    }
  } catch (error) {
    report.issues.push(`real kimi: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function checkPathSetup(ctx, report) {
  if (ctx.platform === 'win32') {
    const current = await ctx.readUserPath().catch(() => null);
    if (current === null) {
      report.issues.push('user PATH: could not be read via powershell');
    } else if (windowsPathHasEntry(current, ctx.paths.bin)) {
      report.lines.push('user PATH: wrapper directory registered');
    } else {
      report.issues.push('user PATH: wrapper directory missing');
    }
    return;
  }
  const { file, content } = await pickRcFile(ctx.env.HOME ?? ctx.env.USERPROFILE ?? '');
  if (removeRcBlock(content) !== null) {
    report.lines.push(`shell rc: marker block present in ${file}`);
  } else {
    report.issues.push('shell rc: marker block missing');
  }
}

async function tlsFingerprintLine(home) {
  try {
    const metadata = JSON.parse(await readFile(tlsPaths(home).metadata, 'utf8'));
    if (typeof metadata.fingerprint === 'string') return `TLS certificate fingerprint: ${metadata.fingerprint}`;
  } catch {
    // no managed certificate yet
  }
  return null;
}

async function reportState(ctx, state, report) {
  report.lines.push(`state file: ${ctx.paths.stateFile} (schema v${state.schema})`);
  await checkRealKimi(ctx, state, report);
  for (const name of state.wrapperFiles ?? []) {
    const file = join(ctx.paths.bin, name);
    if (await isOurWrapper(file)) report.lines.push(`wrapper: ${file}`);
    else report.issues.push(`wrapper: ${file} missing or was replaced`);
  }
  await checkPathSetup(ctx, report);
  await checkPathOrder(ctx, report);
}

function printReport(ctx, report) {
  for (const line of report.lines) ctx.log(`ok: ${line}`);
  for (const note of report.notes) ctx.log(`note: ${note}`);
  for (const issue of report.issues) ctx.error(`issue: ${issue}`);
  const healthy = report.issues.length === 0;
  ctx.log(
    healthy
      ? 'integration status: healthy'
      : 'integration status: problems found (try `open-kimi-web integrate repair`)',
  );
  return healthy ? 0 : 1;
}

export async function statusIntegration(options = {}) {
  const ctx = makeContext(options);
  const loaded = await loadState(ctx.paths);
  if (loaded.state === null && loaded.error === undefined) {
    ctx.log('open-kimi-web integration is not installed.');
    return { code: 0 };
  }
  const report = { lines: [], notes: [], issues: [] };
  if (loaded.error !== undefined) report.issues.push(`state file: ${loaded.error}`);
  if (loaded.state !== null) await reportState(ctx, loaded.state, report);
  const tlsLine = await tlsFingerprintLine(integrationHome(ctx.env));
  if (tlsLine !== null) report.lines.push(tlsLine);
  report.notes.push('shells cache command locations; when in doubt open a new shell or run `hash -r`');
  return { code: printReport(ctx, report) };
}
