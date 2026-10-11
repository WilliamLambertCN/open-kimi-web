import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installRelease, runInstallProcess } from '../../scripts/install.mjs';
import { identifyInstallation } from '../../packages/launcher/src/update/installation.mjs';
import { globalRoot, identityOptions, packageFixture } from './updateFixture.mjs';

let directory;
let windowsDirectory;
let archive;
const version = '2.1.1-r9';
const repo = 'https://github.com/WilliamLambertCN/open-kimi-web';

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'okw install & % fixture-'));
  archive = await packageFixture(directory, version);
}, 120_000);

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  if (windowsDirectory) await rm(windowsDirectory, { recursive: true, force: true });
});

describe('real isolated coordinator npm installation', () => {
  it('installs genuine local tgz and verifies actual custom-prefix updater identity without PATH changes', async () => {
    const home = join(directory, 'isolated-home');
    const bytes = await readFile(archive);
    const name = `open-kimi-web-${version}.tgz`;
    const lines = [];
    const env = { ...process.env, OPEN_KIMI_WEB_HOME: home,
      OPEN_KIMI_REAL_KIMI: join(directory, process.platform === 'win32' ? 'fakeKimi.exe' : 'fakeKimi'),
      npm_config_ignore_scripts: 'false', npm_config_dry_run: 'true', npm_config_prefix: join(directory, 'wrong-prefix') };
    const result = await installRelease({ integrate: false, switchInstallation: true }, {
      env, log: (line) => lines.push(line), ensureGitBash: async () => {},
      discoverOfficial: async () => ({ kind: 'native', path: env.OPEN_KIMI_REAL_KIMI, version: 'kimi, version 2.1.1' }),
      run: async (command, args, options) => {
        if (command === env.OPEN_KIMI_REAL_KIMI) return 'kimi, version 2.1.1';
        return runInstallProcess(command, args, options);
      },
      releaseMetadata: async () => ({ draft: false, prerelease: false, tag_name: `v${version}`,
        html_url: `${repo}/releases/tag/v${version}`, assets: [{ name, state: 'uploaded',
          digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
          browser_download_url: `${repo}/releases/download/v${version}/${name}` }] }),
      download: async () => bytes,
    });
    expect(result.integrated).toBe(false);
    const root = globalRoot(result.prefix);
    expect(await identifyInstallation(identityOptions(root))).toMatchObject({ kind: 'global', prefix: result.prefix, version });
    expect(await runInstallProcess(process.execPath, [result.entry, '--version'])).toBe(version);
    expect((await readdir(root)).includes('UNSAFE-LIFECYCLE')).toBe(false);
    expect(await readdir(home)).toEqual(['bootstrap-install.json', 'npm']);
    expect(lines.join('\n')).toContain('NOT installed or changed');
    expect(dirname(result.entry)).toBe(join(root, 'bin'));
  }, 120_000);

  it.skipIf(process.platform !== 'win32')('runs actual installed integration using isolated User PATH seams and detects shadow',
    async () => {
      const { cp, mkdir, writeFile } = await import('node:fs/promises');
      windowsDirectory = await mkdtemp(join(tmpdir(), 'okw-install-windows-'));
      const home = windowsDirectory;
      const fakeKimi = join(home, 'kimi.exe');
      await writeFile(fakeKimi, 'fixture executable');
      const bytes = await readFile(archive);
      const name = `open-kimi-web-${version}.tgz`;
      let userPath = 'preserve-entry';
      let systemPath = '';
      const env = { ...process.env, HOME: home, USERPROFILE: home,
        OPEN_KIMI_WEB_HOME: join(home, '.open-kimi-web'), OPEN_KIMI_REAL_KIMI: fakeKimi };
      const dependencies = { env, log: () => {}, ensureGitBash: async () => {},
        discoverOfficial: async () => ({ kind: 'native', path: fakeKimi, version: 'kimi, version 2.1.1' }),
        readUserPath: async () => userPath, writeUserPath: async (value) => { userPath = value; },
        readSystemPath: async () => systemPath, windowsPaths: async () => ({ user: userPath, system: systemPath }),
        run: async (command, args, settings) => command === fakeKimi ? 'kimi, version 2.1.1'
          : runInstallProcess(command, args, settings),
        releaseMetadata: async () => ({ draft: false, prerelease: false, tag_name: `v${version}`,
          html_url: `${repo}/releases/tag/v${version}`, assets: [{ name, state: 'uploaded',
            digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
            browser_download_url: `${repo}/releases/download/v${version}/${name}` }] }),
        download: async () => bytes };
      const options = { integrate: true, switchInstallation: true };
      const result = await installRelease(options, dependencies);
      expect(result.integrated).toBe(true);
      expect(userPath.split(';')[0]).toBe(join(env.OPEN_KIMI_WEB_HOME, 'bin'));
      const state = JSON.parse(await readFile(join(env.OPEN_KIMI_WEB_HOME, 'integration.json'), 'utf8'));
      expect(state.node).toBe(process.execPath);
      const shadow = join(home, 'system-shadow');
      await mkdir(shadow);
      await cp(fakeKimi, join(shadow, 'kimi.exe'));
      systemPath = shadow;
      await expect(installRelease(options, dependencies)).rejects.toThrow('System PATH shadows');
    }, 120_000);
});
