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
const TRACKING = 'refs/remotes/origin/main';
const MAIN = 'refs/heads/main';
const COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

function gitEnv(env = process.env) {
  const clean = Object.fromEntries(Object.entries(env).filter(([key]) => !/^GIT_/i.test(key)));
  return { ...clean, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
}

function gitRunner(installation, context) {
  const run = context.run ?? checkedRun;
  return (args, options) => run('git', ['--no-optional-locks', '-c', 'core.hooksPath=/dev/null',
    '-C', installation.repo, ...args], {
    cwd: installation.repo, env: gitEnv(context.env), signal: context.signal, timeoutMs: 30_000, ...options,
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
  const upstream = await git(['rev-parse', TRACKING]);
  await git(['merge-base', '--is-ancestor', head, upstream]);
  return { head, upstream, git };
}

function gitNetwork(git, args) {
  return git(['-c', 'http.followRedirects=false', '-c', 'http.sslVerify=true', ...args, 'origin', MAIN], { quietFailure: true });
}

export async function sourcePlan(installation, context = {}) {
  const { git, head } = await inspectSource(installation, context);
  const evidence = (await gitNetwork(git, ['ls-remote', '--exit-code'])).split(/\s+/);
  const [sha, ref] = evidence;
  if (!COMMIT.test(sha) || ref !== MAIN || evidence.length !== 2) {
    throw new Error('main lookup returned ambiguous commit evidence');
  }
  return { kind: 'source', version: 'main source channel', sha, head,
    command: 'Fetch official origin/main without tags or submodules; verify SHA and ancestry; ' +
      'git merge --ff-only; corepack pnpm install --frozen-lockfile' };
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

async function verifiedTarget(installation, { git, head, upstream }, plan, context) {
  if (head !== plan.head) throw new Error('source HEAD changed during update; refusing to fetch');
  context.stage?.('fetch');
  await gitNetwork(git, ['fetch', '--no-tags', '--no-recurse-submodules', '--refmap=']);
  if (await git(['rev-parse', 'FETCH_HEAD']) !== plan.sha) {
    throw new Error('fetched main changed since lookup; refusing to merge');
  }
  await git(['merge-base', '--is-ancestor', upstream, plan.sha]);
  const manifest = await targetManifests(git, plan.sha);
  const current = await inspectSource(installation, context);
  if (current.head !== head || current.upstream !== upstream) {
    throw new Error('source HEAD or origin/main changed during update; refusing to merge');
  }
  return manifest;
}

export async function updateSource(installation, plan, context = {}) {
  const tools = await (context.resolveTool ?? resolveTool)('corepack');
  const state = await inspectSource(installation, context);
  const manifest = await verifiedTarget(installation, state, plan, context);
  const { git, upstream } = state;
  const { sha } = plan;
  context.stage?.('fast-forward', true);
  await git(['update-ref', TRACKING, sha, upstream]);
  await git(['merge', '--ff-only', '--no-edit', sha]);
  context.stage?.('dependency installation', true);
  await (context.run ?? checkedRun)(tools.command, [...tools.args, 'pnpm', 'install', '--frozen-lockfile'], {
    cwd: installation.repo, signal: context.signal, timeoutMs: 300_000,
  });
  return { version: manifest.version, sha, git };
}
