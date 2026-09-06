import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  defaultTokenFile,
  MAX_LAUNCH_TOKEN_LENGTH,
  resolveLaunchToken,
} from '../src/launchToken.mjs';

const base = { target: 'http://127.0.0.1:58627', noTokenLink: false, tokenFile: null };

describe('defaultTokenFile', () => {
  it('prefers KIMI_CODE_HOME and otherwise uses the official home default', () => {
    expect(defaultTokenFile({ KIMI_CODE_HOME: '/configured' }, '/home/user')).toBe(
      join('/configured', 'server.token'),
    );
    expect(defaultTokenFile({}, '/home/user')).toBe(join('/home/user', '.kimi-code', 'server.token'));
  });
});

describe('resolveLaunchToken', () => {
  it.each(['127.0.0.1', 'localhost', '[::1]'])(
    'best-effort reads the default token for loopback target %s',
    async (host) => {
      const read = vi.fn(async () => '  launch-token\n');
      const result = await resolveLaunchToken({ ...base, target: `http://${host}:58627` }, read);
      expect(result).toEqual({ token: 'launch-token', attempted: true });
      expect(read).toHaveBeenCalledOnce();
    },
  );

  it('does not read by default for a remote target', async () => {
    const read = vi.fn();
    for (const target of ['https://server.example', 'http://127.0.0.2:58627']) {
      await expect(resolveLaunchToken({ ...base, target }, read)).resolves.toEqual({
        token: null,
        attempted: false,
      });
    }
    expect(read).not.toHaveBeenCalled();
  });

  it('lets an explicit token file override target and default paths', async () => {
    const read = vi.fn(async () => 'explicit');
    const result = await resolveLaunchToken({
      ...base,
      target: 'https://server.example',
      tokenFile: '/chosen/token',
    }, read);
    expect(result.token).toBe('explicit');
    expect(read).toHaveBeenCalledWith('/chosen/token', 'utf8');
  });

  it('degrades missing, empty, and overlong files to a bare link', async () => {
    const missing = await resolveLaunchToken(base, async () => { throw new Error('secret path'); });
    const empty = await resolveLaunchToken(base, async () => '  \n');
    const long = await resolveLaunchToken(base, async () => 'x'.repeat(MAX_LAUNCH_TOKEN_LENGTH + 1));
    expect([missing, empty, long]).toEqual([
      { token: null, attempted: true },
      { token: null, attempted: true },
      { token: null, attempted: true },
    ]);
  });

  it('does not read when token links are disabled', async () => {
    const read = vi.fn();
    await expect(resolveLaunchToken({ ...base, noTokenLink: true }, read)).resolves.toEqual({
      token: null,
      attempted: false,
    });
    expect(read).not.toHaveBeenCalled();
  });
});
