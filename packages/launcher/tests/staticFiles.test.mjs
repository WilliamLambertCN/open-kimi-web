import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  cacheControlFor,
  contentTypeFor,
  resolveStaticPath,
  serveStatic,
} from '../src/staticFiles.mjs';

const ROOT = resolve(join('/', 'srv', 'web'));

describe('contentTypeFor', () => {
  it.each([
    ['index.html', 'text/html; charset=utf-8'],
    ['app.js', 'text/javascript; charset=utf-8'],
    ['app.mjs', 'text/javascript; charset=utf-8'],
    ['app.css', 'text/css; charset=utf-8'],
    ['logo.svg', 'image/svg+xml'],
    ['icon.png', 'image/png'],
    ['font.woff2', 'font/woff2'],
    ['data.json', 'application/json; charset=utf-8'],
    ['favicon.ico', 'image/x-icon'],
    ['weird.xyz', 'application/octet-stream'],
    ['noext', 'application/octet-stream'],
  ])('%s → %s', (file, type) => {
    expect(contentTypeFor(file)).toBe(type);
  });
});

describe('cacheControlFor', () => {
  it('never caches index.html or other html', () => {
    expect(cacheControlFor('/index.html')).toBe('no-cache');
    expect(cacheControlFor('/')).toBe('no-cache');
  });

  it('caches content-hashed assets immutably', () => {
    expect(cacheControlFor('/assets/index-Dq2k9f.js')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(cacheControlFor('/assets/logo-B7x.svg')).toBe('public, max-age=31536000, immutable');
  });

  it('does not immutably cache non-hashed top-level files', () => {
    expect(cacheControlFor('/favicon.svg')).toBe('no-cache');
  });
});

describe('resolveStaticPath', () => {
  it('maps / to index.html', () => {
    expect(resolveStaticPath(ROOT, '/')).toBe(join(ROOT, 'index.html'));
  });

  it('maps nested asset paths under the root', () => {
    expect(resolveStaticPath(ROOT, '/assets/app.js')).toBe(join(ROOT, 'assets', 'app.js'));
  });

  it('ignores query strings', () => {
    expect(resolveStaticPath(ROOT, '/app.js?v=1')).toBe(join(ROOT, 'app.js'));
  });

  it.each(['/../etc/passwd', '/../../secret', '/assets/../../../x', '/%2e%2e/%2e%2e/x'])(
    'refuses traversal %s',
    (p) => {
      expect(resolveStaticPath(ROOT, p)).toBeNull();
    },
  );

  it('refuses malformed percent-encoding', () => {
    expect(resolveStaticPath(ROOT, '/%zz')).toBeNull();
  });

  it.each([
    '/.env',
    '/%2eenv',
    '/.git/config',
    '/assets/app.js.map',
    '/secrets/server.pem',
    '/secrets/server.key',
    '/secrets/client.p12',
    '/secrets/client.pfx',
    '/secrets/server.token',
  ])('refuses hidden paths and sensitive extensions: %s', (path) => {
    expect(resolveStaticPath(ROOT, path)).toBeNull();
  });
});

describe('serveStatic sensitive-file boundary', () => {
  it('rejects existing sensitive files for GET and HEAD without SPA fallback', async () => {
    const root = mkdtempSync(join(tmpdir(), 'open-kimi-static-'));
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, 'assets'));
    mkdirSync(join(root, 'secrets'));
    writeFileSync(join(root, 'index.html'), '<html>spa fallback</html>');
    writeFileSync(join(root, '.env'), 'fixture');
    writeFileSync(join(root, '.git', 'config'), 'fixture');
    writeFileSync(join(root, 'assets', 'app.js.map'), '{}');
    for (const name of ['server.pem', 'server.key', 'client.p12', 'client.pfx', 'server.token']) {
      writeFileSync(join(root, 'secrets', name), 'fixture');
    }
    const server = createServer((req, res) => {
      serveStatic(root, req, res).then((served) => {
        if (!served) res.writeHead(404).end('Not Found');
      });
    });
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const paths = [
        '/.env',
        '/.git/config',
        '/assets/app.js.map',
        '/secrets/server.pem',
        '/secrets/server.key',
        '/secrets/client.p12',
        '/secrets/client.pfx',
        '/secrets/server.token',
      ];
      for (const path of paths) {
        const get = await fetch(base + path);
        expect(get.status, path).toBe(400);
        expect(await get.text(), path).not.toContain('spa fallback');
        const head = await fetch(base + path, { method: 'HEAD' });
        expect(head.status, path).toBe(400);
        expect(await head.text(), path).toBe('');
      }
    } finally {
      await new Promise((resolveClose) => server.close(resolveClose));
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('continues to serve existing JavaScript, CSS, and JSON assets', async () => {
    const root = mkdtempSync(join(tmpdir(), 'open-kimi-static-'));
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'index.html'), '<html>index</html>');
    writeFileSync(join(root, 'assets', 'app.js'), 'export {};');
    writeFileSync(join(root, 'assets', 'app.css'), 'body {}');
    writeFileSync(join(root, 'assets', 'data.json'), '{}');
    const server = createServer((req, res) => {
      serveStatic(root, req, res).then((served) => {
        if (!served) res.writeHead(404).end('Not Found');
      });
    });
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      for (const path of ['/assets/app.js', '/assets/app.css', '/assets/data.json']) {
        expect((await fetch(base + path)).status, path).toBe(200);
      }
    } finally {
      await new Promise((resolveClose) => server.close(resolveClose));
      rmSync(root, { recursive: true, force: true });
    }
  });
});
