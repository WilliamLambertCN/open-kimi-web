import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installRelease, runInstallProcess } from '../../scripts/install.mjs';
import { packageFixture } from './updateFixture.mjs';
import { posixOfficialFixture } from './installOfficialFixture.mjs';

let directory;
let archive;
const version = '2.1.1-r9';
const repo = 'https://github.com/WilliamLambertCN/open-kimi-web';
const native = process.platform !== 'win32';

beforeAll(async () => {
  if (!native) return;
  directory = await mkdtemp(join(tmpdir(), "okw posix install quote' fixture-"));
  archive = await packageFixture(directory, version);
}, 120_000);

afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

function metadata(bytes) {
  const name = `open-kimi-web-${version}.tgz`;
  return { draft: false, prerelease: false, tag_name: `v${version}`, html_url: `${repo}/releases/tag/v${version}`,
    assets: [{ name, state: 'uploaded', digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      browser_download_url: `${repo}/releases/download/v${version}/${name}` }] };
}

async function fixture(shell, existing) {
  const home = join(directory, shell);
  const kimi = await posixOfficialFixture(home);
  if (existing) await writeFile(join(home, '.bashrc'), 'export FIXTURE_SENTINEL=preserved\n');
  const bytes = await readFile(archive);
  const env = { ...process.env, HOME: home, USERPROFILE: home, SHELL: `/bin/${shell}`,
    OPEN_KIMI_WEB_HOME: join(home, '.open-kimi-web'), OPEN_KIMI_REAL_KIMI: kimi };
  const dependencies = { env, log: () => {}, releaseMetadata: async () => metadata(bytes), download: async () => bytes };
  const result = await installRelease({ integrate: true, switchInstallation: true }, dependencies);
  return { home, env, result, dependencies };
}

describe.skipIf(!native)('native POSIX r9-compatible integration', () => {
  it('configures a new interactive bash shell and repeated same-prefix install with quoted HOME', async () => {
    const f = await fixture('bash', true);
    const command = 'command -v open-kimi-web; open-kimi-web --version; kimi --version';
    const output = await runInstallProcess('/bin/bash', ['-ic', command], { env: f.env });
    expect(output).toContain(join(f.env.OPEN_KIMI_WEB_HOME, 'bin/open-kimi-web'));
    expect(output).toContain(version);
    expect(output).toContain('kimi, version 2.1.1');
    await installRelease({ integrate: true, switchInstallation: true }, f.dependencies);
    const state = JSON.parse(await readFile(join(f.env.OPEN_KIMI_WEB_HOME, 'integration.json'), 'utf8'));
    expect(state.pathInstall.file).toBe(join(f.home, '.bashrc'));
    expect(await readFile(join(f.home, '.bashrc'), 'utf8')).toContain('FIXTURE_SENTINEL=preserved');
    expect((await readFile(join(f.home, '.bashrc'), 'utf8')).match(/# >>> open-kimi-web >>>/g)).toHaveLength(1);
  }, 120_000);

  it('selects zshrc instead of pre-existing bashrc and a new interactive zsh resolves wrappers', async ({ skip }) => {
    try { await access('/bin/zsh'); } catch { return skip(); }
    const f = await fixture('zsh', true);
    expect(await readFile(join(f.home, '.bashrc'), 'utf8')).toBe('export FIXTURE_SENTINEL=preserved\n');
    const command = 'command -v open-kimi-web; open-kimi-web --version';
    const output = await runInstallProcess('/bin/zsh', ['-ic', command], { env: f.env });
    expect(output).toContain(join(f.env.OPEN_KIMI_WEB_HOME, 'bin/open-kimi-web'));
    expect(output).toContain(version);
  }, 120_000);
});
