import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLauncher } from '../../packages/launcher/src/serve.mjs';

let directory;
let launcher;
const prefix = '/__open-kimi-mobile/';
const html = '<html><head><meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">' +
  '<script type="module" src="/app.js"></script></head><body>Fictional app</body></html>';
const options = () => ({ target: 'http://127.0.0.1:1', publicDir: directory, host: '127.0.0.1', port: 0,
  interfaces: [], officialPresentation: true, officialWebVersion: '2.4.1' });
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'okw-pwa-'));
  await writeFile(join(directory, 'index.html'), html);
  launcher = await createLauncher(options());
});
afterAll(async () => {
  await launcher?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('PWA public installation assets', () => {
  it('injects install assets on root and deep routes without retaining request details', async () => {
    for (const path of ['/', '/sessions/fictional?token=fictional-only']) {
      const response = await fetch(launcher.url + path);
      const index = await response.text();
      expect(index).toContain(`<link rel="manifest" href="${prefix}manifest.webmanifest">`);
      expect(index).toContain(`<link rel="apple-touch-icon" sizes="180x180" href="${prefix}icons/apple-touch-180.png">`);
      expect(index).toContain('<meta name="apple-mobile-web-app-capable" content="yes">');
      expect(index).toContain('<meta name="apple-mobile-web-app-title" content="Open Kimi Web">');
      expect(index).toContain('<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">');
      expect(index).not.toContain('fictional-only');
      expect(index).not.toContain('/sessions/fictional');
      expect(index.indexOf('pwaInstallView.js')).toBeLessThan(index.indexOf('pwaInstall.js'));
      expect(index.indexOf('pwaInstall.js')).toBeLessThan(index.indexOf('<script type="module"'));
      expect(index.indexOf('pwaInstall.js')).toBeGreaterThan(index.indexOf('usageBundle.js'));
    }
  });
  it('serves an anonymous stable manifest with clean same-origin startup and PNG icons', async () => {
    const response = await fetch(launcher.url + prefix + 'manifest.webmanifest?token=fictional-only');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/manifest+json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    const manifest = await response.json();
    expect(manifest).toEqual({ id: '/', name: 'Open Kimi Web', short_name: 'Open Kimi Web', start_url: '/', scope: '/',
      display: 'standalone', background_color: '#d5fafc', theme_color: '#d5fafc', prefer_related_applications: false,
      icons: [...[192, 512].map((size) => ({ src: `${prefix}icons/app-${size}.png`, sizes: `${size}x${size}`,
        type: 'image/png', purpose: 'any' })),
      { src: `${prefix}icons/app-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }] });
    const clean = await fetch(launcher.url + prefix + 'manifest.webmanifest').then((value) => value.json());
    expect(clean).toEqual(manifest);
  });
  it.each([[192, 'app-192'], [512, 'app-512'], [512, 'app-maskable-512'], [180, 'apple-touch-180']])(
    'serves a valid %i pixel %s icon', async (size, name) => {
      const url = launcher.url + prefix + `icons/${name}.png`;
      const response = await fetch(url);
      expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('image/png');
      expect(response.headers.get('cache-control')).toBe('no-cache');
      const image = Buffer.from(await response.arrayBuffer());
      expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(image.readUInt32BE(16)).toBe(size); expect(image.readUInt32BE(20)).toBe(size);
      expect(image[25]).toBe(2);
      const head = await fetch(url, { method: 'HEAD' });
      expect(Number(head.headers.get('content-length'))).toBe(image.length); expect(await head.text()).toBe('');
    });
  it('keeps private paths, arbitrary resources and write methods out of the asset route', async () => {
    for (const path of ['sw.js', 'icons/app.svg', 'icons/private.png', 'manifest.webmanifest/extra']) {
      expect((await fetch(launcher.url + prefix + path)).status).toBe(404);
    }
    const response = await fetch(launcher.url + prefix + 'manifest.webmanifest', { method: 'POST' });
    expect(response.status).toBe(405); expect(response.headers.get('allow')).toBe('GET, HEAD');
  });
  it('does not replace custom frontend installation metadata or expose OKW installation files', async () => {
    const custom = '<html><head><link rel="manifest" href="/custom.webmanifest"></head><body>Custom</body></html>';
    await writeFile(join(directory, 'index.html'), custom);
    await writeFile(join(directory, 'custom.webmanifest'), '{"name":"Custom"}');
    const separate = await createLauncher({ ...options(), officialPresentation: false });
    try {
      expect(await fetch(separate.url).then((response) => response.text())).toBe(custom);
      expect(await fetch(separate.url + '/custom.webmanifest').then((response) => response.json()))
        .toEqual({ name: 'Custom' });
      const response = await fetch(separate.url + prefix + 'manifest.webmanifest');
      expect(response.headers.get('content-type')).not.toContain('manifest+json');
      expect(await response.text()).not.toContain('Open Kimi Web');
    } finally { await separate.close(); await writeFile(join(directory, 'index.html'), html); }
  });
});
