import { isAbsolute, resolve } from 'node:path';
import { exists, samePath } from './files.mjs';
import { checkedRun } from './process.mjs';
import { resolveTool } from './toolResolver.mjs';
import { assertNodeEngine, parseVersion } from './version.mjs';

const ORIGINS = new Set([
  'https://github.com/WilliamLambertCN/open-kimi-web.git',
  'https://github.com/WilliamLambertCN/open-kimi-web',
  'git@github.com:WilliamLambertCN/open-kimi-web.git',
  'ssh://git@github.com/WilliamLambertCN/open-kimi-web.git',
]);
const OPERATIONS = ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG',
  'rebase-apply', 'rebase-merge', 'sequencer'];

function gitEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
}

function gitRunner(installation, context) {
  const run = context.run ?? checkedRun;
  return (args) => run('git', ['--no-optional-locks', '-c', 'core.hooksPath=/dev/null', '-C', installation.repo, ...args], {
    cwd: installation.repo, env: { ...gitEnv(), GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    signal: context.signal, timeoutMs: 30_000,
  });
}

async function assertOrigin(git) {
  const remote = await git(['config', '--get-all', 'remote.origin.url']);
  const effectiveRemote = await git(['remote', 'get-url', '--all', 'origin']);
  if (!ORIGINS.has(remote) || effectiveRemote !== remote) throw new Error('source origin must be the exact official repository');
}

export async function inspectSource(installation, context = {}) {
  const git = gitRunner(installation, context);
  const root = await git(['rev-parse', '--show-toplevel']);
  if (!samePath(root, installation.repo)) throw new Error('Git root does not match the source monorepo');
  const branch = await git(['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (branch !== 'main') throw new Error('source update requires main (not develop or detached HEAD)');
  await assertOrigin(git);
  const tracking = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  if (tracking !== 'origin/main') throw new Error('source main must track origin/main');
  if (await git(['status', '--porcelain=v1', '--untracked-files=all'])) throw new Error('source tree is not clean');
  for (const name of OPERATIONS) {
    const path = await git(['rev-parse', '--git-path', name]);
    if (await exists(isAbsolute(path) ? path : resolve(installation.repo, path))) {
      throw new Error('a Git operation is in progress; finish it manually before updating');
    }
  }
  const head = await git(['rev-parse', 'HEAD']);
  await git(['merge-base', '--is-ancestor', head, 'refs/remotes/origin/main']);
  return { head, git };
}

export async function sourcePlan(installation, context = {}) {
  const state = await inspectSource(installation, context);
  const result = await state.git(['ls-remote', '--exit-code', 'origin', 'refs/heads/main']);
  const match = /^([a-f0-9]{40,64})\s+refs\/heads\/main$/.exec(result);
  if (!match) throw new Error('official main lookup returned ambiguous commit evidence');
  return { kind: 'source', version: 'main source channel', sha: match[1], head: state.head,
    command: 'git fetch --no-tags --no-recurse-submodules origin refs/heads/main; ' +
      'git merge --ff-only <verified SHA>; corepack pnpm install --frozen-lockfile' };
}

async function targetManifests(git, sha) {
  const launcher = JSON.parse(await git(['show', `${sha}:packages/launcher/package.json`]));
  const owner = JSON.parse(await git(['show', `${sha}:package.json`]));
  if (launcher.name !== 'open-kimi-web' || launcher.bin?.['open-kimi-web'] !== 'bin/open-kimi-web.mjs' ||
      owner.name !== 'open-kimi-web-monorepo' || owner.private !== true ||
      !/^pnpm@\d+\.\d+\.\d+$/.test(owner.packageManager || '')) throw new Error('target source identity is invalid');
  if (!parseVersion(launcher.version)) throw new Error('target source version is not supported');
  assertNodeEngine(launcher);
  assertNodeEngine(owner);
  return launcher;
}

export async function updateSource(installation, plan, context = {}) {
  const tools = await (context.resolveTool ?? resolveTool)('corepack');
  const { git } = await inspectSource(installation, context);
  context.stage?.('fetch');
  await git(['fetch', '--no-tags', '--no-recurse-submodules', 'origin', 'refs/heads/main']);
  const sha = await git(['rev-parse', 'FETCH_HEAD']);
  if (!/^[a-f0-9]{40,64}$/.test(sha)) throw new Error('invalid fetched source commit');
  await git(['merge-base', '--is-ancestor', plan.head, sha]);
  const manifest = await targetManifests(git, sha);
  const current = await inspectSource(installation, context);
  if (current.head !== plan.head) throw new Error('source HEAD changed during update; refusing to merge');
  context.stage?.('fast-forward', true);
  await git(['merge', '--ff-only', '--no-edit', sha]);
  context.stage?.('dependency installation', true);
  await (context.run ?? checkedRun)(tools.command, [...tools.args, 'pnpm', 'install', '--frozen-lockfile'], {
    cwd: installation.repo, signal: context.signal, timeoutMs: 300_000,
  });
  return { version: manifest.version, sha, git };
}
