import { describe, expect, it } from 'vitest';

import { buildProxyHeaders, filterHeaders } from '../src/httpProxy.mjs';

describe('filterHeaders', () => {
  it('strips hop-by-hop headers', () => {
    const out = filterHeaders({
      connection: 'keep-alive',
      'keep-alive': 'timeout=5',
      'transfer-encoding': 'chunked',
      te: 'trailers',
      trailer: 'x-expires',
      upgrade: 'websocket',
      'proxy-authorization': 'Basic abc',
      'proxy-authenticate': 'Basic',
      'content-type': 'application/json',
    });
    expect(out).toEqual({ 'content-type': 'application/json' });
  });

  it('strips headers named by the connection token list', () => {
    const out = filterHeaders({
      connection: 'x-acme, keep-alive',
      'x-acme': 'secret',
      'x-keep': 'yes',
    });
    expect(out).toEqual({ 'x-keep': 'yes' });
  });

  it('forwards authorization and accept headers untouched', () => {
    const out = filterHeaders({
      authorization: 'Bearer test-token',
      accept: 'application/json',
    });
    expect(out).toEqual({
      authorization: 'Bearer test-token',
      accept: 'application/json',
    });
  });

  it('removes host so the proxy can rewrite it for the target', () => {
    const out = filterHeaders({ host: '127.0.0.1:4173', 'content-length': '3' });
    expect(out).toEqual({ 'content-length': '3' });
  });
});

describe('buildProxyHeaders', () => {
  it.each([
    ['http://example.test:80', 'example.test', 'http://example.test'],
    ['https://example.test:443', 'example.test', 'https://example.test'],
    ['https://example.test:8443', 'example.test:8443', 'https://example.test:8443'],
  ])('normalizes target Host and Origin for %s', (rawTarget, host, origin) => {
    const target = new URL(rawTarget);
    expect(buildProxyHeaders({ host: 'client.lan', origin: 'http://client.lan' }, target)).toEqual({
      host,
      origin,
    });
  });

  it('does not invent Origin when it was absent', () => {
    expect(buildProxyHeaders({ accept: 'application/json' }, new URL('http://example.test'))).toEqual({
      accept: 'application/json',
      host: 'example.test',
    });
  });
});
