import { Transform } from 'node:stream';
import { safeErrorCode } from './debugLogSchema.mjs';

const responses = new WeakMap();

export function responseDiagnostics(res) {
  return responses.get(res);
}

function encodingName(value) {
  if (value === undefined) return 'identity';
  return value === 'gzip' ? 'gzip' : 'other';
}

function counter(onChunk) {
  return new Transform({
    transform(chunk, encoding, callback) {
      onChunk(chunk.byteLength);
      callback(null, chunk);
    },
  });
}

function responseCounters(state, emit) {
  return {
    streams(source, gzip, res) {
      state.measured = true;
      const raw = counter((bytes) => {
        state.rawBytes += bytes;
        if (state.firstByteMs !== undefined) return;
        state.firstByteMs = performance.now() - state.started;
        emit('http_first_byte');
      });
      const wire = counter((bytes) => { state.wireBytes += bytes; });
      return [source, raw, ...(gzip ? [gzip] : []), wire, res];
    },
    response(headers) {
      state.encoding = encodingName(headers['content-encoding']);
    },
  };
}

function snapshot(state) {
  const fields = { ...state, elapsedMs: performance.now() - state.started };
  delete fields.started;
  delete fields.failed;
  return fields;
}

function bindCompletion(req, res, end) {
  const finish = () => end('finished');
  const close = () => end(res.writableFinished ? 'finished' : 'aborted');
  const aborted = () => end('aborted');
  res.once('finish', finish);
  res.once('close', close);
  req.once('aborted', aborted);
  return () => {
    res.removeListener('finish', finish);
    res.removeListener('close', close);
    req.removeListener('aborted', aborted);
  };
}

export function createHttpTrace(log, fields, req, res, onEnd) {
  const state = { started: performance.now(), rawBytes: 0, wireBytes: 0, measured: false, failed: false };
  let ended = false;
  const emit = (event, extra = {}) => {
    if (!ended || event === 'http_end') log.emit(event, { ...fields, ...snapshot(state), ...extra });
  };
  const timer = setInterval(() => emit('http_progress'), 5_000);
  timer.unref();
  const cleanup = bindCompletion(req, res, end);
  function end(outcome) {
    if (ended) return;
    ended = true;
    clearInterval(timer);
    cleanup();
    emit('http_end', { outcome: state.failed ? 'error' : outcome, status: res.headersSent ? res.statusCode : undefined });
    responses.delete(res);
    onEnd();
  }
  const trace = {
    ...responseCounters(state, emit),
    upstream(status, headers) {
      state.upstreamMs = performance.now() - state.started;
      state.upstreamEncoding = encodingName(headers['content-encoding']);
      emit('http_upstream', { status });
    },
    error(error) {
      if (ended || state.failed) return;
      state.failed = true;
      emit('http_error', { errorCode: safeErrorCode(error) });
    },
    end,
  };
  responses.set(res, trace);
  emit('http_begin');
  return trace;
}
