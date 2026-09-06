// CLI argument parsing for `open-kimi-web serve`. Validation rules are the
// security boundary: the target must be a plain http(s) URL with no embedded
// credentials, and the listener defaults to loopback only.
import { isLoopbackHost } from './accessUrls.mjs';
import { isBundleVersion } from './officialBundle.mjs';

export class UsageError extends Error {}

export const DEFAULTS = Object.freeze({
  target: 'http://127.0.0.1:58627',
  host: '127.0.0.1',
  port: 4173,
  portExplicit: false,
  https: false,
  insecureHttp: false,
  certFile: null,
  keyFile: null,
  tokenFile: null,
  noTokenLink: false,
  webDir: null,
  webVersion: null,
});

export const USAGE = `Usage: open-kimi-web serve [--target <url>] [--host <host> | --lan] [--port <port>]
                           [--https | --insecure-http] [--cert-file <path> --key-file <path>]
                           [--token-file <path> | --no-token-link]
       open-kimi-web integrate <install|status|repair|uninstall>
       open-kimi-web --version

Serves the OpenWeb UI and proxies /api (REST + WebSocket) to a running
\`kimi web\` server, same origin. \`integrate\` manages a reversible PATH
wrapper so plain \`kimi web\` opens OpenWeb instead (every other kimi
invocation is delegated to the official binary).

Options:
  --target         Kimi web server URL (default: ${DEFAULTS.target})
  --host           Listen host (default: ${DEFAULTS.host})
  --lan            Listen on all IPv4 interfaces
  --port           Listen port (default: ${DEFAULTS.port})
  --https          Force HTTPS, including on loopback
  --insecure-http  Allow plain HTTP beyond loopback
  --cert-file      Custom TLS certificate PEM (requires --key-file)
  --key-file       Custom TLS private key PEM (requires --cert-file)
  --token-file     Read a launch-link token from a specific file
  --no-token-link  Do not read or print authenticated launch links
  --web-ui         Deprecated compatibility flag; "official" is a no-op and
                   "open" reports migration guidance because that UI was removed
  --web-dir        Serve this web build directory as-is (highest priority)
  --web-version    Official bundle version (default: asked from the target's
                   /api/v1/meta, falling back to a pinned version)
`;

