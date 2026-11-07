import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { WebSocketServer } from 'ws';

import { createDebugLog } from '../../packages/launcher/src/debugLog.mjs';
import { createLauncher } from '../../packages/launcher/src/serve.mjs';

export const markers = {
  token: 'fictional-token-privacy-7351', cookie: 'fictional-cookie-privacy-7351',
  session: 'fictional-session-privacy-7351', ip: '192.0.2.173',
  workspace: 'fictional-workspace-privacy-7351', query: 'fictional-query-privacy-7351',
  body: 'fictional-body-privacy-7351', reason: 'fictional-ws-reason-privacy-7351',
};
export const transcript = `/api/v1/sessions/${markers.session}/transcript`;
export const page = '?agent_id=main&page_size=10';
export const payload = Buffer.from(JSON.stringify({ items: [markers.body.repeat(300)], seq: 37 }));
const active = [];
const eventNames = new Set([
  'launcher_start', 'launcher_stop', 'http_begin', 'http_upstream', 'http_first_byte', 'http_progress',
  'http_end', 'http_error', 'ws_begin', 'ws_ready', 'ws_first_frame', 'ws_progress', 'ws_end', 'ws_error',
  'tls_error', 'client_error',
]);

export function own(cleanup) {
  active.push(cleanup);
}

export async function cleanup() {
  for (const close of active.splice(0).reverse()) await close();
}

function closeServer(server) {
  server.closeAllConnections();
  return new Promise((done) => server.close(done));
}

export async function fixture({ handler, upgrade, debug = true, launcherOptions = {} } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'launcher-debug-it-'));
  own(() => rmSync(home, { recursive: true, force: true }));
  const publicDir = join(home, 'public');
  mkdirSync(join(publicDir, 'assets'), { recursive: true });
  writeFileSync(join(publicDir, 'index.html'), '<html><head></head><body>isolated fixture</body></html>');
  writeFileSync(join(publicDir, 'assets', 'fixture-HASH.txt'), payload);
  const received = [];
  const receivedWs = [];
  const wss = new WebSocketServer({ noServer: true });
  const server = createServer((req, res) => {
    received.push({ url: req.url, headers: { ...req.headers }, method: req.method });
    if (handler) return handler(req, res);
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': payload.length });
    res.end(payload);
  });
  own(async () => {
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    await closeServer(server);
  });
  server.on('upgrade', (req, socket, head) => {
    receivedWs.push({ url: req.url, headers: { ...req.headers } });
    if (upgrade) return upgrade({ req, socket, head, wss });
    if (req.headers['sec-websocket-protocol'] !== `kimi-code.bearer.${markers.token}`) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => ws.on('message', (data, binary) => ws.send(data, { binary })));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const log = debug ? await createDebugLog({ enabled: true, home }) : undefined;
  if (debug) expect(log?.file).toBeTypeOf('string');
  own(() => log?.close());
  const launcher = await createLauncher({
    target: `http://127.0.0.1:${server.address().port}`, publicDir, host: '127.0.0.1', port: 0,
    interfaces: {}, officialPresentation: true, officialWebVersion: '2.4.1', debugLog: log, ...launcherOptions,
  });
  own(() => launcher.close());
  return { home, launcher, log, server, wss, received, receivedWs };
}

export function raw(url, path, options = {}) {
  const origin = new URL(url);
  const request = origin.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request({ hostname: origin.hostname, port: origin.port, path, agent: false,
      method: options.method ?? 'GET', ca: options.ca,
      headers: { authorization: `Bearer ${markers.token}`, cookie: `test=${markers.cookie}`,
        'x-forwarded-for': markers.ip, ...options.headers },
    }, (res) => {
      const chunks = [];
      if (options.pauseMs) {
        res.pause();
        const timer = setTimeout(() => res.resume(), options.pauseMs);
        res.once('close', () => clearTimeout(timer));
      }
      res.on('data', (chunk) => chunks.push(chunk));
      res.once('error', reject);
      res.once('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
    });
    req.once('error', reject);
    own(() => req.destroy());
    req.end(options.body);
  });
}

export function socketRequest(url, content) {
  const origin = new URL(url);
  return new Promise((resolve, reject) => {
    const socket = connect(Number(origin.port), origin.hostname, () => socket.end(content));
    own(() => socket.destroy());
    const chunks = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.once('error', reject);
    socket.once('close', () => resolve(Buffer.concat(chunks).toString()));
  });
}

export async function records(context) {
  await Promise.all([context.launcher.close(), context.launcher.close()]);
  const text = readFileSync(context.log.file, 'utf8');
  for (const marker of [...Object.values(markers), '127.0.0.1', context.home, 'C:\\fictional\\workspace']) {
    expect(text).not.toContain(marker);
    expect(text).not.toContain(JSON.stringify(marker).slice(1, -1));
    expect(text).not.toContain(encodeURIComponent(marker));
    expect(text).not.toContain(encodeURIComponent(marker).replaceAll('-', '%2D'));
  }
  const rows = text.trim().split('\n').map((line) => JSON.parse(line));
  for (const row of rows) {
    expect(row.schema).toBe(1);
    expect(new Date(row.time).toISOString()).toBe(row.time);
    expect(eventNames.has(row.event)).toBe(true);
  }
  expect(rows.filter((row) => row.event === 'launcher_stop')).toHaveLength(1);
  return rows;
}

export function requestEvents(rows, index = 0, kind = 'http') {
  const begin = rows.filter((row) => row.event === `${kind}_begin`)[index];
  expect(begin).toBeDefined();
  const events = rows.filter((row) => row.id === begin.id);
  expect(events.filter((row) => row.event === `${kind}_end`)).toHaveLength(1);
  return events;
}

export function event(events, name) {
  const found = events.find((row) => row.event === name);
  expect(found).toBeDefined();
  return found;
}
