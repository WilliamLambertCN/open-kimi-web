const EVENTS = new Set([
  'launcher_start', 'launcher_stop', 'http_begin', 'http_upstream', 'http_first_byte', 'http_progress',
  'http_end', 'http_error', 'ws_begin', 'ws_ready', 'ws_first_frame', 'ws_progress', 'ws_end', 'ws_error',
  'tls_error', 'client_error', 'log_dropped',
]);

const ERROR_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'ABORT_ERR', 'ERR_STREAM_PREMATURE_CLOSE',
  'ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_SSL_SSLV3_ALERT_BAD_CERTIFICATE', 'ERR_SSL_TLSV1_ALERT_UNKNOWN_CA',
  'ERR_SSL_UNEXPECTED_EOF_WHILE_READING', 'ERR_HTTP_REQUEST_TIMEOUT', 'HPE_HEADER_OVERFLOW',
  'HPE_INVALID_METHOD', 'HPE_INVALID_URL', 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH',
]);

const ENUMS = {
  method: new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'other']),
  route: new Set([
    'transcript', 'sessions', 'session', 'meta', 'health', 'config', 'models', 'workspaces', 'search',
    'files', 'usage', 'cron', 'extension', 'static', 'index', 'ws', 'other',
  ]),
  outcome: new Set(['finished', 'aborted', 'error', 'closed', 'rejected', 'shutdown']),
  encoding: new Set(['identity', 'gzip', 'other']),
  upstreamEncoding: new Set(['identity', 'gzip', 'other']),
  errorCode: ERROR_CODES,
};

const BOOLEANS = new Set(['enhanced', 'pagingSupported', 'pagingApplied', 'main', 'before', 'after', 'measured']);
const NUMBERS = new Set([
  'elapsedMs', 'upstreamMs', 'firstByteMs', 'firstFrameMs', 'rawBytes', 'wireBytes', 'status', 'pageSize',
  'upstreamPageSize', 'closeCode', 'toClientMessages', 'toClientBytes', 'toClientMaxBytes', 'toUpstreamMessages',
  'toUpstreamBytes', 'toUpstreamMaxBytes', 'clientBufferedBytes', 'upstreamBufferedBytes', 'dropped',
]);
const FIELDS = [
  'id', 'clientTag', 'sessionTag', 'webVersion', ...Object.keys(ENUMS), ...BOOLEANS, ...NUMBERS,
];

function enumValue(key, value) {
  if (typeof value !== 'string') return undefined;
  if (ENUMS[key].has(value)) return value;
  return key === 'outcome' ? undefined : 'other';
}

function numericValue(key, value) {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) return undefined;
  if (key === 'id' && !Number.isSafeInteger(value)) return undefined;
  return value;
}

function stringValue(key, value) {
  if (typeof value !== 'string') return undefined;
  if (key === 'webVersion') {
    return /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(?![\s\S])/.test(value) ? value : 'other';
  }
  return /^[0-9a-f]{16}(?![\s\S])/.test(value) ? value : undefined;
}

function fieldValue(key, value) {
  if (Object.hasOwn(ENUMS, key)) return enumValue(key, value);
  if (BOOLEANS.has(key)) return typeof value === 'boolean' ? value : undefined;
  if (NUMBERS.has(key) || key === 'id') return numericValue(key, value);
  return stringValue(key, value);
}

export function safeErrorCode(error) {
  try {
    const code = error?.code;
    return typeof code === 'string' && ERROR_CODES.has(code) ? code : 'other';
  } catch {
    return 'other';
  }
}

export function debugLogRecord(event, fields) {
  if (!EVENTS.has(event)) return undefined;
  const record = { schema: 1, time: new Date().toISOString(), event };
  if (!fields || typeof fields !== 'object') return record;
  for (const key of FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(fields, key);
    const value = fieldValue(key, descriptor?.value);
    if (value !== undefined) record[key] = value;
  }
  return record;
}
