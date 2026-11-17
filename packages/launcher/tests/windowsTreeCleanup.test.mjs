import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { terminateTree } from '../src/update/treeCleanup.mjs';
import { recordProcessStart } from '../src/update/windowsTreeCleanup.mjs';

function child() {
  const value = { pid: 123, exitCode: null, signalCode: null };
  recordProcessStart(value, Date.now() - 1);
  return value;
}

function fixture(codes = [0, 0], message = '') {
  const fs = { access: vi.fn(async () => {}), mkdtemp: vi.fn(async () => 'fixture/native-cleanup'),
    copyFile: vi.fn(async () => {}), rm: vi.fn(async () => {}) };
  const helpers = [];
  const spawn = vi.fn(() => {
    const index = helpers.length;
    const helper = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(),
      kill: vi.fn(() => queueMicrotask(() => helper.emit('close', null))) });
    helpers.push(helper);
    queueMicrotask(() => {
      helper.stderr.end(message);
      helper.emit('close', codes[index]);
    });
    return helper;
  });
  return { fs, helpers, spawn };
}

const normalized = (path) => path.replaceAll('\\', '/');

describe('native Windows updater cleanup transport', () => {
  it('compiles the existing ownership algorithm with a fixed system compiler and no PowerShell startup', async () => {
    const setup = fixture();
    await terminateTree(child(), { platform: 'win32', ...setup });
    const [compiler, compileArgs, compileOptions] = setup.spawn.mock.calls[0];
    expect(normalized(compiler)).toMatch(/Windows\/Microsoft\.NET\/Framework64\/v4\.0\.30319\/csc\.exe$/);
    expect(compileArgs.slice(0, 3)).toEqual(['/nologo', '/noconfig', '/target:exe']);
    expect(normalized(compileArgs[3])).toBe('/out:fixture/native-cleanup/cleanup.exe');
    expect(normalized(compileArgs[4])).toMatch(/^\/reference:.*\/System\.dll$/);
    expect(normalized(compileArgs[5])).toBe('fixture/native-cleanup/cleanup.cs');
    const [executable, args, options] = setup.spawn.mock.calls[1];
    expect(normalized(executable)).toBe('fixture/native-cleanup/cleanup.exe');
    expect(args).toHaveLength(3);
    expect(args[0]).toBe('123');
    expect(BigInt(args[1])).toBeLessThanOrEqual(BigInt(args[2]));
    expect(compileOptions).toEqual({ shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    expect(options).toEqual(compileOptions);
    expect(setup.fs.copyFile).toHaveBeenCalledOnce();
    expect(normalized(setup.fs.copyFile.mock.calls[0][0])).toMatch(/update\/windowsTreeCleanup\.cs$/);
    expect(setup.fs.rm).toHaveBeenCalledWith('fixture/native-cleanup', { recursive: true, force: true });
    expect(setup.helpers.every((helper) => helper.kill.mock.calls.length === 0)).toBe(true);
  });

  it('preserves bounded native failure evidence and removes its temporary executable', async () => {
    const setup = fixture([0, 1], 'fixture native error ' + 'x'.repeat(5_000));
    let failure;
    try { await terminateTree(child(), { platform: 'win32', ...setup }); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'UPDATE_CLEANUP_UNCONFIRMED', cleanupUnconfirmed: true });
    expect(failure.message).toContain('fixture native error');
    expect(failure.message.length).toBeLessThan(2_200);
    expect(setup.fs.rm).toHaveBeenCalledOnce();
  });

  it('does not execute a failed build or leave its temporary files', async () => {
    const setup = fixture([1]);
    await expect(terminateTree(child(), { platform: 'win32', ...setup }))
      .rejects.toMatchObject({ cleanupUnconfirmed: true });
    expect(setup.spawn).toHaveBeenCalledOnce();
    expect(setup.fs.rm).toHaveBeenCalledOnce();
  });

  it('rejects helper startup errors without claiming that descendants stopped', async () => {
    const setup = fixture();
    setup.spawn.mockImplementation(() => {
      const helper = new EventEmitter();
      queueMicrotask(() => helper.emit('error', new Error('fixture compiler unavailable')));
      return helper;
    });
    await expect(terminateTree(child(), { platform: 'win32', ...setup })).rejects.toMatchObject({
      code: 'UPDATE_CLEANUP_UNCONFIRMED', message: 'fixture compiler unavailable',
    });
    expect(setup.fs.rm).toHaveBeenCalledOnce();
  });
});

describe('native Windows compiler availability and cleanup deadline', () => {
  it('passes temporary paths containing shell syntax literally and never opens a shell', async () => {
    const setup = fixture();
    const path = 'fixture/native & 100% cleanup';
    setup.fs.mkdtemp.mockResolvedValue(path);
    await terminateTree(child(), { platform: 'win32', ...setup });
    expect(normalized(setup.spawn.mock.calls[0][1][3])).toBe(`/out:${path}/cleanup.exe`);
    expect(normalized(setup.spawn.mock.calls[1][0])).toBe(`${path}/cleanup.exe`);
    expect(setup.spawn.mock.calls.every(([, , options]) => options.shell === false)).toBe(true);
    expect(setup.fs.rm).toHaveBeenCalledWith(path, { recursive: true, force: true });
  });

  it('uses the system 32-bit compiler only if the 64-bit runtime is missing', async () => {
    const setup = fixture();
    setup.fs.access.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    await terminateTree(child(), { platform: 'win32', ...setup });
    expect(normalized(setup.spawn.mock.calls[0][0])).toContain('/Microsoft.NET/Framework/v4.0.30319/csc.exe');
  });

  it('fails closed before spawning if system compilers are absent or inaccessible', async () => {
    for (const code of ['ENOENT', 'EACCES']) {
      const setup = fixture();
      setup.fs.access.mockRejectedValue(Object.assign(new Error('fixture system compiler error'), { code }));
      await expect(terminateTree(child(), { platform: 'win32', ...setup }))
        .rejects.toMatchObject({ cleanupUnconfirmed: true });
      expect(setup.spawn).not.toHaveBeenCalled();
      expect(setup.fs.mkdtemp).not.toHaveBeenCalled();
    }
  });

  it('keeps compilation and execution within the same original three-second deadline', async () => {
    vi.useFakeTimers();
    const setup = fixture();
    setup.spawn.mockImplementation(() => {
      const helper = Object.assign(new EventEmitter(), {
        kill: vi.fn(() => queueMicrotask(() => helper.emit('close', null))),
      });
      setup.helpers.push(helper);
      return helper;
    });
    try {
      const task = terminateTree(child(), { platform: 'win32', ...setup });
      const assertion = expect(task).rejects.toThrow('native Windows cleanup timed out');
      await vi.advanceTimersByTimeAsync(2_000);
      setup.helpers[0].emit('close', 0);
      await vi.advanceTimersByTimeAsync(999);
      expect(setup.helpers[1].kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await assertion;
      expect(setup.helpers[0].kill).not.toHaveBeenCalled();
      expect(setup.helpers[1].kill).toHaveBeenCalledOnce();
      expect(setup.fs.rm).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});
