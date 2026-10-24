// Supervisor for the intercepted `kimi web`: spawn the official server on
// its fixed loopback port, discover and verify it via the registry,
// then front it with the OpenWeb launcher. One process exits → the other is
// shut down; SIGINT/SIGTERM tries the authenticated shutdown endpoint first.
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';

import { isLoopbackHost, withTokenFragment } from '../accessUrls.mjs';
import { assertOfficialWebUi } from '../args.mjs';
import { assertCronBackend } from '../cron/guard.mjs';
import { startFrontend } from '../frontend.mjs';
import { defaultTokenFile, resolveLaunchToken } from '../launchToken.mjs';
import { openUrl } from './browserOpen.mjs';
import { isWindowsCmdScript, resolveSpawnTarget, runCapture } from './proc.mjs';
import {
  awaitNewInstance,
  instancesDir,
  snapshotInstanceIds,
  verifyInstance,
} from './registryDiscovery.mjs';
import { IntegrateError } from './state.mjs';

const SHUTDOWN_TIMEOUT_MS = 3_000;
const KILL_GRACE_MS = 2_000;
const FORCE_KILL_WAIT_MS = 500;
const TOKEN_WAIT_MS = 5_000;
const TOKEN_POLL_MS = 250;
export const MANAGED_BACKEND_DEFAULT_PORT = 58_627;
export const MANAGED_FRONTEND_DEFAULT_PORT = 48_627;

export const managedBackendWebArgs = [
  'web', '--no-open', '--host', '127.0.0.1',
  '--port', String(MANAGED_BACKEND_DEFAULT_PORT),
];

