import { describe, expect, it } from 'vitest';

import { DEFAULTS, parseArgs, UsageError } from '../src/args.mjs';

const argv = (...args) => ['node', 'open-kimi-web', ...args];

describe('parseArgs', () => {
  it('applies loopback defaults for bare `serve`', () => {
    const opts = parseArgs(argv('serve'));
    expect(opts).toEqual({
      command: 'serve',
      target: DEFAULTS.target,
      host: '127.0.0.1',
      port: 4173,
      portExplicit: false,
      https: false,
      insecureHttp: false,
      certFile: null,
      keyFile: null,
      tokenFile: null,
      noTokenLink: false,
      webDir: null,
      webVersion: null,
    });
  });

  it('parses explicit target/host/port', () => {
    const opts = parseArgs(
      argv('serve', '--target', 'http://localhost:9000', '--host', '0.0.0.0', '--port', '8080'),
    );
    expect(opts.target).toBe('http://localhost:9000');
    expect(opts.host).toBe('0.0.0.0');
    expect(opts.port).toBe(8080);
  });

  it('maps --lan to the IPv4 wildcard host and enables HTTPS', () => {
    const opts = parseArgs(argv('serve', '--lan'));
    expect(opts.host).toBe('0.0.0.0');
    expect(opts.https).toBe(true);
  });

  it('defaults a specific non-loopback host to HTTPS', () => {
    expect(parseArgs(argv('serve', '--host', '192.168.1.20')).https).toBe(true);
  });

  it('keeps explicit loopback on HTTP unless --https is set', () => {
    expect(parseArgs(argv('serve', '--host', 'localhost')).https).toBe(false);
    expect(parseArgs(argv('serve', '--https')).https).toBe(true);
  });

  it('allows explicit insecure HTTP for a non-loopback listener', () => {
    const opts = parseArgs(argv('serve', '--lan', '--insecure-http'));
    expect(opts.https).toBe(false);
    expect(opts.insecureHttp).toBe(true);
  });

  it('accepts paired custom certificate files and implies HTTPS', () => {
    const opts = parseArgs(argv('serve', '--cert-file', 'server.crt', '--key-file', 'server.key'));
    expect(opts.certFile).toBe('server.crt');
    expect(opts.keyFile).toBe('server.key');
    expect(opts.https).toBe(true);
  });

  it('accepts token-file and token-link opt-out modes', () => {
    expect(parseArgs(argv('serve', '--token-file', 'server.token')).tokenFile).toBe('server.token');
    expect(parseArgs(argv('serve', '--no-token-link')).noTokenLink).toBe(true);
  });

  it('rejects token-file combined with token-link opt-out', () => {
    expect(() => parseArgs(argv('serve', '--token-file', 'x', '--no-token-link'))).toThrow(
      /cannot be combined/,
    );
  });

  it.each([
    ['--lan', '--host', '192.168.1.20'],
    ['--host', '192.168.1.20', '--lan'],
  ])('rejects --lan combined with --host', (...flags) => {
    expect(() => parseArgs(argv('serve', ...flags))).toThrow(/--lan.*--host|--host.*--lan/);
  });

  it.each([
    ['--https', '--insecure-http'],
    ['--insecure-http', '--https'],
    ['--insecure-http', '--cert-file', 'server.crt', '--key-file', 'server.key'],
  ])('rejects conflicting TLS flags', (...flags) => {
    expect(() => parseArgs(argv('serve', ...flags))).toThrow(UsageError);
  });

  it.each([
    ['--cert-file', 'server.crt'],
    ['--key-file', 'server.key'],
  ])('requires cert and key files together', (...flags) => {
    expect(() => parseArgs(argv('serve', ...flags))).toThrow(/together/);
  });
});

