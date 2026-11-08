import { createPrivateKey, X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import { generate } from 'selfsigned';

import { DEFAULT_RENEW_BEFORE_MS } from '../tlsCertificate.mjs';
import { assertCertificateProfile } from './x509Profile.mjs';

const DAY_MS = 86_400_000;
export const ROOT_VALIDITY_MS = 1825 * DAY_MS;
export const LEAF_VALIDITY_MS = 365 * DAY_MS;

function assertPair(pair, root, now) {
  const certificate = new X509Certificate(pair.cert);
  const key = createPrivateKey(pair.key);
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails?.modulusLength !== 2048) {
    throw new Error('certificate key must be RSA 2048');
  }
  if (!certificate.checkPrivateKey(key)) throw new Error('certificate and key do not match');
  if (certificate.ca !== root) throw new Error('incorrect CA constraint');
  if (Date.parse(certificate.validFrom) > now.getTime() || Date.parse(certificate.validTo) <= now.getTime()) {
    throw new Error('certificate is outside its validity period');
  }
  assertCertificateProfile(certificate, root);
  return certificate;
}

export function validateLocalCa(pair, now = new Date()) {
  try {
    const certificate = assertPair(pair, true, now);
    if (certificate.subject !== certificate.issuer || !certificate.verify(certificate.publicKey)) {
      throw new Error('root certificate is not self-signed');
    }
    return certificate;
  } catch {
    throw new Error('Local CA is missing, damaged, expired or invalid; restore the original CA before retrying.');
  }
}

export function assertCaRenewalWindow(ca, now, renewBeforeMs = DEFAULT_RENEW_BEFORE_MS) {
  if (Date.parse(ca.validTo) - now.getTime() <= renewBeforeMs + 1000) {
    throw new Error('Local CA has insufficient remaining lifetime for leaf renewal; explicitly provision a new CA.');
  }
}

export function validateLocalCaLeaf(pair, ca, names, now, renewBeforeMs = DEFAULT_RENEW_BEFORE_MS) {
  try {
    const certificate = assertPair(pair, false, now);
    if (!certificate.checkIssued(ca) || !certificate.verify(ca.publicKey)) throw new Error('invalid CA signature');
    if (certificate.publicKey.equals(ca.publicKey)) throw new Error('leaf key must be independent');
    if (Date.parse(certificate.validTo) > Date.parse(ca.validTo) ||
      Date.parse(certificate.validFrom) < Date.parse(ca.validFrom)) throw new Error('invalid leaf validity');
    if (Date.parse(certificate.validTo) - now.getTime() <= renewBeforeMs) {
      return { valid: false, reason: 'certificate expires within renewal window' };
    }
    if (names.some((name) => !(isIP(name) ? certificate.checkIP(name) : certificate.checkHost(name)))) {
      return { valid: false, reason: 'certificate SAN coverage changed' };
    }
    return { valid: true, fingerprint: certificate.fingerprint256, expiresAt: new Date(certificate.validTo).toISOString() };
  } catch {
    return { valid: false, reason: 'invalid local CA leaf certificate or key' };
  }
}

async function generatePair(commonName, options) {
  const pems = await generate([{ name: 'commonName', value: commonName }], {
    keyType: 'rsa', keySize: 2048, algorithm: 'sha256', ...options,
  });
  return { key: pems.private, cert: pems.cert };
}

export async function generateLocalCa(now = new Date()) {
  return generatePair('Open Kimi Web Local CA', {
    notBeforeDate: now,
    notAfterDate: new Date(now.getTime() + ROOT_VALIDITY_MS),
    extensions: [
      { name: 'basicConstraints', cA: true, critical: true, pathLenConstraint: 0 },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    ],
  });
}

export async function generateLocalCaLeaf(names, root, now = new Date()) {
  const ca = new X509Certificate(root.cert);
  return generatePair('localhost', {
    ca: root,
    notBeforeDate: now,
    notAfterDate: new Date(Math.min(now.getTime() + LEAF_VALIDITY_MS, Date.parse(ca.validTo))),
    extensions: [
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true, critical: true },
      { name: 'subjectAltName', altNames: names.map((name) =>
        isIP(name) ? { type: 7, ip: name } : { type: 2, value: name }) },
    ],
  });
}

export function publicCa(certificate) {
  return {
    certificate: Buffer.from(certificate.raw),
    fingerprint: certificate.fingerprint256,
    expiresAt: new Date(certificate.validTo).toISOString(),
  };
}
