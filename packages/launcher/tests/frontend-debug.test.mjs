import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/debugLog.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createDebugLog: vi.fn() };
});
vi.mock('../src/serve.mjs', () => ({ createLauncher: vi.fn() }));
vi.mock('../src/officialBundle.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, ensureOfficialBundle: vi.fn() };
});

import { createDebugLog } from '../src/debugLog.mjs';
import { PORT_RETRY_ATTEMPTS, startFrontend } from '../src/frontend.mjs';
import { ensureOfficialBundle } from '../src/officialBundle.mjs';
import { createLauncher } from '../src/serve.mjs';

const fixtureOptions = (over = {}) => ({
  target: 'http://127.0.0.1:1', publicDir: 'fixture-web', host: '127.0.0.1', port: 5000,
  noTokenLink: true, interfaces: {}, targetFetch: vi.fn(async () => new Response(null, { status: 204 })),
  env: {}, log: vi.fn(), warn: vi.fn(), ...over,
});

function fixtureLogger() {
  return {
    file: '/fixture/private-home/logs/debug-fixture.jsonl',
    emit: vi.fn(), tag: vi.fn(), close: vi.fn(async () => {}),
  };
}

function fixtureLauncher() {
  return {
    accessUrls: [{ kind: 'local', url: 'http://127.0.0.1:5000' }],
    server: { address: () => ({ port: 5000 }) }, close: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  createDebugLog.mockReset().mockResolvedValue(undefined);
  createLauncher.mockReset().mockResolvedValue(fixtureLauncher());
  ensureOfficialBundle.mockReset().mockResolvedValue({ dir: 'fixture-official', cached: true });
});
afterEach(() => vi.unstubAllEnvs());

describe('startFrontend debug logging', () => {
  it.each([undefined, '', '0', 'true', '01', ' 1', '1 '])('does not enable diagnostics for env=%s', async (value) => {
    const opts = fixtureOptions({ env: { OPEN_KIMI_WEB_DEBUG_LOG: value } });
    await startFrontend(opts);
    expect(createDebugLog).toHaveBeenCalledExactlyOnceWith({
      enabled: false, home: undefined, env: opts.env, warn: opts.warn,
    });
    expect(createLauncher).toHaveBeenCalledWith(expect.objectContaining({ debugLog: undefined }));
    expect(opts.log.mock.calls.flat().some((line) => line.includes('debug log enabled'))).toBe(false);
  });

  it.each([
    [true, '0'], [false, '1'], [true, undefined],
  ])('passes one logger for flag=%s env=%s and prints only its basename', async (debugLog, value) => {
    const logger = fixtureLogger();
    createDebugLog.mockResolvedValueOnce(logger);
    const opts = fixtureOptions({ debugLog, env: { OPEN_KIMI_WEB_DEBUG_LOG: value }, home: '/fixture/okw-home' });
    const result = await startFrontend(opts);
    expect(createDebugLog).toHaveBeenCalledExactlyOnceWith({
      enabled: true, home: '/fixture/okw-home', env: opts.env, warn: opts.warn,
    });
    expect(createLauncher).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ debugLog: logger }));
    expect(result.launcher).toBe(await createLauncher.mock.results[0].value);
    expect(logger.close).not.toHaveBeenCalled();
    expect(logger.emit).not.toHaveBeenCalled();
    expect(opts.log).toHaveBeenCalledWith('debug log enabled: OKW home/logs/debug-fixture.jsonl');
    expect(opts.log.mock.calls.flat().join('\n')).not.toContain('/fixture/private-home');
  });

  it('uses process.env when no explicit environment is supplied', async () => {
    vi.stubEnv('OPEN_KIMI_WEB_DEBUG_LOG', '1');
    await startFrontend(fixtureOptions({ env: undefined }));
    expect(createDebugLog).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, env: process.env }));
  });

  it('creates diagnostics after resolving the official bundle and before listening', async () => {
    await startFrontend(fixtureOptions({ publicDir: undefined, webVersion: '2.4.1', debugLog: true }));
    expect(ensureOfficialBundle.mock.invocationCallOrder[0]).toBeLessThan(createDebugLog.mock.invocationCallOrder[0]);
    expect(createDebugLog.mock.invocationCallOrder[0]).toBeLessThan(createLauncher.mock.invocationCallOrder[0]);
    expect(createLauncher).toHaveBeenCalledWith(expect.objectContaining({
      publicDir: 'fixture-official', officialWebVersion: '2.4.1', officialPresentation: true,
    }));
  });

  it('does not announce a logger without a file', async () => {
    createDebugLog.mockResolvedValueOnce({ ...fixtureLogger(), file: undefined });
    const opts = fixtureOptions({ debugLog: true });
    await startFrontend(opts);
    expect(opts.log.mock.calls.flat().some((line) => line.includes('debug log enabled'))).toBe(false);
  });
});

