import { setImmediate as nextTurn } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';

import { createDebugLog } from '../src/debugLog.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function memoryDisk() {
  const chunks = [];
  const handle = {
    write: vi.fn(async (buffer, offset, length) => {
      chunks.push(Buffer.from(buffer.subarray(offset, offset + length)));
      return { bytesWritten: length };
    }),
    close: vi.fn(async () => {}),
  };
  const fs = {
    mkdir: vi.fn(async () => {}), open: vi.fn(async () => handle),
    rm: vi.fn(async () => {}), rename: vi.fn(async () => {}),
  };
  return { fs, handle, chunks, lines: () => Buffer.concat(chunks).toString().trim().split('\n').filter(Boolean).map(JSON.parse) };
}

async function loggerFor(disk, options = {}) {
  return createDebugLog({ enabled: true, home: 'fixture-home', fs: disk.fs, ...options });
}

describe('bounded diagnostic sink', () => {
  it('does not write synchronously, uses small batches, and preserves event ordering', async () => {
    const disk = memoryDisk();
    const logger = await loggerFor(disk);
    for (let id = 0; id < 1000; id++) logger.emit('http_begin', { id });
    expect(disk.handle.write).not.toHaveBeenCalled();
    await logger.close();
    expect(disk.handle.write.mock.calls.length).toBeGreaterThan(1);
    expect(disk.lines().map((line) => line.id)).toEqual(Array.from({ length: 1000 }, (_, id) => id));
    for (const [, , length] of disk.handle.write.mock.calls) expect(length).toBeLessThanOrEqual(16 * 1024);
  });

  it('bounds the default 256 KiB queue even when the first disk write is stalled', async () => {
    const disk = memoryDisk();
    const gate = deferred();
    const originalWrite = disk.handle.write.getMockImplementation();
    disk.handle.write.mockImplementationOnce(async (...args) => {
      await gate.promise;
      return originalWrite(...args);
    });
    const logger = await loggerFor(disk);
    for (let id = 0; id < 10_000; id++) logger.emit('http_begin', { id });
    await nextTurn();
    expect(disk.handle.write).toHaveBeenCalledTimes(1);
    gate.resolve();
    await logger.close();
    const lines = disk.lines();
    const accepted = lines.filter((line) => line.event === 'http_begin');
    const acceptedBytes = Buffer.byteLength(accepted.map((line) => `${JSON.stringify(line)}\n`).join(''));
    expect(acceptedBytes).toBeLessThanOrEqual(256 * 1024);
    const dropped = lines.filter((line) => line.event === 'log_dropped');
    expect(dropped.reduce((total, line) => total + line.dropped, 0)).toBe(10_000 - accepted.length);
    expect(dropped.length).toBeGreaterThan(0);
  });

  it('counts in-flight batches against an injected queue budget and later reports all drops', async () => {
    const disk = memoryDisk();
    const gate = deferred();
    const originalWrite = disk.handle.write.getMockImplementation();
    disk.handle.write.mockImplementationOnce(async (...args) => {
      await gate.promise;
      return originalWrite(...args);
    });
    const logger = await loggerFor(disk, { queueBytes: 512 });
    logger.emit('http_begin', { id: 0 });
    await nextTurn();
    for (let id = 1; id < 1001; id++) logger.emit('http_begin', { id });
    expect(disk.handle.write).toHaveBeenCalledTimes(1);
    gate.resolve();
    await logger.close();
    const lines = disk.lines();
    const accepted = lines.filter((line) => line.event === 'http_begin');
    expect(accepted.length).toBeLessThan(10);
    expect(lines.reduce((sum, line) => sum + (line.dropped ?? 0), accepted.length)).toBe(1001);
  });

  it('handles partial writes without truncating or duplicating records', async () => {
    const disk = memoryDisk();
    disk.handle.write.mockImplementation(async (buffer, offset, length) => {
      const bytesWritten = Math.min(7, length);
      disk.chunks.push(Buffer.from(buffer.subarray(offset, offset + bytesWritten)));
      return { bytesWritten };
    });
    const logger = await loggerFor(disk);
    logger.emit('http_end', { id: 8, wireBytes: 100 });
    await logger.close();
    expect(disk.lines()).toEqual([{ schema: 1, time: expect.any(String), event: 'http_end', id: 8, wireBytes: 100 }]);
    expect(disk.handle.write.mock.calls.length).toBeGreaterThan(1);
  });

  it('reports an oversized record as dropped without crossing the file bound', async () => {
    const disk = memoryDisk();
    const logger = await loggerFor(disk, { maxBytes: 130 });
    logger.emit('http_end', { id: 1, rawBytes: 100, wireBytes: 100, elapsedMs: 1, method: 'GET' });
    await logger.close();
    expect(disk.lines().map((line) => [line.event, line.dropped])).toEqual([['log_dropped', 1]]);
    expect(Buffer.concat(disk.chunks).length).toBeLessThanOrEqual(130);
  });

});

