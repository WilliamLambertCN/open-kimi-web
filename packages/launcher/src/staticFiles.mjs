// Static file serving for the resolved official bundle or an explicitly
// supplied directory. Cache policy: index.html and other top-level
// files are never cached; Vite's content-hashed /assets/* are immutable.
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const BLOCKED_EXTENSIONS = new Set(['.map', '.pem', '.key', '.p12', '.pfx', '.token']);

export function contentTypeFor(filePath) {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export function cacheControlFor(urlPath) {
  if (urlPath.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  return 'no-cache';
}

// Resolves a request URL to a path inside rootDir, or null when the path
// would escape the root or the encoding is malformed.
export function resolveStaticPath(rootDir, urlPath) {
  const pathname = urlPath.split('?')[0].split('#')[0];
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const segments = decoded.split(/[\\/]+/).filter(Boolean);
  if (segments.some((segment) => segment.startsWith('.'))) return null;
  if (BLOCKED_EXTENSIONS.has(extname(segments.at(-1) ?? '').toLowerCase())) return null;
  const rel = decoded.replace(/^\/+/, '');
  const root = resolve(rootDir);
  const resolved = resolve(root, rel);
  if (resolved !== root && !resolved.startsWith(root + sep)) return null;
  if (decoded.endsWith('/') || resolved === root) return join(resolved, 'index.html');
  return resolved;
}

// Streams a static file to res with SPA fallback to index.html for unknown
// non-/api, non-/assets GET paths. Returns true when a file was served.
export async function serveStatic(rootDir, req, res, transformHtml) {
  const urlPath = (req.url ?? '/').split('?')[0];
  let filePath = resolveStaticPath(rootDir, req.url ?? '/');
  if (filePath === null) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Bad Request');
    return true;
  }
  let info = await stat(filePath).catch(() => null);
  if (info?.isDirectory()) {
    filePath = join(filePath, 'index.html');
    info = await stat(filePath).catch(() => null);
  }
  if (!info) {
    if (urlPath.startsWith('/assets/')) return false;
    filePath = join(resolve(rootDir), 'index.html');
    info = await stat(filePath).catch(() => null);
    if (!info) return false;
  }
  return sendStaticFile({ filePath, info, urlPath }, req, res, transformHtml);
}

async function sendStaticFile({ filePath, info, urlPath }, req, res, transformHtml) {
  const html = transformHtml && extname(filePath) === '.html'
    ? Buffer.from(transformHtml(await readFile(filePath, 'utf8')))
    : null;
  res.writeHead(200, {
    'content-type': contentTypeFor(filePath),
    'content-length': html?.length ?? info.size,
    'cache-control': cacheControlFor(urlPath),
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  if (html) res.end(html);
  else createReadStream(filePath).pipe(res);
  return true;
}
