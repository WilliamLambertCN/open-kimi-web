import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installIntegration,
  repairIntegration,
  uninstallIntegration,
} from '../../src/integration/integrate.mjs';
import { renderRcBlock } from '../../src/integration/pathInstall.mjs';
import { canonicalPath } from '../../src/integration/realKimi.mjs';
import { integrationPaths, loadState } from '../../src/integration/state.mjs';
import { statusIntegration } from '../../src/integration/status.mjs';
import { WRAPPER_MARKER } from '../../src/integration/wrapperGen.mjs';

let root;
let stateHome;
let userHome;
let officialDir;
let logs;
let errors;

const run = vi.fn(async () => ({ code: 0, stdout: 'kimi 1.2.3\n', stderr: '' }));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'okw-integrate-'));
  stateHome = join(root, 'state');
  userHome = join(root, 'home');
  officialDir = join(root, 'official');
  mkdirSync(userHome, { recursive: true });
  mkdirSync(officialDir, { recursive: true });
  writeFileSync(join(officialDir, 'kimi'), '#!/bin/sh\n# official kimi double\n');
  writeFileSync(join(userHome, '.bashrc'), '# user bashrc\n');
  logs = [];
  errors = [];
  run.mockClear();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function options(envOverrides = {}, extra = {}) {
  return {
    env: {
      OPEN_KIMI_WEB_HOME: stateHome,
      HOME: userHome,
      PATH: officialDir,
      ...envOverrides,
    },
    platform: 'linux',
    run,
    log: (line) => logs.push(line),
    error: (line) => errors.push(line),
    ...extra,
  };
}

function winOptions(store, extra = {}) {
  return options(
    { PATH: officialDir },
    {
      platform: 'win32',
      readUserPath: async () => store.value,
      readSystemPath: async () => '',
      writeUserPath: async (next) => {
        store.value = next;
      },
      ...extra,
    },
  );
}

describe('install', () => {
  it('installs wrapper, rc block and state; reports the shell refresh hint', async () => {
    const result = await installIntegration(options());
    expect(result.changed).toBe(true);
    const paths = integrationPaths(stateHome);
    const wrapper = join(paths.bin, 'kimi');
    expect(readFileSync(wrapper, 'utf8')).toContain(WRAPPER_MARKER);
    expect(readFileSync(wrapper, 'utf8')).toContain(
      `OPEN_KIMI_REAL_KIMI='${await canonicalPath(join(officialDir, 'kimi'))}'`,
    );
    expect(readFileSync(join(userHome, '.bashrc'), 'utf8')).toContain('# >>> open-kimi-web >>>');
    const state = (await loadState(paths)).state;
    expect(state.realKimiVersion).toBe('kimi 1.2.3');
    expect(state.pathInstall).toEqual({ kind: 'rc', file: join(userHome, '.bashrc') });
    expect(logs.join('\n')).toMatch(/hash -r|new shell/i);
    // The official file is untouched.
    expect(readFileSync(join(officialDir, 'kimi'), 'utf8')).toContain('official kimi double');
  });

  it('is idempotent when the state and wrapper are intact', async () => {
    await installIntegration(options());
    const rcBefore = readFileSync(join(userHome, '.bashrc'), 'utf8');
    const second = await installIntegration(options());
    expect(second.changed).toBe(false);
    expect(logs.join('\n')).toMatch(/already installed/);
    expect(readFileSync(join(userHome, '.bashrc'), 'utf8')).toBe(rcBefore);
  });

  it('repairs a missing PATH registration instead of claiming the install is intact', async () => {
    const store = { value: 'C:\\official' };
    const first = await installIntegration(winOptions(store));
    store.value = 'C:\\official';
    const second = await installIntegration(winOptions(store));
    expect(second.changed).toBe(true);
    expect(store.value).toBe(`${first.state.wrapperDir};C:\\official`);
    expect(logs.join('\n')).not.toMatch(/already installed/);
  });

  it('refuses when the real kimi cannot be resolved', async () => {
    await expect(installIntegration(options({ PATH: join(root, 'empty') }))).rejects.toThrow(
      /could not find the official kimi/,
    );
  });

  it('refuses when resolution would recurse into the wrapper', async () => {
    // The only "kimi" on PATH identifies itself as our wrapper.
    run.mockResolvedValueOnce({ code: 0, stdout: 'open-kimi-web wrapper\n', stderr: '' });
    await expect(installIntegration(options())).rejects.toThrow(/could not find the official kimi/);
  });

  it('refuses on a half-install: rc marker block without a state file', async () => {
    writeFileSync(join(userHome, '.bashrc'), `# user bashrc\n${renderRcBlock(join(stateHome, 'bin'))}`);
    await expect(installIntegration(options())).rejects.toThrow(/repair/);
  });

  it('rolls back the wrapper when PATH installation fails', async () => {
    const env = { OPEN_KIMI_WEB_HOME: stateHome, PATH: officialDir, HOME: undefined, USERPROFILE: undefined };
    await expect(
      installIntegration(options(env)),
    ).rejects.toThrow(/HOME is not set/);
    const paths = integrationPaths(stateHome);
    expect(existsSync(paths.bin)).toBe(false);
    expect(existsSync(paths.stateFile)).toBe(false);
  });
});