describe('parseArgs web source selection', () => {
  it('accepts the legacy official no-op plus web-dir and web-version', () => {
    const opts = parseArgs(
      argv('serve', '--web-ui', 'official', '--web-dir', '/srv/web', '--web-version', '0.41.0'),
    );
    expect(opts).not.toHaveProperty('webUi');
    expect(opts.webDir).toBe('/srv/web');
    expect(opts.webVersion).toBe('0.41.0');
  });

  it('rejects removed or unknown UI flavors and a path-like version', () => {
    expect(() => parseArgs(argv('serve', '--web-ui', 'open'))).toThrow(/removed/);
    expect(() => parseArgs(argv('serve', '--web-ui', 'both'))).toThrow(/no longer selects/);
    expect(() => parseArgs(argv('serve', '--web-version', '../etc'))).toThrow(/version/);
    expect(() => parseArgs(argv('serve', '--web-version', '..'))).toThrow(/version/);
    expect(() => parseArgs(argv('serve', '--web-version', 'latest'))).toThrow(/version/);
    expect(() => parseArgs(argv('serve', '--web-dir'))).toThrow(UsageError);
  });

  it('applies OPEN_KIMI_WEB_DIR and accepts legacy official as a no-op', () => {
    const opts = parseArgs(argv('serve'), {
      OPEN_KIMI_WEB_UI: 'official',
      OPEN_KIMI_WEB_DIR: '/env/dir',
    });
    expect(opts).not.toHaveProperty('webUi');
    expect(opts.webDir).toBe('/env/dir');
  });

  it('lets an explicit directory win over the environment', () => {
    const env = { OPEN_KIMI_WEB_DIR: '/env/dir' };
    const opts = parseArgs(argv('serve', '--web-dir', '/flag/dir'), env);
    expect(opts.webDir).toBe('/flag/dir');
  });

  it('rejects OPEN_KIMI_WEB_UI=open even when a custom directory is present', () => {
    expect(() => parseArgs(argv('serve', '--web-dir', '/flag/dir'), {
      OPEN_KIMI_WEB_UI: 'open',
    })).toThrow(/OPEN_KIMI_WEB_UI=open.*removed/);
  });

  it('rejects an unknown OPEN_KIMI_WEB_UI value', () => {
    expect(() => parseArgs(argv('serve'), { OPEN_KIMI_WEB_UI: 'fancy' })).toThrow(UsageError);
  });

  it('ignores an empty OPEN_KIMI_WEB_DIR and keeps the default', () => {
    const opts = parseArgs(argv('serve'), { OPEN_KIMI_WEB_DIR: '' });
    expect(opts.webDir).toBeNull();
  });
});

describe('parseArgs validation', () => {
  it('strips trailing slashes from the target', () => {
    const opts = parseArgs(argv('serve', '--target', 'http://127.0.0.1:58627/'));
    expect(opts.target).toBe('http://127.0.0.1:58627');
  });

  it('rejects a non-http(s) target scheme', () => {
    expect(() => parseArgs(argv('serve', '--target', 'ws://127.0.0.1:1'))).toThrow(UsageError);
    expect(() => parseArgs(argv('serve', '--target', 'ftp://x'))).toThrow(/http/);
  });

  it('rejects credentials embedded in the target URL', () => {
    expect(() => parseArgs(argv('serve', '--target', 'http://user:pass@127.0.0.1:58627'))).toThrow(
      /credentials/,
    );
  });

  it('rejects a malformed target URL', () => {
    expect(() => parseArgs(argv('serve', '--target', 'not a url'))).toThrow(UsageError);
  });

  it.each([
    'http://127.0.0.1:58627/api',
    'http://127.0.0.1:58627/api/v1',
    'http://127.0.0.1:58627/?x=1',
    'http://127.0.0.1:58627/#frag',
    'https://example.test/base/',
  ])('rejects target with path/query/fragment: %s', (target) => {
    expect(() => parseArgs(argv('serve', '--target', target))).toThrow(/root/);
  });

  it('allows root http(s) URLs with a trailing slash', () => {
    expect(parseArgs(argv('serve', '--target', 'http://127.0.0.1:58627/')).target).toBe(
      'http://127.0.0.1:58627',
    );
    expect(parseArgs(argv('serve', '--target', 'https://example.test/')).target).toBe(
      'https://example.test',
    );
  });

  it.each(['0', '65536', '-1', 'abc', '1.5'])('rejects invalid port %s', (port) => {
    expect(() => parseArgs(argv('serve', '--port', port))).toThrow(UsageError);
  });

  it('rejects unknown flags and stray positionals, including a raw token flag', () => {
    expect(() => parseArgs(argv('serve', '--token', 'secret'))).toThrow(UsageError);
    expect(() => parseArgs(argv('serve', '--frobnicate'))).toThrow(UsageError);
    expect(() => parseArgs(argv('serve', 'extra'))).toThrow(UsageError);
    expect(() => parseArgs(argv('explode'))).toThrow(UsageError);
  });

  it('rejects a flag missing its value', () => {
    expect(() => parseArgs(argv('serve', '--target'))).toThrow(UsageError);
  });

  it('treats --help / no args as help, not an error', () => {
    expect(parseArgs(argv('--help')).command).toBe('help');
    expect(parseArgs(argv()).command).toBe('help');
  });
});

describe('parseArgs port explicitness', () => {
  it('flags --port as explicit so the listener does not fall back', () => {
    expect(parseArgs(argv('serve', '--port', '8080')).portExplicit).toBe(true);
  });

  it('leaves portExplicit false for a bare serve', () => {
    expect(parseArgs(argv('serve')).portExplicit).toBe(false);
  });
});
