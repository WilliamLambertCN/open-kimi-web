import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { downloadRelease, latestRelease, REPOSITORY, validateRelease } from '../src/update/githubRelease.mjs';
import { proxyArchiveUrl } from '../src/update/downloadProxy.mjs';
import { assertNodeEngine, compareVersions, parseVersion } from '../src/update/version.mjs';

const version = '2.1.1-r10';
const bytes = Buffer.from('archive fixture');
const digest = createHash('sha256').update(bytes).digest('hex');
const proxy = 'https://ghfast.top';
const settings = { env: {}, proxyDelayMs: 15 };
const stalled = (signal) => delay(1_000, null, { signal });
const api = 'https://api.github.com/repos/WilliamLambertCN/open-kimi-web/releases';
const metadataUrl = `${api}/latest`;

function release(current = version) {
  const name = `open-kimi-web-${current}.tgz`;
  return { tag_name: `v${current}`, prerelease: false, draft: false, html_url: `${REPOSITORY}/releases/tag/v${current}`,
    assets: [{ name, browser_download_url: `${REPOSITORY}/releases/download/v${current}/${name}`,
      state: 'uploaded', digest: `sha256:${digest}` }] };
}

const plan = validateRelease(release());
const proxyUrl = `${proxy}/${plan.url}`;

function urls(download) { return download.mock.calls.map(([url]) => url); }

describe('stable update versions', () => {
  it('compares stable revisions numerically', () => {
    expect(compareVersions(version, '2.1.1-r9')).toBe(1);
    expect(compareVersions('2.1.1-r9', version)).toBe(-1);
    expect(compareVersions('2.1.2', '2.1.1-r99')).toBe(1);
    expect(compareVersions('2.1.1', '2.1.1')).toBe(0);
    expect(compareVersions('2.1.1-r999999999999999999999', version)).toBe(1);
  });
  it.each(['v2.1.1', '2.1.1-beta', '2.01.1', '2.1.1-r0', '2.1', null])('rejects ambiguous %s', (value) => {
    expect(parseVersion(value)).toBeNull();
  });
  it('requires an understood target engine and sufficient current Node', () => {
    expect(() => assertNodeEngine({ engines: { node: '>=22.0.0' } }, '24.14.0')).not.toThrow();
    expect(() => assertNodeEngine({ engines: { node: '>=25.0.0' } }, '24.14.0')).toThrow('requires Node');
    expect(() => assertNodeEngine({ engines: { node: '^24' } })).toThrow('cannot be safely verified');
    expect(() => compareVersions('bad', version)).toThrow('unsupported');
  });
});

describe('trusted release evidence', () => {
  it('requires one exact stable asset and records the digest', () => {
    expect(validateRelease(release())).toMatchObject({ version, digest, assetName: 'open-kimi-web-2.1.1-r10.tgz' });
  });
  it.each([
    (r) => { delete r.draft; }, (r) => { r.draft = true; }, (r) => { r.prerelease = true; },
    (r) => { r.tag_name = 'v2.1.1-beta'; }, (r) => { r.tag_name = 5; },
    (r) => { r.html_url = ''; }, (r) => { r.assets = []; }, (r) => { r.assets = {}; },
    (r) => { r.assets.push({ ...r.assets[0], name: 'different.tgz' }); },
    (r) => { r.assets[0].state = 'new'; }, (r) => { r.assets[0].digest = 'sha256:abc'; },
    (r) => { r.assets[0].browser_download_url += '?download=1'; },
    (r) => { r.assets[0].browser_download_url += '#fragment'; },
    (r) => { r.assets[0].browser_download_url = r.assets[0].browser_download_url.replace('github.com', 'evil.example'); },
    (r) => { r.assets[0].browser_download_url = r.assets[0].browser_download_url.replace('https://', 'https://user@'); },
  ])('rejects malformed release evidence %#', (alter) => {
    const value = release();
    alter(value);
    expect(() => validateRelease(value)).toThrow();
  });
  it.each([['latest', undefined], [`tags/v${version}`, version]])('queries only GitHub for %s', async (endpoint, requested) => {
    const download = vi.fn(async () => Buffer.from(JSON.stringify(release())));
    expect(await latestRelease({ ...settings, download, version: requested })).toEqual(plan);
    expect(download).toHaveBeenCalledExactlyOnceWith(`${api}/${endpoint}`, expect.objectContaining({ metadata: true }));
  });
  it.each([
    ['HTTP error', () => { throw new Error('HTTP 503'); }, 'HTTP 503'],
    ['bad metadata', () => Buffer.from('<html>'), 'valid JSON'],
    ['missing digest', () => Buffer.from(JSON.stringify({ ...release(), assets: [{ ...release().assets[0], digest: null }] })),
      'SHA256 digest'],
  ])('does not ask the proxy for evidence after %s', async (_name, result, message) => {
    const download = vi.fn(result);
    await expect(latestRelease({ ...settings, download })).rejects.toThrow(message);
    expect(urls(download)).toEqual([metadataUrl]);
  });
});

