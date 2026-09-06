// Same-origin REST proxy: forwards /api/* to the target kimi web server.
// Hop-by-hop headers are dropped per RFC 9110 §7.6.1 (including any header
// named by the connection token list). Host is always rewritten; an existing
// Origin is rewritten to the target origin. Authorization is never logged.
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
  // Rewritten for the target by proxyRequest.
  'host',
]);

export function filterHeaders(headers) {
  const tokens = new Set();
  const connection = headers.connection;
  if (connection) {
    for (const token of String(connection).split(',')) {
      tokens.add(token.trim().toLowerCase());
    }
  }
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (HOP_BY_HOP.has(key) || tokens.has(key)) continue;
    out[key] = value;
  }
  return out;
}

export function buildProxyHeaders(headers, target) {
  const out = { ...filterHeaders(headers), host: target.host };
  if (headers.origin !== undefined) out.origin = target.origin;
  return out;
}

export function proxyRequest(req, res, targetBase) {
  const target = new URL(targetBase);
  const isHttps = target.protocol === 'https:';
  const upstream = (isHttps ? httpsRequest : httpRequest)(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      method: req.method,
      path: req.url,
      headers: buildProxyHeaders(req.headers, target),
    },
    (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, filterHeaders(upRes.headers));
      upRes.on('error', () => res.destroy());
      upRes.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Bad Gateway');
  });
  req.on('aborted', () => upstream.destroy());
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
}
