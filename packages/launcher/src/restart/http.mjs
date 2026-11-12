export class RestartError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}

export function sendRestartJson(res, status, body) {
  const bytes = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8', 'content-length': bytes.length,
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    ...(status === 405 ? { allow: 'GET, POST' } : {}),
  }).end(bytes);
}

export function checkRestartOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && !['same-origin', 'none'].includes(site)) throw new RestartError('cross-origin', 403);
  if (req.headers.origin === undefined) return;
  let expected;
  try { expected = new URL(`${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`).origin; }
  catch { throw new RestartError('cross-origin', 403); }
  if (req.headers.origin !== expected) throw new RestartError('cross-origin', 403);
}

export async function readRestartBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
    throw new RestartError('json-required', 415);
  }
  const length = req.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > 256)) {
    throw new RestartError('invalid-body', 400);
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const finish = (error) => {
      clearTimeout(timer);
      req.off('data', data); req.off('end', end); req.off('error', aborted); req.off('aborted', aborted);
      if (error) { req.pause(); reject(error); } else {
        try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
        catch { reject(new RestartError('invalid-body', 400)); }
      }
    };
    const data = (chunk) => {
      size += chunk.length;
      if (size > 256) finish(new RestartError('invalid-body', 413)); else chunks.push(Buffer.from(chunk));
    };
    const end = () => finish();
    const aborted = () => finish(new RestartError('invalid-body', 400));
    const timer = setTimeout(() => finish(new RestartError('body-timeout', 408)), 3000);
    timer.unref();
    req.on('data', data); req.once('end', end); req.once('error', aborted); req.once('aborted', aborted);
  });
}
