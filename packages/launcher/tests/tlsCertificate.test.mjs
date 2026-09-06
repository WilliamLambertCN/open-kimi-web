import { X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  generateSelfSignedCertificate,
  requiredSanNames,
  validateManagedCertificate,
} from '../src/tlsCertificate.mjs';

const interfaces = {
  Ethernet: [
    { address: '192.168.1.20', family: 'IPv4', internal: false },
    { address: '2001:db8::20', family: 'IPv6', internal: false },
  ],
};

describe('requiredSanNames', () => {
  it('builds a stable, deduplicated DNS/IP SAN list', () => {
    expect(requiredSanNames({ interfaces, hostname: 'DevBox' })).toEqual([
      'devbox',
      'localhost',
      '127.0.0.1',
      '192.168.1.20',
      '::1',
      '2001:db8::20',
    ]);
    expect(requiredSanNames({ interfaces, hostname: 'LOCALHOST' })).toEqual([
      'localhost',
      '127.0.0.1',
      '192.168.1.20',
      '::1',
      '2001:db8::20',
    ]);
    expect(requiredSanNames({ interfaces, hostname: 'devbox', host: 'server.lan' })).toEqual([
      'devbox',
      'localhost',
      'server.lan',
      '127.0.0.1',
      '::1',
    ]);
  });
});

describe('generated certificate', () => {
  it('is an RSA-2048 SHA-256 leaf for server auth with every required SAN', async () => {
    const names = requiredSanNames({ interfaces, hostname: 'devbox' });
    const pair = await generateSelfSignedCertificate(names, {
      now: new Date('2026-01-01T00:00:00Z'),
    });
    const cert = new X509Certificate(pair.cert);
    const validation = validateManagedCertificate(pair, names, new Date('2026-06-01T00:00:00Z'));

    expect(validation.valid).toBe(true);
    expect(cert.ca).toBe(false);
    expect(cert.publicKey.asymmetricKeyDetails.modulusLength).toBe(2048);
    expect(cert.keyUsage).toContain('1.3.6.1.5.5.7.3.1');
    // X509Certificate.signatureAlgorithm was added in Node 23.5 (absent on
    // the Node 22 CI image); the signer is fixed to SHA-256 at generation,
    // so assert the readable value when the runtime exposes it.
    if (cert.signatureAlgorithm !== undefined) {
      expect(cert.signatureAlgorithm).toBe('sha256WithRSAEncryption');
    }
    expect(cert.validToDate.getTime() - cert.validFromDate.getTime()).toBe(365 * 86_400_000);
    expect(cert.checkHost('devbox')).toBe('devbox');
    expect(cert.checkIP('192.168.1.20')).toBe('192.168.1.20');
    expect(cert.checkIP('2001:db8::20')).toBe('2001:db8::20');
    expect(cert.fingerprint256).toBe(validation.fingerprint);
  });

  it('reports invalid pairs, near expiry, and missing SANs without PEM content', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const pair = await generateSelfSignedCertificate(['localhost', '127.0.0.1'], { now });
    const nearExpiry = validateManagedCertificate(pair, ['localhost'], new Date('2026-12-15T00:00:00Z'));
    const missing = validateManagedCertificate(pair, ['localhost', '192.168.1.20'], now);
    const damaged = validateManagedCertificate({ key: pair.key, cert: 'not a cert' }, [], now);

    expect(nearExpiry.reason).toMatch(/expires within/);
    expect(missing.reason).toMatch(/SAN missing.*192\.168\.1\.20/);
    expect(damaged.reason).toMatch(/invalid certificate or private key/);
    expect(JSON.stringify([nearExpiry, missing, damaged])).not.toContain('PRIVATE KEY');
  });
});
