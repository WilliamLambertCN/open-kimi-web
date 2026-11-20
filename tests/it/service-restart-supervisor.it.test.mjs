import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { processAlive } from '../../packages/launcher/src/restart/worker.mjs';
import { recordProcessStart } from '../../packages/launcher/src/update/windowsTreeCleanup.mjs';
import { availableHttpPort } from '../testkit/httpPort.mjs';

const AUTH = 'Bearer fictional-restart-it';
const cleanups = [];
const moduleUrl = (path) => new URL('../../packages/launcher/src/' + path, import.meta.url).href;
const backendPath = fileURLToPath(new URL('../../packages/launcher/tests/integration/restartKimi.mjs', import.meta.url));
const servicePath = '/__open-kimi-mobile/service/';
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function records(dir) {
  return Promise.all((await readdir(dir)).filter((name) => name.endsWith('.json'))
    .map(async (name) => JSON.parse(await readFile(join(dir, name), 'utf8'))));
}

async function cleanupFixture(root, home) {
  const launch = await readFile(join(root, 'launcher.json'), 'utf8').then(JSON.parse).catch(() => null);
  const backends = await records(join(home, 'server', 'instances'));
  for (const backend of backends) {
    if (!processAlive(backend.pid)) continue;
    const response = await fetch(`http://127.0.0.1:${backend.port}/__fixture/stop`, { method: 'POST',
      headers: { authorization: AUTH }, signal: AbortSignal.timeout(2000) });
    await response.text();
  }
  await expect.poll(() => backends.every((backend) => !processAlive(backend.pid)), { timeout: 10000 }).toBe(true);
  if (launch) await expect.poll(() => !processAlive(launch.pid), { timeout: 10000 }).toBe(true);
  await rm(root, { recursive: true, force: true });
}