describe('repair', () => {
  it('rebuilds a deleted wrapper and refreshes state, keeping installedAt', async () => {
    const first = await installIntegration(options());
    const paths = integrationPaths(stateHome);
    rmSync(join(paths.bin, 'kimi'));
    const repaired = await repairIntegration(options());
    expect(readFileSync(join(paths.bin, 'kimi'), 'utf8')).toContain(WRAPPER_MARKER);
    expect(repaired.state.installedAt).toBe(first.state.installedAt);
    // repair also fixes a missing rc block
    writeFileSync(join(userHome, '.bashrc'), '# user bashrc\n');
    await repairIntegration(options());
    expect(readFileSync(join(userHome, '.bashrc'), 'utf8')).toContain('# >>> open-kimi-web >>>');
  });

  it('restores an existing wrapper when a later PATH repair step fails', async () => {
    const store = { value: 'C:\\official' };
    const installed = await installIntegration(winOptions(store));
    const wrapper = join(installed.state.wrapperDir, 'kimi.cmd');
    const original = `${readFileSync(wrapper, 'utf8')}rem preserved before failed repair\r\n`;
    writeFileSync(wrapper, original);
    store.value = 'C:\\official';
    await expect(
      repairIntegration(winOptions(store, { writeUserPath: async () => { throw new Error('denied'); } })),
    ).rejects.toThrow(/denied/);
    expect(readFileSync(wrapper, 'utf8')).toBe(original);
  });
});

describe('status', () => {
  it('reports not installed with exit 0', async () => {
    const result = await statusIntegration(options());
    expect(result.code).toBe(0);
    expect(logs.join('\n')).toMatch(/not installed/);
  });

  it('is healthy after install; a pre-install shell PATH is only a note', async () => {
    await installIntegration(options());
    const result = await statusIntegration(options());
    expect(result.code).toBe(0);
    expect(logs.join('\n')).toMatch(/healthy/);
    expect(logs.join('\n')).toMatch(/predates the install/);
  });

  it('detects the wrapper shadowing the official kimi when PATH is updated', async () => {
    const installed = await installIntegration(options());
    const result = await statusIntegration(
      options({ PATH: [installed.state.wrapperDir, officialDir].join(delimiter) }),
    );
    expect(result.code).toBe(0);
    expect(logs.join('\n')).toMatch(/wrapper shadows the official kimi/);
  });

  it('reports a missing wrapper as an issue with exit 1', async () => {
    const installed = await installIntegration(options());
    rmSync(join(installed.state.wrapperDir, 'kimi'));
    const result = await statusIntegration(options());
    expect(result.code).toBe(1);
    expect(errors.join('\n')).toMatch(/wrapper/);
  });
});

describe('uninstall', () => {
  it('removes only its own artifacts and keeps official files and data', async () => {
    await installIntegration(options());
    const result = await uninstallIntegration(options());
    expect(result.code).toBe(0);
    const paths = integrationPaths(stateHome);
    expect(existsSync(paths.bin)).toBe(false);
    expect(existsSync(paths.stateFile)).toBe(false);
    expect(readFileSync(join(userHome, '.bashrc'), 'utf8')).toBe('# user bashrc\n');
    expect(existsSync(join(officialDir, 'kimi'))).toBe(true);
    expect(logs.join('\n')).toMatch(/kept: official kimi/i);
  });

  it('keeps wrappers and state when PATH removal fails', async () => {
    const store = { value: 'C:\\official' };
    const installed = await installIntegration(winOptions(store));
    await expect(
      uninstallIntegration(winOptions(store, { writeUserPath: async () => { throw new Error('denied'); } })),
    ).rejects.toThrow(/denied/);
    expect(existsSync(join(installed.state.wrapperDir, 'kimi.cmd'))).toBe(true);
    expect(existsSync(integrationPaths(stateHome).stateFile)).toBe(true);
  });

  it('leaves foreign files in the wrapper directory alone', async () => {
    const installed = await installIntegration(options());
    writeFileSync(join(installed.state.wrapperDir, 'kimi'), '# user edited');
    await uninstallIntegration(options());
    expect(readFileSync(join(installed.state.wrapperDir, 'kimi'), 'utf8')).toBe('# user edited');
  });

  it('is a safe no-op when nothing is installed', async () => {
    const result = await uninstallIntegration(options());
    expect(result.code).toBe(0);
    expect(logs.join('\n')).toMatch(/no state file/);
  });
});

describe('windows PATH handling', () => {
  it('prepends the exact wrapper entry and later removes exactly it', async () => {
    const store = { value: 'C:\\official;C:\\other' };
    const result = await installIntegration(winOptions(store));
    const bin = result.state.wrapperDir;
    expect(store.value).toBe(`${bin};C:\\official;C:\\other`);
    expect(result.state.wrapperFiles).toEqual(['kimi.cmd', 'open-kimi-web.cmd']);
    expect(result.state.pathInstall).toEqual({ kind: 'windows-user-path' });

    await uninstallIntegration(winOptions(store));
    expect(store.value).toBe('C:\\official;C:\\other');
  });

  it('status reads the registry-style user PATH through the seam', async () => {
    const store = { value: 'C:\\official' };
    await installIntegration(winOptions(store));
    const result = await statusIntegration(winOptions(store));
    expect(result.code).toBe(0);
    expect(logs.join('\n')).toMatch(/user PATH: wrapper directory registered/);
  });

  it('warns when an official kimi in System PATH precedes the user wrapper', async () => {
    const store = { value: 'C:\\other' };
    await installIntegration(winOptions(store, { readSystemPath: async () => officialDir }));
    expect(errors.join('\n')).toMatch(/WARNING:.*System PATH.*takeover is not active/i);
  });
});
