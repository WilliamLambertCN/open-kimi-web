// Process-level entry glue: argument errors → exit 2, help → usage text,
// serve → bind + signal handlers. `integrate` and the hidden `__wrap`
// (wrapper handoff) dispatch before strict serve parsing. Excluded from
// coverage (like the web app's main.ts); exercised for real by
// scripts/pack-smoke.mjs and the integration IT suite.
import { readFile } from 'node:fs/promises';

import { parseArgs, USAGE, UsageError } from './args.mjs';
import { startFrontend } from './frontend.mjs';
import { integrateMain } from './integration/integrateMain.mjs';
import { wrapMain } from './integration/wrapMain.mjs';

const SHUTDOWN_TIMEOUT_MS = 3_000;

async function printVersion() {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(pkg.version);
}

async function serve(opts) {
  if (opts.insecureHttp) {
    console.error(
      'WARNING: insecure HTTP exposes bearer tokens and all traffic in plaintext ' +
        'to devices that can observe this network.',
    );
  }
  const { launcher } = await startFrontend(opts);
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) {
      process.exit(1);
      return;
    }
    shuttingDown = true;
    const timer = setTimeout(() => {
      console.error('launcher shutdown timed out; forcing process exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    Promise.resolve()
      .then(() => launcher.close())
      .then(
        () => process.exit(0),
        (error) => {
          console.error(`launcher shutdown failed: ${error.message}`);
          process.exit(1);
        },
      )
      .finally(() => clearTimeout(timer));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export async function run(argv) {
  const args = argv.slice(2);
  if (args[0] === '__wrap') {
    process.exitCode = await wrapMain(args.slice(1));
    return;
  }
  if (args[0] === '--version' || args[0] === '-v') {
    await printVersion();
    return;
  }
  if (args[0] === 'integrate') {
    process.exitCode = await integrateMain(args.slice(1));
    return;
  }
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`error: ${err.message}\n\n${USAGE}`);
      process.exitCode = 2;
      return;
    }
    throw err;
  }
  if (opts.command === 'help') {
    console.log(USAGE);
    return;
  }
  await serve(opts);
}