async function fixture(mode) {
  const root = await mkdtemp(join(tmpdir(), 'okw-managed-restart-')); const port = await availableHttpPort();
  const home = join(root, 'kimi'); const publicDir = join(root, 'public'); const runner = join(root, 'runner.mjs');
  await mkdir(join(home, 'server', 'instances'), { recursive: true }); await mkdir(publicDir);
  await writeFile(join(home, 'server.token'), 'fictional-restart-it');
  await writeFile(join(publicDir, 'index.html'), '<html><head></head><body>fixture restart</body></html>');
  await writeFile(join(root, 'policy.json'), JSON.stringify({ mode }));
  await writeFile(runner, `
    import {spawn} from 'node:child_process';
    import {writeFile} from 'node:fs/promises';
    import {superviseWeb} from ${JSON.stringify(moduleUrl('integration/supervisor.mjs'))};
    import {createLauncher} from ${JSON.stringify(moduleUrl('serve.mjs'))};
    const env=process.env;
    await writeFile(${JSON.stringify(join(root, 'launcher.json'))},JSON.stringify({pid:process.pid,created:Date.now()}));
    const code=await superviseWeb({realKimi:'fixture',web:{port:${port},noOpen:true},env,deps:{
      spawn:(_cmd,args,options)=>spawn(process.execPath,[${JSON.stringify(backendPath)},...args],options),
      log:()=>{},warn:()=>{},
      startFrontend:async(options)=>({launcher:await createLauncher({target:options.target,
        publicDir:${JSON.stringify(publicDir)},host:'127.0.0.1',port:${port},officialPresentation:true,
        officialWebVersion:'2.7.2',restartControl:options.restartControl}),tokenResult:{token:null}})
    }});
    process.exit(code);
  `);
  const env = { ...process.env, KIMI_CODE_HOME: home, RESTART_TEST_ROOT: root };
  const child = spawn(process.execPath, [runner, '__wrap', 'web', '--port', String(port), '--no-open'],
    { env, detached: true, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  recordProcessStart(child, Date.now() - 1000);
  let stderr = ''; child.stderr.on('data', (chunk) => { stderr += chunk; });
  const origin = `http://127.0.0.1:${port}`;
  const call = async (path, options = {}) => {
    const response = await fetch(origin + path, { ...options, headers: { authorization: AUTH, ...options.headers } });
    return { status: response.status, body: await response.json() };
  };
  cleanups.push(() => cleanupFixture(root, home));
  await expect.poll(async () => (await call(servicePath + 'status').catch(() => null))?.status,
    { timeout: 15000, message: stderr }).toBe(200);
  const status = await call(servicePath + 'status');
  const backend = (await records(join(home, 'server', 'instances')))[0];
  const restart = () => call(servicePath + 'restart', { method: 'POST',
    body: JSON.stringify({ instance: status.body.instance }), headers: { 'content-type': 'application/json' } });
  return { root, child, origin, status, backend, call, restart, home };
}

async function wsAt(origin) {
  const ws = new WebSocket(origin.replace(/^http/, 'ws') + '/api/v1/ws');
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  cleanups.push(() => ws.terminate()); return ws;
}

describe('real restart controller, supervisor and detached worker chain', () => {
  it.each(['idle', 'lost'])('replaces both owned processes at the same frontend address with shutdown mode=%s',
    { timeout: 30000 }, async (mode) => {
      const f = await fixture(mode); const ws = await wsAt(f.origin);
      const closed = new Promise((resolve) => ws.once('close', resolve));
      expect((await f.restart()).status).toBe(202); expect(await closed).toBe(1013);
      await expect.poll(async () => {
        const state = await f.call(servicePath + 'status').catch(() => null);
        return !!state?.body.instance && state.body.instance !== f.status.body.instance;
      }, { timeout: 15000 }).toBe(true);
      const next = await f.call(servicePath + 'status'); expect(next.body.phase).toBe('ready');
      expect(next.body.available).toBe(true);
      const newBackend = (await records(join(f.home, 'server', 'instances')))[0];
      expect(newBackend.pid).not.toBe(f.backend.pid); expect(processAlive(f.backend.pid)).toBe(false);
      expect(processAlive(f.child.pid)).toBe(false);
      const shutdown = JSON.parse(await readFile(join(f.root, `shutdown-${f.backend.pid}.json`), 'utf8'));
      expect(shutdown).toMatchObject({ conditional: true, clients: 0 });
    });

  it('retains both original processes and restores traffic after official busy refusal', { timeout: 30000 }, async () => {
    const f = await fixture('busy'); const direct = await wsAt(`http://127.0.0.1:${f.backend.port}`);
    expect(await f.restart()).toMatchObject({ status: 409, body: { error: 'service-busy' } });
    expect(processAlive(f.backend.pid)).toBe(true); expect(processAlive(f.child.pid)).toBe(true);
    expect((await f.call(servicePath + 'status')).body).toMatchObject({
      instance: f.status.body.instance, phase: 'ready', lastError: 'service-busy',
    });
    expect((await f.call('/api/v1/fixture', { method: 'POST' })).status).toBe(200);
    const echoed = new Promise((resolve) => direct.once('message', (data) => resolve(String(data))));
    direct.send('direct-client-still-works'); expect(await echoed).toBe('direct-client-still-works');
  });
});


it.each([
  ['survive', 'restart-exit-unconfirmed'], ['lost-live', 'restart-outcome-unknown'],
])('never escalates or replaces a surviving backend with mode=%s', { timeout: 30000 }, async (mode, code) => {
  const f = await fixture(mode);
  expect(await f.restart()).toMatchObject({ status: 503, body: { error: code } });
  expect(processAlive(f.backend.pid)).toBe(true); expect(processAlive(f.child.pid)).toBe(true);
  expect((await f.call(servicePath + 'status')).body).toMatchObject({
    instance: f.status.body.instance, phase: 'ready', lastError: code,
  });
  const ws = await wsAt(f.origin); expect(ws.readyState).toBe(WebSocket.OPEN);
  expect((await f.call('/api/v1/fixture', { method: 'POST' })).status).toBe(200);
  expect(await records(join(f.home, 'server', 'instances'))).toHaveLength(1);
  const shutdowns = (await readdir(f.root)).filter((name) => name.startsWith('shutdown-'));
  expect(shutdowns).toHaveLength(1);
  expect(JSON.parse(await readFile(join(f.root, shutdowns[0]), 'utf8')).conditional).toBe(true);
});
