import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  INTEGRATION_SCHEMA,
  integrationHome,
  integrationPaths,
  loadState,
  makeState,
  removeState,
  saveState,
} from '../../src/integration/state.mjs';

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'okw-state-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function stateFields() {
  return {
    realKimi: '/opt/kimi/bin/kimi',
    realKimiVersion: 'kimi 1.0.0',
    node: '/usr/bin/node',
    wrapperDir: join(dir, 'bin'),
    wrapperFiles: ['kimi'],
    pathInstall: { kind: 'rc', file: '/home/u/.bashrc' },
    installedAt: '2026-01-01T00:00:00.000Z',
    launcherVersion: '0.1.0',
  };
}

describe('integrationHome', () => {
  it('honours OPEN_KIMI_WEB_HOME and otherwise derives from HOME/USERPROFILE', () => {
    expect(integrationHome({ OPEN_KIMI_WEB_HOME: '/custom' })).toBe('/custom');
    expect(integrationHome({ HOME: '/home/u' })).toBe(join('/home/u', '.open-kimi-web'));
    expect(integrationHome({ USERPROFILE: 'C:\\Users\\u' })).toBe(
      join('C:\\Users\\u', '.open-kimi-web'),
    );
  });
});

describe('integration state file', () => {
  it('round-trips through an atomic save/load', async () => {
    const paths = integrationPaths(dir);
    await saveState(paths, stateFields());
    const loaded = await loadState(paths);
    expect(loaded.error).toBeUndefined();
    expect(loaded.state).toEqual({ schema: INTEGRATION_SCHEMA, ...stateFields() });
  });

  it('reports missing, corrupt and wrong-schema files distinctly', async () => {
    const paths = integrationPaths(dir);
    expect(await loadState(paths)).toEqual({ state: null });

    const { writeFileSync } = await import('node:fs');
    writeFileSync(paths.stateFile, 'not json');
    expect((await loadState(paths)).error).toMatch(/corrupt/);

    writeFileSync(paths.stateFile, JSON.stringify({ schema: 999 }));
    expect((await loadState(paths)).error).toMatch(/schema/);
  });

  it('removeState is silent when nothing exists', async () => {
    const paths = integrationPaths(dir);
    await removeState(paths);
    expect(await loadState(paths)).toEqual({ state: null });
  });

  it('makeState keeps only the documented fields', () => {
    expect(makeState({ ...stateFields(), extra: 'dropped' })).not.toHaveProperty('extra');
  });
});
