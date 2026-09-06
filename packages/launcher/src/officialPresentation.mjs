import { readFile } from 'node:fs/promises';

const PREFIX = '/__open-kimi-mobile/';
const FILES = new Map([
  ['presentation.css', 'text/css; charset=utf-8'],
  ['presentation.js', 'text/javascript; charset=utf-8'],
  ['themes.css', 'text/css; charset=utf-8'],
  ['themes.js', 'text/javascript; charset=utf-8'],
  ['backgrounds/aurora.png', 'image/png'],
  ['backgrounds/twilight.png', 'image/png'],
  ['backgrounds/ember.png', 'image/png'],
  ['backgrounds/mineral.png', 'image/png'],
  ['backgrounds/nocturne.png', 'image/png'],
]);

const SCRIPTS = ['themes.js', 'presentation.js'];
const STYLES = ['presentation.css', 'themes.css'];

// Serve the presentation layer from the installed launcher, so existing
// official caches receive updates without rewriting upstream assets.
export async function servePresentationAsset(req, res) {
  const pathname = (req.url ?? '/').split('?')[0];
  if (!pathname.startsWith(PREFIX)) return false;
  const name = pathname.slice(PREFIX.length);
  const type = FILES.get(name);
  if (!type) {
    res.writeHead(404).end('Not Found');
    return true;
  }
  const body = await readFile(new URL(`./mobile/${name}`, import.meta.url));
  res.writeHead(200, {
    'content-type': type,
    'content-length': body.length,
    'cache-control': 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}

export function addMobilePresentation(html) {
  const scripts = SCRIPTS.map((name) => `<script src="${PREFIX}${name}"></script>`).join('\n') + '\n';
  const moduleTag = /<script\b[^>]*\btype\s*=\s*["']module["'][^>]*>/i;
  const withScript = moduleTag.test(html)
    ? html.replace(moduleTag, (tag) => `${scripts}${tag}`)
    : html.replace('</head>', `${scripts}</head>`);
  const styles = STYLES.map((name) => `<link rel="stylesheet" href="${PREFIX}${name}">`).join('\n') + '\n';
  return withScript.replace('</head>', `${styles}</head>`);
}
