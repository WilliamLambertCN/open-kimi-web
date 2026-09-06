import { describe, expect, it, vi } from 'vitest';

import { openUrl } from '../../src/integration/browserOpen.mjs';

function fakeSpawn(behavior) {
  return vi.fn(() => {
    const listeners = {};
    const child = {
      on: (event, fn) => {
        listeners[event] = fn;
        return child;
      },
      unref: () => {},
    };
    queueMicrotask(() => behavior(listeners));
    return child;
  });
}

describe('openUrl', () => {
  it('uses start/open/xdg-open per platform and resolves true on exit 0', async () => {
    const spawn = fakeSpawn((listeners) => listeners.exit?.(0));
    await expect(openUrl('http://x', { platform: 'win32', spawn })).resolves.toBe(true);
    expect(spawn).toHaveBeenCalledWith('cmd', ['/c', 'start', '""', 'http://x'], expect.anything());
    await openUrl('http://x', { platform: 'darwin', spawn });
    expect(spawn).toHaveBeenLastCalledWith('open', ['http://x'], expect.anything());
    await openUrl('http://x', { platform: 'linux', spawn });
    expect(spawn).toHaveBeenLastCalledWith('xdg-open', ['http://x'], expect.anything());
  });

  it('warns instead of throwing when the opener is missing', async () => {
    const warn = vi.fn();
    const spawn = fakeSpawn((listeners) => listeners.error?.(new Error('ENOENT')));
    await expect(openUrl('http://x', { platform: 'linux', spawn, warn })).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/open http:\/\/x yourself/));

    const throwing = vi.fn(() => {
      throw new Error('no spawn');
    });
    await expect(openUrl('http://x', { platform: 'linux', spawn: throwing, warn })).resolves.toBe(false);
  });
});
