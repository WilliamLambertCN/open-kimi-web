import { Agent, request } from 'node:https';

const API = 'https://api.github.com/repos/WilliamLambertCN/open-kimi-web/releases';

function allowedDownload(url, metadata) {
  if (metadata) return url.origin === 'https://api.github.com' && url.pathname.startsWith(`${new URL(API).pathname}/`);
  return url.href === 'https://registry.npmjs.org/@moonshot-ai/kimi-code/-/kimi-code-2.4.1.tgz' ||
    url.origin === 'https://github.com' && url.pathname.startsWith('/WilliamLambertCN/open-kimi-web/releases/download/') ||
    ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname);
}

export function assertDownloadUrl(value, metadata = false) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
    throw new Error('unsafe HTTPS download URL');
  }
  if (!allowedDownload(url, metadata)) throw new Error('download host/path is not allowed');
  return url;
}

function redirectUrl(res, url, metadata, redirects) {
  if (metadata || redirects >= 4 || !res.headers.location) throw new Error('download redirect refused');
  try { return assertDownloadUrl(new URL(res.headers.location, url).href).href; }
  catch { throw new Error('download redirect refused'); }
}

function collectResponse(res, limit, finish) {
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

function requestResponse(url, context, metadata, redirects) {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const cancel = () => finish(new Error('download timed out'));
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
    const req = context.request(url, { agent: context.agent, headers: {
      Accept: metadata ? 'application/vnd.github+json' : 'application/octet-stream', 'User-Agent': 'open-kimi-web-install',
    } }, (res) => {
      const interrupted = () => finish(new Error('download response interrupted'));
      res.once('error', interrupted);
      res.once('aborted', interrupted);
      res.once('close', () => { if (!res.complete) interrupted(); });
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();
        try { finish(null, { next: redirectUrl(res, url, metadata, redirects) }); }
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

async function requestBytes(url, context, metadata, redirects) {
  assertDownloadUrl(url, metadata);
  context.signal.throwIfAborted();
  const response = await requestResponse(url, context, metadata, redirects);
  return response.next ? requestBytes(response.next, context, false, redirects + 1) : response.bytes;
}

export async function downloadBytes(url, options = {}) {
  const controller = new AbortController();
  const agent = (options.agentFactory ?? ((settings) => new Agent(settings)))({ proxyEnv: options.env ?? process.env });
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
  const limit = options.metadata ? 1024 * 1024 : 128 * 1024 * 1024;
  try {
    return await requestBytes(url, { agent, signal: controller.signal, request: options.request ?? request,
      idleTimeoutMs: options.idleTimeoutMs ?? 15_000, limit: Math.min(limit, options.maxBytes ?? limit) }, options.metadata, 0);
  } finally { clearTimeout(timer); agent.destroy(); }
}
