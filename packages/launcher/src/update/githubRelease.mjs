import { parseVersion } from './version.mjs';

export const RELEASE_API = 'https://api.github.com/repos/WilliamLambertCN/open-kimi-web/releases/latest';
export const REPOSITORY = 'https://github.com/WilliamLambertCN/open-kimi-web';
const LIMIT = 1024 * 1024;

function releaseAsset(value, assetName, url) {
  if (!Array.isArray(value.assets)) throw new Error('GitHub release assets are malformed');
  const assets = value.assets.filter((asset) => asset?.name === assetName);
  if (!assets || assets.length !== 1 || assets[0].browser_download_url !== url || assets[0].state !== 'uploaded') {
    throw new Error('GitHub latest release does not contain one exact official tgz asset');
  }
}

export function validateRelease(value) {
  if (!value || value.draft !== false || value.prerelease !== false || typeof value.tag_name !== 'string') {
    throw new Error('GitHub latest release is draft, prerelease or malformed');
  }
  const version = value.tag_name.startsWith('v') ? value.tag_name.slice(1) : '';
  if (!parseVersion(version)) throw new Error('GitHub latest release has an unsupported stable tag');
  const assetName = `open-kimi-web-${version}.tgz`;
  const url = `${REPOSITORY}/releases/download/v${version}/${assetName}`;
  releaseAsset(value, assetName, url);
  return { version, url, assetName };
}

async function readBounded(response, signal) {
  if (Number(response.headers.get('content-length')) > LIMIT) throw new Error('release response exceeds size limit');
  if (!response.body) throw new Error('empty GitHub release response');
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > LIMIT) throw new Error('release response exceeds size limit');
      chunks.push(Buffer.from(chunk.value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
  }
}

function assertResponse(response) {
  if (response.status !== 200 || response.redirected || response.url && response.url !== RELEASE_API) {
    throw new Error(`GitHub latest release request failed (HTTP ${response.status}); check network/rate limits`);
  }
}

export async function latestRelease(options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('GitHub release request timed out')), options.timeoutMs ?? 15_000);
  const cancel = () => controller.abort(new Error('GitHub release request cancelled'));
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  try {
    const response = await (options.fetch ?? fetch)(RELEASE_API, {
      redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'open-kimi-web-update' },
    });
    assertResponse(response);
    return validateRelease(await readBounded(response, controller.signal));
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
  }
}
