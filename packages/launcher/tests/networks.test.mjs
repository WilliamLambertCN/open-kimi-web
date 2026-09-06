import { describe, expect, it } from 'vitest';

import { listNetworkAddresses } from '../src/networks.mjs';

describe('listNetworkAddresses', () => {
  it('filters loopback, internal, duplicates, and IPv6 link-local addresses', () => {
    const interfaces = {
      Ethernet: [
        { address: '192.168.1.20', family: 'IPv4', internal: false },
        { address: 'fe80::1234', family: 'IPv6', internal: false },
        { address: '2001:DB8::2', family: 'IPv6', internal: false },
      ],
      WiFi: [
        { address: '10.0.0.8', family: 4, internal: false },
        { address: '192.168.1.20', family: 'IPv4', internal: false },
        { address: '127.0.0.2', family: 'IPv4', internal: false },
        { address: '::1', family: 6, internal: false },
        { address: '10.0.0.9', family: 'IPv4', internal: true },
      ],
    };

    expect(listNetworkAddresses(interfaces)).toEqual([
      '10.0.0.8',
      '192.168.1.20',
      '2001:db8::2',
    ]);
  });

  it('sorts IPv4 numerically before IPv6 and handles empty interfaces', () => {
    expect(
      listNetworkAddresses({
        z: [
          { address: '192.168.1.100', family: 'IPv4', internal: false },
          { address: '2001:db8::b', family: 'IPv6', internal: false },
        ],
        a: [
          { address: '192.168.1.9', family: 'IPv4', internal: false },
          { address: '2001:db8::a', family: 'IPv6', internal: false },
        ],
      }),
    ).toEqual(['192.168.1.9', '192.168.1.100', '2001:db8::a', '2001:db8::b']);
    expect(listNetworkAddresses({ Ethernet: undefined })).toEqual([]);
  });
});
