import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseArgs } from '../../packages/launcher/src/args.mjs';
import { startFrontend } from '../../packages/launcher/src/frontend.mjs';
import { pidAlive } from '../../packages/launcher/src/integration/registryDiscovery.mjs';
import { managedBackendWebArgs } from '../../packages/launcher/src/integration/supervisor.mjs';
import { wrapMain } from '../../packages/launcher/src/integration/wrapMain.mjs';

const FAKE_KIMI = fileURLToPath(new URL('../../packages/launcher/tests/integration/fakeKimi.mjs', import.meta.url));
const TOKEN = 'fixture-entry-token-private-marker';
const SESSION = 'fixture-entry-session-private-marker';
const QUERY = 'fixture-entry-query-private-marker';
const BODY = 'fixture-entry-body-private-marker';
const MODES = [
  { name: 'flag', flags: ['--debug'], envValue: '0', enabled: true },
  { name: 'legacy alias', flags: ['--debug-log'], envValue: '0', enabled: true },
  { name: 'env=1', flags: [], envValue: '1', enabled: true },
  { name: 'env=0', flags: [], envValue: '0', enabled: false },
];
let fixture;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'okw-debug-entry-'));
  const kimiHome = join(root, 'fixture-kimi-private-path');
  const publicDir = join(root, 'fixture-public-private-path');
  mkdirSync(kimiHome);
  mkdirSync(publicDir);
  writeFileSync(join(publicDir, 'index.html'), '<html>isolated entry fixture</html>');
  fixture = {
    root, kimiHome, publicDir, okwHome: join(root, 'fixture-okw-private-path'),
    record: join(root, 'backend-record.json'), logs: [], warnings: [], children: [], pending: [], closers: [],
  };
});

function fixtureEnv(envValue) {
  return {
    ...process.env,
    KIMI_CODE_HOME: fixture.kimiHome,
    OPEN_KIMI_WEB_HOME: fixture.okwHome,
    OPEN_KIMI_WEB_DEBUG_LOG: envValue,
    OPEN_KIMI_REAL_KIMI: 'fixture-not-an-installed-kimi',
    OPEN_KIMI_WEB_UI: 'official', OPEN_KIMI_WEB_DIR: '', OPEN_KIMI_WEB_VERSION: '',
    FAKE_RECORD: fixture.record, FAKE_KIMI_CREATE_TOKEN: TOKEN,
  };
}

function registryInstance() {
  const directory = join(fixture.kimiHome, 'server', 'instances');
  if (!existsSync(directory)) return undefined;
  const name = readdirSync(directory).find((file) => file.endsWith('.json'));
  return name ? JSON.parse(readFileSync(join(directory, name), 'utf8')) : undefined;
}

function fakeSpawn(_command, args, opts) {
  const child = spawn(process.execPath, [FAKE_KIMI, ...args], { ...opts, stdio: 'ignore' });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  fixture.children.push({ child, exited });
  return child;
}

function entryDeps(env) {
  return {
    env, spawn: fakeSpawn, publicDir: fixture.publicDir, interfaces: {},
    log: (line) => fixture.logs.push(line), warn: (line) => fixture.warnings.push(line),
    error: (line) => fixture.warnings.push(line),
  };
}

function remember(operation) {
  operation.catch(() => undefined);
  fixture.pending.push(operation);
  return operation;
}

async function shutdownBackend(instance) {
  if (!instance) return;
  const token = readFileSync(join(fixture.kimiHome, 'server.token'), 'utf8').trim();
  await fetch(`http://127.0.0.1:${instance.port}/api/v1/shutdown`, {
    method: 'POST', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2_000),
  });
}

async function stopChildren() {
  for (const { child, exited } of fixture.children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
    expect(pidAlive(child.pid)).toBe(false);
  }
}

afterEach(async () => {
  try {
    await shutdownBackend(registryInstance()).catch(() => undefined);
    await stopChildren();
    await Promise.allSettled(fixture.pending);
    for (const close of fixture.closers.reverse()) await close();
    expect(registryInstance()).toBeUndefined();
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
    expect(existsSync(fixture.root)).toBe(false);
  }
});

function localUrl() {
  const line = fixture.logs.find((value) => value.includes('Local:'));
  return line?.trim().split(/\s+/).at(-1);
}

