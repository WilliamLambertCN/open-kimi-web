import { describe, expect, it } from 'vitest';

import { routeWrapArgv } from '../../src/integration/wrapRoute.mjs';

describe('routeWrapArgv', () => {
  it('delegates non-web commands without a note', () => {
    expect(routeWrapArgv(['chat', '--resume'])).toEqual({ action: 'delegate', reason: null });
    expect(routeWrapArgv([])).toEqual({ action: 'delegate', reason: null });
    expect(routeWrapArgv(['--version'])).toEqual({ action: 'delegate', reason: null });
  });

  it('delegates web subcommands and unsafe/unsupervised flags with a note', () => {
    expect(routeWrapArgv(['web', 'rotate-token']).reason).toMatch(/rotate-token/);
    expect(routeWrapArgv(['web', '--rc']).reason).toMatch(/--rc/);
    expect(routeWrapArgv(['web', '--remote-control']).reason).toMatch(/--remote-control/);
    expect(routeWrapArgv(['web', '--dangerous-bypass-auth']).reason).toMatch(
      /--dangerous-bypass-auth/,
    );
  });

  it('delegates unknown or malformed web arguments losslessly', () => {
    expect(routeWrapArgv(['web', '--allowed-host', 'x']).reason).toMatch(/unsupported arguments/);
    expect(routeWrapArgv(['web', '--port']).reason).toMatch(/unsupported arguments/);
    expect(routeWrapArgv(['web', '--port', 'abc']).reason).toMatch(/unsupported arguments/);
    expect(routeWrapArgv(['web', '--port', '70000']).reason).toMatch(/unsupported arguments/);
    expect(routeWrapArgv(['web', 'extra']).reason).toMatch(/unsupported arguments/);
  });

  it('supervises the understood argument sets', () => {
    expect(routeWrapArgv(['web'])).toEqual({
      action: 'supervise',
      options: { port: undefined, host: undefined, hostBare: false, noOpen: false },
    });
    expect(routeWrapArgv(['web', '--port', '0', '--no-open'])).toEqual({
      action: 'supervise',
      options: { port: 0, host: undefined, hostBare: false, noOpen: true },
    });
    expect(routeWrapArgv(['web', '--host'])).toMatchObject({
      action: 'supervise',
      options: { hostBare: true },
    });
    expect(routeWrapArgv(['web', '--host', '--no-open'])).toMatchObject({
      action: 'supervise',
      options: { hostBare: true, noOpen: true },
    });
    expect(routeWrapArgv(['web', '--host', '0.0.0.0'])).toMatchObject({
      action: 'supervise',
      options: { host: '0.0.0.0', hostBare: false },
    });
  });
});
