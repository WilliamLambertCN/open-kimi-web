import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpTrace, responseDiagnostics } from '../src/httpDiagnostics.mjs';
import { createTransportDiagnostics } from '../src/transportDiagnostics.mjs';

function setup() {
  const rows = [];
  const log = { emit: (event, fields) => rows.push({ event, ...fields }) };
  const req = new EventEmitter();
  const res = Object.assign(new EventEmitter(), { headersSent: true, statusCode: 200, writableFinished: false });
  const onEnd = vi.fn();
  const trace = createHttpTrace(log, { id: 1 }, req, res, onEnd);
  return { rows, req, res, trace, onEnd };
}

afterEach(() => vi.useRealTimers());

describe('HTTP diagnostics lifecycle', () => {
  it('emits waiting progress before headers and stops after exactly one end', () => {
    vi.useFakeTimers();
    const { rows, req, res, trace, onEnd } = setup();
    expect(responseDiagnostics(res)).toBe(trace);
    expect(rows.map((row) => row.event)).toEqual(['http_begin']);
    vi.advanceTimersByTime(10_000);
    expect(rows.filter((row) => row.event === 'http_progress')).toHaveLength(2);
    res.writableFinished = true;
    res.emit('finish');
    res.emit('close');
    req.emit('aborted');
    trace.end('shutdown');
    vi.advanceTimersByTime(10_000);
    expect(rows.filter((row) => row.event === 'http_progress')).toHaveLength(2);
    expect(rows.filter((row) => row.event === 'http_end')).toEqual([
      expect.objectContaining({ outcome: 'finished', status: 200, measured: false }),
    ]);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(responseDiagnostics(res)).toBeUndefined();
    expect(req.listenerCount('aborted')).toBe(0);
  });

  it.each(['aborted', 'close'])('reports client %s and no status before headers', (event) => {
    const { rows, req, res, trace } = setup();
    res.headersSent = false;
    (event === 'close' ? res : req).emit(event);
    trace.error({ code: 'ECONNRESET' });
    expect(rows.at(-1)).toMatchObject({ event: 'http_end', outcome: 'aborted' });
    expect(rows.at(-1).status).toBeUndefined();
    expect(rows.some((row) => row.event === 'http_error')).toBe(false);
  });

  it('reports safe errors once without exposing message or raw code', () => {
    const { rows, trace } = setup();
    trace.error({ code: 'private-code', message: 'private-message' });
    trace.error({ code: 'ECONNRESET' });
    trace.end('closed');
    expect(rows.filter((row) => row.event === 'http_error')).toEqual([
      expect.objectContaining({ errorCode: 'other' }),
    ]);
    expect(rows.at(-1).outcome).toBe('error');
    expect(JSON.stringify(rows)).not.toContain('private');
  });

  it('keeps upstream and outgoing encodings separate and measures each chunk once', () => {
    const { rows, res, trace } = setup();
    trace.upstream(200, { 'content-encoding': 'private-encoding' });
    trace.response({ 'content-encoding': 'gzip' });
    const [source, raw, gzip, wire, destination] = trace.streams('source', 'gzip', res);
    expect([source, gzip, destination]).toEqual(['source', 'gzip', res]);
    raw.resume(); wire.resume();
    raw.write(Buffer.alloc(13)); raw.write(Buffer.alloc(17));
    wire.write(Buffer.alloc(9));
    trace.end('finished'); raw.destroy(); wire.destroy();
    expect(rows.filter((row) => row.event === 'http_first_byte')).toHaveLength(1);
    expect(rows.at(-1)).toMatchObject({ measured: true, rawBytes: 30, wireBytes: 9,
      encoding: 'gzip', upstreamEncoding: 'other' });
    expect(JSON.stringify(rows)).not.toContain('private');
  });

  it('measures identity bodies and normalizes upstream gzip', () => {
    const { rows, res, trace } = setup();
    trace.upstream(201, { 'content-encoding': 'gzip' });
    trace.response({});
    const streams = trace.streams(null, null, res);
    expect(streams).toHaveLength(4);
    streams[1].destroy(); streams[2].destroy(); trace.end('shutdown');
    expect(rows.at(-1)).toMatchObject({ encoding: 'identity', upstreamEncoding: 'gzip', outcome: 'shutdown' });
  });
});

describe('HTTP diagnostics terminal event ordering', () => {
  it('ignores late upstream headers, body chunks and errors after cancellation', () => {
    vi.useFakeTimers();
    const { rows, res, trace, onEnd } = setup();
    const [, raw, wire] = trace.streams(null, null, res);
    raw.resume(); wire.resume();
    try {
      trace.end('aborted');
      trace.upstream(200, {});
      trace.response({ 'content-encoding': 'gzip' });
      raw.write(Buffer.from('fixture'));
      wire.write(Buffer.from('fixture'));
      trace.error({ code: 'ECONNRESET' });
      trace.end('finished');
      vi.advanceTimersByTime(10_000);
      expect(rows.map((row) => row.event)).toEqual(['http_begin', 'http_end']);
      expect(rows.at(-1)).toMatchObject({ outcome: 'aborted', rawBytes: 0, wireBytes: 0 });
      expect(onEnd).toHaveBeenCalledTimes(1);
      expect(responseDiagnostics(res)).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    } finally { raw.destroy(); wire.destroy(); trace.end('shutdown'); }
  });
});

describe('transport diagnostics defaults and safety', () => {
  it('allocates no diagnostics when disabled', () => {
    expect(createTransportDiagnostics()).toBeUndefined();
  });

  it('cleans active traces and observes errors without replacing clientError handling', () => {
    const log = { emit: vi.fn(), tag: vi.fn(() => '1234567890abcdef') };
    const diagnostics = createTransportDiagnostics(log);
    const req = Object.assign(new EventEmitter(), { url: '/', method: 'GET', socket: { remoteAddress: 'private' } });
    const res = new EventEmitter();
    diagnostics.http(req, res, '/');
    diagnostics.ws(req);
    const server = new EventEmitter();
    const socket = Object.assign(new EventEmitter(), { remoteAddress: 'private' });
    diagnostics.attach(server);
    expect(server.listenerCount('clientError')).toBe(0);
    server.emit('connection', socket);
    socket.emit('error', { code: 'HPE_INVALID_METHOD', rawPacket: Buffer.from('private') });
    server.emit('tlsClientError', { code: 'private', message: 'private' }, socket);
    diagnostics.stop(); diagnostics.stop();
    expect(log.emit).toHaveBeenCalledWith('client_error', { clientTag: '1234567890abcdef', errorCode: 'HPE_INVALID_METHOD' });
    expect(log.emit).toHaveBeenCalledWith('tls_error', { clientTag: '1234567890abcdef', errorCode: 'other' });
    expect(log.emit.mock.calls.filter(([event]) => event === 'http_end')).toHaveLength(1);
    expect(log.emit.mock.calls.filter(([event]) => event === 'ws_end')).toHaveLength(1);
    expect(JSON.stringify(log.emit.mock.calls)).not.toContain('private');
  });
});
