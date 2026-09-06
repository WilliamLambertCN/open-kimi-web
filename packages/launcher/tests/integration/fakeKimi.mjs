// Fake `kimi` binary for integration tests. Stands in for the official
// native binary without touching a real installation. Behaviour:
//   --version            prints FAKE_KIMI_VERSION (default "kimi 9.9.9-fake")
//   web --port 0 …       writes a registry instance file, serves
//                        /api/v1/{healthz,meta,shutdown} on 127.0.0.1
//   anything else        records {argv, cwd, marker} to FAKE_RECORD and exits
//                        with FAKE_EXIT_CODE (default 0)
// Env knobs: FAKE_KIMI_DIE_MS (exit before serving), FAKE_KIMI_DIE_CODE.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const env = process.env;
const serverId = `fake-${process.pid}`;

function record(extra = {}) {
  if (env.FAKE_RECORD === undefined) return;
  // Merge so an earlier write (e.g. the shutdown flag) survives cleanup.
  let prior = {};
  try {
    prior = JSON.parse(readFileSync(env.FAKE_RECORD, 'utf8'));
  } catch {
    // First write or unreadable — start fresh.
  }
  writeFileSync(
    env.FAKE_RECORD,
    JSON.stringify({ argv: args, cwd: process.cwd(), marker: env.FAKE_MARKER ?? null, ...prior, ...extra }),
  );
}

if (args[0] === '--version') {
  console.log(env.FAKE_KIMI_VERSION ?? 'kimi 9.9.9-fake');
  process.exit(0);
}

// Only `web … --port N` (the supervisor invocation) starts the server; other
// web subcommands/flags (rotate-token, --dangerous-bypass-auth, …) are
// delegated verbatim, so record them and exit like any other command.
if (args[0] !== 'web' || !args.includes('--port')) {
  record();
  process.exit(Number(env.FAKE_EXIT_CODE ?? 0));
}

if (env.FAKE_KIMI_DIE_MS !== undefined) {
  setTimeout(() => process.exit(Number(env.FAKE_KIMI_DIE_CODE ?? 3)), Number(env.FAKE_KIMI_DIE_MS));
  // Keep the event loop alive until the timer fires, no registry write.
  setInterval(() => {}, 1000);
} else {
  startWeb();
}

function kimiHome() {
  return env.KIMI_CODE_HOME;
}

function token() {
  return readFileSync(join(kimiHome(), 'server.token'), 'utf8').trim();
}

function registryFile() {
  return join(kimiHome(), 'server', 'instances', `${serverId}.json`);
}

function cleanup(code) {
  try {
    rmSync(registryFile(), { force: true });
    record({ exited: code });
  } finally {
    process.exit(code);
  }
}

function authorized(req) {
  return req.headers.authorization === `Bearer ${token()}`;
}

function handle(req, res) {
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/api/v1/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    return;
  }
  if (!authorized(req)) {
    res.writeHead(401).end();
    return;
  }
  if (path === '/api/v1/meta') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({ code: 0, msg: 'success', data: { server_id: serverId, server_version: '9.9.9-fake' }, request_id: 'fake' }),
    );
    return;
  }
  if (path === '/api/v1/shutdown' && req.method === 'POST') {
    record({ shutdown: true });
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"code":0}');
    if (env.FAKE_KIMI_IGNORE_SHUTDOWN !== '1') setTimeout(() => cleanup(0), 20);
    return;
  }
  res.writeHead(404).end();
}

function startWeb() {
  const server = createServer(handle);
  server.listen(0, '127.0.0.1', () => {
    if (env.FAKE_KIMI_CREATE_TOKEN !== undefined) {
      writeFileSync(join(kimiHome(), 'server.token'), `${env.FAKE_KIMI_CREATE_TOKEN}\n`);
    }
    mkdirSync(join(kimiHome(), 'server', 'instances'), { recursive: true });
    writeFileSync(registryFile(), JSON.stringify({
      server_id: serverId,
      pid: process.pid,
      host: '127.0.0.1',
      port: server.address().port,
      started_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      host_version: '9.9.9-fake',
    }));
    console.log(`fake kimi web listening on 127.0.0.1:${server.address().port}`);
  });
  process.on('SIGTERM', () => cleanup(0));
  process.on('SIGINT', () => cleanup(0));
}
