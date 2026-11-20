import { createServer } from 'node:http';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';

const home = process.env.KIMI_CODE_HOME;
const root = process.env.RESTART_TEST_ROOT;
const id = `fixture-${process.pid}`;
const registry = join(home, 'server', 'instances', `${id}.json`);
const token = readFileSync(join(home, 'server.token'), 'utf8').trim();
const policy = () => JSON.parse(readFileSync(join(root, 'policy.json'), 'utf8'));
const reply = (res, data) => res.writeHead(200, { 'content-type': 'application/json' })
  .end(JSON.stringify({ code: 0, data }));

function stop() {
  server.close(() => { rmSync(registry, { force: true }); process.exit(0); });
  server.closeAllConnections();
}

function handle(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/api/v1/healthz') { reply(res, { ok: true }); return; }
  if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
  if (url.pathname === '/api/v1/meta') {
    reply(res, { server_version: '2.7.2', server_id: id }); return;
  }
  if (url.pathname === '/api/v1/sessions') {
    reply(res, { items: [], total: 0, has_more: false }); return;
  }
  if (url.pathname === '/api/v1/shutdown' && req.method === 'POST') {
    shutdown(url, res); return;
  }
  reply(res, { written: req.method === 'POST' });
}

function shutdown(url, res) {
  const state = policy();
  const record = { conditional: url.search === '?if_idle=true', pid: process.pid, clients: wss.clients.size };
  writeFileSync(join(root, `shutdown-${process.pid}.json`), JSON.stringify(record));
  if (!record.conditional) { reply(res, { ok: false }); return; }
  const ok = state.mode !== 'busy' && wss.clients.size === 0;
  if (state.mode.startsWith('lost')) res.destroy();
  else reply(res, { ok });
  if (ok && !['survive', 'lost-live'].includes(state.mode)) setTimeout(stop, 20);
}

const server = createServer(handle);
const wss = new WebSocketServer({ server });
wss.on('connection', (client) => client.on('message', (data) => client.send(data)));
server.listen(0, '127.0.0.1', () => {
  mkdirSync(join(home, 'server', 'instances'), { recursive: true });
  writeFileSync(registry, JSON.stringify({ server_id: id, pid: process.pid,
    port: server.address().port, started_at: Date.now() }));
});
