import { createHash } from 'node:crypto';
import { chmod, cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installRelease, runInstallProcess } from '../../scripts/install.mjs';

export async function nativeCoordinatorFixture(shell = 'bash') {
  if (process.platform === 'win32') throw new Error('native POSIX fixture requires a POSIX runtime');
  const directory = await mkdtemp(join(tmpdir(), "okw native quote' fixture-"));
  const home = join(directory, 'home');
  await mkdir(home);
  const kimi = join(home, 'fakeKimi');
  await writeFile(kimi, '#!/bin/sh\nif [ "$1" = web ]; then echo "kimi web --host --port"; ' +
    'else node -e "console.log(\'kimi, version 2.1.1\')"; fi\n');
  await chmod(kimi, 0o755);
  await writeFile(join(home, '.bashrc'), 'export FIXTURE_SENTINEL=preserved\n');
  const base = { ...process.env, HOME: home, USERPROFILE: home, SHELL: shell.startsWith('/') ? shell : `/bin/${shell}`,
    OPEN_KIMI_WEB_HOME: join(home, '.open-kimi-web'), OPEN_KIMI_REAL_KIMI: kimi,
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin` };
  try {
    const runtime = join(base.OPEN_KIMI_WEB_HOME, 'runtime/node/bin/node');
    await mkdir(dirname(runtime), { recursive: true });
    await cp(process.execPath, runtime);
    await cp(join(dirname(process.execPath), '../lib'), join(dirname(runtime), '../lib'), { recursive: true });
    const source = new URL('./installNativeFixture.mjs', import.meta.url).pathname;
    const output = await runInstallProcess(runtime, [source, '--child', JSON.stringify(base)], { env: base, timeoutMs: 300_000 });
    return JSON.parse(output.split('\n').at(-1));
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function child(env) {
  const dependencies = { env, log: () => {} };
  const options = { integrate: true, switchInstallation: true };
  const result = await installRelease(options, dependencies);
  const clean = { ...env, PATH: '/usr/bin:/bin' };
  const command = 'command -v node; open-kimi-web --version; kimi --version';
  const output = await runInstallProcess(env.SHELL, ['-ic', command], { env: clean });
  if (!output.includes(process.execPath) || !output.includes(result.version) || !output.includes('kimi, version 2.1.1')) {
    throw new Error('new shell did not resolve private Node and real installed wrapper');
  }
  await installRelease(options, dependencies);
  const state = JSON.parse(await readFile(join(env.OPEN_KIMI_WEB_HOME, 'integration.json'), 'utf8'));
  const wrapper = await readFile(join(env.OPEN_KIMI_WEB_HOME, 'bin/kimi'), 'utf8');
  const modulePath = join(result.prefix, 'lib/node_modules/open-kimi-web/src/update/installation.mjs');
  const module = await import(pathToFileURL(modulePath).href);
  const identity = await module.identifyInstallation({ entryPath: result.entry, env: {} });
  const integratePath = join(result.prefix, 'lib/node_modules/open-kimi-web/src/integration/integrate.mjs');
  const integration = await import(pathToFileURL(integratePath).href);
  await integration.uninstallIntegration({ env, log: () => {} });
  const rc = await readFile(state.pathInstall.file, 'utf8');
  if (rc.includes('# >>> open-kimi-web >>>')) throw new Error('uninstall did not remove owned PATH block');
  console.log(JSON.stringify({ version: result.version, identity: identity.kind,
    shellVerified: true, repeatedInstall: true, runtimeRecorded: state.bootstrapRuntimeDirectory === dirname(process.execPath),
    uninstallVerified: true, wrapperDigest: createHash('sha256').update(wrapper).digest('hex') }));
}

if (process.argv[2] === '--child') await child(JSON.parse(process.argv[3]));
