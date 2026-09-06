import { createSecureContext } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import { hostname as systemHostname } from 'node:os';
import { generate } from 'selfsigned';

import { isWildcardHost } from './accessUrls.mjs';
import { listNetworkAddresses } from './networks.mjs';

const SERVER_AUTH_OID = '1.3.6.1.5.5.7.3.1';
const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_RENEW_BEFORE_MS = 30 * DAY_MS;

function compareSanNames(left, right) {
  const leftFamily = isIP(left);
  const rightFamily = isIP(right);
  if (leftFamily !== rightFamily) return leftFamily - rightFamily;
  return left.localeCompare(right, undefined, { numeric: true });
}

export function requiredSanNames({ interfaces, hostname = systemHostname(), host } = {}) {
  const names = new Set(['localhost', '127.0.0.1', '::1']);
  if (hostname) names.add(hostname.toLowerCase());
  if (host && !isWildcardHost(host)) names.add(host.replace(/^\[|\]$/g, '').toLowerCase());
  if (!host || isWildcardHost(host)) {
    for (const address of listNetworkAddresses(interfaces)) names.add(address.toLowerCase());
  }
  return [...names].sort(compareSanNames);
}

function extensionsFor(names) {
  const altNames = names.map((name) =>
    isIP(name) ? { type: 7, ip: name } : { type: 2, value: name },
  );
  return [
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true, critical: true },
    { name: 'subjectAltName', altNames },
  ];
}

export async function generateSelfSignedCertificate(names, options = {}) {
  const now = options.now ?? new Date();
  const notAfterDate = new Date(now.getTime() + (options.validDays ?? 365) * DAY_MS);
  const pems = await generate([{ name: 'commonName', value: 'localhost' }], {
    keyType: 'rsa',
    keySize: 2048,
    algorithm: 'sha256',
    notBeforeDate: now,
    notAfterDate,
    extensions: extensionsFor(names),
  });
  return { key: pems.private, cert: pems.cert };
}

function sanMissing(cert, names) {
  for (const name of names) {
    const matched = isIP(name) ? cert.checkIP(name) : cert.checkHost(name);
    if (!matched) return name;
  }
  return null;
}

function inspectPair(pair) {
  createSecureContext({ key: pair.key, cert: pair.cert, minVersion: 'TLSv1.2' });
  return new X509Certificate(pair.cert);
}

export function validateManagedCertificate(
  pair,
  names,
  now = new Date(),
  renewBeforeMs = DEFAULT_RENEW_BEFORE_MS,
) {
  try {
    const cert = inspectPair(pair);
    if (cert.ca) return { valid: false, reason: 'certificate is a CA' };
    if (!cert.keyUsage?.includes(SERVER_AUTH_OID)) {
      return { valid: false, reason: 'certificate lacks serverAuth usage' };
    }
    if (new Date(cert.validFrom).getTime() > now.getTime()) {
      return { valid: false, reason: 'certificate is not valid yet' };
    }
    if (new Date(cert.validTo).getTime() - now.getTime() <= renewBeforeMs) {
      return { valid: false, reason: 'certificate expires within 30 days' };
    }
    const missing = sanMissing(cert, names);
    if (missing) return { valid: false, reason: `certificate SAN missing: ${missing}` };
    return { valid: true, fingerprint: cert.fingerprint256, expiresAt: cert.validTo };
  } catch {
    return { valid: false, reason: 'invalid certificate or private key' };
  }
}

export function validateCustomCertificate(pair, now = new Date()) {
  try {
    const cert = inspectPair(pair);
    const time = now.getTime();
    if (new Date(cert.validFrom).getTime() > time || new Date(cert.validTo).getTime() <= time) {
      throw new Error('certificate is outside its validity period');
    }
    return { fingerprint: cert.fingerprint256, expiresAt: cert.validTo };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    throw new Error(`invalid custom TLS certificate or key: ${detail}`);
  }
}
