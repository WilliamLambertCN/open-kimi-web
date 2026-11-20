import { requestJson } from '../cron/transport.mjs';
import { RestartError } from './http.mjs';

async function waitForExit(backend) {
  try { return await backend.waitForExit(); } catch { return false; }
}

export async function conditionalShutdown(state, authorization) {
  let outcome;
  try {
    const data = await requestJson(state.fetchImpl,
      new URL('/api/v1/shutdown?if_idle=true', state.target), authorization, {});
    if (typeof data?.ok === 'boolean') outcome = data.ok;
  } catch { outcome = undefined; }
  if (outcome === false) throw new RestartError('service-busy');
  const exited = await waitForExit(state.backend);
  if (!exited) throw new RestartError(outcome === true ? 'restart-exit-unconfirmed' : 'restart-outcome-unknown', 503);
  if (outcome === true) return;
  try {
    await requestJson(state.fetchImpl, new URL('/api/v1/meta', state.target), authorization);
  } catch { return; }
  throw new RestartError('restart-outcome-unknown', 503);
}
