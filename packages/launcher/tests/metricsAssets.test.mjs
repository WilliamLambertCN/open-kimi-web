import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { metricsHtml, metricsPresentationState, metricsStartupMessage, prepareMetricsAssets } from '../src/metricsAssets.mjs';
import { addMobilePresentation } from '../src/officialPresentation.mjs';
import { METRICS_ASSET_PREFIX as prefix } from '../src/officialRequestMetrics.mjs';
import { nativeTimingFixture as source } from './testkit/officialRequestMetrics.mjs';

const html = '<head><script src="/boot.js"></script><script crossorigin type="module" src="/assets/main.js"></script></head>';
let root; let publicDir;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'okw-metrics-prepare-')); publicDir = join(root, 'public');
  await mkdir(join(publicDir, 'assets'), { recursive: true });
  await writeFile(join(publicDir, 'index.html'), html);
  await writeFile(join(publicDir, 'assets/main.js'), source);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const index = (body) => writeFile(join(publicDir, 'index.html'), body);
const prepare = () => prepareMetricsAssets(publicDir, true);

describe('verified official metrics assets', () => {
  it('validates the actual module rather than the boot script and retains the complete patched representation', async () => {
    const result = await prepare();
    expect(result).toMatchObject({ state: 'active', index: html, original: source });
    expect(result.patched).toContain('__okwTimingSlots');
    expect(result.file.endsWith('main.js')).toBe(true);
    expect(metricsHtml(html, result)).toContain(`src="${prefix}/assets/main.js"`);
    expect(() => metricsHtml(html + 'changed', result)).toThrow('official bundle changed');
  });
  it('does not inspect or rewrite custom directories', async () => {
    expect(await prepareMetricsAssets(join(root, 'missing'), false)).toEqual({ state: 'disabled' });
    expect(metricsHtml(html)).toBe(html);
    expect(metricsHtml(html, { state: 'incompatible-bundle' })).toBe(html);
  });
  it('accepts relative paths, reversed attributes and single quotes without a fixed filename', async () => {
    await index("<head><script src='assets/main.js' type='module'></script></head>");
    expect((await prepare()).state).toBe('active');
  });
  it.each([
    '<head></head>', '<script type="module" src="/outside.js"></script>',
    '<script type="module" src="https://example.invalid/assets/main.js"></script>',
    '<script type="module" src="/assets/main.js?build=1"></script>',
    '<script type="module" src="/assets/main.js#build"></script>',
    '<script type="module">import("/assets/main.js")</script>',
    html + '<script type="module" src="/assets/main.js"></script>',
  ])('leaves a missing or ambiguous module graph untouched: %s', async (body) => {
    await index(body); expect(await prepare()).toEqual({ state: 'incompatible-bundle' });
  });
  it('rejects an incomplete semantic contract atomically instead of checking just a marker', async () => {
    await writeFile(join(publicDir, 'assets/main.js'), source.replace('stepDebug||', 'stepDebug&&'));
    expect(await prepare()).toEqual({ state: 'incompatible-bundle' });
  });
});

describe('bundle read safety', () => {
  it('handles missing directories, modules and non-file sources without exposing a raw error', async () => {
    expect(await prepareMetricsAssets(join(root, 'missing'), true)).toEqual({ state: 'unavailable-bundle' });
    await rm(join(publicDir, 'assets/main.js'));
    expect(await prepare()).toEqual({ state: 'unavailable-bundle' });
    await mkdir(join(publicDir, 'assets/main.js'));
    expect(await prepare()).toEqual({ state: 'unavailable-bundle' });
  });
  it('bounds source reads before loading oversized files', async () => {
    await truncate(join(publicDir, 'assets/main.js'), 16 * 1024 * 1024 + 1);
    expect(await prepare()).toEqual({ state: 'unavailable-bundle' });
  });
  it.each(['/assets/%GG.js', '/assets/%2e%2e/%2e%2e/outside.js', '/assets/.hidden.js'])(
    'rejects unsafe module %s', async (path) => {
      await index(`<script type="module" src="${path}"></script>`);
      expect(await prepare()).toEqual({ state: 'unavailable-bundle' });
    });
  it.each(['outside', '.hidden'])('rejects real paths outside the public or visible tree: %s', async (name) => {
    const dir = name === 'outside' ? join(root, name) : join(publicDir, name);
    await mkdir(dir); await writeFile(join(dir, 'main.js'), source);
    await symlink(dir, join(publicDir, 'assets/linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await index('<script type="module" src="/assets/linked/main.js"></script>');
    expect(await prepare()).toEqual({ state: 'unavailable-bundle' });
  });
});

describe('metrics availability reporting', () => {
  it('prints a fixed structural result without a version restriction or private file information', () => {
    expect(metricsPresentationState()).toBe('disabled');
    expect(metricsStartupMessage()).toBeNull();
    expect(metricsStartupMessage({ state: 'active' })).toContain('no version restriction');
    for (const state of ['incompatible-bundle', 'unavailable-bundle']) {
      expect(metricsStartupMessage({ state })).toBe(`request metrics: unavailable (${state}); original official UI retained`);
    }
  });
  it('only writes verified fixed states into page metadata and does not rewrite assets on its own', () => {
    for (const state of ['active', 'incompatible-bundle', 'unavailable-bundle']) {
      const page = addMobilePresentation(html, { requestMetricsState: state });
      expect(page).toContain(`<meta name="open-kimi-web-request-metrics" content="${state}">`);
      expect(page).toContain('src="/assets/main.js"');
    }
    const page = addMobilePresentation(html, { requestMetricsState: '"><script>fictional</script>' });
    expect(page).not.toContain('open-kimi-web-request-metrics');
    expect(page).not.toContain('<script>fictional</script>');
  });
});
