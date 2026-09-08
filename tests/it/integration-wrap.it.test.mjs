// Full-chain integration tests for the `__wrap` supervisor: a fake kimi
// (node script) plays the official backend — registry write, healthz/meta,
// shutdown — while the real launcher fronts it. Everything runs under
// temporary KIMI_CODE_HOME / OPEN_KIMI_WEB_HOME; no real user environment.
import { spawn } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCapture, spawnMirror } from '../../packages/launcher/src/integration/proc.mjs';
import { pidAlive } from '../../packages/launcher/src/integration/registryDiscovery.mjs';
import { superviseWeb } from '../../packages/launcher/src/integration/supervisor.mjs';
import { wrapMain } from '../../packages/launcher/src/integration/wrapMain.mjs';

const FAKE_KIMI = fileURLToPath(
  new URL('../../packages/launcher/tests/integration/fakeKimi.mjs', import.meta.url),
);

let root;
let kimiHome;
let publicDir;
let logs;
let warnings;
const spawnedPids = new Set();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'okw-supervisor-'));
  kimiHome = join(root, 'kimi-code');
  publicDir = join(root, 'public');
  mkdirSync(join(kimiHome, 'server', 'instances'), { recursive: true });
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(join(publicDir, 'index.html'), '<html>open-kimi-web it fixture</html>');
  writeFileSync(join(kimiHome, 'server.token'), 'it-token\n');
  logs = [];
  warnings = [];
});

afterEach(async () => {
  for (const pid of spawnedPids) {
    if (pidAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        await runCapture('taskkill', ['/pid', String(pid), '/T', '/F']);
      }
    }
  }
  spawnedPids.clear();
  rmSync(root, { recursive: true, force: true });
});

function env(extra = {}) {
  return {
    ...process.env,
    KIMI_CODE_HOME: kimiHome,
    OPEN_KIMI_WEB_HOME: join(root, 'open-kimi-web'),
    OPEN_KIMI_REAL_KIMI: 'fake-kimi',
    ...extra,
  };
}

/** The supervisor/delegate spawn seam: run the fake kimi through node. */
function fakeSpawn(extraEnv = {}) {
  return (cmd, args, opts) =>
    spawn(process.execPath, [FAKE_KIMI, ...args], {
      ...opts,
      env: { ...opts?.env, ...extraEnv },
    });
}

function deps(extra = {}) {
  return {
    spawn: fakeSpawn(),
    log: (line) => logs.push(line),
    warn: (line) => warnings.push(line),
    openUrl: async () => true,
    publicDir,
    ...extra,
  };
}

function localLink() {
  return logs.find((line) => line.includes('Local:'))?.split(/\s+/).pop();
}

function registryInstance() {
  const dir = join(kimiHome, 'server', 'instances');
  const file = readdirSync(dir).find((name) => name.endsWith('.json'));
  return file === undefined ? null : JSON.parse(readFileSync(join(dir, file), 'utf8'));
}

async function shutdownBackend() {
  const port = registryInstance().port;
  await fetch(`http://127.0.0.1:${port}/api/v1/shutdown`, {
    method: 'POST',
    headers: { authorization: 'Bearer it-token' },
  });
}

async function waitForLink() {
  await expect.poll(() => localLink(), { timeout: 15_000, interval: 100 }).toBeDefined();
  return new URL(localLink());
}

async function canTaskkillTree() {
  const probe = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const exited = new Promise((resolve) => probe.once('exit', resolve));
  const result = await runCapture('taskkill', ['/pid', String(probe.pid), '/T', '/F']);
  if (result.code !== 0) probe.kill('SIGTERM');
  await exited;
  return result.code === 0;
}

// Use an ephemeral public frontend port so integration tests do not reserve a
// stable user-facing port on the host running the suite.
const WEB_DEFAULTS = { port: 0, host: undefined, hostBare: false, noOpen: true };

