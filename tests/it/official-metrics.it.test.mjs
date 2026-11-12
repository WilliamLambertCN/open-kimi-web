import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLauncher } from '../../packages/launcher/src/serve.mjs';
import { METRICS_ASSET_PREFIX as prefix } from '../../packages/launcher/src/officialRequestMetrics.mjs';
import { fixturePrelude, nativeTimingFixture } from '../../packages/launcher/tests/testkit/officialRequestMetrics.mjs';

const source = fixturePrelude + nativeTimingFixture + '\nexport const preloads=["assets/part.js"];' +
  '\nexport const load=()=>import("./part.js");\nexport const absolute=()=>import("/assets/part.js");';
const html = '<html><head><script type="module" src="/assets/main.js"></script>' +
  '<link rel="stylesheet" href="/assets/main.css"></head><body>Fictional application</body></html>';
const css = '@font-face{src:url(/assets/font.woff2)}.demo{background:url("./image.png")}';
let root; let publicDir; let launcher;

function raw(path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(launcher.url, { path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.once('error', reject); req.end();
  });
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'okw-metrics-assets-')); publicDir = join(root, 'public');
  const assets = join(publicDir, 'assets'); const outside = join(root, 'outside');
  await mkdir(assets, { recursive: true }); await mkdir(outside);
  for (const [name, body] of Object.entries({ 'index.html': html, 'assets/main.js': source,
    'assets/main.css': css, 'assets/part.js': 'export const sample="Fictional chunk";',
    'assets/font.woff2': Buffer.from([0, 1, 2, 3]), 'assets/image.png': Buffer.from([4, 5, 6]),
    'assets/private.map': 'Fictional sourcemap', 'assets/.hidden': 'Fictional hidden file' })) {
    await writeFile(join(publicDir, name), body);
  }
  await writeFile(join(outside, 'external.js'), 'Fictional external file');
  await symlink(outside, join(assets, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
  launcher = await createLauncher({ publicDir, target: 'http://127.0.0.1:1', host: '127.0.0.1', port: 0,
    interfaces: {}, officialPresentation: true, officialWebVersion: '2.5.2' });
});
afterAll(async () => { await launcher?.close(); await rm(root, { recursive: true, force: true }); });

describe('official step metrics static delivery', () => {
  it('rewrites the entry and patches only the revisioned representation, leaving the official files unchanged', async () => {
    const index = await raw('/');
    expect(index.status).toBe(200);
    expect(index.body.toString()).toContain(`src="${prefix}/assets/main.js"`);
    expect(index.body.toString()).toContain(`href="${prefix}/assets/main.css"`);
    const original = await raw('/assets/main.js'); expect(original.body.toString()).toBe(source);
    const result = await raw(`${prefix}/assets/main.js?revision=fixture`); const text = result.body.toString();
    expect(result.status).toBe(200); expect(result.headers['content-type']).toContain('text/javascript');
    expect(result.headers['cache-control']).toContain('immutable');
    expect(result.headers['x-content-type-options']).toBe('nosniff');
    expect(text).toContain('"data-okw-step-id":O.stepId');
    expect(text).toContain(`preloads=["${prefix.slice(1)}/assets/part.js"]`);
    expect(text).toContain('import("./part.js")'); expect(text).toContain(`import("${prefix}/assets/part.js")`);
    await import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`);
    expect(await readFile(join(publicDir, 'assets/main.js'), 'utf8')).toBe(source);
  });
  it('keeps dependent modules, CSS fonts and images in the same namespace and streams binary assets intact', async () => {
    const chunk = await raw(`${prefix}/assets/part.js`);
    expect(chunk.status).toBe(200); expect(chunk.body.toString()).toBe('export const sample="Fictional chunk";');
    const style = await raw(`${prefix}/assets/main.css`);
    expect(style.headers['content-type']).toContain('text/css');
    expect(style.body.toString()).toContain(`url(${prefix}/assets/font.woff2)`);
    expect(style.body.toString()).toContain('url("./image.png")');
    expect((await raw(`${prefix}/assets/font.woff2`)).body).toEqual(Buffer.from([0, 1, 2, 3]));
    expect((await raw(`${prefix}/assets/image.png`)).body).toEqual(Buffer.from([4, 5, 6]));
  });
  it('returns transformed byte lengths for HEAD and compresses the transformed JavaScript for GET', async () => {
    const get = await raw(`${prefix}/assets/main.js`);
    const head = await raw(`${prefix}/assets/main.js`, { method: 'HEAD', headers: { 'accept-encoding': 'gzip' } });
    expect(Number(get.headers['content-length'])).toBe(get.body.length);
    expect(head.status).toBe(200); expect(head.body.length).toBe(0);
    expect(head.headers['content-length']).toBe(String(get.body.length));
    const gzip = await raw(`${prefix}/assets/main.js`, { headers: { 'accept-encoding': 'gzip' } });
    expect(gzip.headers['content-encoding']).toBe('gzip'); expect(gunzipSync(gzip.body)).toEqual(get.body);
  });
  it.each(['/assets/missing.js', '/assets/private.map', '/assets/.hidden', '/assets/external/external.js',
    '/assets/external/missing.js', '/not-assets/main.js', ''])('does not fall back to application HTML for %s', async (path) => {
    const result = await raw(prefix + path);
    expect([400, 404]).toContain(result.status); expect(result.body.toString()).not.toContain('<html');
    expect(result.body.toString()).not.toContain('Fictional');
  });
  it.each(['/assets/%GG', '/assets/%2e%2e/index.html', '/assets/%2e%2e%2f%2e%2e/outside/external.js'])(
    'rejects malformed and escaping paths %s before serving any bytes', async (path) => {
      const result = await raw(prefix + path); expect(result.status).toBe(400);
      expect(result.body.toString()).toBe('Bad Request');
    });
  it('leaves custom web directories and other official versions on their original module graph', async () => {
    for (const options of [{ officialPresentation: false, officialWebVersion: '2.5.2' },
      { officialPresentation: true, officialWebVersion: '2.4.1' }]) {
      const other = await createLauncher({ publicDir, target: 'http://127.0.0.1:1', host: '127.0.0.1', port: 0,
        interfaces: {}, ...options });
      try {
        const index = await (await fetch(other.url)).text();
        expect(index).toContain('src="/assets/main.js"'); expect(index).not.toContain(prefix);
        expect(await (await fetch(other.url + '/assets/main.js')).text()).toBe(source);
      } finally { await other.close(); }
    }
  });
});
