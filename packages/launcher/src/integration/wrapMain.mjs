// Hidden `__wrap` entry: the generated wrapper execs `node <entry> __wrap
// <original argv>` with OPEN_KIMI_REAL_KIMI pointing at the real binary.
// Route: supervise understood `web` invocations, delegate everything else
// with stdio/cwd/env/exit-code fidelity.
import { spawnMirror } from './proc.mjs';
import { superviseWeb } from './supervisor.mjs';
import { routeWrapArgv } from './wrapRoute.mjs';

function missingRealKimi(error) {
  error(
    'open-kimi-web: the wrapper does not know the real kimi; run `open-kimi-web integrate repair`',
  );
  return 1;
}

async function delegate(argv, env, deps, error) {
  const realKimi = env.OPEN_KIMI_REAL_KIMI;
  if (realKimi === undefined || realKimi === '') return missingRealKimi(error);
  const { exited } = (deps.spawnMirror ?? spawnMirror)(realKimi, argv, { env });
  const { code } = await exited;
  return code ?? 1;
}

/** Returns the exit code the wrapper process should use. */
export async function wrapMain(argv, deps = {}) {
  const env = deps.env ?? process.env;
  const error = deps.error ?? ((line) => console.error(line));
  const route = routeWrapArgv(argv);
  if (route.action === 'supervise') {
    const realKimi = env.OPEN_KIMI_REAL_KIMI;
    if (realKimi === undefined || realKimi === '') return missingRealKimi(error);
    return superviseWeb({ realKimi, web: route.options, env, deps });
  }
  if (route.reason !== null) error(`open-kimi-web: ${route.reason}`);
  return delegate(argv, env, deps, error);
}
