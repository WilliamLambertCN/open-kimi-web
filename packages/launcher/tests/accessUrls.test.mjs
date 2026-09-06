import { describe, expect, it } from 'vitest';

import { createAccessUrls, formatAccessUrl, withTokenFragment } from '../src/accessUrls.mjs';

const interfaces = {
  Ethernet: [
    { address: '192.168.1.20', family: 'IPv4', internal: false },
    { address: '2001:db8::20', family: 'IPv6', internal: false },
  ],
};

describe('formatAccessUrl', () => {
  it('formats IPv4, hostnames, and bracketed IPv6', () => {
    expect(formatAccessUrl('127.0.0.1', 4173)).toBe('http://127.0.0.1:4173');
    expect(formatAccessUrl('localhost', 4173)).toBe('http://localhost:4173');
    expect(formatAccessUrl('2001:db8::1', 4173)).toBe('http://[2001:db8::1]:4173');
    expect(formatAccessUrl('[2001:db8::1]', 4173)).toBe('http://[2001:db8::1]:4173');
    expect(formatAccessUrl('192.168.1.20', 4173, 'https')).toBe('https://192.168.1.20:4173');
  });
});

describe('withTokenFragment', () => {
  it('percent-encodes tokens without changing the bare URL contract', () => {
    const bare = 'https://[::1]:4173';
    expect(withTokenFragment(bare, 'a b&c/#%')).toBe(
      'https://[::1]:4173#token=a%20b%26c%2F%23%25',
    );
    expect(bare).toBe('https://[::1]:4173');
  });
});

describe('createAccessUrls', () => {
  it('uses an openable loopback URL plus every network URL for IPv4 wildcard', () => {
    expect(createAccessUrls('0.0.0.0', 54321, interfaces)).toEqual([
      { type: 'local', url: 'http://127.0.0.1:54321' },
      { type: 'network', url: 'http://192.168.1.20:54321' },
      { type: 'network', url: 'http://[2001:db8::20]:54321' },
    ]);
  });

  it('uses IPv6 loopback for the IPv6 wildcard', () => {
    expect(createAccessUrls('::', 4173, interfaces)[0]).toEqual({
      type: 'local',
      url: 'http://[::1]:4173',
    });
  });

  it('uses HTTPS for every wildcard access URL when requested', () => {
    expect(createAccessUrls('0.0.0.0', 4173, interfaces, 'https')).toEqual([
      { type: 'local', url: 'https://127.0.0.1:4173' },
      { type: 'network', url: 'https://192.168.1.20:4173' },
      { type: 'network', url: 'https://[2001:db8::20]:4173' },
    ]);
  });

  it.each([
    ['127.0.0.1', 'http://127.0.0.1:4173'],
    ['127.0.0.2', 'http://127.0.0.2:4173'],
    ['localhost', 'http://localhost:4173'],
    ['::1', 'http://[::1]:4173'],
  ])('only reports Local for loopback host %s', (host, url) => {
    expect(createAccessUrls(host, 4173, interfaces)).toEqual([{ type: 'local', url }]);
  });

  it.each([
    ['192.168.1.50', 'http://192.168.1.50:4173'],
    ['server.lan', 'http://server.lan:4173'],
    ['2001:db8::50', 'http://[2001:db8::50]:4173'],
  ])('only reports the bound Network URL for specific host %s', (host, url) => {
    expect(createAccessUrls(host, 4173, interfaces)).toEqual([{ type: 'network', url }]);
  });
});
