const LAUNCHER_DEPENDENCIES = ['ws', 'selfsigned'];

export async function missingLauncherDependencies(load = (name) => import(name)) {
  const missing = [];
  for (const name of LAUNCHER_DEPENDENCIES) {
    try {
      await load(name);
    } catch (error) {
      if (error?.code !== 'ERR_MODULE_NOT_FOUND' && error?.code !== 'MODULE_NOT_FOUND') throw error;
      missing.push(name);
    }
  }
  return missing;
}

export function launcherDependencyMessage(missing) {
  return (
    `launcher dependencies are missing: ${missing.join(', ')}. ` +
    'From a source checkout, restore registry access and run ' +
    '`corepack pnpm install --frozen-lockfile`; for an installed package, reinstall ' +
    '`open-kimi-web` with its dependencies. Then retry.'
  );
}
