// Launcher assembly: one same-origin HTTP(S) server that serves the resolved
// official or custom web build and proxies /api to the target kimi server.
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';

import { createAccessUrls } from './accessUrls.mjs';
import { isDebugApiPath, isRemoteControlApiPath } from './apiPathPolicy.mjs';
import { createCronRouteService, serveCron } from './cron/routes.mjs';
import { proxyRequest } from './httpProxy.mjs';
import { serveModelDiscovery } from './modelDiscovery.mjs';
import { addMobilePresentation, servePresentationAsset } from './officialPresentation.mjs';
import { serveSessionSize } from './sessionSize.mjs';
import { serveStatic } from './staticFiles.mjs';
import { createUsageService, serveUsage } from './usage/routes.mjs';
import { createWsProxy } from './wsProxy.mjs';

export const WS_PATH = '/api/v1/ws';
const DEFAULT_CLOSE_GRACE_MS = 1_000;

async function serveOfficialExtension(req, res, context) {
  if (!context.officialPresentation) return false;
  if (await serveCron(req, res, context.cronService)) return true;
  if (await serveSessionSize(req, res, context)) return true;
  if (await serveUsage(req, res, context.target, context.usageService, context.fetchImpl)) return true;
  return serveModelDiscovery(req, res, context.target);
}

function isForbiddenPath(url, scheduledTasks) {
  return isDebugApiPath(url) || (scheduledTasks && isRemoteControlApiPath(url));
}

function assertCronPresentation(scheduledTasks, officialPresentation) {
  if (scheduledTasks && !officialPresentation) throw new Error('--scheduled-tasks requires the enhanced official web UI');
}

async function closeCronService(service) {
  await service?.close?.();
}

async function route(req, res, context) {
  const url = req.url ?? '/';
  if (isForbiddenPath(url, context.scheduledTasks)) {
    res.writeHead(404).end('Not Found');
    return;
  }
  if (await serveOfficialExtension(req, res, context)) return;
  const pathname = url.split('?')[0];
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    proxyRequest(req, res, context.target);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' })
      .end('Method Not Allowed');
    return;
  }
  const served = await serveFrontendFiles(req, res, context);
  if (!served) res.writeHead(404).end('Not Found');
}

async function serveFrontendFiles(req, res, { publicDir, officialPresentation, officialWebVersion }) {
  if (officialPresentation && await servePresentationAsset(req, res)) return true;
  const transformHtml = officialPresentation ? (html) => addMobilePresentation(html, { officialWebVersion }) : undefined;
  return serveStatic(publicDir, req, res, transformHtml);
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

function tlsSummary(tls) {
  if (!tls) return null;
  const { fingerprint, expiresAt, source, created, rotated, reason } = tls;
  return { fingerprint, expiresAt, source, created, rotated, reason };
}

function cronBackendOptions(enabled, home, onUnsafeBackend) {
  return { home: enabled ? home : null, onUnsafeBackend: enabled ? onUnsafeBackend : undefined };
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
  officialWebVersion,
  scheduledTasks = false,
  onUnsafeBackend,
  usageHome = null,
  usageStorageDir = null,
  usageFetch = fetch,
}) {
  assertCronPresentation(scheduledTasks, officialPresentation);
  const cronService = createCronRouteService({
    target, enabled: scheduledTasks, fetchImpl: usageFetch,
    ...cronBackendOptions(scheduledTasks, usageHome, onUnsafeBackend),
  });
  const { wss, handleUpgrade, closeConnections } = createWsProxy();
  const usageService = createUsageService({ usageHome, usageStorageDir, fetchImpl: usageFetch });
  const context = { target, publicDir, officialPresentation, officialWebVersion, scheduledTasks, usageHome,
    usageService, cronService, fetchImpl: usageFetch };
  const listener = (req, res) => {
    route(req, res, context).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  };
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
    await closeCronService(cronService);
  }

  return {
    server,
    wss,
    url,
    accessUrls,
    tls: tlsSummary(tls),
    close,
  };
}
