import { requestFields } from './diagnosticContext.mjs';
import { safeErrorCode } from './debugLogSchema.mjs';
import { createHttpTrace } from './httpDiagnostics.mjs';
import { createWsTrace } from './wsDiagnostics.mjs';

export function createTransportDiagnostics(log) {
  if (!log) return undefined;
  const active = new Set();
  let id = 0;
  function track(create) {
    const trace = create(() => active.delete(trace));
    active.add(trace);
    return trace;
  }
  return {
    http(req, res, path) {
      const fields = requestFields(log, ++id, req, path);
      return track((onEnd) => createHttpTrace(log, fields, req, res, onEnd));
    },
    ws(req) {
      const fields = requestFields(log, ++id, req);
      return track((onEnd) => createWsTrace(log, fields, onEnd));
    },
    attach(server) {
      const report = (event, error, socket) => log.emit(event, {
        clientTag: log.tag('client', socket.remoteAddress ?? ''), errorCode: safeErrorCode(error),
      });
      server.on('connection', (socket) => {
        socket.once('error', (error) => report('client_error', error, socket));
      });
      server.on('tlsClientError', (error, socket) => report('tls_error', error, socket));
    },
    stop() {
      for (const trace of active) trace.end('shutdown');
      active.clear();
    },
  };
}
