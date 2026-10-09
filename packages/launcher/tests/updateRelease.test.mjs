import { describe, expect, it, vi } from 'vitest';
import { latestRelease, RELEASE_API, REPOSITORY, validateRelease } from '../src/update/githubRelease.mjs';
import { assertNodeEngine, compareVersions, parseVersion } from '../src/update/version.mjs';

function release(version = '2.1.1-r10') {
  const name = `open-kimi-web-${version}.tgz`;
  return { draft: false, prerelease: false, tag_name: `v${version}`, assets: [{
    name, state: 'uploaded', browser_download_url: `${REPOSITORY}/releases/download/v${version}/${name}`,
  }] };
}

describe('stable update versions', () => {
  it('compares revision numbers numerically and never treats r10 as older than r9', () => {
    expect(compareVersions('2.1.1-r10', '2.1.1-r9')).toBe(1);
    expect(compareVersions('2.1.1-r9', '2.1.1-r10')).toBe(-1);
    expect(compareVersions('2.1.2', '2.1.1-r99')).toBe(1);
    expect(compareVersions('2.1.1', '2.1.1')).toBe(0);
    expect(compareVersions('2.1.1-r999999999999999999999', '2.1.1-r10')).toBe(1);
  });
  it.each(['v2.1.1', '2.1.1-beta', '2.01.1', '2.1.1-r0', '2.1', null])('rejects ambiguous %s', (value) => {
    expect(parseVersion(value)).toBeNull();
  });
  it('requires an understood target engine and sufficient current Node', () => {
    expect(() => assertNodeEngine({ engines: { node: '>=22.0.0' } }, '24.14.0')).not.toThrow();
    expect(() => assertNodeEngine({ engines: { node: '>=25.0.0' } }, '24.14.0')).toThrow('requires Node');
    expect(() => assertNodeEngine({ engines: { node: '^24' } })).toThrow('cannot be safely verified');
    expect(() => compareVersions('bad', '2.1.1')).toThrow('unsupported');
  });
});

describe('fixed official GitHub latest release', () => {
  it('requires one exact stable asset', () => {
    expect(validateRelease(release())).toMatchObject({ version: '2.1.1-r10', assetName: 'open-kimi-web-2.1.1-r10.tgz' });
  });
  it.each([
    (r) => { r.draft = true; }, (r) => { r.prerelease = true; }, (r) => { r.tag_name = 'v2.1.1-beta'; },
    (r) => { r.assets = []; }, (r) => { r.assets = {}; }, (r) => { r.assets.push(r.assets[0]); },
    (r) => { r.assets[0].state = 'new'; },
    (r) => { r.assets[0].browser_download_url += '?download=1'; },
    (r) => { r.assets[0].browser_download_url += '#fragment'; },
    (r) => { r.assets[0].browser_download_url = r.assets[0].browser_download_url.replace('github.com', 'evil.example'); },
    (r) => { r.assets[0].browser_download_url = r.assets[0].browser_download_url.replace('https://', 'https://user@'); },
  ])('rejects malformed release evidence %# without fallback', (alter) => {
    const value = release();
    alter(value);
    expect(() => validateRelease(value)).toThrow();
  });
  it('uses a fixed API, refuses redirects and completes within a deadline', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(release())));
    expect((await latestRelease({ fetch })).version).toBe('2.1.1-r10');
    expect(fetch).toHaveBeenCalledWith(RELEASE_API, expect.objectContaining({ redirect: 'error' }));
    await expect(latestRelease({ fetch: async () => new Response('', { status: 403 }) })).rejects.toThrow('rate limits');
    const stalled = async (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    await expect(latestRelease({ fetch: stalled, timeoutMs: 10 })).rejects.toThrow('timed out');
  });
  it('bounds both headers and streaming responses and cancels a stalled body', async () => {
    await expect(latestRelease({ fetch: async () => new Response('{}', {
      headers: { 'content-length': '1048577' },
    }) })).rejects.toThrow('size limit');
    await expect(latestRelease({ fetch: async () => new Response('x'.repeat(1048577)) })).rejects.toThrow('size limit');
    const body = new ReadableStream({ start() {} });
    await expect(latestRelease({ fetch: async () => new Response(body), timeoutMs: 10 })).rejects.toThrow('timed out');
  });
  it('does not accept redirected response metadata, invalid JSON or external cancellation', async () => {
    const response = new Response('{}');
    Object.defineProperty(response, 'redirected', { value: true });
    await expect(latestRelease({ fetch: async () => response })).rejects.toThrow('failed');
    await expect(latestRelease({ fetch: async () => new Response('bad json') })).rejects.toThrow();
    const controller = new AbortController();
    controller.abort();
    await expect(latestRelease({ fetch: async () => new Response('{}'), signal: controller.signal })).rejects.toThrow();
  });
});
