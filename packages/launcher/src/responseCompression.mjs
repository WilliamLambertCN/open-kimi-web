import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { constants, createGzip } from 'node:zlib';

const MIN_LENGTH = 1024;
const TOKEN = /^[!#$%&'*+.^_`|~\da-z-]+$/i;
const QUALITY = /^q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/i;
const APPLICATION_TYPES = new Set([
  'application/javascript',
  'application/x-javascript',
  'application/ecmascript',
  'application/json',
  'application/xml',
  'application/wasm',
]);

function headerText(value) {
  return Array.isArray(value) ? value.join(',') : String(value ?? '');
}

function normalizeHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
}

function encodingQualities(value) {
  const qualities = new Map();
  for (const entry of headerText(value).split(',')) {
    const [name, ...parameters] = entry.trim().split(';').map((part) => part.trim());
    if (!TOKEN.test(name)) continue;
    const quality = parameters.length === 0 ? 1 : parseQuality(parameters);
    const coding = name.toLowerCase();
    qualities.set(coding, Math.min(qualities.get(coding) ?? 1, quality));
  }
  return qualities;
}

function parseQuality(parameters) {
  const match = parameters.length === 1 && QUALITY.exec(parameters[0]);
  return match ? Number(match[1]) : 0;
}

export function acceptsGzip(value) {
  const qualities = encodingQualities(value);
  const gzip = qualities.get('gzip') ?? qualities.get('*') ?? 0;
  return gzip > 0 && gzip >= (qualities.get('identity') ?? 0);
}

function mergeVary(value) {
  const tokens = new Map();
  for (const token of headerText(value).split(',').map((part) => part.trim()).filter(Boolean)) {
    const key = token.toLowerCase();
    if (!tokens.has(key)) tokens.set(key, token);
  }
  if (tokens.has('*')) return '*';
  if (!tokens.has('accept-encoding')) tokens.set('accept-encoding', 'Accept-Encoding');
  return [...tokens.values()].join(', ');
}

function noTransform(headers) {
  return headerText(headers['cache-control']).split(',').some((part) =>
    part.trim().split('=')[0].trim().toLowerCase() === 'no-transform');
}

function compressibleType(value) {
  const type = headerText(value).split(';')[0].trim().toLowerCase();
  if (type === 'text/event-stream') return false;
  return type.startsWith('text/') || APPLICATION_TYPES.has(type) || type === 'image/svg+xml' ||
    /^application\/[\w.+-]+\+(?:json|xml)$/.test(type);
}

function knownLength(value) {
  const text = headerText(value);
  return /^\d+$/.test(text) ? Number(text) : undefined;
}

function bodyAllowed(method, statusCode) {
  return method !== 'HEAD' && statusCode >= 200 && ![204, 205, 304].includes(statusCode);
}

function representationAllowed(headers, statusCode) {
  return statusCode >= 200 && ![204, 205, 206].includes(statusCode) && headers['content-range'] === undefined &&
    headers['content-encoding'] === undefined && !noTransform(headers);
}

function requestAllowsTransform(req, headers) {
  return req.method !== 'HEAD' && headers.range === undefined && !noTransform(headers);
}

function transformedHeaders(headers) {
  const result = { ...headers };
  for (const name of ['content-length', 'content-md5', 'digest', 'content-digest', 'repr-digest']) delete result[name];
  const etag = headerText(result.etag);
  if (/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag)) result.etag = `W/${etag}`;
  else if (result.etag !== undefined && !/^W\/"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag)) delete result.etag;
  return result;
}

function eligibleRepresentation(headers, statusCode, length) {
  const size = length ?? knownLength(headers['content-length']);
  const largeEnough = size === undefined || size >= MIN_LENGTH;
  const typeAllowed = compressibleType(headers['content-type']) ||
    (statusCode === 304 && headers['content-type'] === undefined);
  return representationAllowed(headers, statusCode) && typeAllowed && largeEnough;
}

function resetContentHeaders(headers, statusCode) {
  if (statusCode !== 205) return;
  if (knownLength(headers['content-length']) !== 0) headers['content-length'] = 0;
  delete headers['transfer-encoding'];
  delete headers.trailer;
}

function variantHeaders(headers, statusCode, eligible, selected) {
  const output = selected ? transformedHeaders(headers) : headers;
  if (eligible) output.vary = mergeVary(output.vary);
  if (selected && statusCode !== 304) output['content-encoding'] = 'gzip';
  return output;
}

export function prepareResponse(req, { statusCode = 200, headers = {}, length } = {}) {
  const requestHeaders = normalizeHeaders(req.headers ?? {});
  const output = normalizeHeaders(headers);
  resetContentHeaders(output, statusCode);
  const hasBody = bodyAllowed(req.method, statusCode);
  const eligible = eligibleRepresentation(output, statusCode, length);
  const selected = eligible && requestAllowsTransform(req, requestHeaders) &&
    acceptsGzip(requestHeaders['accept-encoding']);
  return { headers: variantHeaders(output, statusCode, eligible, selected), gzip: selected && hasBody, bodyAllowed: hasBody };
}

function bufferLength(body) {
  if (typeof body === 'string') return Buffer.byteLength(body);
  if (body instanceof Uint8Array) return body.byteLength;
  return undefined;
}

function responseSource(body) {
  const source = typeof body === 'function' ? body() : body;
  if (source instanceof Readable) return source;
  if (typeof source === 'string' || source instanceof Uint8Array) return Readable.from([source]);
  throw new TypeError('Response body must be a readable, buffer, string, or readable factory');
}

function destroyReadable(body) {
  if (body instanceof Readable) body.destroy();
}

function assertResponseOpen(req, res) {
  if (req.aborted || res.destroyed) throw new Error('Response closed before sending');
  if (res.headersSent) throw new Error('Response headers already sent');
}

function responsePlan(req, res, statusCode, headers, body) {
  const preset = res.getHeaders?.() ?? {};
  const merged = { ...normalizeHeaders(preset), ...normalizeHeaders(headers) };
  const length = bodyAllowed(req.method, statusCode) ? bufferLength(body) : undefined;
  const plan = prepareResponse(req, { statusCode, headers: merged, length });
  for (const name of Object.keys(preset)) {
    if (!(name.toLowerCase() in plan.headers)) res.removeHeader(name);
  }
  return plan;
}

export async function sendResponse(req, res, { statusCode = 200, headers = {}, body = Buffer.alloc(0) } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const close = () => { if (!res.writableFinished) abort(); };
  let source;
  let gzip;
  req.once('aborted', abort);
  res.once('close', close);
  try {
    assertResponseOpen(req, res);
    const plan = responsePlan(req, res, statusCode, headers, body);
    res.writeHead(statusCode, plan.headers);
    if (!plan.bodyAllowed) {
      destroyReadable(body);
      res.end();
      return;
    }
    source = responseSource(body);
    gzip = plan.gzip ? createGzip({ level: 1, flush: constants.Z_SYNC_FLUSH }) : null;
    const streams = gzip ? [source, gzip, res] : [source, res];
    await pipeline(...streams, { signal: controller.signal });
  } catch (error) {
    destroyReadable(source);
    destroyReadable(gzip);
    destroyReadable(body);
    res.destroy();
    throw error;
  } finally {
    req.removeListener('aborted', abort);
    res.removeListener('close', close);
  }
}
