import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { installRelease, runInstallProcess } from '../../scripts/install.mjs';

const [home, archive, version] = process.argv.slice(2);
const repo = 'https://github.com/WilliamLambertCN/open-kimi-web';
const directory = dirname(home);
const bytes = await readFile(archive);
const name = `open-kimi-web-${version}.tgz`;
const lines = [];
const env = { ...process.env, OPEN_KIMI_WEB_HOME: home,
  OPEN_KIMI_REAL_KIMI: join(directory, process.platform === 'win32' ? 'fakeKimi.exe' : 'fakeKimi'),
  npm_config_ignore_scripts: 'false', npm_config_dry_run: 'true', npm_config_prefix: join(directory, 'wrong-prefix') };
const result = await installRelease({ integrate: false, switchInstallation: true }, {
  env, log: (line) => lines.push(line), ensureGitBash: async () => {},
  windowsPaths: async () => ({ user: '', system: '' }),
  discoverOfficial: async () => ({ kind: 'native', path: env.OPEN_KIMI_REAL_KIMI, version: 'kimi, version 2.1.1' }),
  run: async (command, args, options) => command === env.OPEN_KIMI_REAL_KIMI
    ? 'kimi, version 2.1.1' : runInstallProcess(command, args, options),
  releaseMetadata: async () => ({ draft: false, prerelease: false, tag_name: `v${version}`,
    html_url: `${repo}/releases/tag/v${version}`, assets: [{ name, state: 'uploaded',
      digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      browser_download_url: `${repo}/releases/download/v${version}/${name}` }] }),
  download: async () => bytes,
});
console.log(JSON.stringify({ result, lines }));
