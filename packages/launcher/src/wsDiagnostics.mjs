import { safeErrorCode } from './debugLogSchema.mjs';
import { createConversationTrace } from './wsConversationDiagnostics.mjs';

const OUTCOMES = new Set(['closed', 'error', 'rejected', 'aborted', 'shutdown']);
const CLOSE_CODES = new Set([1000, 1001, 1002, 1003, 1005, 1006, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014, 1015]);

function byteLength(data) {
  if (typeof data === 'string') return Buffer.byteLength(data);
  if (Array.isArray(data)) return data.reduce((total, part) => total + part.byteLength, 0);
  return data.byteLength;
}

function endFields(fields) {
  const result = {};
  if (Number.isInteger(fields.status) && fields.status >= 100 && fields.status <= 599) result.status = fields.status;
  const code = fields.closeCode;
  if (CLOSE_CODES.has(code) || (Number.isInteger(code) && code >= 3000 && code <= 4999)) result.closeCode = code;
  return result;
}

function counters() {
  return {
    toClientMessages: 0, toClientBytes: 0, toClientMaxBytes: 0,
    toUpstreamMessages: 0, toUpstreamBytes: 0, toUpstreamMaxBytes: 0,
    clientBufferedBytes: 0, upstreamBufferedBytes: 0,
  };
}

function count(stats, direction, data, bufferedAmount) {
  const bytes = byteLength(data);
  stats[`${direction}Messages`] += 1;
  stats[`${direction}Bytes`] += bytes;
  stats[`${direction}MaxBytes`] = Math.max(stats[`${direction}MaxBytes`], bytes);
  const bufferedKey = direction === 'toClient' ? 'clientBufferedBytes' : 'upstreamBufferedBytes';
  if (Number.isFinite(bufferedAmount) && bufferedAmount >= 0) {
    stats[bufferedKey] = Math.max(stats[bufferedKey], bufferedAmount);
  }
  return bytes;
}

export function createWsTrace(log, fields, onEnd, { progressMs = 5000 } = {}) {
  const started = performance.now();
  const identity = { ...fields };
  const stats = counters();
  let ended = false;
  let connected = false;
  let failed = false;
  let firstFrameMs;
  const elapsedMs = () => performance.now() - started;
  const emit = (event, extra = {}) => {
    try { log?.emit(event, { ...identity, ...extra }); } catch { /* Diagnostics must not affect the proxy. */ }
  };
  const conversation = createConversationTrace(log, emit, elapsedMs);
  const observe = (direction, data, bytes, binary) => {
    if (!binary) { try { conversation?.[direction](data, bytes); } catch {} }
  };
  const snapshot = () => ({ ...stats, elapsedMs: elapsedMs(), ...(firstFrameMs === undefined ? {} : { firstFrameMs }) });
  const interval = Number.isFinite(progressMs) ? Math.max(5000, progressMs) : 5000;
  emit('ws_begin');
  const timer = log ? setInterval(() => emit('ws_progress', snapshot()), interval) : undefined;
  timer?.unref?.();
  return {
    ready() {
      if (ended || connected) return;
      connected = true;
      emit('ws_ready', { elapsedMs: elapsedMs() });
    },
    toClient(data, bufferedAmount, binary = false) {
      if (ended) return;
      const bytes = count(stats, 'toClient', data, bufferedAmount);
      if (firstFrameMs === undefined) {
        firstFrameMs = elapsedMs();
        emit('ws_first_frame', { firstFrameMs });
      }
      observe('toClient', data, bytes, binary);
    },
    toUpstream(data, bufferedAmount, binary = false) {
      if (ended) return;
      const bytes = count(stats, 'toUpstream', data, bufferedAmount);
      observe('toUpstream', data, bytes, binary);
    },
    error(error) {
      if (ended) return;
      failed = true;
      emit('ws_error', { errorCode: safeErrorCode(error) });
    },
    end(outcome = 'closed', extra = {}) {
      if (ended) return;
      ended = true;
      clearInterval(timer);
      conversation?.clear();
      const result = OUTCOMES.has(outcome) ? outcome : 'closed';
      emit('ws_end', { ...snapshot(), outcome: failed && result === 'closed' ? 'error' : result, ...endFields(extra) });
      onEnd?.();
    },
  };
}
