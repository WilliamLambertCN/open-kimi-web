import { describe, expect, it } from 'vitest';

import { tlsStatusLines } from '../src/tlsMessages.mjs';

describe('tlsStatusLines', () => {
  it('reports first-use trust guidance and rotation without exposing PEM data', () => {
    const created = tlsStatusLines({
      source: 'managed',
      created: true,
      rotated: false,
      fingerprint: 'AA:BB',
      key: '-----BEGIN PRIVATE KEY-----secret',
      cert: '-----BEGIN CERTIFICATE-----secret',
    });
    const rotated = tlsStatusLines({
      source: 'managed',
      created: true,
      rotated: true,
      reason: 'certificate SAN missing: 192.168.1.20',
      fingerprint: 'CC:DD',
    });
    const stable = tlsStatusLines({
      source: 'managed', created: false, rotated: false, fingerprint: 'EE:FF',
    });
    const custom = tlsStatusLines({
      source: 'custom', created: false, rotated: false, fingerprint: '11:22',
    });

    expect(created.join('\n')).toMatch(/SHA-256 fingerprint: AA:BB/);
    expect(created.join('\n')).toMatch(/self-signed.*not trusted/i);
    expect(rotated.join('\n')).toMatch(/fingerprint changed.*SAN missing/i);
    expect(stable).toEqual([
      '  SHA-256 fingerprint: EE:FF',
      '  Verify this fingerprint before accepting the browser warning.',
    ]);
    expect(custom).toEqual(['  SHA-256 fingerprint: 11:22']);
    expect([...created, ...rotated, ...stable, ...custom].join('\n')).not.toMatch(
      /PRIVATE KEY|BEGIN CERTIFICATE|secret/,
    );
  });
});
