import { lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export async function windowsPaths(ctx) {
  const command = join(ctx.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const script = "$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.Encoding]::UTF8;" +
    "@{user=[Environment]::GetEnvironmentVariable('PATH','User');" +
    "system=[Environment]::GetEnvironmentVariable('PATH','Machine')}|ConvertTo-Json -Compress";
  const value = JSON.parse(await ctx.run(command, ['-NoProfile', '-NonInteractive', '-Command', script], { env: ctx.env }));
  if (typeof value !== 'object' || value === null) throw new Error('persistent Windows PATH could not be inspected');
  return { user: value.user ?? '', system: value.system ?? '' };
}

export async function assertNoSystemShadow(ctx) {
  const paths = await (ctx.windowsPaths ?? windowsPaths)(ctx);
  const expanded = expandWindowsPath(paths.system, ctx.env).split(';').filter(Boolean);
  const wrapper = expanded.findIndex((dir) => resolve(dir).toLowerCase() === resolve(ctx.bin).toLowerCase());
  for (const [index, dir] of expanded.entries()) {
    if (wrapper !== -1 && index >= wrapper) break;
    for (const name of ['kimi.exe', 'kimi.cmd', 'kimi.bat']) {
      let exists;
      try { exists = await lstat(join(dir, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (exists) throw new Error('package installed, but System PATH shadows takeover');
    }
  }
}

export function expandWindowsPath(value, env) {
  return value.replace(/%([^%]+)%/g, (match, name) => {
    const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    return key === undefined ? match : env[key];
  });
}
