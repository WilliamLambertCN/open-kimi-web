import { X509Certificate } from 'node:crypto';

const PREFIX = '/__open-kimi-mobile/tls/';
const HEX_BYTE = /^[\da-f]{2}$/i;
const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

function decodedPath(path) {
  const output = [];
  for (const char of path) {
    output.push(char);
    while (output.length >= 3 && output.at(-3) === '%' && HEX_BYTE.test(output.at(-2) + output.at(-1))) {
      const value = Number.parseInt(output.slice(-2).join(''), 16);
      output.length -= 3;
      output.push(String.fromCharCode(value));
    }
  }
  return output.join('');
}

function isReserved(path) {
  const parts = [];
  for (const part of decodedPath(path.split(/[?#]/, 1)[0]).split(/[\\/]+/)) {
    if (part === '' || part === '.') continue;
    if (part === '..') { parts.pop(); continue; }
    parts.push(part);
    if (parts.length === 2 && parts[0] === '__open-kimi-mobile' && parts[1] === 'tls') return true;
  }
  return false;
}

function responseMaterial(publicCa) {
  if (!publicCa) return null;
  const certificate = Buffer.from(publicCa.certificate);
  const ca = new X509Certificate(certificate);
  const now = Date.now();
  if (!ca.ca || ca.subject !== ca.issuer || !ca.verify(ca.publicKey) ||
      Date.parse(ca.validFrom) > now || Date.parse(ca.validTo) <= now || !certificate.equals(ca.raw)) {
    throw new Error('Invalid local CA public certificate');
  }
  const status = Buffer.from(JSON.stringify({
    source: 'local-ca', fingerprint: ca.fingerprint256, expiresAt: new Date(ca.validTo).toISOString(),
  }));
  return { certificate, status };
}

function sendCertificate(req, res, name, material) {
  const body = name === 'status' ? material.status : material.certificate;
  const headers = { ...HEADERS, 'content-length': body.length,
    'content-type': name === 'status' ? 'application/json; charset=utf-8' : 'application/pkix-cert' };
  if (name === 'ca.cer') headers['content-disposition'] = 'attachment; filename="open-kimi-web-ca.cer"';
  res.writeHead(200, headers).end(req.method === 'HEAD' ? undefined : body);
}

export function localCaRouteForTls(tls) {
  return createLocalCaRoute(tls?.source === 'local-ca' ? tls.publicCa : null);
}

export function createLocalCaRoute(publicCa) {
  const material = responseMaterial(publicCa);
  return (req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (!isReserved(path)) return false;
    const name = path.slice(PREFIX.length);
    if (!material || !path.startsWith(PREFIX) || !['status', 'ca.cer'].includes(name)) {
      res.writeHead(404, HEADERS).end('Not Found');
      return true;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...HEADERS, allow: 'GET, HEAD' }).end('Method Not Allowed');
      return true;
    }
    sendCertificate(req, res, name, material);
    return true;
  };
}
