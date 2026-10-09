import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { identifyInstallation } from '../../packages/launcher/src/update/installation.mjs';
import { inspectSource, sourcePlan, updateSource } from '../../packages/launcher/src/update/sourceUpdate.mjs';
import { updateMain } from '../../packages/launcher/src/update/updateMain.mjs';
import { verifyInstallation } from '../../packages/launcher/src/update/verification.mjs';
import { git, identityOptions, networkInjectedRun, officialOrigin, put, sourceFixture } from './updateFixture.mjs';

const directories = [];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'okw-update-git-'));
  directories.push(directory);
  const value = await sourceFixture(directory);
  const root = join(value.checkout, 'packages/launcher');
  return { ...value, directory, installation: await identifyInstallation(identityOptions(root)) };
}
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });

describe('isolated real source update', () => {
  it('check is read-only, then fetches a frozen commit, fast-forwards and installs through real Corepack', async () => {
    const value = await fixture();
    const { checkout, remote, installation, sha } = value;
    const before = await git(checkout, ['rev-parse', 'HEAD']);
    const run = networkInjectedRun(remote);
    const plan = await sourcePlan(installation, { run });
    expect(plan.sha).toBe(sha);
    expect(await git(checkout, ['rev-parse', 'HEAD'])).toBe(before);
    expect(await git(checkout, ['rev-parse', 'origin/main'])).toBe(before);
    await expect(readFile(join(checkout, '.git/FETCH_HEAD'))).rejects.toThrow();
    const result = await updateSource(installation, plan, { run });
    expect(result.sha).toBe(sha);
    expect(await git(checkout, ['rev-parse', 'HEAD'])).toBe(sha);
    expect(await git(checkout, ['config', 'remote.origin.url'])).toBe(officialOrigin);
    expect(await git(checkout, ['status', '--porcelain'])).toBe('');
    await verifyInstallation(installation, result, { run });
  }, 60_000);

  it('refuses dirty trees, unsafe branches/remotes/tracking, ahead commits and ongoing operations', async () => {
    const { checkout, installation } = await fixture();
    await put(join(checkout, 'untracked'), 'fixture');
    await expect(inspectSource(installation)).rejects.toThrow('not clean');
    await git(checkout, ['add', 'untracked']);
    await expect(inspectSource(installation)).rejects.toThrow('not clean');
    await git(checkout, ['restore', '--staged', 'untracked']);
    await rm(join(checkout, 'untracked'));
    await put(join(checkout, '.git/MERGE_HEAD'), await git(checkout, ['rev-parse', 'HEAD']));
    await expect(inspectSource(installation)).rejects.toThrow('operation is in progress');
    await rm(join(checkout, '.git/MERGE_HEAD'));
    await git(checkout, ['switch', '-c', 'develop']);
    await expect(inspectSource(installation)).rejects.toThrow('requires main');
    await git(checkout, ['switch', 'main']);
    await git(checkout, ['switch', '--detach']);
    await expect(inspectSource(installation)).rejects.toThrow();
    await git(checkout, ['switch', 'main']);
    await git(checkout, ['remote', 'set-url', 'origin', 'https://example.invalid/other.git']);
    await expect(inspectSource(installation)).rejects.toThrow('exact official');
    await git(checkout, ['remote', 'set-url', 'origin', officialOrigin]);
    await git(checkout, ['branch', '--unset-upstream']);
    await expect(inspectSource(installation)).rejects.toThrow();
    await git(checkout, ['branch', '--set-upstream-to', 'origin/main']);
    await git(checkout, ['config', 'user.name', 'Fixture']);
    await git(checkout, ['config', 'user.email', 'fixture@example.invalid']);
    await git(checkout, ['commit', '--allow-empty', '-m', 'fixture ahead']);
    await expect(inspectSource(installation)).rejects.toThrow();
  }, 60_000);

  it('detects HEAD changes and rejects a too-new Node requirement before modifying HEAD', async () => {
    const { checkout, remote, installation } = await fixture();
    const run = networkInjectedRun(remote);
    const plan = await sourcePlan(installation, { run });
    const before = await git(checkout, ['rev-parse', 'HEAD']);
    const manifest = JSON.parse(await readFile(join(remote, 'packages/launcher/package.json'), 'utf8'));
    manifest.engines.node = '>=999.0.0';
    await put(join(remote, 'packages/launcher/package.json'), manifest);
    await git(remote, ['add', '.']);
    await git(remote, ['commit', '-m', 'fixture unsupported node']);
    await expect(updateSource(installation, plan, { run })).rejects.toThrow('requires Node');
    expect(await git(checkout, ['rev-parse', 'HEAD'])).toBe(before);
  }, 60_000);

  it('reports a genuine post-fast-forward install failure with changed HEAD and recovery, not rollback', async () => {
    const { checkout, remote, installation, sha } = await fixture();
    const lines = [];
    const real = networkInjectedRun(remote);
    const run = async (command, args, options) => {
      if (args.includes('pnpm')) throw new Error('fixture Corepack dependency failure');
      return real(command, args, options);
    };
    const code = await updateMain([], { identify: async () => installation, run,
      log: (line) => lines.push(line), error: (line) => lines.push(line) });
    expect(code).toBe(1);
    expect(await git(checkout, ['rev-parse', 'HEAD'])).toBe(sha);
    expect(lines.join('\n')).toContain('dependency installation');
    expect(lines.join('\n')).toContain('partially changed');
    expect(lines.join('\n')).toContain('Current on-disk version: 2.1.1-r10');
    expect(lines.join('\n')).toContain(`Current source HEAD: ${sha}`);
    expect(lines.join('\n')).toContain('corepack pnpm install --frozen-lockfile');
  }, 60_000);
});
