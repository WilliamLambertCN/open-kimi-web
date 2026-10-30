import { nodePathEnv } from './environment.mjs';

const MARKER = 'open-kimi-shell-ok';
const PROBE = `
const { spawn } = require('node:child_process');
const [shell, platform] = process.argv.slice(1);
const args = platform === 'win32' ? ['--noprofile', '--norc', '-c'] : ['-c'];
const child = spawn(shell, [...args, 'printf ${MARKER}'], {
  cwd: process.cwd(), env: process.env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
});
let output = '';
child.stdout.on('data', (chunk) => { if (output.length < 4096) output += chunk; });
child.on('error', () => { process.exitCode = 1; });
child.on('close', (code) => {
  if (code === 0 && output === '${MARKER}') console.log('${MARKER}');
  else process.exitCode = 1;
});
`;

export async function verifyOfficialShell(ctx, root) {
  const shell = ctx.platform === 'win32' ? ctx.env.KIMI_SHELL_PATH : '/bin/sh';
  if (!shell) throw new Error('official shell verification requires prepared Git Bash');
  const denied = /^(?:BASH_ENV|ENV|SHELLOPTS|BASHOPTS|CDPATH|BASH_FUNC_.*|NODE_OPTIONS|NODE_PATH|LD_PRELOAD|LD_LIBRARY_PATH)$/i;
  const safe = Object.fromEntries(Object.entries(ctx.env).filter(([key]) => !denied.test(key)));
  const env = nodePathEnv(safe, ctx.node, ctx.platform);
  const result = await ctx.run(ctx.node, ['-e', PROBE, shell, ctx.platform], { env, cwd: root, timeoutMs: 20000 });
  if (result !== MARKER) {
    throw new Error('official child_process shell verification failed; inspect and repair manually; ' +
      'no automatic rebuild or reinstall');
  }
}
