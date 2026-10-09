import { identifyInstallation } from './installation.mjs';
import { latestRelease } from './githubRelease.mjs';
import { acquireLock, lockPath } from './lock.mjs';
import { npmCommand, updateNpm } from './npmUpdate.mjs';
import { sourcePlan, updateSource } from './sourceUpdate.mjs';
import { compareVersions } from './version.mjs';
import { verifyInstallation } from './verification.mjs';
import { currentFacts } from './currentFacts.mjs';

export const UPDATE_USAGE = `Usage: open-kimi-web update [--check | --help]

Updates only the verified installation executing this command.
--check  Inspect the target and planned command without fetch/install or a lock.
--help   Show this help without loading service dependencies.
Source: clean main tracking official origin/main, fast-forward only.
Npm: exact official GitHub latest release tgz, never another global copy.
No automatic restart, rollback, repair, PATH, certificate or user-data changes.
Exit codes: 0 success/check/current, 1 failure/refusal, 2 invalid arguments.
`;

export function parseUpdateArgs(args) {
  if (args.length === 0) return { check: false };
  if (args.length === 1 && args[0] === '--check') return { check: true };
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true };
  throw new Error('update accepts only --check or --help');
}

function recovery(installation, plan) {
  if (!installation) return 'Use a verified main checkout or reinstall the official GitHub Release tgz manually.';
  if (installation.kind === 'source') {
    return 'Inspect git status/HEAD in the identified checkout; after resolving the failure, run ' +
      'corepack pnpm install --frozen-lockfile there. Do not reset or discard local work.';
  }
  return plan ? `Inspect the identified npm installation, then retry manually: ${npmCommand(installation, plan.url)}` :
    'Inspect the identified npm installation and reinstall the official GitHub Release tgz manually.';
}

function describe(installation, plan, log) {
  log(`Installation: ${installation.kind} ${installation.repo ?? installation.owner ?? installation.prefix}`);
  log(`Current: ${installation.version}`);
  log(`Target: ${plan.sha ?? plan.version}${plan.sha ? ' (main source, not the tgz channel)' : ''}`);
  log(`Command: ${plan.command ?? npmCommand(installation, plan.url)}`);
  if (installation.kind === 'local') log(`Updates owner package.json/package-lock.json; retains ${installation.category}.`);
}

function dependenciesWithDefaults(dependencies) {
  return { log: console.log, error: console.error, identify: identifyInstallation,
    latestRelease, acquireLock, verify: verifyInstallation, ...dependencies };
}

async function performUpdate(options, context, state) {
  const installation = await context.identify();
  state.installation = installation;
  if (!options.check) state.releaseLock = await context.acquireLock(installation);
  context.stage('target lookup');
  const plan = installation.kind === 'source' ? await sourcePlan(installation, context) :
    await context.latestRelease({ signal: context.signal });
  state.plan = plan;
  describe(installation, plan, context.log);
  if (installation.kind !== 'source' && compareVersions(plan.version, installation.version) <= 0) {
    context.log('Already current or newer; no downgrade performed.');
    return;
  }
  if (options.check) return;
  const result = installation.kind === 'source' ? await updateSource(installation, plan, context) :
    await updateNpm(installation, plan, context);
  context.stage('fresh-process verification');
  await context.verify(installation, result, context);
  context.log(`Updated and verified: ${result.version}${result.sha ? ` at ${result.sha}` : ''}`);
  context.log('Stop the old launcher yourself, start it again, then refresh the browser. No running services were restarted.');
}

async function finishLock(state, error) {
  if (state.cleanupUnconfirmed && state.releaseLock) {
    const path = state.releaseLock.path ?? lockPath(state.installation);
    error(`Child-tree cleanup unconfirmed; update lock retained: ${path}`);
    error('Verify the original updater and its descendants have stopped before manually removing this lock.');
    return true;
  }
  try { await state.releaseLock?.(); return true; } catch (failure) {
    error(`Update lock cleanup failed: ${failure.message}; check the owning updater before manual removal.`);
    return false;
  }
}

export async function updateMain(args, dependencies = {}) {
  const deps = dependenciesWithDefaults(dependencies);
  let options;
  try { options = parseUpdateArgs(args); } catch (failure) {
    deps.error(`${failure.message}\n${UPDATE_USAGE}`);
    return 2;
  }
  if (options.help) { deps.log(UPDATE_USAGE); return 0; }
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error('update cancelled'));
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  const state = { stage: 'identification', mayHaveChanged: false };
  const context = { ...deps, signal: controller.signal, stage: (name, changed = false) => {
    state.stage = name;
    state.mayHaveChanged ||= changed;
  } };
  try {
    await performUpdate(options, context, state);
    return 0;
  } catch (failure) {
    state.cleanupUnconfirmed = failure.cleanupUnconfirmed === true;
    deps.error(`Update failed during ${state.stage}: ${failure.message}`);
    deps.error(state.mayHaveChanged ? 'Installation may have partially changed; no automatic rollback was attempted.' :
      'No replacement stage was started.');
    await currentFacts(state.installation, deps.error);
    deps.error(recovery(state.installation, state.plan));
    return 1;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    if (!await finishLock(state, deps.error)) return 1;
  }
}
