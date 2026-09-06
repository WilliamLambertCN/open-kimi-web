// Integration tests for official-bundle mode: a fake upstream answers
// /api/v1/meta, the system tar extracts a real (fixture) npm tarball, and the
// running launcher serves the staged bundle, fails closed when it is
// unavailable. No real network access anywhere.
import { execFile } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startFrontend } from '../../packages/launcher/src/frontend.mjs';

const tar = promisify(execFile);

// The 0.41.0 runtime title composer, byte-for-byte.
const TITLE_SNIPPET = 'function uze(e,t){return e!==""?e:t?`${aze(t)} | Kimi Code`:"Kimi Code"}';
const BOOT_JS = "// upstream boot fixture\nlocalStorage.getItem('kimi-web.color-scheme');\n";
const INDEX_HTML = [
  '<!doctype html><html><head>',
  '<script src="/boot.js"></script>',
  '<script type="module" src="/assets/index-9.9.9.js"></script>',
  '<title>Kimi Code Web</title>',
  '</head><body><div id="app"></div></body></html>',
].join('\n');

let root;
let upstream;
let upstreamUrl;
let tokenFile;
let fixtureTarball;
let lastMetaAuth = null;

function startFakeUpstream() {
  return new Promise((resolveListen) => {
    const server = createServer((req, res) => {
      if (req.url === '/api/v1/meta') {
        lastMetaAuth = req.headers.authorization ?? null;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          code: 0,
          data: { server_version: '9.9.9', capabilities: {} },
        }));
        return;
      }
      res.writeHead(404).end();
    });
    server.listen(0, '127.0.0.1', () => resolveListen(server));
  });
}

async function makeFixtureTarball(version) {
  const staging = join(root, `package-src-${version}`);
  const distWeb = join(staging, 'package', 'dist-web');
  mkdirSync(join(distWeb, 'assets'), { recursive: true });
  writeFileSync(join(distWeb, 'index.html'), INDEX_HTML);
  writeFileSync(join(distWeb, 'boot.js'), BOOT_JS);
  writeFileSync(join(distWeb, 'assets', `index-${version}.js`), TITLE_SNIPPET);
  writeFileSync(join(staging, 'package', 'LICENSE'), 'MIT, Copyright (c) Moonshot AI\n');
  await tar('tar', ['-czf', 'fixture.tgz', 'package'], { cwd: staging });
  copyFileSync(join(staging, 'fixture.tgz'), join(root, `fixture-${version}.tgz`));
  rmSync(staging, { recursive: true, force: true });
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'launcher-official-it-'));
  tokenFile = join(root, 'server.token');
  writeFileSync(tokenFile, 'it-official-token\n');
  upstream = await startFakeUpstream();
  upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  await makeFixtureTarball('9.9.9');
  fixtureTarball = join(root, 'fixture-9.9.9.tgz');
});

afterAll(async () => {
  await new Promise((r) => upstream.close(r));
  rmSync(root, { recursive: true, force: true });
});

function frontendOpts(extra = {}) {
  return {
    target: upstreamUrl,
    host: '127.0.0.1',
    port: 0,
    tokenFile,
    noTokenLink: false,
    officialCacheRoot: join(root, 'official-web'),
    log: () => {},
    warn: () => {},
    ...extra,
  };
}

describe('concurrent official frontends', () => {
  it('shares one cold download and serves both launchers from the completed cache', async () => {
    const officialDownload = vi.fn(async (_url, dest) => {
      await delay(100);
      copyFileSync(fixtureTarball, dest);
    });
    const opts = frontendOpts({ officialDownload, webVersion: '2.0.0' });
    const frontends = await Promise.all([startFrontend(opts), startFrontend(opts)]);
    try {
      expect(officialDownload).toHaveBeenCalledTimes(1);
      for (const frontend of frontends) {
        expect(frontend.publicDir).toBe(join(root, 'official-web', '2.0.0'));
        const response = await fetch(`${frontend.launcher.url}/boot.js`);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(BOOT_JS);
      }
    } finally {
      await Promise.all(frontends.map(({ launcher }) => launcher.close()));
    }
  });
});

