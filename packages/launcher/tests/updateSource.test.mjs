import { describe, expect, it, vi } from 'vitest';
import { inspectSource, sourcePlan, updateSource } from '../src/update/sourceUpdate.mjs';

const sha = 'a'.repeat(40);
const installation = { kind: 'source', repo: process.cwd(), root: `${process.cwd()}/packages/launcher` };
const origin = 'https://github.com/WilliamLambertCN/open-kimi-web.git';
const lookup = 'ls-remote --exit-code origin refs/heads/main';
const fetch = 'fetch --no-tags --no-recurse-submodules --refmap= origin refs/heads/main';
const tools = { resolveTool: async () => ({ command: process.execPath, args: ['corepack.js'] }), env: {} };
const plan = { head: sha, sha };
const responses = {
  'rev-parse --show-toplevel': installation.repo,
  'symbolic-ref --quiet --short HEAD': 'main',
  'config --get-all remote.origin.url': origin,
  'remote get-url --all origin': origin,
  'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': 'origin/main',
  'rev-parse HEAD': sha, 'rev-parse FETCH_HEAD': sha, 'rev-parse refs/remotes/origin/main': sha,
  [lookup]: `${sha}\trefs/heads/main`,
  [`show ${sha}:packages/launcher/package.json`]: JSON.stringify({ name: 'open-kimi-web',
    version: '2.1.1-r10', bin: { 'open-kimi-web': 'bin/open-kimi-web.mjs' }, engines: { node: '>=22.0.0' } }),
  [`show ${sha}:package.json`]: JSON.stringify({ name: 'open-kimi-web-monorepo', private: true,
    packageManager: 'pnpm@10.33.0', engines: { node: '>=22.0.0' } }),
};
function runner(overrides = {}) {
  const count = { heads: 0 };
  return vi.fn(async (command, args) => {
    let start = args.indexOf('-C') + 2;
    while (args[start] === '-c') start += 2;
    const key = args.slice(start).join(' ');
    if (Object.hasOwn(overrides, key)) return typeof overrides[key] === 'function' ? overrides[key](count) : overrides[key];
    if (key.startsWith('rev-parse --git-path ')) return `nonexistent-update-fixture/${key.split(' ').at(-1)}`;
    return responses[key] ?? '';
  });
}

function called(run, arg) { return run.mock.calls.filter(([, args]) => args.includes(arg)); }

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
    expect((await sourcePlan(installation, { run, env: {} })).sha).toBe(sha);
    expect(called(run, 'fetch')).toHaveLength(0);
    expect(run.mock.calls.at(-1)[2].timeoutMs).toBe(30_000);
    await expect(sourcePlan(installation, { run: runner({ [lookup]: 'ambiguous' }), env: {} })).rejects.toThrow('ambiguous');
  });
  it('fetches without tags/submodules, freezes SHA and uses ff-only plus frozen Corepack install', async () => {
    const run = runner();
    const result = await updateSource(installation, plan, { ...tools, run });
    expect(result.sha).toBe(sha);
    const calls = run.mock.calls.map((call) => call[1]);
    expect(calls.some((args) => args.includes('--no-tags') && args.includes('--no-recurse-submodules'))).toBe(true);
    expect(calls.some((args) => args.includes('--ff-only') && args.at(-1) === sha)).toBe(true);
    expect(calls.at(-1)).toEqual(['corepack.js', 'pnpm', 'install', '--frozen-lockfile']);
  });
  it('refuses a raced HEAD or moved remote ref before merging', async () => {
    const run = runner({ 'rev-parse HEAD': (count) => ++count.heads === 1 ? sha : 'b'.repeat(40) });
    await expect(updateSource(installation, plan, { ...tools, run })).rejects.toThrow('HEAD or origin/main changed');
    expect(called(run, 'merge')).toHaveLength(0);
    await expect(updateSource(installation, plan, { ...tools, run: runner({ 'rev-parse FETCH_HEAD': 'b'.repeat(40) }) }))
      .rejects.toThrow('main changed since lookup');
  });
  it.each([lookup, fetch])('never substitutes the download proxy for a failed Git request: %s', async (command) => {
    const unavailable = new Error('fixture GitHub unavailable');
    const env = { OPEN_KIMI_WEB_GITHUB_PROXY: 'https://ghfast.top' };
    const run = runner({ [command]: () => { throw unavailable; } });
    const context = { ...tools, env, run };
    const task = command === lookup ? sourcePlan(installation, context) : updateSource(installation, plan, context);
    await expect(task).rejects.toBe(unavailable);
    const requests = called(run, command.split(' ')[0]);
    expect(requests).toHaveLength(1);
    expect(requests[0][1].at(-2)).toBe('origin');
    expect(requests[0][2].timeoutMs).toBe(30_000);
    expect(called(run, 'merge')).toHaveLength(0);
  });
});