async function exerciseProxy(origin, token) {
  const response = await fetch(`${origin}/api/v1/meta?private_query=${QUERY}`, {
    headers: { authorization: `Bearer ${token}`, cookie: `private_cookie=${QUERY}` },
  });
  expect(response.status).toBe(200);
  const metadata = await response.json();
  expect(metadata.code).toBe(0);
  const missing = await fetch(`${origin}/api/v1/sessions/${SESSION}?private_query=${QUERY}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ privateBody: BODY }),
  });
  expect(missing.status).toBe(404);
  await missing.arrayBuffer();
  return metadata;
}

function assertLogFiles(enabled, additionalPrivate = []) {
  const directory = join(fixture.okwHome, 'logs');
  if (!enabled) {
    expect(existsSync(directory)).toBe(false);
    expect(fixture.logs.some((line) => line.includes('debug log enabled'))).toBe(false);
    return;
  }
  const files = readdirSync(directory);
  expect(files).toHaveLength(1);
  expect(files[0]).toMatch(/^debug-.*\.jsonl$/);
  const raw = readFileSync(join(directory, files[0]), 'utf8');
  const records = raw.trim().split('\n').map((line) => JSON.parse(line));
  expect(records.filter((record) => record.event === 'launcher_start')).toHaveLength(1);
  expect(records.filter((record) => record.event === 'launcher_stop')).toHaveLength(1);
  expect(records.some((record) => record.event === 'http_end' && record.route === 'meta' && record.status === 200)).toBe(true);
  expect(records.some((record) => record.event === 'http_end' && record.route === 'session' && record.status === 404)).toBe(true);
  expect(records.find((record) => record.event === 'launcher_start').enhanced).toBe(false);
  for (const marker of [TOKEN, SESSION, QUERY, BODY, fixture.root, fixture.kimiHome, fixture.publicDir,
    fixture.okwHome, fixture.root.replaceAll('\\', '/'), '127.0.0.1', ...additionalPrivate]) {
    expect(raw.includes(marker)).toBe(false);
  }
  expect(fixture.logs.some((line) => line === `debug log enabled: OKW home/logs/${files[0]}`)).toBe(true);
  expect(fixture.warnings.every((line) =>
    line === 'WARNING: authenticated launch links grant full coding-agent access. Do not share them.')).toBe(true);
}

async function assertNoListener(origin) {
  await expect(fetch(`${origin}/api/v1/meta`, { signal: AbortSignal.timeout(2_000) })).rejects.toThrow();
}

describe('managed wrapper real diagnostic entry', () => {
  it.each(MODES)('$name controls the real supervisor/frontend/sink chain', { timeout: 30_000 }, async (mode) => {
    const running = remember(wrapMain(['web', '--port', '0', '--no-open', ...mode.flags], entryDeps(fixtureEnv(mode.envValue))));
    await expect.poll(localUrl, { timeout: 15_000, interval: 50 }).toBeDefined();
    const url = new URL(localUrl());
    expect(url.hash.startsWith('#token=')).toBe(true);
    const token = readFileSync(join(fixture.kimiHome, 'server.token'), 'utf8').trim();
    expect(token === TOKEN).toBe(true);
    const metadata = await exerciseProxy(url.origin, token);
    const instance = registryInstance();
    await shutdownBackend(instance);
    await expect(running).resolves.toBe(0);
    const record = JSON.parse(readFileSync(fixture.record, 'utf8'));
    expect(record.argv).toEqual(managedBackendWebArgs);
    expect(record.argv).not.toContain('--debug-log');
    expect(record.argv).not.toContain('--debug-endpoints');
    expect(record.shutdown).toBe(true);
    expect(record.exited).toBe(0);
    expect(pidAlive(instance.pid)).toBe(false);
    assertLogFiles(mode.enabled, [instance.server_id, metadata.data.server_id]);
    await assertNoListener(url.origin);
  });
});

async function localBackend() {
  const server = createServer((req, res) => {
    if (req.url.startsWith('/api/v1/healthz')) {
      res.writeHead(204).end();
    } else if (req.url.startsWith('/api/v1/meta')) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        code: 0, data: { server_id: 'fixture-local-server-private-id', server_version: '2.4.1' },
      }));
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  fixture.closers.push(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

describe('standalone serve real diagnostic entry', () => {
  it.each(MODES)('$name controls parseArgs/frontend/sink and closes the log', { timeout: 15_000 }, async (mode) => {
    const target = await localBackend();
    const env = fixtureEnv(mode.envValue);
    const args = parseArgs(['node', 'open-kimi-web', 'serve', '--target', target,
      '--web-dir', fixture.publicDir, '--no-token-link', ...mode.flags], env);
    const { launcher } = await startFrontend({ ...args, ...entryDeps(env), port: 0 });
    fixture.closers.push(() => launcher.close());
    const metadata = await exerciseProxy(launcher.url, TOKEN);
    await launcher.close();
    assertLogFiles(mode.enabled, [metadata.data.server_id]);
    await assertNoListener(launcher.url);
  });
});

describe('explicit diagnostics reject unsupported wrapper arguments', () => {
  it.each([
    ['--debug', '--unknown=fixture-private-argv'],
    ['--debug=fixture-private-argv', '--unknown=fixture-private-argv'],
    ['--debug', '--rc'], ['--debug', '--debug-endpoints'],
    ['--debug', '--port', 'fixture-private-argv'],
    ['--debug-log', '--unknown=fixture-private-argv'],
    ['--debug-log=fixture-private-argv', '--unknown=fixture-private-argv'],
    ['--debug-log', '--rc'], ['--debug-log', '--debug-endpoints'],
    ['--debug-log', '--port', 'fixture-private-argv'],
  ])('fails closed before any official invocation: %j', async (...flags) => {
    const spawn = vi.fn();
    const spawnMirror = vi.fn();
    const superviseWeb = vi.fn();
    const loadDependency = vi.fn();
    const code = await wrapMain(['web', ...flags], {
      ...entryDeps(fixtureEnv('0')), spawn, spawnMirror, superviseWeb, loadDependency,
    });
    expect(code).toBe(1);
    for (const spy of [spawn, spawnMirror, superviseWeb, loadDependency]) expect(spy).not.toHaveBeenCalled();
    expect(fixture.warnings).toHaveLength(1);
    expect(fixture.warnings[0].includes('fixture-private-argv')).toBe(false);
    expect(fixture.logs).toEqual([]);
    expect(existsSync(join(fixture.okwHome, 'logs'))).toBe(false);
    expect(existsSync(fixture.record)).toBe(false);
  });
});
