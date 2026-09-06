import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  awaitNewInstance,
  instancesDir,
  kimiCodeHome,
  pidAlive,
  snapshotInstanceIds,
  verifyInstance,
} from '../../src/integration/registryDiscovery.mjs';

const DIR = '/fake/registry';

function ioWith(files) {
  return {
    readdir: async () => Object.keys(files),
    readFile: async (path) => {
      const name = path.split(/[\\/]/).pop();
      if (files[name] === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files[name];
    },
  };
}

function instance(overrides = {}) {
  return {
    server_id: 'srv-new',
    pid: 1234,
    host: '127.0.0.1',
    port: 4321,
    // The real registry writes epoch milliseconds, not an ISO string.
    started_at: Date.parse('2026-01-01T00:00:10.000Z'),
    ...overrides,
  };
}

describe('kimiCodeHome / instancesDir', () => {
  it('honours KIMI_CODE_HOME and derives from HOME otherwise', () => {
    expect(kimiCodeHome({ KIMI_CODE_HOME: '/kc' })).toBe('/kc');
    expect(kimiCodeHome({ HOME: '/h' })).toBe(join('/h', '.kimi-code'));
    expect(instancesDir({ KIMI_CODE_HOME: '/kc' })).toBe(join('/kc', 'server', 'instances'));
  });
});

describe('snapshotInstanceIds', () => {
  it('collects server ids and ignores malformed files', async () => {
    const io = ioWith({ 'a.json': JSON.stringify(instance()), 'b.json': 'broken', 'c.txt': '{}' });
    expect(await snapshotInstanceIds(DIR, io)).toEqual(new Set(['srv-new']));
  });

  it('treats a missing directory as empty', async () => {
    const io = { readdir: async () => { throw new Error('ENOENT'); }, readFile: vi.fn() };
    expect(await snapshotInstanceIds(DIR, io)).toEqual(new Set());
  });
});

describe('awaitNewInstance', () => {
  const sinceMs = Date.parse('2026-01-01T00:00:05.000Z');

  it('returns the single new, started, listening instance', async () => {
    const io = ioWith({
      'old.json': JSON.stringify(instance({ server_id: 'srv-old' })),
      'new.json': JSON.stringify(instance()),
    });
    const found = await awaitNewInstance({
      dir: DIR,
      sinceMs,
      previousIds: new Set(['srv-old']),
      io,
    });
    expect(found.server_id).toBe('srv-new');
  });

  it('ignores pre-existing ids, stale timestamps and port 0', async () => {
    const io = ioWith({
      'stale.json': JSON.stringify(
        instance({ started_at: Date.parse('2025-12-31T00:00:00.000Z') }),
      ),
      'noport.json': JSON.stringify(instance({ server_id: 'srv-np', port: 0 })),
    });
    await expect(
      awaitNewInstance({ dir: DIR, sinceMs, previousIds: new Set(), io, timeoutMs: 50, pollMs: 5 }),
    ).rejects.toThrow(/timed out/);
  });

  it('still accepts an ISO started_at, so a format change cannot break discovery', async () => {
    const io = ioWith({
      'new.json': JSON.stringify(instance({ started_at: '2026-01-01T00:00:10.000Z' })),
    });
    const found = await awaitNewInstance({ dir: DIR, sinceMs, previousIds: new Set(), io });
    expect(found.server_id).toBe('srv-new');
  });

  it('fails closed on registry ambiguity', async () => {
    const io = ioWith({
      'a.json': JSON.stringify(instance({ server_id: 'a' })),
      'b.json': JSON.stringify(instance({ server_id: 'b' })),
    });
    await expect(
      awaitNewInstance({ dir: DIR, sinceMs, previousIds: new Set(), io }),
    ).rejects.toThrow(/multiple new kimi web instances/);
  });
});

describe('pidAlive', () => {
  it('reports the current process as alive and an exited child as dead', async () => {
    expect(pidAlive(process.pid)).toBe(true);
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
    await new Promise((resolve) => child.once('exit', resolve));
    // The kernel object can outlive the exit event briefly; give it a beat.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pidAlive(child.pid)).toBe(false);
  });
});

describe('verifyInstance', () => {
  function fetchImpl(handlers) {
    return vi.fn(async (url, init) => {
      for (const [suffix, handler] of Object.entries(handlers)) {
        if (url.endsWith(suffix)) return handler(init);
      }
      throw new Error(`unexpected ${url}`);
    });
  }

  it('passes with a live registry pid, ok healthz and an accepted token', async () => {
    // Real pidAlive against process.pid; the meta server_id comes from a
    // separate id space and must not be compared with the registry entry.
    const fetchMock = fetchImpl({
      '/healthz': () => ({ ok: true }),
      '/meta': (init) => {
        expect(init.headers.authorization).toBe('Bearer tok');
        return { ok: true, json: async () => ({ data: { server_id: 'unrelated-id' } }) };
      },
    });
    await expect(
      verifyInstance({ port: 1, pid: process.pid, token: 'tok', fetchImpl: fetchMock }),
    ).resolves.toBeUndefined();
  });

  it('fails closed on a dead registered pid before making any request', async () => {
    const fetchMock = fetchImpl({});
    await expect(
      verifyInstance({ port: 1, pid: 4, token: 't', fetchImpl: fetchMock, pidAlive: () => false }),
    ).rejects.toThrow(/registered backend pid 4 is not alive/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails on bad healthz, meta status and network errors', async () => {
    const live = { port: 1, pid: 4, pidAlive: () => true, token: 't' };

    const badHealth = fetchImpl({ '/healthz': () => ({ ok: false, status: 503 }) });
    await expect(
      verifyInstance({ ...live, fetchImpl: badHealth }),
    ).rejects.toThrow(/healthz answered HTTP 503/);

    const badMeta = fetchImpl({
      '/healthz': () => ({ ok: true }),
      '/meta': () => ({ ok: false, status: 401 }),
    });
    await expect(
      verifyInstance({ ...live, fetchImpl: badMeta }),
    ).rejects.toThrow(/meta answered HTTP 401/);

    const offline = vi.fn(async () => { throw new Error('refused'); });
    await expect(
      verifyInstance({ ...live, fetchImpl: offline }),
    ).rejects.toThrow(/healthz unreachable/);
  });

  it('bounds a wedged readiness request with the supplied abort signal', async () => {
    const signal = AbortSignal.timeout(20);
    const wedged = vi.fn((url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    }));
    await expect(
      verifyInstance({ port: 1, pid: process.pid, token: 't', fetchImpl: wedged, signal }),
    ).rejects.toThrow(/healthz unreachable/);
  });
});
