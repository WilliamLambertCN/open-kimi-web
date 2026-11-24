import { setTimeout as delay } from 'node:timers/promises';
import { parseVersion } from './version.mjs';

export const REPOSITORY = 'https://github.com/WilliamLambertCN/open-kimi-web';
const GHFAST = 'https://ghfast.top';

export function releaseArchive(version) {
  if (!parseVersion(version)) throw new Error('unsupported release version');
  const assetName = `open-kimi-web-${version}.tgz`;
  return { version, assetName, url: `${REPOSITORY}/releases/download/v${version}/${assetName}` };
}

export function proxyArchiveUrl(version, env = process.env) {
  const value = env.OPEN_KIMI_WEB_GITHUB_PROXY || GHFAST;
  if (value === '0') return null;
  if (value !== GHFAST && value !== `${GHFAST}/`) {
    throw new Error(`OPEN_KIMI_WEB_GITHUB_PROXY must be ${GHFAST} or 0 (disable)`);
  }
  return `${GHFAST}/${releaseArchive(version).url}`;
}

export async function preferGitHub(primary, fallback, { signal, proxyDelayMs = 2_000 } = {}) {
  signal?.throwIfAborted();
  if (!fallback) return primary(signal);
  const stop = new AbortController();
  const attempt = signal ? AbortSignal.any([stop.signal, signal]) : stop.signal;
  const github = (async () => primary(attempt))();
  const slow = delay(proxyDelayMs, true, { signal: attempt });
  const failed = github.then(() => false, () => true);
  const proxy = Promise.race([failed, slow]).then((retry) => {
    attempt.throwIfAborted();
    return retry ? fallback(attempt) : github;
  });
  try {
    return await Promise.any([github, proxy]);
  } catch (error) {
    attempt.throwIfAborted();
    throw new Error(`GitHub: ${error.errors[0].message}; download proxy: ${error.errors[1].message}`);
  } finally {
    stop.abort();
    await Promise.allSettled([github, proxy]);
    signal?.throwIfAborted();
  }
}
