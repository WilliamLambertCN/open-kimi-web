import { stopWindowsTree } from './windowsTreeCleanup.mjs';

export function unconfirmedCleanup(message) {
  return Object.assign(new Error(message), { code: 'UPDATE_CLEANUP_UNCONFIRMED', cleanupUnconfirmed: true });
}

function groupSignal(pid, signal, kill) {
  try { kill(-pid, signal); return true; } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function stopGroup(pid, options) {
  const kill = options.kill ?? process.kill;
  const wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  if (!groupSignal(pid, 'SIGTERM', kill)) return;
  for (let elapsed = 0; elapsed < 1_000; elapsed += 50) {
    await wait(50);
    if (!groupSignal(pid, 0, kill)) return;
  }
  groupSignal(pid, 'SIGKILL', kill);
}

export async function terminateTree(child, options = {}) {
  if (!child.pid) return;
  try {
    if ((options.platform ?? process.platform) === 'win32') await stopWindowsTree(child, options);
    else await stopGroup(child.pid, options);
  } catch (error) {
    throw unconfirmedCleanup(error.message);
  }
}
