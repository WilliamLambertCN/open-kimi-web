import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

describe('serveStatic realpath boundary', () => {
  it('serves links within the root but refuses outside and broken directory links', async () => {
    const root = mkdtempSync(join(tmpdir(), 'open-kimi-static-'));
    const outside = mkdtempSync(join(tmpdir(), 'open-kimi-outside-'));
    mkdirSync(join(root, 'assets'));
    mkdirSync(join(outside, 'removed'));
    writeFileSync(join(root, 'index.html'), '<html>spa fallback</html>');
    writeFileSync(join(root, 'assets', 'app.js'), 'export {};');
    writeFileSync(join(outside, 'secret.txt'), 'outside fixture');
    symlinkSync(join(root, 'assets'), join(root, 'inside'), process.platform === 'win32' ? 'junction' : 'dir');
    symlinkSync(outside, join(root, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
    symlinkSync(join(outside, 'removed'), join(root, 'broken'), process.platform === 'win32' ? 'junction' : 'dir');
    rmSync(join(outside, 'removed'), { recursive: true });
    const server = createServer((req, res) => {
      serveStatic(root, req, res).then((served) => {
        if (!served) res.writeHead(404).end('Not Found');
      });
    });
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      expect((await fetch(`${base}/inside/app.js`)).status).toBe(200);
      expect(await (await fetch(`${base}/client-route`)).text()).toContain('spa fallback');
      for (const path of ['/outside/secret.txt', '/outside/missing.txt', '/broken/secret.txt']) {
        const response = await fetch(base + path);
        expect(response.status, path).toBe(404);
        expect(await response.text(), path).toBe('Not Found');
      }
    } finally {
      await new Promise((resolveClose) => server.close(resolveClose));
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses an SPA fallback index that resolves outside the root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'open-kimi-static-'));
    const outside = mkdtempSync(join(tmpdir(), 'open-kimi-outside-'));
    writeFileSync(join(outside, 'index.html'), '<html>outside fixture</html>');
    symlinkSync(outside, join(root, 'index.html'), process.platform === 'win32' ? 'junction' : 'dir');
    const server = createServer((req, res) => {
      serveStatic(root, req, res).then((served) => {
        if (!served) res.writeHead(404).end('Not Found');
      });
    });
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const response = await fetch(`${base}/client-route`);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('Not Found');
    } finally {
      await new Promise((resolveClose) => server.close(resolveClose));
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('serveStatic realpath sensitive-file boundary', () => {
  it('refuses in-root aliases to hidden paths and sensitive extensions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'open-kimi-static-'));
    mkdirSync(join(root, '.private'));
    mkdirSync(join(root, 'certificate.pem'));
    writeFileSync(join(root, 'index.html'), '<html>spa fallback</html>');
    writeFileSync(join(root, '.private', 'data.json'), '{}');
    writeFileSync(join(root, 'certificate.pem', 'index.html'), '<html>private</html>');
    symlinkSync(join(root, '.private'), join(root, 'public-data'), process.platform === 'win32' ? 'junction' : 'dir');
    symlinkSync(join(root, 'certificate.pem'), join(root, 'public-cert'), process.platform === 'win32' ? 'junction' : 'dir');

    const refused = ['/public-data/data.json', '/public-data/missing.json', '/public-cert'];
    try {
      writeFileSync(join(root, 'server.pem'), 'private fixture');
      symlinkSync(join(root, 'server.pem'), join(root, 'public.txt'), 'file');
      refused.push('/public.txt');
    } catch (error) {
      if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error;
    }

    const server = createServer((req, res) => {
      serveStatic(root, req, res).then((served) => {
        if (!served) res.writeHead(404).end('Not Found');
      });
    });
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      for (const path of refused) {
        const response = await fetch(base + path);
        expect(response.status, path).toBe(404);
        expect(await response.text(), path).toBe('Not Found');
      }
    } finally {
      await new Promise((resolveClose) => server.close(resolveClose));
      rmSync(root, { recursive: true, force: true });
    }
  });
});
