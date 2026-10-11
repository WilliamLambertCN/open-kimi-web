import { basename, isAbsolute } from 'node:path';

export function assertIntegrationPaths(ctx) {
  const values = [ctx.home, ctx.node, ctx.entry, ctx.kimi].filter(Boolean);
  const unsafe = ctx.platform === 'win32' ? /[%!&|<>^"\r\n\0]/ : /["$`\\\r\n\0]/;
  if (values.some((value) => unsafe.test(value))) {
    throw new Error('automatic integration cannot safely quote this installation path; use --no-integrate and manual setup');
  }
  if (ctx.platform === 'win32') return;
  const shell = basename(ctx.env.SHELL || 'sh');
  if (!['bash', 'zsh', 'sh'].includes(shell)) {
    throw new Error('automatic integration does not support this shell; use --no-integrate and manual setup');
  }
  const home = ctx.env.HOME || ctx.env.USERPROFILE;
  if (!home || !isAbsolute(home)) throw new Error('an absolute HOME is required for shell integration');
}
