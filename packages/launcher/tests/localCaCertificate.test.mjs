import { X509Certificate } from 'node:crypto';
import { generate } from 'selfsigned';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  generateLocalCa, generateLocalCaLeaf, validateLocalCa, validateLocalCaLeaf,
} from '../src/tls/localCaCertificate.mjs';

const now = new Date(Math.floor(Date.now() / 1000) * 1000);
let root;
let ca;

beforeAll(async () => {
  root = await generateLocalCa(now);
  ca = validateLocalCa(root, now);
});

async function customRoot(extra = {}) {
  const pems = await generate([{ name: 'commonName', value: 'fixture' }], {
    algorithm: 'sha256', keySize: 2048, keyType: 'rsa', notBeforeDate: now,
    extensions: [
      { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    ],
    ...extra,
  });
  return { key: pems.private, cert: pems.cert };
}

describe('local CA certificate verification', () => {
  it('rejects mismatched root keys and roots outside their validity period', async () => {
    const other = await generateLocalCa(now);
    expect(() => validateLocalCa({ key: other.key, cert: root.cert }, now)).toThrow(/Local CA/);
    expect(() => validateLocalCa(root, new Date(now.getTime() - 1000))).toThrow(/Local CA/);
    expect(() => validateLocalCa(root, new Date(Date.parse(ca.validTo)))).toThrow(/Local CA/);
  });

  it.each([
    { algorithm: 'sha384' },
    { keySize: 1024 },
    { extensions: [{ name: 'basicConstraints', cA: true, pathLenConstraint: 1, critical: true }] },
    { extensions: [{ name: 'basicConstraints', cA: true, pathLenConstraint: 0 }] },
    { extensions: [
      { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true },
      { name: 'keyUsage', keyCertSign: true, critical: true },
    ] },
  ])('rejects roots with an incorrect algorithm, constraints or key usage %#', async (extra) => {
    const pair = await customRoot(extra);
    expect(() => validateLocalCa(pair, now)).toThrow(/Local CA/);
  });

  it('rejects a CA signed by another CA rather than itself', async () => {
    const signed = await customRoot({ ca: root });
    expect(() => validateLocalCa(signed, now)).toThrow(/Local CA/);
  });

  it('rejects a leaf lacking serverAuth and a leaf using the CA key', async () => {
    const pems = await generate([{ name: 'commonName', value: 'localhost' }], {
      ca: root, keySize: 2048, algorithm: 'sha256', notBeforeDate: now,
      extensions: [
        { name: 'basicConstraints', cA: false, critical: true },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
        { name: 'extKeyUsage', clientAuth: true, critical: true },
        { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }] },
      ],
    });
    const leaf = { key: pems.private, cert: pems.cert };
    expect(validateLocalCaLeaf(leaf, ca, ['localhost'], now).valid).toBe(false);
    const reused = await generate([{ name: 'commonName', value: 'localhost' }], {
      ca: root, algorithm: 'sha256', notBeforeDate: now,
      keyPair: { privateKey: root.key, publicKey: ca.publicKey.export({ type: 'spki', format: 'pem' }) },
      extensions: [
        { name: 'basicConstraints', cA: false, critical: true },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
        { name: 'extKeyUsage', serverAuth: true, critical: true },
        { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }] },
      ],
    });
    expect(validateLocalCaLeaf({ key: reused.private, cert: reused.cert }, ca, ['localhost'], now).valid).toBe(false);
    const good = await generateLocalCaLeaf(['localhost'], root, now);
    expect(validateLocalCaLeaf(good, ca, ['localhost'], new Date(now.getTime() - 1000)).valid).toBe(false);
  });

  it('rejects a self-signed server, another CA signature and a mismatched leaf private key', async () => {
    const otherRoot = await generateLocalCa(now);
    const otherLeaf = await generateLocalCaLeaf(['localhost'], otherRoot, now);
    expect(validateLocalCaLeaf(otherLeaf, ca, ['localhost'], now).valid).toBe(false);
    const leaf = await generateLocalCaLeaf(['localhost'], root, now);
    expect(validateLocalCaLeaf({ key: otherLeaf.key, cert: leaf.cert }, ca, ['localhost'], now).valid).toBe(false);
    expect(validateLocalCaLeaf(root, ca, ['localhost'], now).valid).toBe(false);
    expect(new X509Certificate(leaf.cert).verify(new X509Certificate(otherRoot.cert).publicKey)).toBe(false);
  });
});
