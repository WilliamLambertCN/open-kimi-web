import { samePath } from './files.mjs';
import { identifyInstallation, sameInstallationTarget } from './installation.mjs';
import { checkedRun } from './process.mjs';

const PROBE = `
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const entry = await realpath(process.argv[1]);
const manifest = JSON.parse(await readFile(process.argv[2], 'utf8'));
if (manifest.name !== 'open-kimi-web' || manifest.bin?.['open-kimi-web'] !== 'bin/open-kimi-web.mjs') {
  throw new Error('updated launcher identity mismatch');
}
const require = createRequire(pathToFileURL(entry));
for (const name of Object.keys(manifest.dependencies ?? {})) await import(pathToFileURL(require.resolve(name)));
console.log(JSON.stringify({ entry, version: manifest.version }));
`;

function assertFreshIdentity(fresh, installation, result) {
  if (!sameInstallationTarget(fresh, installation) || fresh.version !== result.version) {
    throw new Error('updated install identity mismatch');
  }
}

export async function verifyInstallation(installation, result, context = {}) {
  const run = context.run ?? checkedRun;
  const options = { cwd: installation.root, signal: context.signal, timeoutMs: 30_000 };
  const version = await run(process.execPath, [installation.entry, '--version'], options);
  if (version !== result.version) throw new Error('fresh launcher --version does not match the update target');
  const text = await run(process.execPath, ['--input-type=module', '-e', PROBE,
    installation.entry, `${installation.root}/package.json`], options);
  const probe = JSON.parse(text);
  if (probe.version !== result.version || !samePath(probe.entry, installation.entry)) {
    throw new Error('fresh launcher dependency probe identity/version mismatch');
  }
  const fresh = await (context.reidentify ?? identifyInstallation)({
    modulePath: `${installation.root}/src/update/installation.mjs`, entryPath: installation.entry,
  });
  assertFreshIdentity(fresh, installation, result);
  if (result.sha && await result.git(['rev-parse', 'HEAD']) !== result.sha) {
    throw new Error('updated source HEAD no longer matches the frozen commit');
  }
}
