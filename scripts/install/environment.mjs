import { dirname } from 'node:path';

export function pathValue(env, platform = process.platform) {
  if (platform !== 'win32') return env.PATH ?? '';
  const key = Object.keys(env).sort().find((name) => name.toLowerCase() === 'path');
  return key ? env[key] ?? '' : '';
}

export function normalizePathEnv(env, platform = process.platform) {
  if (platform !== 'win32') return { ...env };
  return { ...Object.fromEntries(Object.entries(env).filter(([key]) => key.toLowerCase() !== 'path')),
    PATH: pathValue(env, platform) };
}

export function nodePathEnv(env, node, platform = process.platform) {
  const safe = normalizePathEnv(env, platform);
  safe.PATH = `${dirname(node)}${platform === 'win32' ? ';' : ':'}${pathValue(safe, platform)}`;
  return safe;
}