function backendWebArgs(web) {
  return web.scheduledTasks === true ? [...managedBackendWebArgs, '--debug-endpoints'] : managedBackendWebArgs;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readBackendToken(env, readFile) {
  const result = await resolveLaunchToken(
    { target: 'http://127.0.0.1:1', noTokenLink: false, tokenFile: null, env },
    readFile,
  );
  return result.token;
}

async function awaitBackendToken(env, deps) {
  const deadline = Date.now() + TOKEN_WAIT_MS;
  for (;;) {
    const token = await readBackendToken(env, deps.readFile);
    if (token !== null) return token;
    if (Date.now() >= deadline) {
      throw new IntegrateError('could not read the kimi server token (server.token)');
    }
    await (deps.sleep ?? sleep)(TOKEN_POLL_MS);
  }
}

async function exitedWithin(exited, timeoutMs) {
  return Promise.race([
    exited.then(() => true, () => true),
    sleep(timeoutMs).then(() => false),
  ]);
}

async function killWindowsTree(child, exited, ctx) {
  const run = ctx.killTree ?? ((pid) => runCapture('taskkill', ['/pid', String(pid), '/T', '/F']));
  const pid = ctx.backendPid ?? child.pid;
  const result = await run(pid).catch((error) => ({ code: 1, stderr: error.message }));
  if (result?.code !== 0) ctx.warn(`could not terminate backend process tree ${pid}: ${result.stderr}`);
  if (!(await exitedWithin(exited, FORCE_KILL_WAIT_MS))) {
    ctx.warn(`backend process tree ${pid} may still be running`);
  }
}

export async function killBackend(child, exited, ctx = {}) {
  const warn = ctx.warn ?? console.error;
  const killCtx = { ...ctx, warn };
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (ctx.treeKill) {
    await killWindowsTree(child, exited, killCtx);
    return;
  }
  child.kill('SIGTERM');
  if (await exitedWithin(exited, KILL_GRACE_MS)) return;
  child.kill('SIGKILL');
  if (!(await exitedWithin(exited, FORCE_KILL_WAIT_MS))) {
    warn(`backend process ${child.pid} did not exit after SIGKILL and may still be running`);
  }
}

async function requestShutdown(ctx) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SHUTDOWN_TIMEOUT_MS);
  try {
    await ctx.fetchImpl(`http://127.0.0.1:${ctx.port}/api/v1/shutdown`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.token}` },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Wait for backend exit, a termination signal or an unsafe-backend abort.
 *  Listeners are always removed before resolving. */
export function waitForStop(exited, signal) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
      signal?.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onSigint = () => done({ kind: 'signal' });
    const onSigterm = () => done({ kind: 'signal' });
    const onAbort = () => done({ kind: 'unsafe-backend' });
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    exited.then((result) => done({ kind: 'exit', result }), () => done({ kind: 'exit', result: { code: 1 } }));
  });
}

async function supervise(child, exited, launcher, ctx) {
  const stop = await (ctx.waitStop ?? waitForStop)(exited, ctx.stopSignal);
  if (stop.kind === 'exit' && !ctx.stopSignal?.aborted) {
    await closeLauncher(launcher, ctx);
    return stop.result.code ?? 1;
  }
  await requestShutdown(ctx).catch(() => undefined);
  await exitedWithin(exited, SHUTDOWN_TIMEOUT_MS);
  await killBackend(child, exited, ctx);
  await closeLauncher(launcher, ctx);
  if (ctx.stopSignal?.aborted || stop.kind === 'unsafe-backend') {
    ctx.warn('scheduled-task backend became unsafe; shutting down the managed backend');
    return 1;
  }
  return 0;
}

async function closeLauncher(launcher, ctx) {
  const closed = Promise.resolve().then(() => launcher.close()).then(() => true, () => true);
  if (await Promise.race([closed, sleep(SHUTDOWN_TIMEOUT_MS).then(() => false)])) return;
  (ctx.warn ?? console.error)('launcher shutdown timed out; forcing process exit');
  (ctx.forceExit ?? process.exit)(1);
}

function assertWebUiCompatibility(web, env) {
  const legacyWebUi = web.webUi ?? env.OPEN_KIMI_WEB_UI;
  if (legacyWebUi !== undefined) assertOfficialWebUi(legacyWebUi, 'OPEN_KIMI_WEB_UI');
}

export function assertScheduledTasksOptions(web, env, publicDir) {
  if (web.scheduledTasks !== true) return;
  if ([web.webDir, env.OPEN_KIMI_WEB_DIR, publicDir].some(Boolean)) {
    throw new IntegrateError('--scheduled-tasks requires the enhanced official web UI; custom web directories are not supported');
  }
  const overrides = new Set([
    'NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH',
    'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', 'DYLD_FRAMEWORK_PATH',
    'KIMI_CODE_ALLOWED_HOSTS', 'KIMI_CODE_CORS_ORIGINS',
  ]);
  for (const [key, value] of Object.entries(env)) {
    const name = key.toUpperCase();
    if ((name === 'KIMI_CODE_DISABLE_HOST_CHECK' && value === '1') || (overrides.has(name) && value?.length > 0)) {
      throw new IntegrateError(`--scheduled-tasks is incompatible with ${name}; remove the environment override first`);
    }
  }
}

export function frontendOptions(web, instancePort, env) {
  const host = web.hostBare ? '0.0.0.0' : web.host ?? '127.0.0.1';
  assertWebUiCompatibility(web, env);
  return {
    target: `http://127.0.0.1:${instancePort}`,
    host,
    // Keep the official backend on 58627 and expose the enhanced UI on the
    // memorable companion port 48627.
    port: web.port ?? MANAGED_FRONTEND_DEFAULT_PORT,
    portExplicit: true,
    https: !isLoopbackHost(host),
    certFile: null,
    keyFile: null,
    insecureHttp: false,
    noTokenLink: false,
    tokenFile: null,
    webDir: web.webDir ?? env.OPEN_KIMI_WEB_DIR ?? null,
    webVersion: web.webVersion ?? env.OPEN_KIMI_WEB_VERSION ?? null,
    scheduledTasks: web.scheduledTasks === true,
  };
}

function unsafeBackendStop(web) {
  if (web.scheduledTasks !== true) return {};
  const controller = new AbortController();
  return {
    signal: controller.signal,
    onUnsafeBackend: () => {
      if (!controller.signal.aborted) controller.abort('unsafe-backend');
    },
  };
}

function managedTreeKill(realKimi, web, platform = process.platform) {
  if (web.scheduledTasks === true && platform === 'win32') return true;
  return isWindowsCmdScript(realKimi, platform);
}

async function openFrontend(frontend, web, stopSignal, deps, warn) {
  if (web.noOpen || stopSignal?.aborted) return;
  const first = frontend.launcher.accessUrls[0].url;
  const url = frontend.token === null ? first : withTokenFragment(first, frontend.token);
  await (deps.openUrl ?? openUrl)(url, { warn });
}

/**
 * Run the supervised `kimi web` replacement. Returns the process exit code.
 * options: { realKimi, web, env, deps: { spawn, fetch, openUrl, readFile,
 *           log, warn, publicDir, interfaces, io, sleep, platform } }
 */
