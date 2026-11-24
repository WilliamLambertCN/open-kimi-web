import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { installRelease, runInstallProcess } from '../../scripts/install.mjs';

const [home, archive, version] = process.argv.slice(2);
const repo = 'https://github.com/WilliamLambertCN/open-kimi-web';
const proxy = 'https://ghfast.top';
const directory = dirname(home);
const bytes = await readFile(archive);
const lines = [];
const digest = createHash('sha256').update(bytes).digest('hex');
const url = `${repo}/releases/download/v${version}/open-kimi-web-${version}.tgz`;
const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^OPEN_KIMI_WEB_GITHUB_PROXY$/i.test(key)));
const env = { ...inherited, OPEN_KIMI_WEB_HOME: home, OPEN_KIMI_WEB_INSTALL_SHA256: digest,
  OPEN_KIMI_REAL_KIMI: join(directory, process.platform === 'win32' ? 'fakeKimi.exe' : 'fakeKimi'),
  npm_config_ignore_scripts: 'false', npm_config_dry_run: 'true', npm_config_prefix: join(directory, 'wrong-prefix') };
const result = await installRelease({ version, integrate: false, switchInstallation: true }, {
  env, log: (line) => lines.push(line), ensureGitBash: async () => {},
  windowsPaths: async () => ({ user: '', system: '' }),
  discoverOfficial: async () => ({ kind: 'native', path: env.OPEN_KIMI_REAL_KIMI, version: 'kimi, version 2.1.1' }),
  run: async (command, args, options) => command === env.OPEN_KIMI_REAL_KIMI
    ? 'kimi, version 2.1.1' : runInstallProcess(command, args, options),
  releaseMetadata: async () => { throw new Error('a pinned installer must not need GitHub metadata'); },
  download: async (source, { proxyVersion }) => {
    if (source === url) throw new Error('fixture GitHub unavailable');
    if (source !== `${proxy}/${url}` || proxyVersion !== version) throw new Error('unexpected fixture download');
    return bytes;
  },
});
console.log(JSON.stringify({ result, lines }));
