import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDebugLog, debugLogEnabled } from '../src/debugLog.mjs';

let home;
const loggers = [];

beforeEach(async () => {
  home = await fs.mkdtemp(join(tmpdir(), 'okw-debug-log-'));
});

afterEach(async () => {
  await Promise.all(loggers.splice(0).map((logger) => logger?.close()));
  await fs.rm(home, { recursive: true, force: true });
});

async function create(options = {}) {
  const logger = await createDebugLog({ enabled: true, home, ...options });
  loggers.push(logger);
  return logger;
}

async function records(file) {
  const text = await fs.readFile(file, 'utf8');
  return text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

describe('debug logging activation', () => {
  it('defaults to disabled, including an enabling env without explicit enabled true', async () => {
    const injected = { mkdir: vi.fn(), open: vi.fn() };
    expect(await createDebugLog()).toBeUndefined();
    for (const enabled of [false, undefined, null, 0, 1, 'true']) {
      expect(await createDebugLog({ enabled, home, env: { OPEN_KIMI_WEB_DEBUG_LOG: '1' }, fs: injected }))
        .toBeUndefined();
    }
    expect(injected.mkdir).not.toHaveBeenCalled();
    expect(injected.open).not.toHaveBeenCalled();
    expect(await fs.readdir(home)).toEqual([]);
  });

  it.each([undefined, '', '0', 'false', 'true', 1, true])('ignores env value %s', (value) => {
    expect(debugLogEnabled(false, { OPEN_KIMI_WEB_DEBUG_LOG: value })).toBe(false);
    expect(debugLogEnabled(true, { OPEN_KIMI_WEB_DEBUG_LOG: value })).toBe(true);
  });

  it('requires strict true or the exact env string 1', () => {
    expect(debugLogEnabled(undefined, {})).toBe(false);
    expect(debugLogEnabled('true', {})).toBe(false);
    expect(debugLogEnabled(false, { OPEN_KIMI_WEB_DEBUG_LOG: '1' })).toBe(true);
  });

  it('uses integrationHome and requests private directory and exclusive private files', async () => {
    const injected = { ...fs, mkdir: vi.fn(fs.mkdir), open: vi.fn(fs.open) };
    const logger = await create({ home: undefined, env: { HOME: home }, fs: injected });
    expect(dirname(logger.file)).toBe(join(home, '.open-kimi-web', 'logs'));
    expect(injected.mkdir).toHaveBeenCalledWith(dirname(logger.file), { recursive: true, mode: 0o700 });
    expect(injected.open).toHaveBeenCalledWith(logger.file, 'wx', 0o600);
    expect(basename(logger.file)).toMatch(/^debug-\d{4}-\d{2}-\d{2}-\d+-[0-9a-f]{16}\.jsonl$/);
    await logger.close();
    if (process.platform !== 'win32') {
      expect((await fs.stat(logger.file)).mode & 0o777).toBe(0o600);
      expect((await fs.stat(dirname(logger.file))).mode & 0o777).toBe(0o700);
    }
  });

  it('honors explicit integration home from env', async () => {
    const logger = await create({ home: undefined, env: { OPEN_KIMI_WEB_HOME: home } });
    expect(dirname(logger.file)).toBe(join(home, 'logs'));
  });
});

describe('actual JSONL output', () => {
  it('writes only schema records and drops marker tokens, paths, bodies, errors, and raw identifiers', async () => {
    const logger = await create();
    const markers = ['marker-token', 'marker-path', 'marker-body', 'marker-error', 'marker-session', '192.0.2.19'];
    expect(logger.emit('http_end', {
      id: 1, method: 'GET', route: 'transcript', outcome: 'finished', rawBytes: 400_000_000,
      sessionTag: logger.tag('session', markers[4]), clientTag: logger.tag('client', markers[5]),
      token: markers[0], path: markers[1], body: markers[2], error: new Error(markers[3]),
      session: markers[4], ip: markers[5], schema: 9, time: markers[1], event: markers[2],
    })).toBeUndefined();
    logger.emit('marker-event', { body: markers[2] });
    await logger.close();
    const text = await fs.readFile(logger.file, 'utf8');
    for (const marker of markers) expect(text).not.toContain(marker);
    expect(await records(logger.file)).toEqual([{
      schema: 1, time: expect.any(String), event: 'http_end', id: 1, method: 'GET', route: 'transcript',
      outcome: 'finished', rawBytes: 400_000_000, sessionTag: expect.stringMatching(/^[0-9a-f]{16}$/),
      clientTag: expect.stringMatching(/^[0-9a-f]{16}$/),
    }]);
  });

  it('uses stable in-run domain-separated HMAC tags and fresh salts/files for every run', async () => {
    const first = await create();
    const second = await create();
    expect(first.file).not.toBe(second.file);
    const tag = first.tag('session', 'marker-session');
    expect(tag).toMatch(/^[0-9a-f]{16}$/);
    expect(first.tag('session', 'marker-session')).toBe(tag);
    expect(first.tag('client', 'marker-session')).not.toBe(tag);
    expect(first.tag('ip', 'marker-session')).not.toBe(tag);
    expect(second.tag('session', 'marker-session')).not.toBe(tag);
    expect(first.tag('path', 'marker-path')).toBeUndefined();
    expect(first.tag('session', {})).toBeUndefined();
    first.emit('http_begin', { id: 1 });
    second.emit('ws_begin', { id: 2 });
    await Promise.all([first.close(), second.close()]);
    expect((await records(first.file))[0].id).toBe(1);
    expect((await records(second.file))[0].id).toBe(2);
    expect((await fs.readdir(dirname(first.file))).length).toBe(2);
  });

  it('never throws for hostile fields and does not run getters or arbitrary toJSON', async () => {
    const logger = await create();
    const toJSON = vi.fn(() => { throw new Error('marker-body'); });
    const getter = vi.fn(() => { throw new Error('marker-token'); });
    const fields = { body: { toJSON }, method: { toJSON }, rawBytes: { toJSON } };
    Object.defineProperty(fields, 'id', { get: getter });
    expect(() => logger.emit('http_end', fields)).not.toThrow();
    expect(() => logger.emit('http_end', new Proxy({}, {
      getOwnPropertyDescriptor() { throw new Error('marker-error'); },
    }))).not.toThrow();
    await logger.close();
    expect(toJSON).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
    expect((await records(logger.file)).length).toBe(1);
  });

});

describe('actual disk lifecycle', () => {
  it('rotates at the per-file byte limit with exactly two backups and intact JSON lines', async () => {
    const injected = { ...fs, open: vi.fn(fs.open) };
    const logger = await create({ maxBytes: 300, fs: injected });
    for (let id = 0; id < 50; id++) logger.emit('http_end', { id });
    await logger.close();
    expect((await fs.readdir(dirname(logger.file))).sort()).toEqual([
      basename(logger.file), `${basename(logger.file)}.1`, `${basename(logger.file)}.2`,
    ]);
    for (const file of [logger.file, `${logger.file}.1`, `${logger.file}.2`]) {
      expect((await fs.stat(file)).size).toBeLessThanOrEqual(300);
      const lines = await records(file);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.every((line) => line.event === 'http_end')).toBe(true);
    }
    expect((await records(logger.file)).at(-1).id).toBe(49);
    for (const call of injected.open.mock.calls) expect(call.slice(1)).toEqual(['wx', 0o600]);
  });

  it('returns the identical close promise, drains accepted lines, and ignores subsequent emit', async () => {
    const logger = await create();
    logger.emit('launcher_stop', { outcome: 'shutdown' });
    const first = logger.close();
    expect(first).toBeInstanceOf(Promise);
    expect(logger.close()).toBe(first);
    logger.emit('http_begin', { id: 2 });
    await first;
    expect(logger.close()).toBe(first);
    expect((await records(logger.file)).map((line) => line.event)).toEqual(['launcher_stop']);
  });
});