export async function superviseWeb(options) {
  const env = options.env ?? process.env;
  assertWebUiCompatibility(options.web, env);
  const deps = options.deps ?? {};
  assertScheduledTasksOptions(options.web, env, deps.publicDir);
  const log = deps.log ?? console.log;
  const warn = deps.warn ?? console.error;
  const dir = instancesDir(env);
  const previousIds = await snapshotInstanceIds(dir, deps.io);
  const sinceMs = Date.now();
  const spawnImpl = deps.spawn ?? spawn;
  // An npm-installed real kimi is a .cmd shim on Windows, which cannot be
  // spawned directly — route through cmd.exe exactly like the wrappers do.
  const target = resolveSpawnTarget(
    options.realKimi,
    backendWebArgs(options.web),
    deps.platform,
  );
  const child = spawnImpl(target.cmd, target.args, {
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsVerbatimArguments: target.verbatim,
  });
  const exited = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });

  const stop = unsafeBackendStop(options.web);
  const frontend = await startBackendAndFrontend({
    child, exited, env, dir, previousIds, sinceMs, realKimi: options.realKimi,
    web: options.web, deps, log, warn, onUnsafeBackend: stop.onUnsafeBackend,
  });
  await openFrontend(frontend, options.web, stop.signal, deps, warn);
  return supervise(child, exited, frontend.launcher, {
    port: frontend.instancePort,
    token: frontend.backendToken,
    fetchImpl: deps.fetch ?? fetch,
    waitStop: deps.waitStop,
    stopSignal: stop.signal,
    treeKill: managedTreeKill(options.realKimi, options.web, deps.platform),
    killTree: deps.killTree,
    warn,
    forceExit: deps.forceExit,
    backendPid: child.pid,
  });
}

async function startBackendAndFrontend(ctx) {
  const { exited, env, deps, log, warn } = ctx;
  const earlyExit = exited.then((result) => {
    throw new IntegrateError(
      `kimi web exited during startup (code ${result.code ?? 'signal ' + result.signal})`,
    );
  });
  // The race below may settle first; without this the late rejection from a
  // normal backend exit would surface as an unhandled rejection.
  earlyExit.catch(() => undefined);
  let instance;
  try {
    instance = await Promise.race([
      awaitNewInstance({
        dir: ctx.dir,
        sinceMs: ctx.sinceMs,
        previousIds: ctx.previousIds,
        io: deps.io,
        sleep: deps.sleep,
      }),
      earlyExit,
    ]);
    ctx.backendPid = instance.pid;
    const token = await Promise.race([awaitBackendToken(env, deps), earlyExit]);
    await verifyInstance({
      port: instance.port,
      pid: instance.pid,
      token,
      fetchImpl: deps.fetch,
    });
    ctx.token = token;
    if (ctx.web.scheduledTasks === true) {
      await (deps.assertCronBackend ?? assertCronBackend)({
        target: `http://127.0.0.1:${instance.port}`,
        authorization: `Bearer ${token}`,
        fetchImpl: deps.fetch ?? fetch,
      });
    }
  } catch (error) {
    await stopFailedStartup(ctx, instance);
    throw error;
  }
  log(`kimi web backend ready on 127.0.0.1:${instance.port}`);
  try {
    const frontend = await startFrontend({
      ...frontendOptions(ctx.web, instance.port, env),
      env,
      usageHome: dirname(defaultTokenFile(env)),
      onUnsafeBackend: ctx.onUnsafeBackend,
      log,
      warn,
      publicDir: deps.publicDir,
      interfaces: deps.interfaces,
    });
    return {
      launcher: frontend.launcher,
      token: frontend.tokenResult.token,
      backendToken: ctx.token,
      backendPid: instance.pid,
      instancePort: instance.port,
    };
  } catch (error) {
    await stopFailedStartup(ctx, instance);
    throw error;
  }
}

async function stopFailedStartup(ctx, instance) {
  if (ctx.token && instance) {
    await requestShutdown({ port: instance.port, token: ctx.token, fetchImpl: ctx.deps.fetch ?? fetch })
      .catch(() => undefined);
    await exitedWithin(ctx.exited, SHUTDOWN_TIMEOUT_MS);
  }
  await killBackend(ctx.child, ctx.exited, {
    treeKill: (ctx.deps.platform ?? process.platform) === 'win32',
    killTree: ctx.deps.killTree,
    backendPid: ctx.child.pid,
    warn: ctx.warn,
  });
}
