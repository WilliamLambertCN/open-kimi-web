// Launcher assembly: one same-origin HTTP(S) server that serves the resolved
// official or custom web build and proxies /api to the target kimi server.
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';

import { createAccessUrls } from './accessUrls.mjs';
import { proxyRequest } from './httpProxy.mjs';
import { addMobilePresentation, servePresentationAsset } from './officialPresentation.mjs';
import { serveStatic } from './staticFiles.mjs';
import { createWsProxy } from './wsProxy.mjs';

export const WS_PATH = '/api/v1/ws';
const DEFAULT_CLOSE_GRACE_MS = 1_000;

function route(req, res, target, publicDir, officialPresentation) {
  const url = req.url ?? '/';
  const pathname = url.split('?')[0];
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    proxyRequest(req, res, target);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end('Method Not Allowed');
    return;
  }
  serveFrontendFiles(req, res, publicDir, officialPresentation)
    .then((served) => {
      if (!served) res.writeHead(404).end('Not Found');
    })
    .catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
}

async function serveFrontendFiles(req, res, publicDir, officialPresentation) {
  if (officialPresentation && await servePresentationAsset(req, res)) return true;
  return serveStatic(publicDir, req, res, officialPresentation ? addMobilePresentation : undefined);
}

function closeServer(server, graceMs) {
  return new Promise((resolveClose) => {
    const timer = setTimeout(() => server.closeAllConnections(), graceMs);
    timer.unref();
    server.close(() => {
      clearTimeout(timer);
      resolveClose();
    });
  });
}

export async function createLauncher({
  target,
  publicDir,
  host,
  port,
  interfaces,
  tls = null,
  closeGraceMs = DEFAULT_CLOSE_GRACE_MS,
  officialPresentation = false,
}) {
  const { wss, handleUpgrade, closeConnections } = createWsProxy();
  const listener = (req, res) => route(req, res, target, publicDir, officialPresentation);
  const server = tls
    ? createHttpsServer({ key: tls.key, cert: tls.cert, minVersion: 'TLSv1.2' }, listener)
    : createHttpServer(listener);
  server.on('upgrade', (req, socket, head) => {
    // req.url carries the query string (the official web appends
    // `?client_id=...`); match on the pathname only.
    if ((req.url ?? '').split('?')[0] === WS_PATH) {
      handleUpgrade(req, socket, head, target);
    } else {
      socket.destroy();
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolveListen);
  });
  const boundPort = server.address().port;
  const protocol = tls ? 'https' : 'http';
  const accessUrls = createAccessUrls(host, boundPort, interfaces, protocol);
  const url = accessUrls[0].url;

  async function close() {
    closeConnections();
    for (const client of wss.clients) client.terminate();
    await closeServer(server, closeGraceMs);
  }

  return {
    server,
    wss,
    url,
    accessUrls,
    tls: tls ? {
      fingerprint: tls.fingerprint,
      expiresAt: tls.expiresAt,
      source: tls.source,
      created: tls.created,
      rotated: tls.rotated,
      reason: tls.reason,
    } : null,
    close,
  };
}
