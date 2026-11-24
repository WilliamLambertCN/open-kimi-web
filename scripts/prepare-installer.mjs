import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkedRun } from '../packages/launcher/src/update/process.mjs';
import { parseVersion } from '../packages/launcher/src/update/version.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const update = 'packages/launcher/src/update/';
const files = ['LICENSE', 'scripts/install.sh', 'scripts/install.ps1', 'scripts/install.mjs', 'scripts/install',
  ...['download.mjs', 'downloadProxy.mjs', 'githubRelease.mjs', 'version.mjs', 'windowsTreeCleanup.mjs', 'windowsTreeCleanup.cs']
    .map((name) => update + name)];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function prepareInstaller({ revision, archive, output, repo = root }) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('a full lowercase release commit SHA is required');
  const git = (args) => checkedRun('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', ...args], { cwd: repo });
  const manifest = JSON.parse(await git(['show', `${revision}:packages/launcher/package.json`]));
  const version = manifest.version;
  const name = `open-kimi-web-${version}.tgz`;
  if (manifest.name !== 'open-kimi-web' || !parseVersion(version) || basename(archive ?? '') !== name) {
    throw new Error('release commit version and tgz filename must match');
  }
  const packageDigest = sha256(await readFile(archive));
  await mkdir(output);
  for (const [format, script] of [['tar.gz', 'sh'], ['zip', 'ps1']]) {
    const destination = join(output, `okw-install-${version}.${format}`);
    await git(['archive', `--format=${format}`, '-o', destination, revision, '--', ...files]);
    const installerDigest = sha256(await readFile(destination));
    const template = await git(['show', `${revision}:scripts/install/bootstrap.${script}`]);
    const command = template.replace('@VERSION@', version)
      .replace('@INSTALLER_SHA256@', installerDigest).replace('@PACKAGE_SHA256@', packageDigest);
    await writeFile(join(output, `install-command.${script}`), command);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [revision, archive, output] = process.argv.slice(2);
  if (!revision || !archive || !output) {
    throw new Error('Usage: prepare-installer.mjs <release SHA> <release tgz> <new output dir>');
  }
  await prepareInstaller({ revision, archive: resolve(archive), output: resolve(output) });
}