function validateTarget(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new UsageError(`--target is not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UsageError('--target must use http:// or https://');
  }
  if (url.username !== '' || url.password !== '') {
    throw new UsageError('--target must not embed credentials');
  }
  // The proxy only forwards /api/* to the server root; a target carrying its
  // own path/query/fragment would have those parts silently dropped.
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new UsageError('--target must be the server root (no path, query, or fragment)');
  }
  return raw.replace(/\/+$/, '');
}

function validatePort(raw) {
  if (!/^\d+$/.test(raw)) throw new UsageError(`--port must be an integer: ${raw}`);
  const port = Number(raw);
  if (port < 1 || port > 65535) throw new UsageError(`--port out of range: ${raw}`);
  return port;
}

export function assertOfficialWebUi(raw, source = '--web-ui') {
  if (raw === 'official') return;
  if (raw === 'open') {
    throw new UsageError(
      `${source}=open is no longer supported because the built-in OpenWeb UI was removed. ` +
      'Remove this setting to use the enhanced official UI, or use --web-dir/OPEN_KIMI_WEB_DIR ' +
      'to serve an explicitly supplied build.',
    );
  }
  throw new UsageError(
    `${source} no longer selects a UI; remove it to use the enhanced official UI: ${raw}`,
  );
}

function validateWebVersion(raw) {
  if (!isBundleVersion(raw)) {
    throw new UsageError(`--web-version must be a version string like 0.41.0: ${raw}`);
  }
  return raw;
}

function nonEmpty(flag, raw) {
  if (raw === '') throw new UsageError(`${flag} must not be empty`);
  return raw;
}

const FLAG_HANDLERS = {
  '--target': ['target', validateTarget],
  '--host': ['host', (raw) => nonEmpty('--host', raw)],
  '--port': ['port', validatePort],
  '--cert-file': ['certFile', (raw) => nonEmpty('--cert-file', raw)],
  '--key-file': ['keyFile', (raw) => nonEmpty('--key-file', raw)],
  '--token-file': ['tokenFile', (raw) => nonEmpty('--token-file', raw)],
  '--web-dir': ['webDir', (raw) => nonEmpty('--web-dir', raw)],
  '--web-version': ['webVersion', validateWebVersion],
};

function assertFlagConflicts(args) {
  if (args.includes('--lan') && args.includes('--host')) {
    throw new UsageError('--lan cannot be combined with --host');
  }
  if (args.includes('--https') && args.includes('--insecure-http')) {
    throw new UsageError('--https cannot be combined with --insecure-http');
  }
  if (args.includes('--token-file') && args.includes('--no-token-link')) {
    throw new UsageError('--token-file cannot be combined with --no-token-link');
  }
}

function finalizeTls(opts) {
  if (Boolean(opts.certFile) !== Boolean(opts.keyFile)) {
    throw new UsageError('--cert-file and --key-file must be provided together');
  }
  if (opts.insecureHttp && opts.certFile) {
    throw new UsageError('--insecure-http cannot be combined with certificate files');
  }
  opts.https = Boolean(opts.https || opts.certFile || (!isLoopbackHost(opts.host) && !opts.insecureHttp));
  return opts;
}

const BOOLEAN_HANDLERS = {
  '--lan': (opts) => {
    opts.host = '0.0.0.0';
  },
  '--https': (opts) => {
    opts.https = true;
  },
  '--insecure-http': (opts) => {
    opts.insecureHttp = true;
  },
  '--no-token-link': (opts) => {
    opts.noTokenLink = true;
  },
};

function applyOption(args, index, opts) {
  const flag = args[index];
  const booleanHandler = BOOLEAN_HANDLERS[flag];
  if (booleanHandler) {
    booleanHandler(opts);
    return index;
  }
  const entry = FLAG_HANDLERS[flag];
  if (flag === '--web-ui') {
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new UsageError('missing value for --web-ui');
    }
    assertOfficialWebUi(value);
    return index + 1;
  }
  if (!entry) throw new UsageError(`unknown argument: ${flag}`);
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new UsageError(`missing value for ${flag}`);
  }
  const [key, handler] = entry;
  opts[key] = handler(value);
  return index + 1;
}

// OPEN_KIMI_WEB_UI is read only to reject the removed open mode with useful
// migration guidance. OPEN_KIMI_WEB_DIR remains a supported default.
function applyWebEnvDefaults(args, opts, env) {
  if (env.OPEN_KIMI_WEB_UI !== undefined) {
    assertOfficialWebUi(env.OPEN_KIMI_WEB_UI, 'OPEN_KIMI_WEB_UI');
  }
  const envDir = env.OPEN_KIMI_WEB_DIR;
  if (!args.includes('--web-dir') && typeof envDir === 'string' && envDir !== '') {
    opts.webDir = envDir;
  }
}

function normalizeArgs(argv) {
  const rawArgs = argv.slice(2);
  // pnpm may preserve its pass-through separator in scripts whose command
  // already supplies `serve` (`pnpm dev -- --lan` -> `serve -- --lan`).
  // Consume only that one leading serve separator; a later `--` remains an
  // unsupported CLI argument rather than silently changing option semantics.
  return rawArgs[0] === 'serve' && rawArgs[1] === '--'
    ? [rawArgs[0], ...rawArgs.slice(2)]
    : rawArgs;
}

function isHelpRequest(args) {
  if (args.length === 0) return true;
  if (args[0] === '--help' || args[0] === '-h') return true;
  return args.length === 2 && args[0] === 'serve' && (args[1] === '--help' || args[1] === '-h');
}

export function parseArgs(argv, env = process.env) {
  const args = normalizeArgs(argv);
  if (isHelpRequest(args)) return { command: 'help' };
  if (args[0] !== 'serve') throw new UsageError(`unknown command: ${args[0]}`);
  assertFlagConflicts(args);
  const opts = { command: 'serve', ...DEFAULTS };
  for (let i = 1; i < args.length; i += 1) i = applyOption(args, i, opts);
  if (args.includes('--port')) opts.portExplicit = true;
  applyWebEnvDefaults(args, opts, env);
  return finalizeTls(opts);
}
