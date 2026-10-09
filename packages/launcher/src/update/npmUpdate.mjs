import { isDeepStrictEqual } from 'node:util';
import { identifyInstallation, sameInstallationTarget } from './installation.mjs';
import { checkedRun } from './process.mjs';
import { resolveTool } from './toolResolver.mjs';

export function npmArguments(installation, url) {
  const args = ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--engine-strict',
    '--dry-run=false', '--bin-links=true', '--force=false', '--package-lock-only=false', '--replace-registry-host=never'];
  if (installation.kind === 'global') args.push('--global', '--prefix', installation.prefix);
  else if (installation.kind === 'local') {
    args.push('--global=false', '--location=project', '--save=true', '--prefix', installation.owner,
      '--include=dev', '--package-lock=true', '--workspaces=false');
    args.push(installation.category === 'devDependencies' ? '--save-dev' : '--save-prod');
  } else throw new Error('npm update requires an identified npm installation');
  return [...args, url];
}

export function npmCommand(installation, url) {
  return `npm ${npmArguments(installation, url).map((arg) => JSON.stringify(arg)).join(' ')}`;
}

export async function updateNpm(installation, plan, context = {}) {
  const tool = await (context.resolveTool ?? resolveTool)('npm');
  const fresh = await (context.reidentify ?? identifyInstallation)({
    modulePath: `${installation.root}/src/update/installation.mjs`, entryPath: installation.entry,
  });
  if (!sameInstallationTarget(fresh, installation) || fresh.version !== installation.version ||
      !isDeepStrictEqual(fresh.ownerManifest, installation.ownerManifest)) {
    throw new Error('npm installation changed before replacement');
  }
  context.stage?.('npm replacement', true);
  await (context.run ?? checkedRun)(tool.command, [...tool.args, ...npmArguments(installation, plan.url)], {
    cwd: installation.owner ?? installation.prefix, signal: context.signal, timeoutMs: 300_000,
  });
  return { version: plan.version };
}
