import { describe, expect, it } from 'vitest';

import { isVirtualInterfaceName, listNetworkAddresses } from '../src/networks.mjs';

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

  it('drops Windows and POSIX virtual adapters while keeping physical ones', () => {
    const interfaces = {
      'vEthernet (WSL)': [{ address: '172.20.0.1', family: 'IPv4', internal: false }],
      'VMware Network Adapter VMnet8': [{ address: '192.168.222.1', family: 'IPv4', internal: false }],
      'vEthernet (Default Switch)': [{ address: '172.31.240.1', family: 'IPv4', internal: false }],
      'TAP-Windows Adapter V9': [{ address: '10.8.0.1', family: 'IPv4', internal: false }],
      以太网: [{ address: '192.168.3.40', family: 'IPv4', internal: false }],
      WLAN: [{ address: '192.168.3.41', family: 'IPv4', internal: false }],
      docker0: [{ address: '172.17.0.1', family: 'IPv4', internal: false }],
      'br-9f2a': [{ address: '172.18.0.1', family: 'IPv4', internal: false }],
      tailscale0: [{ address: '100.64.0.1', family: 'IPv4', internal: false }],
      eth0: [{ address: '10.1.0.5', family: 'IPv4', internal: false }],
      '': [{ address: '10.9.9.9', family: 'IPv4', internal: false }],
    };
    expect(listNetworkAddresses(interfaces)).toEqual([
      '10.1.0.5',
      '10.9.9.9',
      '192.168.3.40',
      '192.168.3.41',
    ]);
  });
});

describe('isVirtualInterfaceName', () => {
  it.each([
    'vEthernet (WSL)',
    'vEthernet (nat)',
    'VMware Network Adapter VMnet1',
    'VirtualBox Host-Only Network',
    'Hyper-V Virtual Ethernet Adapter',
    'Loopback Pseudo-Interface 1',
    'Teredo Tunneling Pseudo-Interface',
    'isatap.example',
    'docker0',
    'veth1234',
    'virbr0',
    'utun0',
    'tun0',
    'tap0',
  ])('flags %s as virtual', (name) => {
    expect(isVirtualInterfaceName(name)).toBe(true);
  });

  it.each(['以太网', 'WLAN', 'Ethernet', 'Wi-Fi', 'eth0', 'en0', 'wlan0', 'br0'])(
    'keeps physical interface %s',
    (name) => {
      expect(isVirtualInterfaceName(name)).toBe(false);
    },
  );
});