async function expectPresentationAssets(baseUrl) {
  for (const name of [
    'presentation.css',
    'presentation.js',
    'themes.css',
    'themes.js',
    'backgrounds/aurora.png',
    'backgrounds/twilight.png',
    'backgrounds/ember.png',
    'backgrounds/mineral.png',
    'backgrounds/nocturne.png',
  ]) {
    const url = `${baseUrl}/__open-kimi-mobile/${name}`;
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-cache');
    const body = name.endsWith('.png') ? await response.arrayBuffer() : await response.text();
    if (name.endsWith('.png')) {
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(Number(response.headers.get('content-length'))).toBeGreaterThan(0);
      expect(body.byteLength).toBe(Number(response.headers.get('content-length')));
    }
    if (name === 'presentation.js') {
      expect(body).toContain("document.querySelector('.side .ch-brand .ch-name')");
      expect(body).toContain("label.textContent = 'OPEN-KIMI-WEB'");
    }
    if (name === 'themes.css') {
      for (const theme of ['aurora', 'twilight', 'ember', 'mineral', 'nocturne']) {
        expect(body).toContain(`html[data-okw-theme='${theme}']`);
      }
    }
    const head = await fetch(url, { method: 'HEAD' });
    expect(head.headers.get('content-length')).toBe(response.headers.get('content-length'));
    expect(await head.text()).toBe('');
  }
  const missing = await fetch(`${baseUrl}/__open-kimi-mobile/missing.js`);
  expect(missing.status).toBe(404);
}

describe('official mode end-to-end', () => {
  it('downloads (via injection), patches titles, and serves the official bundle', async () => {
    const log = vi.fn();
    const warn = vi.fn();
    const officialDownload = async (_url, dest) => copyFileSync(fixtureTarball, dest);
    const { launcher, publicDir } = await startFrontend(frontendOpts({ log, warn, officialDownload }));
    try {
      expect(publicDir).toBe(join(root, 'official-web', '9.9.9'));
      expect(lastMetaAuth).toBe('Bearer it-official-token');
      expect(log).toHaveBeenCalledWith('web UI: official 9.9.9 (downloaded)');

      const index = await fetch(`${launcher.url}/`);
      const indexText = await index.text();
      expect(index.status).toBe(200);
      expect(indexText).toContain('<title>open Kimi-Code web</title>');
      expect(indexText).not.toContain('Kimi Code Web');
      expect(indexText).toContain('/__open-kimi-mobile/presentation.css');
      expect(indexText).toContain('/__open-kimi-mobile/presentation.js');
      expect(indexText).toContain('/__open-kimi-mobile/themes.css');
      expect(indexText).toContain('/__open-kimi-mobile/themes.js');
      expect(indexText.indexOf('presentation.css')).toBeLessThan(indexText.indexOf('themes.css'));
      expect(indexText.indexOf('themes.js')).toBeLessThan(indexText.indexOf('<script type="module"'));
      expect(indexText.indexOf('presentation.js')).toBeLessThan(indexText.indexOf('<script type="module"'));
      expect(Number(index.headers.get('content-length'))).toBe(Buffer.byteLength(indexText));

      const boot = await fetch(`${launcher.url}/boot.js`);
      expect(boot.status).toBe(200);
      expect(await boot.text()).toBe(BOOT_JS);

      const asset = await fetch(`${launcher.url}/assets/index-9.9.9.js`);
      expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      const assetText = await asset.text();
      expect(assetText).toContain(' | open Kimi-Code');
      expect(assetText).not.toContain('Kimi Code');

      const spa = await fetch(`${launcher.url}/session/abc`);
      expect(spa.status).toBe(200);
      expect(await spa.text()).toContain('<title>open Kimi-Code web</title>');
    } finally {
      await launcher.close();
    }
  });

  it('uses the cache on a second start without downloading again', async () => {
    const log = vi.fn();
    const officialDownload = vi.fn(async () => {
      throw new Error('must not be called on a cache hit');
    });
    const { launcher } = await startFrontend(frontendOpts({ log, officialDownload }));
    try {
      expect(officialDownload).not.toHaveBeenCalled();
      expect(log.mock.calls.some(([line]) => line.includes('(cached)'))).toBe(true);
      const index = await fetch(`${launcher.url}/session/abc`);
      expect(await index.text()).toContain('/__open-kimi-mobile/presentation.css');
      await expectPresentationAssets(launcher.url);
    } finally {
      await launcher.close();
    }
  });

  it('fails with recovery instructions when the official download fails', async () => {
    const warn = vi.fn();
    const officialDownload = async () => {
      throw new Error('curl: (6) could not resolve host');
    };
    // A version no earlier test has cached, so the download really runs.
    await expect(startFrontend(
      frontendOpts({ warn, officialDownload, webVersion: '1.0.0' }),
    )).rejects.toThrow(
      /official web UI 1\.0\.0 is unavailable:[\s\S]*could not resolve host[\s\S]*curl and tar/,
    );
  });
});
