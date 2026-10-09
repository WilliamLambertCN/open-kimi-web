import { readJson } from './files.mjs';
import { checkedRun } from './process.mjs';
import { parseVersion } from './version.mjs';

export async function currentFacts(installation, log) {
  if (!installation) return;
  try {
    const manifest = await readJson(`${installation.root}/package.json`);
    if (!parseVersion(manifest.version)) throw new Error('unrecognized on-disk version');
    log(`Current on-disk version: ${manifest.version} (not verified as runnable).`);
  } catch {
    log('Current on-disk package manifest/version could not be verified; inspect the identified installation manually.');
  }
  if (installation.kind !== 'source') return;
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
    const head = await checkedRun('git', ['--no-optional-locks', '-C', installation.repo, 'rev-parse', 'HEAD'], {
      cwd: installation.repo, env, timeoutMs: 5_000, maxBytes: 4_096,
    });
    if (!/^[a-f0-9]{40,64}$/.test(head)) throw new Error('unrecognized source HEAD');
    log(`Current source HEAD: ${head}.`);
  } catch {
    log('Current source HEAD could not be read; inspect git status/HEAD manually.');
  }
}
