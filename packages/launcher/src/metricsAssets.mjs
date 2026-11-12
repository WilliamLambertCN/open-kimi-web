import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, sep } from 'node:path';
import { METRICS_ASSET_PREFIX, metricsAssetPaths, patchOfficialRequestMetrics } from './officialRequestMetrics.mjs';
import { resolveStaticPath, serveStatic } from './staticFiles.mjs';

const SOURCE_LIMIT = 16 * 1024 * 1024;

async function readBundleFile(root, urlPath) {
  const requested = resolveStaticPath(root, urlPath);
  if (!requested) throw new Error('unsafe-bundle');
  const file = await realpath(requested);
  const rel = relative(root, file);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`) ||
      !resolveStaticPath(root, '/' + rel.split(sep).join('/'))) throw new Error('unsafe-bundle');
  const info = await stat(file);
  if (!info.isFile() || info.size > SOURCE_LIMIT) throw new Error('unavailable-bundle');
  return { file, text: await readFile(file, 'utf8') };
}

function moduleEntry(html) {
  const modules = [...html.matchAll(/<script\b[^>]*>/gi)].map(([tag]) => tag)
    .filter((tag) => /\btype\s*=\s*["']module["']/i.test(tag));
  if (modules.length !== 1) return null;
  const src = modules[0].match(/\bsrc\s*=\s*(["'])([^"']+)\1/i)?.[2];
  return /^\/?assets\/[^?#]+\.js$/.test(src ?? '') ? '/' + src.replace(/^\//, '') : null;
}

export async function prepareMetricsAssets(publicDir, enabled) {
  if (!enabled) return { state: 'disabled' };
  try {
    const root = await realpath(publicDir);
    const index = await readBundleFile(root, '/index.html');
    const entry = moduleEntry(index.text);
    if (!entry) return { state: 'incompatible-bundle' };
    const source = await readBundleFile(root, entry);
    const result = patchOfficialRequestMetrics(source.text);
    return result.patched ? { state: 'active', index: index.text, entry, file: source.file,
      original: source.text, patched: result.text } : { state: 'incompatible-bundle' };
  } catch {
    return { state: 'unavailable-bundle' };
  }
}

export function metricsPresentationState(metrics) {
  return metrics?.state ?? 'disabled';
}

export function metricsStartupMessage(metrics) {
  const state = metricsPresentationState(metrics);
  if (state === 'disabled') return null;
  return state === 'active' ? 'request metrics: active (bundle structure verified; no version restriction)' :
    `request metrics: unavailable (${state}); original official UI retained`;
}

export function metricsHtml(html, metrics) {
  if (metricsPresentationState(metrics) !== 'active') return html;
  if (html !== metrics.index) throw new Error('official bundle changed; restart the launcher');
  return metricsAssetPaths(html);
}

export async function serveMetricsAssets(req, res, { publicDir, metrics }) {
  const path = (req.url ?? '').split('?')[0];
  if (path !== METRICS_ASSET_PREFIX && !path.startsWith(`${METRICS_ASSET_PREFIX}/`)) return false;
  const transformAsset = (source, file) => {
    if (path.slice(METRICS_ASSET_PREFIX.length) === metrics.entry || file === metrics.file) {
      if (file !== metrics.file || source !== metrics.original) throw new Error('official bundle changed; restart the launcher');
      return metricsAssetPaths(metrics.patched);
    }
    return metricsAssetPaths(source);
  };
  if (metricsPresentationState(metrics) === 'active' && path.startsWith(`${METRICS_ASSET_PREFIX}/assets/`) &&
      await serveStatic(publicDir, req, res, undefined, {
        urlPath: path.slice(METRICS_ASSET_PREFIX.length),
        transformAsset: (source, file) => ['.js', '.css'].includes(extname(file)) ? transformAsset(source, file) : source,
      })) return true;
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' }).end('Not Found');
  return true;
}
