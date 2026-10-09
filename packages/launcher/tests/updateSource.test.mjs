import { describe, expect, it, vi } from 'vitest';
import { inspectSource, sourcePlan, updateSource } from '../src/update/sourceUpdate.mjs';

const sha = 'a'.repeat(40);
const installation = { kind: 'source', repo: process.cwd(), root: `${process.cwd()}/packages/launcher` };
const origin = 'https://github.com/WilliamLambertCN/open-kimi-web.git';
const responses = {
  'rev-parse --show-toplevel': installation.repo,
  'symbolic-ref --quiet --short HEAD': 'main',
  'config --get-all remote.origin.url': origin,
  'remote get-url --all origin': origin,
  'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': 'origin/main',
  'rev-parse HEAD': sha, 'rev-parse FETCH_HEAD': sha,
  'ls-remote --exit-code origin refs/heads/main': `${sha}\trefs/heads/main`,
  [`show ${sha}:packages/launcher/package.json`]: JSON.stringify({ name: 'open-kimi-web',
    version: '2.1.1-r10', bin: { 'open-kimi-web': 'bin/open-kimi-web.mjs' }, engines: { node: '>=22.0.0' } }),
  [`show ${sha}:package.json`]: JSON.stringify({ name: 'open-kimi-web-monorepo', private: true,
    packageManager: 'pnpm@10.33.0', engines: { node: '>=22.0.0' } }),
};
function runner(overrides = {}) {
  const count = { heads: 0 };
  return vi.fn(async (command, args) => {
    const key = args.slice(args.indexOf('-C') + 2).join(' ');
    if (Object.hasOwn(overrides, key)) return typeof overrides[key] === 'function' ? overrides[key](count) : overrides[key];
    if (key.startsWith('rev-parse --git-path ')) return `nonexistent-update-fixture/${key.split(' ').at(-1)}`;
    return responses[key] ?? '';
  });
}

describe('source security and frozen update commands', () => {
  it.each([
    ['rev-parse --show-toplevel', 'not-this-checkout', 'root'],
    ['symbolic-ref --quiet --short HEAD', 'develop', 'main'],
    ['config --get-all remote.origin.url', 'https://evil.invalid/repo.git', 'official'],
    ['remote get-url --all origin', 'https://redirect.invalid/repo.git', 'official'],
    ['rev-parse --abbrev-ref --symbolic-full-name @{upstream}', 'origin/develop', 'track'],
    ['status --porcelain=v1 --untracked-files=all', '?? dirty', 'clean'],
  ])('refuses unsafe evidence %s', async (key, value, message) => {
    await expect(inspectSource(installation, { run: runner({ [key]: value }) })).rejects.toThrow(message);
  });
  it('check runs bounded ls-remote but never fetches', async () => {
    const run = runner();
    const plan = await sourcePlan(installation, { run });
    expect(plan.sha).toBe(sha);
    expect(run.mock.calls.some((call) => call[1].includes('fetch'))).toBe(false);
    expect(run.mock.calls.at(-1)[2].timeoutMs).toBe(30_000);
    await expect(sourcePlan(installation, { run: runner({ 'ls-remote --exit-code origin refs/heads/main': 'ambiguous' }) }))
      .rejects.toThrow('ambiguous');
  });
  it('fetches without tags/submodules, freezes SHA and uses ff-only plus frozen Corepack install', async () => {
    const run = runner();
    const result = await updateSource(installation, { head: sha }, { run,
      resolveTool: async () => ({ command: process.execPath, args: ['corepack.js'] }) });
    expect(result.sha).toBe(sha);
    const calls = run.mock.calls.map((call) => call[1]);
    expect(calls.some((args) => args.includes('--no-tags') && args.includes('--no-recurse-submodules'))).toBe(true);
    expect(calls.some((args) => args.includes('--ff-only') && args.at(-1) === sha)).toBe(true);
    expect(calls.at(-1)).toEqual(['corepack.js', 'pnpm', 'install', '--frozen-lockfile']);
  });
  it('refuses a raced HEAD and an invalid fetched SHA before merging', async () => {
    const run = runner({ 'rev-parse HEAD': (count) => ++count.heads === 1 ? sha : 'b'.repeat(40) });
    await expect(updateSource(installation, { head: sha }, { run,
      resolveTool: async () => ({ command: process.execPath, args: [] }) })).rejects.toThrow('HEAD changed');
    expect(run.mock.calls.some((call) => call[1].includes('merge'))).toBe(false);
    await expect(updateSource(installation, { head: sha }, { run: runner({ 'rev-parse FETCH_HEAD': 'bad-sha' }),
      resolveTool: async () => ({ command: process.execPath, args: [] }) })).rejects.toThrow('invalid fetched');
  });
});
