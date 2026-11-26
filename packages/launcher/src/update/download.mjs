import { Agent, request } from 'node:https';
import { proxyArchiveUrl, REPOSITORY } from './downloadProxy.mjs';

const API = 'https://api.github.com/repos/WilliamLambertCN/open-kimi-web/releases';
const OFFICIAL = 'https://registry.npmjs.org/@moonshot-ai/kimi-code/-/kimi-code-2.8.0.tgz';
const GITHUB_CDN = new Set(['https://release-assets.githubusercontent.com', 'https://objects.githubusercontent.com']);

function allowedDownload(url, metadata) {
  const plain = url.href === url.origin + url.pathname;
  if (metadata) return plain && url.href.startsWith(`${API}/`);
  return url.href === OFFICIAL || GITHUB_CDN.has(url.origin) ||
    plain && url.href.startsWith(`${REPOSITORY}/releases/download/`);
}

export function assertDownloadUrl(value, metadata = false) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.href !== value || [url.username, url.password, url.hash].some(Boolean) ||
      /[%\\]/.test(url.pathname)) throw new Error('unsafe HTTPS download URL');
  if (!allowedDownload(url, metadata)) throw new Error('download host/path is not allowed');
  return url;
}

function assertRequestUrl(url, { metadata, proxyVersion, env }) {
  if (!proxyVersion) return assertDownloadUrl(url, metadata);
  const allowed = proxyArchiveUrl(proxyVersion, env);
  if (!allowed || metadata || url !== allowed) {
    throw new Error('download host/path is not allowed for the selected release archive');
  }
}

function redirectUrl(res, url, context, redirects) {
  if (context.metadata || context.proxyVersion || url === OFFICIAL || redirects >= 4 || !res.headers.location) {
    throw new Error('download redirect refused');
  }
  try {
    const raw = res.headers.location;
    const next = new URL(raw, url).href;
    if (raw.includes('\\') || /^https:\/\//i.test(raw) && raw !== next) throw new Error();
    return assertDownloadUrl(next).href;
  } catch { throw new Error('download redirect refused'); }
}

function collectResponse(res, limit, finish) {
  if (Number(res.headers['content-length']) > limit) { finish(new Error('download exceeds size limit')); return; }
  const chunks = [];
  let bytes = 0;
  res.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > limit) finish(new Error('download exceeds size limit'));
    else chunks.push(chunk);
  });
  res.once('end', () => {
    if (!res.complete) finish(new Error('download response interrupted'));
    else finish(null, { bytes: Buffer.concat(chunks) });
  });
}

function requestResponse(url, context, redirects) {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const cancel = () => finish(context.signal.reason);
    const idle = () => finish(new Error('download idle timeout'));
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      context.signal.removeEventListener('abort', cancel);
      req.setTimeout(0);
      req.removeListener('timeout', idle);
      if (error) { reject(error); req.destroy(); }
      else resolvePromise(result);
    };
    const accept = context.metadata ? 'application/vnd.github+json' : 'application/octet-stream';
    const req = context.request(url, { agent: context.agent, headers: {
      Accept: accept, 'User-Agent': 'open-kimi-web-install',
    } }, (res) => {
      const interrupted = () => finish(new Error('download response interrupted'));
      res.once('error', interrupted);
      res.once('aborted', interrupted);
      res.once('close', () => { if (!res.complete) interrupted(); });
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();
        try { finish(null, { next: redirectUrl(res, url, context, redirects) }); }
        catch (error) { finish(error); }
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        finish(new Error(`download failed (HTTP ${res.statusCode})`));
        return;
      }
      collectResponse(res, context.limit, finish);
    });
    req.once('error', () => finish(new Error('HTTPS download failed; check network/proxy and certificate trust')));
    req.once('close', () => { if (!settled) finish(new Error('download response interrupted')); });
    req.setTimeout(context.idleTimeoutMs);
    req.once('timeout', idle);
    context.signal.addEventListener('abort', cancel, { once: true });
    if (context.signal.aborted) cancel();
    else req.end();
  });
}

async function requestBytes(url, context, redirects) {
  context.signal.throwIfAborted();
  assertRequestUrl(url, context);
  const response = await requestResponse(url, context, redirects);
  return response.next ? requestBytes(response.next, context, redirects + 1) : response.bytes;
}

export async function downloadBytes(url, options = {}) {
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  const env = options.env ?? process.env;
  const agent = (options.agentFactory ?? ((settings) => new Agent(settings)))({ proxyEnv: env, rejectUnauthorized: true });
  const timer = setTimeout(() => controller.abort(new Error('download timed out')), options.timeoutMs ?? 120_000);
  const limit = options.metadata ? 1024 * 1024 : 128 * 1024 * 1024;
  try {
    return await requestBytes(url, { ...options, agent, signal, env, request: options.request ?? request,
      idleTimeoutMs: options.idleTimeoutMs ?? 15_000, limit: Math.min(limit, options.maxBytes ?? limit) }, 0);
  } finally { clearTimeout(timer); agent.destroy(); }
}
