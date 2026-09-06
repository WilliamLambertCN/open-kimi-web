// Shared frontend assembly used by both `serve` (cli.mjs) and the
// integration supervisor: TLS resolution, token link resolution, launcher
// creation and the Local/Network link output.
import { networkInterfaces } from 'node:os';
import { launchLinkLines, launchLinkWarnings } from './launchLinks.mjs';
import { resolveLaunchToken } from './launchToken.mjs';
import { ensureOfficialBundle, officialCacheDir, resolveOfficialVersion } from './officialBundle.mjs';
import { createLauncher } from './serve.mjs';
import { tlsStatusLines } from './tlsMessages.mjs';
import { ensureManagedTls, loadCustomTls } from './tlsStore.mjs';

const TARGET_PROBE_TIMEOUT_MS = 3_000;

async function assertTargetReachable(target, fetchImpl = fetch) {
  const healthUrl = new URL('/api/v1/healthz', target);
  try {
    const response = await fetchImpl(healthUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TARGET_PROBE_TIMEOUT_MS),
    });
    void response.body?.cancel().catch(() => undefined);
  } catch (err) {
    throw new Error(
      `Kimi backend is unreachable at ${target}: ${err.message}. ` +
      'Start the official backend on the configured target (use the real Kimi binary if ' +
      '`kimi` is wrapped), or run `kimi web --host` with integration instead of `pnpm dev`.',
      { cause: err },
    );
  }
}

async function resolveTls(opts, interfaces) {
  if (!opts.https) return null;
  if (opts.certFile) return loadCustomTls(opts);
  return ensureManagedTls({ host: opts.host, interfaces });
}

// Pin the official bundle to --web-version or the target server's
// version, then make sure it is downloaded and title-patched. Keep this mode
// strict: serving another UI would make a successful launch misleading.
async function resolveOfficialPublicDir(opts, token) {
  const log = opts.log ?? console.log;
  const warn = opts.warn ?? console.error;
  const version = opts.webVersion ?? (await resolveOfficialVersion(opts.target, token));
  try {
    const { dir, cached } = await ensureOfficialBundle({
      version,
      cacheDir: officialCacheDir(version, opts.officialCacheRoot),
      downloadImpl: opts.officialDownload,
      log,
      warn,
    });
    log(`web UI: official ${version} (${cached ? 'cached' : 'downloaded'})`);
    return dir;
  } catch (err) {
    throw new Error(
      `official web UI ${version} is unavailable: ${err.message}\n` +
      'Install or enable curl and tar, restore npm network access, then retry.',
      { cause: err },
    );
  }
}

async function resolvePublicDir(opts, token) {
  const log = opts.log ?? console.log;
  if (opts.publicDir) {
    log('web UI: custom directory');
    return opts.publicDir;
  }
  if (opts.webDir) {
    log('web UI: custom directory');
    return opts.webDir;
  }
  return resolveOfficialPublicDir(opts, token);
}

// On Windows the default port can fall inside a Hyper-V/WSL excluded port
// range, making listen() fail with EACCES even though the port is free. When
// the user did not pin --port, walk up one port at a time, then fall back to
// an OS-assigned ephemeral port before giving up.
export const PORT_RETRY_ATTEMPTS = 10;

const RETRYABLE_LISTEN_CODES = new Set(['EACCES', 'EADDRINUSE']);

const triedRange = (opts) =>
  `could not bind ${opts.host} on ports ${opts.port}-${Math.min(opts.port + PORT_RETRY_ATTEMPTS - 1, 65535)}`;

function rangeExhaustedError(opts, err) {
  return new Error(
    `${triedRange(opts)} and no ephemeral port was available ` +
    `(last error: ${err?.code}: ${err?.message}). ` +
    'On Windows the range may be reserved by Hyper-V/WSL; check with ' +
    '"netsh interface ipv4 show excludedportrange protocol=tcp" ' +
    'or pick a free port with --port.',
  );
}

async function createOnEphemeralPort(opts, create, lastError) {
  try {
    const launcher = await create({ ...opts, port: 0 });
    const reason = lastError ? ` (last error: ${lastError.code}: ${lastError.message})` : '';
    (opts.warn ?? console.error)(
      `${triedRange(opts)}${reason}; listening on ephemeral port ${launcher.server.address().port} instead`,
    );
    return launcher;
  } catch (err) {
    throw rangeExhaustedError(opts, err);
  }
}

export async function createLauncherWithRetry(opts, create = createLauncher) {
  if (opts.portExplicit) return create(opts);
  let lastError;
  for (let attempt = 0; attempt < PORT_RETRY_ATTEMPTS; attempt += 1) {
    const port = opts.port + attempt;
    if (port > 65535) break;
    try {
      return await create({ ...opts, port });
    } catch (err) {
      if (!RETRYABLE_LISTEN_CODES.has(err?.code)) throw err;
      lastError = err;
    }
  }
  return createOnEphemeralPort(opts, create, lastError);
}

/**
 * Start the OpenWeb listener and print its access links.
 * opts mirrors the serve CLI options; log/warn are injectable for tests.
 * Returns { launcher, tls, tokenResult, publicDir }.
 */
export async function startFrontend(opts) {
  await assertTargetReachable(opts.target, opts.targetFetch);
  const interfaces = opts.interfaces ?? networkInterfaces();
  const [tls, tokenResult] = await Promise.all([
    resolveTls(opts, interfaces),
    resolveLaunchToken(opts),
  ]);
  const publicDir = await resolvePublicDir(opts, tokenResult.token);
  const launcher = await createLauncherWithRetry({
    target: opts.target,
    publicDir,
    officialPresentation: !opts.publicDir && !opts.webDir,
    host: opts.host,
    port: opts.port,
    portExplicit: opts.portExplicit,
    warn: opts.warn,
    tls,
    interfaces,
  });
  const log = opts.log ?? console.log;
  const warn = opts.warn ?? console.error;
  log(`open-kimi-web ready (target: ${opts.target})`);
  for (const line of launchLinkLines(launcher.accessUrls, tokenResult.token)) log(line);
  for (const warning of launchLinkWarnings(tokenResult, Boolean(opts.insecureHttp))) warn(warning);
  for (const line of tls ? tlsStatusLines(tls) : []) log(line);
  return { launcher, tls, tokenResult, publicDir };
}
