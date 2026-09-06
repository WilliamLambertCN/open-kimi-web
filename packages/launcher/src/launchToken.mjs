import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const MAX_LAUNCH_TOKEN_LENGTH = 4096;
const DEFAULT_TOKEN_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export function defaultTokenFile(env = process.env, userHome = homedir()) {
  const kimiHome = env.KIMI_CODE_HOME || join(userHome, '.kimi-code');
  return join(kimiHome, 'server.token');
}

function validToken(raw) {
  const token = raw.trim();
  if (token === '' || token.length > MAX_LAUNCH_TOKEN_LENGTH) return null;
  return token;
}

export async function resolveLaunchToken(options, read = readFile) {
  if (options.noTokenLink) return { token: null, attempted: false };
  const targetHost = new URL(options.target).hostname;
  const file = options.tokenFile ?? (
    DEFAULT_TOKEN_HOSTS.has(targetHost.toLowerCase())
      ? defaultTokenFile(options.env, options.userHome)
      : null
  );
  if (file === null) return { token: null, attempted: false };
  try {
    return { token: validToken(await read(file, 'utf8')), attempted: true };
  } catch {
    return { token: null, attempted: true };
  }
}
