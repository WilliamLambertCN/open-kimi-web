function signalGroup(pid, signal, kill) {
  try { kill(-pid, signal); return true; } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

export async function stopInstallerGroup(pid, options = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('installer process group identity is unavailable');
  const kill = options.kill ?? process.kill;
  const wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  if (!signalGroup(pid, 'SIGKILL', kill)) return;
  for (let elapsed = 0; elapsed < 3_000; elapsed += 50) {
    if (!signalGroup(pid, 0, kill)) return;
    await wait(50);
  }
  if (signalGroup(pid, 0, kill)) throw new Error('installer process group exit could not be confirmed');
}
