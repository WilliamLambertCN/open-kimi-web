import { describe, expect, it } from 'vitest';

import { isDebugApiPath, isRemoteControlApiPath } from '../src/apiPathPolicy.mjs';

const blocked = [
  '/api/v1/debug',
  '/api/v1/debug/',
  '/api/v1/debug/rpc?arg=1',
  '/api/v1/%64ebug',
  '/api/v1/deb%75g/rpc',
  '/api/v1/d%65bug',
  '/%61pi/%76%31/%64%65%62%75%67',
  '/api/v1/%2564ebug',
  '/api/v1/%25%36%34ebug',
  '/api/v1/deb%252575g/rpc',
  '/api/v1/debug%2frpc',
  '/api/v1/debug%2Frpc',
  '/api/v1/debug%252frpc',
  '/api%2fv1%2fdebug',
  '/api/v1%2Fdebug',
  '/api/v1/debug\\rpc',
  '/api\\v1\\debug',
  '/api/v1%5cdebug',
  '/api/v1%5Cdebug',
  '/api/v1%255cdebug',
  '//api///v1//debug',
  '/api/./v1/./debug',
  '/api/v1/x/../debug',
  '/api/v1/x/%2e%2e/%64ebug',
  '/api/v1/fs/%252e%252e/debug',
  '/api/v1/fs%2f..%2fdebug',
  '/api/v1/fs%5c..%5cdebug',
  '/__open-kimi-mobile/../api/v1/%64ebug',
  '/api/v1/debug/../meta',
  '/api/v1/%64ebug/%ZZ',
  '/api/v1/deb%75g/%C0%AF',
  '/api/v1/debug?arg=%',
  '/api/v1/debug#probe',
  '/api/v1/%64ebug#probe?arg=1',
];

const allowed = [
  '/',
  '',
  '/api',
  '/api/v1/meta',
  '/api/v1/debugger',
  '/api/v1/debug.json',
  '/api/v1/debug%25',
  '/api/v1/deb%75gger',
  '/api/v1/DEBUG',
  '/api/v2/debug',
  '/apix/v1/debug',
  '/api/v1/fs/debug:download',
  '/api/v1/fs/debug/file.txt:download',
  '/api/v1/fs/report%25.txt:download',
  '/api/v1/fs/report%2525.txt:download',
  '/api/v1/fs/100%.txt:download',
  '/api/v1/fs/%E4%B8%AD%E6%96%87-debug.txt:download',
  '/api/v1/fs/中文-debug.txt:download',
  '/api/v1/fs/a%2fdebug.txt:download',
  '/api/v1/fs/a%5cdebug.txt:download',
  '/api/v1/meta?path=/api/v1/debug',
  '/api/v1/meta?path=%252fapi%252fv1%252fdebug',
  '/api/v1/ws?client_id=/api/v1/debug&value=%',
  '/api/v1/%',
  '/api/v1/%6',
  '/api/v1/%GG',
  '/api/v1/deb%7g',
  '/api/v1/deb%u0075g',
  '/api/v1/%C0%AFdebug',
  '/api/v1/%E0%A4%A',
  '/api/v1/fs/invalid%FF.txt:download',
];

describe('debug API path policy', () => {
  it.each(blocked)('blocks the debug namespace: %s', (path) => {
    expect(isDebugApiPath(path)).toBe(true);
  });

  it.each(allowed)('does not block unrelated paths or query values: %s', (path) => {
    expect(isDebugApiPath(path)).toBe(false);
  });

  it('reduces deep percent nesting without a recursive decoder or a fixed-pass bypass', () => {
    const encodedD = `%${'25'.repeat(4_000)}64`;
    expect(isDebugApiPath(`/api/v1/${encodedD}ebug`)).toBe(true);
    expect(isDebugApiPath(`/api/v1/fs/${encodedD}ebug.txt:download`)).toBe(false);
  });

  it('handles many encoded bytes and malformed percent sequences without throwing', () => {
    const filename = `${'%25%FF%GG'.repeat(2_000)}.txt`;
    expect(isDebugApiPath(`/api/v1/fs/${filename}:download`)).toBe(false);
    expect(isDebugApiPath(`/api/v1/%64ebug/${filename}`)).toBe(true);
  });
});

describe('remote-control API path policy', () => {
  it.each([
    '/api/v1/remote-control', '/api/v1/remote-control/', '/api/v1/remote-control/start',
    '/api/v1/%72emote-control', '/api/v1/remote%2dcontrol', '/api/v1/%2572emote-control',
    '/api/v1%2Fremote-control', '/api/v1%5cremote-control', '/api//v1/./remote-control',
    '/api/v1/fs/%2e%2e/remote-control', '/api/v1/remote-control/../meta',
    '/api/v1/remote-control#probe', '/api/v1/%72emote-control#probe?arg=1',
  ])('blocks the entire normalized namespace: %s', (path) => {
    expect(isRemoteControlApiPath(path)).toBe(true);
  });

  it.each([
    '/api/v1/meta?path=/api/v1/remote-control', '/api/v1/remote-controller',
    '/api/v1/fs/remote-control:download', '/api/v1/fs/%E4%B8%AD%E6%96%87-remote-control:download',
    '/api/v1/fs/100%.txt:download', '/api/v1/remote%ZZcontrol', '/api/v2/remote-control',
    '/api/v1/remote-control%23probe', '/api/v1/fs/report%23name:download',
  ])('preserves unrelated paths and query values: %s', (path) => {
    expect(isRemoteControlApiPath(path)).toBe(false);
  });
});
