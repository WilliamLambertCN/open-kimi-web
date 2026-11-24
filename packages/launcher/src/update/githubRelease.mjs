import { createHash } from 'node:crypto';
import { downloadBytes } from './download.mjs';
import { preferGitHub, proxyArchiveUrl, releaseArchive, REPOSITORY } from './downloadProxy.mjs';
import { parseVersion } from './version.mjs';

const API = 'https://api.github.com/repos/WilliamLambertCN/open-kimi-web/releases';
export { releaseArchive, REPOSITORY };

function asset(value, name, url) {
  if (!Array.isArray(value.assets)) throw new Error('release assets are malformed');
  const matches = value.assets.filter((item) => item?.name === name || item?.browser_download_url === url);
  if (matches.length !== 1 || matches[0].name !== name || matches[0].browser_download_url !== url) {
    throw new Error('release must have one exact asset for each required filename');
  }
  return matches[0];
}

function formalVersion(value, requested) {
  if (value?.prerelease !== false || value.draft !== false) throw new Error('release is not formal');
  const tag = value.tag_name;
  const version = typeof tag === 'string' && tag.startsWith('v') ? tag.slice(1) : '';
  if (!parseVersion(version) || requested && version !== requested) throw new Error('release version does not match');
  return version;
}

export function validateRelease(value, requested) {
  const release = releaseArchive(formalVersion(value, requested));
  if (value.html_url !== `${REPOSITORY}/releases/tag/v${release.version}`) throw new Error('release repository does not match');
  const { state, digest } = asset(value, release.assetName, release.url);
  if (state !== 'uploaded' || typeof digest !== 'string' || !/^sha256:[a-fA-F0-9]{64}$/.test(digest)) {
    throw new Error('release requires an uploaded tgz and a SHA256 digest');
  }
  return { ...release, digest: digest.slice(7).toLowerCase() };
}

async function metadataFrom(download, url, settings) {
  const bytes = await download(url, settings);
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('release metadata is not valid JSON'); }
}

export async function latestRelease(options = {}) {
  const { version, env, signal, timeoutMs = 15_000 } = options;
  if (version && !parseVersion(version)) throw new Error('unsupported release version');
  signal?.throwIfAborted();
  const endpoint = version ? `tags/v${version}` : 'latest';
  const read = options.releaseMetadata ?? metadataFrom.bind(null, options.download ?? downloadBytes);
  const value = await read(`${API}/${endpoint}`, { env, signal, timeoutMs, metadata: true });
  signal?.throwIfAborted();
  return validateRelease(value, version);
}

export async function downloadRelease({ version, url, digest }, options = {}) {
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) throw new Error('release SHA256 digest is missing');
  if (url !== releaseArchive(version).url) throw new Error('release archive URL does not match the selected version');
  const proxy = proxyArchiveUrl(version, options.env);
  const download = options.download ?? downloadBytes;
  const verified = async (address, signal, downloadedViaProxy) => {
    const bytes = await download(address, { env: options.env, signal, proxyVersion: downloadedViaProxy ? version : undefined });
    signal?.throwIfAborted();
    if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('release SHA256 digest mismatch');
    return { bytes, url, downloadedViaProxy };
  };
  return preferGitHub((signal) => verified(url, signal, false),
    proxy && ((signal) => verified(proxy, signal, true)), options);
}