describe('supervised kimi web', () => {
  it(
    'fronts the backend, proxies authenticated /api, and closes on backend exit',
    { timeout: 30_000 },
    async () => {
      const record = join(root, 'record.json');
      const supervised = superviseWeb({
        realKimi: 'fake-kimi',
        web: WEB_DEFAULTS,
        env: env({ FAKE_RECORD: record }),
        deps: deps(),
      });
      const url = await waitForLink();
      expect(url.hash.startsWith('#token=')).toBe(true);

      // The real launcher proxies to the fake backend with the token.
      const meta = await fetch(`${url.origin}/api/v1/meta`, {
        headers: { authorization: 'Bearer it-token' },
      });
      expect(meta.status).toBe(200);
      expect(await meta.text()).toContain('fake-');

      // Backend exit (via the official shutdown endpoint) → launcher closes,
      // supervisor mirrors the exit code.
      await shutdownBackend();
      await expect(supervised).resolves.toBe(0);
      expect(JSON.parse(readFileSync(record, 'utf8')).shutdown).toBe(true);
      await expect(fetch(`${url.origin}/api/v1/meta`)).rejects.toThrow();
    },
  );

  it(
    'opens the browser with the authenticated link unless --no-open',
    { timeout: 30_000 },
    async () => {
      const opened = [];
      const supervised = superviseWeb({
        realKimi: 'fake-kimi',
        web: { ...WEB_DEFAULTS, port: 0, noOpen: false },
        env: env(),
        deps: deps({ openUrl: async (url) => (opened.push(url), true) }),
      });
      await expect.poll(() => opened.length, { timeout: 15_000 }).toBe(1);
      expect(opened[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+#token=/);
      await waitForLink();
      await shutdownBackend();
      await expect(supervised).resolves.toBe(0);
    },
  );

  it(
    'fails closed when the backend dies during startup',
    { timeout: 30_000 },
    async () => {
      await expect(
        superviseWeb({
          realKimi: 'fake-kimi',
          web: WEB_DEFAULTS,
          env: env(),
          deps: deps({ spawn: fakeSpawn({ FAKE_KIMI_DIE_MS: '150', FAKE_KIMI_DIE_CODE: '3' }) }),
        }),
      ).rejects.toThrow(/exited during startup/);
    },
  );

  it(
    'signal path: shutdown POST with token, launcher close, exit 0',
    { timeout: 30_000 },
    async () => {
      const record = join(root, 'record.json');
      const supervised = superviseWeb({
        realKimi: 'fake-kimi',
        web: WEB_DEFAULTS,
        env: env({ FAKE_RECORD: record }),
        deps: deps({ waitStop: async () => ({ kind: 'signal' }) }),
      });
      await expect(supervised).resolves.toBe(0);
      expect(JSON.parse(readFileSync(record, 'utf8')).shutdown).toBe(true);
    },
  );
});

describe('supervisor startup and Windows process trees', () => {
  it(
    'survives a transient connection refusal after registry discovery',
    { timeout: 30_000 },
    async () => {
      let healthAttempts = 0;
      const fetchImpl = vi.fn(async (url, init) => {
        if (new URL(url).pathname === '/api/v1/healthz' && healthAttempts++ === 0) {
          throw new Error('simulated listener startup race');
        }
        return fetch(url, init);
      });
      const supervised = superviseWeb({
        realKimi: 'fake-kimi',
        web: WEB_DEFAULTS,
        env: env(),
        deps: deps({
          fetch: fetchImpl,
          waitStop: async () => ({ kind: 'signal' }),
        }),
      });
      await expect(supervised).resolves.toBe(0);
      expect(healthAttempts).toBe(2);
    },
  );

  it(
    'starts a fresh backend before waiting for its first server token',
    { timeout: 30_000 },
    async () => {
      rmSync(join(kimiHome, 'server.token'));
      const record = join(root, 'fresh-token.json');
      const supervised = superviseWeb({
        realKimi: 'fake-kimi',
        web: WEB_DEFAULTS,
        env: env({ FAKE_RECORD: record }),
        deps: deps({
          spawn: fakeSpawn({ FAKE_KIMI_CREATE_TOKEN: 'it-token' }),
          waitStop: async () => ({ kind: 'signal' }),
        }),
      });
      await expect(supervised).resolves.toBe(0);
      expect(readFileSync(join(kimiHome, 'server.token'), 'utf8').trim()).toBe('it-token');
      expect(JSON.parse(readFileSync(record, 'utf8')).shutdown).toBe(true);
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'terminates the whole cmd.exe shim tree when graceful shutdown is ignored',
    { timeout: 30_000 },
    async (context) => {
      if (!(await canTaskkillTree())) {
        context.skip();
        return;
      }
      const shim = join(root, 'fake-kimi.cmd');
      writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${FAKE_KIMI}" %*\r\n`);
      const supervised = superviseWeb({
        realKimi: shim,
        web: WEB_DEFAULTS,
        env: env({ FAKE_KIMI_IGNORE_SHUTDOWN: '1' }),
        deps: deps({
          spawn,
          platform: 'win32',
          waitStop: async () => ({ kind: 'signal' }),
        }),
      });
      await expect.poll(() => registryInstance(), { timeout: 15_000 }).not.toBeNull();
      const backendPid = registryInstance().pid;
      spawnedPids.add(backendPid);
      await expect(supervised).resolves.toBe(0);
      await expect.poll(
        () => pidAlive(backendPid),
        { timeout: 5_000, message: warnings.join('\n') },
      ).toBe(false);
      spawnedPids.delete(backendPid);
    },
  );
});

describe('supervisor environment options', () => {
  it(
    'serves the environment-selected custom directory and opens its authenticated URL',
    { timeout: 30_000 },
    async () => {
      const envPublicDir = join(root, 'env-public');
      mkdirSync(envPublicDir);
      writeFileSync(join(envPublicDir, 'index.html'), '<html>environment-selected-ui</html>');
      const opened = [];
      let stop;
      const supervised = superviseWeb({
        realKimi: 'fake-kimi',
        web: { ...WEB_DEFAULTS, noOpen: false },
        env: env({
          OPEN_KIMI_WEB_DIR: envPublicDir,
          OPEN_KIMI_WEB_VERSION: '1.2.3',
        }),
        deps: deps({
          publicDir: undefined,
          openUrl: async (url) => (opened.push(url), true),
          waitStop: () => new Promise((resolve) => { stop = resolve; }),
        }),
      });
      const url = await waitForLink();
      expect(await (await fetch(url.origin)).text()).toContain('environment-selected-ui');
      expect(opened).toEqual([expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+#token=/)]);
      stop({ kind: 'signal' });
      await expect(supervised).resolves.toBe(0);
    },
  );

  it('rejects the removed open UI before spawning, even with a custom directory', async () => {
    const spawnAttempt = vi.fn(() => {
      throw new Error('must not spawn');
    });
    await expect(superviseWeb({
      realKimi: 'fake-kimi',
      web: WEB_DEFAULTS,
      env: env({
        OPEN_KIMI_WEB_UI: 'open',
        OPEN_KIMI_WEB_DIR: join(root, 'custom-web'),
      }),
      deps: deps({ spawn: spawnAttempt }),
    })).rejects.toThrow(/OPEN_KIMI_WEB_UI=open.*removed/);
    expect(spawnAttempt).not.toHaveBeenCalled();
  });
});

function captureSpawnMirror(recordPath, extraEnv = {}) {
  return (cmd, args, opts) =>
    spawnMirror(process.execPath, [FAKE_KIMI, ...args], {
      ...opts,
      env: { ...opts?.env, FAKE_RECORD: recordPath, ...extraEnv },
    });
}

describe('__wrap delegation', () => {
  it(
    'delegates non-web commands with argv/cwd/env/exit-code fidelity',
    { timeout: 30_000 },
    async () => {
      const record = join(root, 'delegate.json');
      const code = await wrapMain(['chat', '--resume', 'abc'], {
        env: env(),
        spawnMirror: captureSpawnMirror(record, { FAKE_EXIT_CODE: '7', FAKE_MARKER: 'm1' }),
        error: (line) => warnings.push(line),
      });
      expect(code).toBe(7);
      const seen = JSON.parse(readFileSync(record, 'utf8'));
      expect(seen.argv).toEqual(['chat', '--resume', 'abc']);
      expect(seen.marker).toBe('m1');
      expect(seen.cwd).toBe(process.cwd());
    },
  );

  it(
    'delegates unsupported, unsafe, and malformed web arguments losslessly',
    { timeout: 30_000 },
    async () => {
      const cases = [
        ['web', 'rotate-token'],
        ['web', '--dangerous-bypass-auth'],
        ['web', '--rc'],
        ['web', '--remote-control'],
        ['web', '--allowed-host', 'example.test'],
        ['web', '--port'],
        ['web', '--port', 'abc'],
        ['web', '--port', '70000'],
        ['web', 'extra'],
      ];
      for (const [index, argv] of cases.entries()) {
        const record = join(root, `delegate-${index}.json`);
        const code = await wrapMain(argv, {
          env: env(),
          spawnMirror: captureSpawnMirror(record, { FAKE_FORCE_DELEGATE: '1' }),
          error: (line) => warnings.push(line),
        });
        expect(code).toBe(0);
        expect(JSON.parse(readFileSync(record, 'utf8')).argv).toEqual(argv);
      }
      expect(warnings.join('\n')).toMatch(/rotate-token/);
      expect(warnings.join('\n')).toMatch(/dangerous-bypass-auth/);
      expect(warnings.join('\n')).toMatch(/unsupported arguments/);
    },
  );
});

describe('__wrap supervision routing', () => {
  it('passes every supported web option shape to the supervisor', async () => {
    const superviseWeb = vi.fn(async () => 0);
    const loadDependency = async () => ({});
    const cases = [
      [['web'], { port: undefined, host: undefined, hostBare: false, noOpen: false }],
      [['web', '--port', '48627', '--no-open'], {
        port: 48627, host: undefined, hostBare: false, noOpen: true,
      }],
      [['web', '--host'], { port: undefined, host: undefined, hostBare: true, noOpen: false }],
      [['web', '--host', '--no-open'], {
        port: undefined, host: undefined, hostBare: true, noOpen: true,
      }],
      [['web', '--host', '192.168.1.20'], {
        port: undefined, host: '192.168.1.20', hostBare: false, noOpen: false,
      }],
    ];

    for (const [argv, web] of cases) {
      await expect(wrapMain(argv, {
        env: env(), loadDependency, superviseWeb,
      })).resolves.toBe(0);
      expect(superviseWeb).toHaveBeenLastCalledWith(expect.objectContaining({
        realKimi: 'fake-kimi', web,
      }));
    }
  });
});

describe('__wrap startup errors', () => {
  it(
    'errors clearly when the wrapper lost track of the real kimi',
    { timeout: 30_000 },
    async () => {
      const noReal = env();
      delete noReal.OPEN_KIMI_REAL_KIMI;
      const code = await wrapMain(['chat'], {
        env: noReal,
        error: (line) => warnings.push(line),
      });
      expect(code).toBe(1);
      expect(warnings.join('\n')).toMatch(/integrate repair/);
    },
  );

  it('errors clearly before supervising when launcher dependencies are missing', async () => {
    const supervise = vi.fn();
    const loadDependency = async (name) => {
      const error = new Error(`Cannot find package '${name}'`);
      error.code = 'ERR_MODULE_NOT_FOUND';
      throw error;
    };

    const code = await wrapMain(['web'], {
      env: env(),
      error: (line) => warnings.push(line),
      loadDependency,
      superviseWeb: supervise,
    });

    expect(code).toBe(1);
    expect(warnings.join('\n')).toMatch(/launcher dependencies are missing: ws, selfsigned/);
    expect(warnings.join('\n')).toMatch(/corepack pnpm install --frozen-lockfile/);
    expect(supervise).not.toHaveBeenCalled();
  });
});
