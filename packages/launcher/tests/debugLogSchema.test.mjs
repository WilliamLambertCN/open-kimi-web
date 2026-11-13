import { describe, expect, it } from 'vitest';

import { debugLogRecord, safeErrorCode } from '../src/debugLogSchema.mjs';

const events = [
  'launcher_start', 'launcher_stop', 'http_begin', 'http_upstream', 'http_first_byte', 'http_progress',
  'http_end', 'http_error', 'ws_begin', 'ws_ready', 'ws_first_frame', 'ws_progress', 'ws_end', 'ws_error',
  'tls_error', 'client_error', 'log_dropped', 'ws_subscribe', 'ws_subscribed', 'ws_turns',
];
const numbers = [
  'elapsedMs', 'upstreamMs', 'firstByteMs', 'firstFrameMs', 'rawBytes', 'wireBytes', 'status', 'pageSize',
  'upstreamPageSize', 'closeCode', 'toClientMessages', 'toClientBytes', 'toClientMaxBytes', 'toUpstreamMessages',
  'toUpstreamBytes', 'toUpstreamMaxBytes', 'clientBufferedBytes', 'upstreamBufferedBytes', 'dropped',
  'subscribeMs', 'frameBytes', 'resultCode',
];
const booleans = ['enhanced', 'pagingSupported', 'pagingApplied', 'main', 'before', 'after', 'measured'];
const errorCodes = [
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'ABORT_ERR', 'ERR_STREAM_PREMATURE_CLOSE',
  'ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_SSL_SSLV3_ALERT_BAD_CERTIFICATE', 'ERR_SSL_TLSV1_ALERT_UNKNOWN_CA',
  'ERR_SSL_UNEXPECTED_EOF_WHILE_READING', 'ERR_HTTP_REQUEST_TIMEOUT', 'HPE_HEADER_OVERFLOW',
  'HPE_INVALID_METHOD', 'HPE_INVALID_URL', 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH',
];
const enums = {
  method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'other'],
  route: [
    'transcript', 'sessions', 'session', 'meta', 'health', 'config', 'models', 'workspaces', 'search',
    'files', 'usage', 'cron', 'extension', 'static', 'index', 'ws', 'other', 'turns',
  ],
  outcome: ['finished', 'aborted', 'error', 'closed', 'rejected', 'shutdown'],
  encoding: ['identity', 'gzip', 'other'],
  upstreamEncoding: ['identity', 'gzip', 'other'],
  errorCode: [...errorCodes, 'other'],
};

describe('diagnostic record whitelist', () => {
  it.each(events)('accepts only the fixed event %s and owns schema/time/event', (event) => {
    const record = debugLogRecord(event, { schema: 999, time: 'marker-time', event: 'marker-event', id: 1 });
    expect(record).toEqual({ schema: 1, time: expect.any(String), event, id: 1 });
    expect(new Date(record.time).toISOString()).toBe(record.time);
  });

  it.each(['marker-event', '', null, undefined, {}, new String('http_begin')])('rejects event %s', (event) => {
    expect(debugLogRecord(event, { id: 1 })).toBeUndefined();
  });

  it.each(Object.entries(enums))('accepts every %s enumeration and never arbitrary strings', (key, values) => {
    for (const value of values) expect(debugLogRecord('http_end', { [key]: value })[key]).toBe(value);
    expect(debugLogRecord('http_end', { [key]: 'marker-token' })[key]).toBe(key === 'outcome' ? undefined : 'other');
    for (const value of [null, true, {}, 1]) {
      expect(debugLogRecord('http_end', { [key]: value })[key]).toBeUndefined();
    }
  });

  it.each(numbers)('accepts finite nonnegative safe-range %s, including fractional durations', (key) => {
    for (const value of [0, 0.25, 42, Number.MAX_SAFE_INTEGER]) {
      expect(debugLogRecord('http_end', { [key]: value })[key]).toBe(value);
    }
    for (const value of [-1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '42', null, {}, true]) {
      expect(debugLogRecord('http_end', { [key]: value })[key]).toBeUndefined();
    }
  });

  it.each(booleans)('accepts only boolean %s', (key) => {
    for (const value of [true, false]) expect(debugLogRecord('http_end', { [key]: value })[key]).toBe(value);
    for (const value of [0, 1, 'false', null, {}]) {
      expect(debugLogRecord('http_end', { [key]: value })[key]).toBeUndefined();
    }
  });

  it('requires a nonnegative safe integer id', () => {
    for (const id of [0, 1, Number.MAX_SAFE_INTEGER]) expect(debugLogRecord('http_begin', { id }).id).toBe(id);
    for (const id of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
      expect(debugLogRecord('http_begin', { id }).id).toBeUndefined();
    }
  });

  it.each(['clientTag', 'sessionTag'])('accepts only exact lowercase 16-hex %s', (key) => {
    expect(debugLogRecord('ws_begin', { [key]: '0123456789abcdef' })[key]).toBe('0123456789abcdef');
    for (const value of ['0123456789abcde', '0123456789abcdef0', '0123456789abcdeF', '0123456789abcdef\n', {}]) {
      expect(debugLogRecord('ws_begin', { [key]: value })[key]).toBeUndefined();
    }
  });

  it('normalizes only string versions and requires a strict three-part numeric version', () => {
    for (const webVersion of ['0.0.0', '2.4.1', '999.999.999']) {
      expect(debugLogRecord('launcher_start', { webVersion }).webVersion).toBe(webVersion);
    }
    for (const webVersion of ['1000.1.1', 'v2.4.1', '2.4', '2.4.1-r1', '2.4.1\n', 'marker-path']) {
      expect(debugLogRecord('launcher_start', { webVersion }).webVersion).toBe('other');
    }
    expect(debugLogRecord('launcher_start', { webVersion: {} }).webVersion).toBeUndefined();
  });

  it('does not traverse unknown fields, inherited data, accessors, or toJSON', () => {
    const hostile = { toJSON() { throw new Error('marker-body'); } };
    const fields = Object.assign(Object.create({ id: 9 }), {
      token: 'marker-token', path: 'marker-path', body: hostile, error: new Error('marker-error'),
      url: 'https://example.invalid/?marker-query', method: hostile, rawBytes: hostile,
    });
    Object.defineProperty(fields, 'status', { get() { throw new Error('marker-getter'); } });
    expect(debugLogRecord('http_end', fields)).toEqual({ schema: 1, time: expect.any(String), event: 'http_end' });
    for (const value of [undefined, null, 'marker-body', 12]) {
      expect(Object.keys(debugLogRecord('http_end', value))).toEqual(['schema', 'time', 'event']);
    }
  });
});

describe('safe error codes', () => {
  it.each(errorCodes)('accepts only the known error.code %s', (code) => {
    expect(safeErrorCode({ code, message: 'marker-path marker-token', stack: 'marker-body' })).toBe(code);
  });

  it.each([null, undefined, 'ECONNRESET', {}, { code: 'marker-error' }, { code: 400 }, { code: {} }])(
    'normalizes non-whitelisted error %s', (error) => {
      expect(safeErrorCode(error)).toBe('other');
    },
  );

  it('ignores a throwing code accessor', () => {
    expect(safeErrorCode({ get code() { throw new Error('marker-error'); } })).toBe('other');
  });
});