describe('GitHub-first release archive download', () => {
  it.each([
    'https://user@ghfast.top', 'https://ghfast.top:443', 'https://ghfast.top?x=1', 'https://ghfast.top#fragment',
    'https://ghfast.top/example', 'https://ghfast.top.evil.invalid', 'http://ghfast.top',
  ])('rejects an unapproved proxy definition %s', (value) => {
    expect(() => proxyArchiveUrl(version, { OPEN_KIMI_WEB_GITHUB_PROXY: value })).toThrow('OPEN_KIMI_WEB_GITHUB_PROXY');
  });
  it.each(['', proxy, `${proxy}/`])('uses the same proxy and archive for setting %j', (value) => {
    expect(proxyArchiveUrl(version, { OPEN_KIMI_WEB_GITHUB_PROXY: value })).toBe(proxyUrl);
  });
  it('does not try the proxy when explicitly disabled, even if GitHub fails', async () => {
    const download = vi.fn(async () => { throw new Error('GitHub unavailable'); });
    const env = { OPEN_KIMI_WEB_GITHUB_PROXY: '0' };
    await expect(downloadRelease(plan, { env, download })).rejects.toThrow('GitHub unavailable');
    expect(urls(download)).toEqual([plan.url]);
  });
  it('uses quick verified GitHub bytes without probing the proxy', async () => {
    const download = vi.fn(async () => bytes);
    expect(await downloadRelease(plan, { ...settings, download })).toEqual({ bytes, url: plan.url, downloadedViaProxy: false });
    expect(urls(download)).toEqual([plan.url]);
  });
  it.each(['slow', 'failed'])('uses the proxy for exactly the same archive when GitHub is %s', async (mode) => {
    const download = vi.fn(async (url, { signal }) => {
      if (url === proxyUrl) return bytes;
      if (mode === 'slow') return stalled(signal);
      throw new Error('GitHub unavailable');
    });
    expect(await downloadRelease(plan, { ...settings, download })).toEqual({ bytes, url: plan.url, downloadedViaProxy: true });
    expect(urls(download)).toEqual([plan.url, proxyUrl]);
    expect(download.mock.calls[1][1].proxyVersion).toBe(version);
    expect(download.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('does not send a request if the plan lacks a digest or has a different archive URL', async () => {
    const download = vi.fn();
    await expect(downloadRelease({ ...plan, digest: null }, { ...settings, download })).rejects.toThrow('digest is missing');
    await expect(downloadRelease({ ...plan, url: `${plan.url}?token=fixture` }, { ...settings, download }))
      .rejects.toThrow('archive URL does not match');
    expect(download).not.toHaveBeenCalled();
  });
  it('rejects a corrupt body from either source', async () => {
    const download = vi.fn(async () => Buffer.from('bad'));
    await expect(downloadRelease(plan, { ...settings, download }))
      .rejects.toThrow('GitHub: release SHA256 digest mismatch; download proxy: release SHA256 digest mismatch');
    expect(urls(download)).toEqual([plan.url, proxyUrl]);
  });
  it('keeps waiting for the official download when the proxy fails', async () => {
    let finish;
    const official = new Promise((resolve) => { finish = resolve; });
    const download = vi.fn(async (url) => {
      if (url === plan.url) return official;
      setImmediate(() => finish(bytes));
      return Buffer.from('bad');
    });
    expect(await downloadRelease(plan, { ...settings, download })).toMatchObject({ bytes, downloadedViaProxy: false });
    expect(urls(download)).toEqual([plan.url, proxyUrl]);
  });
});

describe('archive cancellation', () => {
  it('does not launch another request if cancelled before startup or before the fallback', async () => {
    const controller = new AbortController();
    const download = vi.fn((_url, { signal }) => stalled(signal));
    const options = { ...settings, signal: controller.signal, download };
    const task = expect(downloadRelease(plan, options)).rejects.toThrow('cancelled');
    controller.abort(new Error('cancelled'));
    await task;
    await expect(downloadRelease(plan, options)).rejects.toThrow('cancelled');
    expect(urls(download)).toEqual([plan.url]);
  });
  it('cancels both transfers when stopped during the fallback', async () => {
    const controller = new AbortController();
    const download = vi.fn((url, { signal }) => {
      if (url === proxyUrl) controller.abort(new Error('cancelled during fallback'));
      return stalled(signal);
    });
    await expect(downloadRelease(plan, { ...settings, download, signal: controller.signal }))
      .rejects.toThrow('cancelled during fallback');
    expect(urls(download)).toEqual([plan.url, proxyUrl]);
    expect(download.mock.calls.every(([, { signal }]) => signal.aborted)).toBe(true);
  });
});