describe('bounded diagnostic shutdown', () => {
  it('bounds close to the configured deadline for a hung disk and handles late rejection', async () => {
    const disk = memoryDisk();
    const gate = deferred();
    disk.handle.write.mockImplementation(() => gate.promise);
    const warn = vi.fn();
    const logger = await loggerFor(disk, { closeTimeoutMs: 20, warn });
    logger.emit('http_begin', { id: 0 });
    await nextTurn();
    const start = performance.now();
    const closing = logger.close();
    expect(logger.close()).toBe(closing);
    await closing;
    expect(performance.now() - start).toBeLessThan(500);
    expect(disk.handle.close).toHaveBeenCalledTimes(1);
    gate.reject(new Error('marker-secret-path'));
    await nextTurn();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('marker-secret-path');
    expect(logger.close()).toBe(closing);
  });

  it('uses a one-second close deadline by default', async () => {
    const disk = memoryDisk();
    const gate = deferred();
    disk.handle.write.mockImplementation(() => gate.promise);
    const warn = vi.fn();
    const logger = await loggerFor(disk, { warn });
    logger.emit('http_begin');
    await nextTurn();
    vi.useFakeTimers();
    try {
      let closed = false;
      const closing = logger.close().then(() => { closed = true; });
      await vi.advanceTimersByTimeAsync(999);
      expect(closed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await closing;
      expect(closed).toBe(true);
      gate.resolve({ bytesWritten: disk.handle.write.mock.calls[0][2] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('also bounds a hung file close operation', async () => {
    const disk = memoryDisk();
    const gate = deferred();
    disk.handle.close.mockImplementation(() => gate.promise);
    const warn = vi.fn();
    const logger = await loggerFor(disk, { closeTimeoutMs: 10, warn });
    await logger.close();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(disk.handle.close).toHaveBeenCalledTimes(1);
    gate.resolve();
    await nextTurn();
  });
});

describe('diagnostic failure isolation', () => {
  it.each(['mkdir', 'open'])('returns undefined and warns with a fixed message on %s failure', async (operation) => {
    const disk = memoryDisk();
    disk.fs[operation].mockRejectedValue(new Error('marker-token marker-path marker-error'));
    const warn = vi.fn();
    expect(await loggerFor(disk, { warn })).toBeUndefined();
    expect(warn.mock.calls).toEqual([['Debug logging unavailable; diagnostic records may be lost.']]);
  });

  it.each(['write', 'close'])('isolates %s failure with one warning and no original error', async (operation) => {
    const disk = memoryDisk();
    disk.handle[operation].mockRejectedValue(new Error('marker-token marker-path marker-body'));
    const warn = vi.fn();
    const logger = await loggerFor(disk, { warn });
    expect(() => logger.emit('http_begin', { id: 1 })).not.toThrow();
    await logger.close();
    expect(() => logger.emit('http_end', { id: 1 })).not.toThrow();
    await logger.close();
    expect(warn.mock.calls).toEqual([['Debug logging unavailable; diagnostic records may be lost.']]);
  });

  it.each([0, -1, 1.5, Infinity, undefined, 99999])('rejects invalid write progress %s safely', async (bytesWritten) => {
    const disk = memoryDisk();
    disk.handle.write.mockResolvedValue({ bytesWritten });
    const warn = vi.fn();
    const logger = await loggerFor(disk, { warn });
    logger.emit('http_begin');
    await logger.close();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each(['rm', 'rename', 'open'])('isolates %s failures during rotation', async (operation) => {
    const disk = memoryDisk();
    const logger = await loggerFor(disk, { maxBytes: 130, warn: () => {} });
    disk.fs[operation].mockRejectedValue(new Error('marker-error'));
    logger.emit('http_begin', { id: 1 });
    logger.emit('http_end', { id: 1 });
    await logger.close();
    expect(disk.lines().length).toBe(1);
  });

  it('ignores only ENOENT for a missing first backup', async () => {
    const disk = memoryDisk();
    disk.fs.rename.mockRejectedValueOnce(Object.assign(new Error('marker-path'), { code: 'ENOENT' }));
    const warn = vi.fn();
    const logger = await loggerFor(disk, { maxBytes: 130, warn });
    logger.emit('http_begin', { id: 1 });
    logger.emit('http_end', { id: 1 });
    await logger.close();
    expect(disk.lines().length).toBe(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not expose even a throwing warning callback as an unhandled rejection', async () => {
    const disk = memoryDisk();
    disk.handle.write.mockRejectedValue(new Error('marker-error'));
    const logger = await loggerFor(disk, { warn: () => { throw new Error('marker-warning'); } });
    logger.emit('http_begin');
    await expect(logger.close()).resolves.toBeUndefined();
  });

  it('closes a file opened after the close deadline without resuming writes', async () => {
    const disk = memoryDisk();
    const gate = deferred();
    const lateHandle = { write: vi.fn(), close: vi.fn(async () => {}) };
    disk.fs.open.mockResolvedValueOnce(disk.handle).mockImplementationOnce(() => gate.promise);
    const logger = await loggerFor(disk, { maxBytes: 130, closeTimeoutMs: 10, warn: vi.fn() });
    logger.emit('http_begin', { id: 1 });
    logger.emit('http_end', { id: 1 });
    await nextTurn();
    await logger.close();
    gate.resolve(lateHandle);
    await nextTurn();
    expect(lateHandle.close).toHaveBeenCalledTimes(1);
    expect(lateHandle.write).not.toHaveBeenCalled();
  });
});
