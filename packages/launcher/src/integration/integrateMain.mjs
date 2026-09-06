// CLI surface for `open-kimi-web integrate …`. Subcommand parsing lives
// here; the work lives in integrate.mjs / status.mjs.
import { installIntegration, repairIntegration, uninstallIntegration } from './integrate.mjs';
import { statusIntegration } from './status.mjs';
import { IntegrateError } from './state.mjs';

export const INTEGRATE_USAGE = `Usage: open-kimi-web integrate <command>

Manage the reversible PATH wrapper that lets plain \`kimi web\` open the
OpenWeb UI while delegating every other kimi invocation to the official
binary.

Commands:
  install    Resolve the real kimi, install the wrapper, update PATH
  status     Check wrapper, PATH order, real kimi and state health
  repair     Re-resolve the real kimi and rebuild the wrapper/PATH entry
  uninstall  Remove the wrapper, the PATH entry and the state file
             (the official Kimi install and your data are never touched)
`;

const SUBCOMMANDS = ['install', 'status', 'repair', 'uninstall'];

async function installThenStatus(options) {
  const result = await installIntegration(options);
  if (!result.changed) return result.code;
  const status = await statusIntegration(options);
  return status.code === 0 ? result.code : status.code;
}

async function dispatch(sub, options) {
  if (sub === 'install') return installThenStatus(options);
  if (sub === 'status') return (await statusIntegration(options)).code;
  if (sub === 'repair') return (await repairIntegration(options)).code;
  return (await uninstallIntegration(options)).code;
}

function invalidInvocation(argv, sub, rest) {
  return sub === undefined || argv.includes('--help') || argv.includes('-h')
    ? 'help'
    : rest.length > 0 || !SUBCOMMANDS.includes(sub)
      ? 'invalid'
      : null;
}

export async function integrateMain(argv, options = {}) {
  const log = options.log ?? console.log;
  const error = options.error ?? console.error;
  const [sub, ...rest] = argv;
  const verdict = invalidInvocation(argv, sub, rest);
  if (verdict === 'help') {
    log(INTEGRATE_USAGE);
    return 0;
  }
  if (verdict === 'invalid') {
    error(`open-kimi-web integrate: unknown arguments: ${argv.join(' ')}\n\n${INTEGRATE_USAGE}`);
    return 2;
  }
  try {
    return await dispatch(sub, options);
  } catch (err) {
    if (err instanceof IntegrateError) {
      error(`open-kimi-web integrate ${sub}: ${err.message}`);
      return 1;
    }
    throw err;
  }
}