describe('startFrontend metrics status', () => {
  it.each(['active', 'incompatible-bundle', 'unavailable-bundle'])(
    'announces verified status %s without enabling debug logging', async (state) => {
      createLauncher.mockResolvedValueOnce({ ...fixtureLauncher(), requestMetricsState: state });
      const opts = fixtureOptions({ publicDir: undefined, webVersion: '2.5.3' });
      await startFrontend(opts);
      const output = state === 'active' ? opts.log : opts.warn;
      expect(output).toHaveBeenCalledWith(expect.stringContaining(`request metrics: ${
        state === 'active' ? 'active' : 'unavailable (' + state + ')'}`));
      expect(createDebugLog).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    });
});

describe('startFrontend diagnostic startup lifetime', () => {
  it('reuses the same logger through a successful port retry without closing it', async () => {
    const logger = fixtureLogger();
    createDebugLog.mockResolvedValueOnce(logger);
    createLauncher.mockRejectedValueOnce(Object.assign(new Error('fixture retry'), { code: 'EADDRINUSE' }));
    await startFrontend(fixtureOptions({ debugLog: true }));
    expect(createDebugLog).toHaveBeenCalledOnce();
    expect(createLauncher.mock.calls.map(([opts]) => opts.port)).toEqual([5000, 5001]);
    expect(createLauncher.mock.calls.every(([opts]) => opts.debugLog === logger)).toBe(true);
    expect(logger.close).not.toHaveBeenCalled();
  });

  it('closes the logger after all numbered and ephemeral port attempts fail', async () => {
    const logger = fixtureLogger();
    createDebugLog.mockResolvedValueOnce(logger);
    createLauncher.mockRejectedValue(Object.assign(new Error('fixture private error'), { code: 'EACCES' }));
    await expect(startFrontend(fixtureOptions({ debugLog: true }))).rejects.toThrow(/no ephemeral port was available/);
    expect(createDebugLog).toHaveBeenCalledOnce();
    expect(createLauncher).toHaveBeenCalledTimes(PORT_RETRY_ATTEMPTS + 1);
    expect(createLauncher.mock.calls.every(([opts]) => opts.debugLog === logger)).toBe(true);
    expect(logger.close).toHaveBeenCalledOnce();
    expect(logger.emit).not.toHaveBeenCalled();
  });

  it('closes on an explicit-port error and preserves the original error if logger close fails', async () => {
    const logger = fixtureLogger();
    logger.close.mockRejectedValueOnce(new Error('fixture logger close error'));
    createDebugLog.mockResolvedValueOnce(logger);
    const original = Object.assign(new Error('fixture private error'), { code: 'EINVAL' });
    createLauncher.mockRejectedValueOnce(original);
    await expect(startFrontend(fixtureOptions({ debugLog: true, portExplicit: true }))).rejects.toBe(original);
    expect(createLauncher).toHaveBeenCalledOnce();
    expect(logger.close).toHaveBeenCalledOnce();
    expect(logger.emit).not.toHaveBeenCalled();
  });

  it('does not create a logger when the target probe fails', async () => {
    await expect(startFrontend(fixtureOptions({ debugLog: true, targetFetch: async () => {
      throw new Error('fixture unreachable');
    } }))).rejects.toThrow(/backend is unreachable/);
    expect(createDebugLog).not.toHaveBeenCalled();
    expect(createLauncher).not.toHaveBeenCalled();
  });

  it('does not create a logger when bundle resolution fails', async () => {
    ensureOfficialBundle.mockRejectedValueOnce(new Error('fixture bundle unavailable'));
    await expect(startFrontend(fixtureOptions({
      debugLog: true, publicDir: undefined, webVersion: '2.4.1',
    }))).rejects.toThrow(/official web UI.*unavailable/);
    expect(createDebugLog).not.toHaveBeenCalled();
    expect(createLauncher).not.toHaveBeenCalled();
  });

  it('keeps a disabled startup failure unchanged without a logger to close', async () => {
    const original = Object.assign(new Error('fixture failure'), { code: 'EINVAL' });
    createLauncher.mockRejectedValueOnce(original);
    await expect(startFrontend(fixtureOptions())).rejects.toBe(original);
    expect(createDebugLog).toHaveBeenCalledOnce();
  });
});
