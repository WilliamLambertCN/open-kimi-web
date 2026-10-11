import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { probePty } from '../../../scripts/install/ptyProbe.mjs';

const roots = [];
async function fixture(source = 'module.exports = { spawn: (...args) => globalThis.__okwPtySpawn(...args) };') {
  const root = await mkdtemp(join(tmpdir(), 'okw-pty-probe-'));
  roots.push(root);
  const module = join(root, 'node_modules/node-pty');
  await mkdir(module, { recursive: true });
  await writeFile(join(module, 'package.json'), JSON.stringify({ name: 'node-pty', main: 'index.js' }));
  await writeFile(join(module, 'index.js'), source);
  return root;
}
function terminal() {
  const events = {};
  const child = { onExit: (callback) => { events.exit = callback; }, onData: (callback) => { events.data = callback; },
    kill: vi.fn() };
  const spawn = vi.fn(() => child);
  vi.stubGlobal('__okwPtySpawn', spawn);
  return { events, child, spawn };
}
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('PTY probe output and exit evidence', () => {
  it('distinguishes missing bindings from other load failures', async () => {
    const root = await fixture('throw new Error("Failed to load native module: pty.node");');
    expect(await probePty(root, '/bin/sh', false)).toEqual({ status: 'missing' });
    const corrupt = await fixture('throw new Error("invalid native ABI");');
    expect(await probePty(corrupt, '/bin/sh', false)).toEqual({ status: 'failed' });
  });

  it('requires marker output and zero exit from a profile-free Windows shell', async () => {
    const root = await fixture();
    const { events, spawn } = terminal();
    const result = probePty(root, 'bash.exe', true);
    events.data('open-kimi-pty-ok');
    events.exit({ exitCode: 0 });
    expect(await result).toEqual({ status: 'ok' });
    expect(spawn.mock.calls[0][1]).toEqual(['--noprofile', '--norc', '-c', 'printf open-kimi-pty-ok']);
  });

  it('does not accept zero exit without marker output', async () => {
    const root = await fixture();
    const { events } = terminal();
    const result = probePty(root, '/bin/sh', false);
    events.exit({ exitCode: 0 });
    expect(await result).toEqual({ status: 'failed' });
  });

  it('handles synchronous spawn failure without reporting a missing binding', async () => {
    const root = await fixture();
    vi.stubGlobal('__okwPtySpawn', () => { throw new Error('spawn failed'); });
    expect(await probePty(root, '/bin/sh', false)).toEqual({ status: 'failed' });
  });
});

describe('PTY probe timeout cleanup', () => {
  it('reports failure after timeout when killed terminal exit is confirmed', async () => {
    const root = await fixture();
    vi.useFakeTimers();
    const { events, child } = terminal();
    child.kill.mockImplementation(() => events.exit({ exitCode: 0 }));
    const result = probePty(root, '/bin/sh', false);
    events.data('open-kimi-pty-ok');
    await vi.advanceTimersByTimeAsync(10000);
    expect(await result).toEqual({ status: 'failed' });
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('reports unconfirmed cleanup if the killed terminal never exits', async () => {
    const root = await fixture();
    vi.useFakeTimers();
    const { child } = terminal();
    child.kill.mockImplementation(() => { throw new Error('kill failed'); });
    const result = probePty(root, '/bin/sh', false);
    await vi.advanceTimersByTimeAsync(12000);
    expect(await result).toEqual({ status: 'unconfirmed' });
    expect(child.kill).toHaveBeenCalledOnce();
  });
});
