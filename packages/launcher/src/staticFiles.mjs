// Static file serving for the resolved official bundle or an explicitly
// supplied directory. Cache policy: index.html and other top-level
// files are never cached; Vite's content-hashed /assets/* are immutable.
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

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

function isSensitivePath(filePath) {
  const segments = filePath.split(/[\\/]+/).filter(Boolean);
  return segments.some((segment) => segment.startsWith('.')) ||
    BLOCKED_EXTENSIONS.has(extname(segments.at(-1) ?? '').toLowerCase());
}

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
  if (isSensitivePath(decoded)) return null;
  const rel = decoded.replace(/^\/+/, '');
  const root = resolve(rootDir);
  const resolved = resolve(root, rel);
  if (resolved !== root && !resolved.startsWith(root + sep)) return null;
  if (decoded.endsWith('/') || resolved === root) return join(resolved, 'index.html');
  return resolved;
}

function isWithin(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function isMissing(error) {
  return error?.code === 'ENOENT' || error?.code === 'ENOTDIR';
}

// A missing child below an outside or broken symlink is unsafe, not an SPA
// route. Walk back to the first existing ancestor so both cases stay 404.
async function missingPathIsSafe(root, rootReal, filePath) {
  let current = dirname(filePath);
  while (isWithin(root, current)) {
    try {
      await lstat(current);
    } catch (error) {
      if (!isMissing(error)) return false;
      if (current === root) break;
      current = dirname(current);
      continue;
    }
    const currentReal = await realpath(current).catch(() => null);
    return currentReal !== null && isWithin(rootReal, currentReal) &&
      !isSensitivePath(relative(rootReal, currentReal));
  }
  return false;
}

async function resolveRealStaticPath(root, rootReal, filePath) {
  try {
    await lstat(filePath);
  } catch (error) {
    if (!isMissing(error) || !(await missingPathIsSafe(root, rootReal, filePath))) {
      return { kind: 'unsafe' };
    }
    return { kind: 'missing' };
  }

  const fileReal = await realpath(filePath).catch(() => null);
  if (fileReal === null || !isWithin(rootReal, fileReal) ||
      isSensitivePath(relative(rootReal, fileReal))) return { kind: 'unsafe' };
  const info = await stat(fileReal).catch(() => null);
  if (info === null) return { kind: 'unsafe' };
  return { kind: 'found', filePath: fileReal, info };
}

async function resolveRealStaticFile(root, rootReal, filePath) {
  let result = await resolveRealStaticPath(root, rootReal, filePath);
  if (result.kind !== 'found' || !result.info.isDirectory()) return result;
  result = await resolveRealStaticPath(root, rootReal, join(filePath, 'index.html'));
  if (result.kind === 'found' && result.info.isDirectory()) return { kind: 'unsafe' };
  return result;
}

// Streams a static file to res with SPA fallback to index.html for unknown
// non-/api, non-/assets GET paths. Returns true when a file was served.
export async function serveStatic(rootDir, req, res, transformHtml) {
  const urlPath = (req.url ?? '/').split('?')[0];
  const root = resolve(rootDir);
  const rootReal = await realpath(root).catch(() => null);
  if (rootReal === null) return false;

  const requestedPath = resolveStaticPath(root, req.url ?? '/');
  if (requestedPath === null) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Bad Request');
    return true;
  }

  let resolved = await resolveRealStaticFile(root, rootReal, requestedPath);
  if (resolved.kind === 'unsafe') return false;
  if (resolved.kind === 'missing') {
    if (urlPath.startsWith('/assets/')) return false;
    resolved = await resolveRealStaticFile(root, rootReal, join(root, 'index.html'));
    if (resolved.kind !== 'found') return false;
  }
  return sendStaticFile({ filePath: resolved.filePath, info: resolved.info, urlPath }, req, res, transformHtml);
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
