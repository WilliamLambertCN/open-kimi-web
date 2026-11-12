// Transparent WebSocket proxy for /api/v1/ws. The upstream connection is
// opened first (with the client's subprotocol list, e.g.
// `kimi-code.bearer.<token>`); only once the upstream accepts do we complete
// the client handshake, echoing the upstream's negotiated subprotocol.
import { STATUS_CODES } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

// Per-message cap on both WS legs. Prompts may inline base64 image
// attachments inside the WS message itself (asyncapi.json image source
// `{kind:"base64", media_type, data}`), so legitimate frames reach tens of
// MiB when several phone photos go in one message. 64 MiB covers that while
// still bounding the memory a hostile or buggy peer can force per frame.
export const MAX_WS_PAYLOAD_BYTES = 64 * 1024 * 1024;

// Headers the ws client library manages itself — forwarding the client's
// values would corrupt the upstream handshake.
const WS_MANAGED_HEADERS = new Set([
  'connection',
  'upgrade',
  'host',
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-protocol',
  'sec-websocket-extensions',
]);

function upstreamHeaders(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!WS_MANAGED_HEADERS.has(name.toLowerCase())) out[name] = value;
  }
  return out;
}

// RFC 6455 reserves 1005 (no status), 1006 (abnormal) and 1015 (TLS
// failure): they may surface as a local 'close' event but must never be
// sent on the wire — the ws library throws on them. Relay as 1000 (normal).
export function relayCloseCode(code) {
  return code === 1005 || code === 1006 || code === 1015 ? 1000 : code;
}

function bridge(upstream, client, onClose, trace, blocked) {
  upstream.on('message', (data, isBinary) => {
    client.send(data, { binary: isBinary });
    trace?.toClient(data, client.bufferedAmount);
  });
  client.on('message', (data, isBinary) => {
    if (upstream.readyState !== WebSocket.OPEN) return;
    if (blocked?.()) { client.close(1013, 'Service restarting'); return; }
    upstream.send(data, { binary: isBinary });
    trace?.toUpstream(data, upstream.bufferedAmount);
  });
  upstream.on('close', (code, reason) => {
    onClose();
    trace?.end('closed', { closeCode: code });
    client.close(relayCloseCode(code), reason);
  });
  client.on('close', (code, reason) => {
    trace?.end('closed', { closeCode: code });
    if (code === 1006) terminate(upstream);
    else upstream.close(relayCloseCode(code), reason);
  });
  upstream.on('error', (error) => {
    trace?.error(error);
    client.close(1011);
  });
  client.on('error', (error) => {
    trace?.error(error);
    upstream.close(1011);
  });
}

function terminate(upstream) {
  if (upstream.readyState !== WebSocket.CLOSED) upstream.terminate();
}

function rejectHandshake(socket, status = 400) {
  const reason = STATUS_CODES[status] ?? 'Bad Request';
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

function safeUpstreamStatus(status) {
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502;
}

function connectUpstream(req, targetBase) {
  const target = new URL(targetBase);
  const targetOrigin = target.origin;
  target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
  const protocols = (req.headers['sec-websocket-protocol'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const headers = { ...upstreamHeaders(req.headers), host: target.host };
  if (req.headers.origin !== undefined) headers.origin = targetOrigin;
  return new WebSocket(new URL(req.url, target), protocols, { headers, maxPayload: MAX_WS_PAYLOAD_BYTES });
}

function acceptUpgrade(context, cleanup, abandon) {
  const { upstream, req, socket, head, wss, active, trace, blocked } = context;
  if (blocked?.()) { abandon(); rejectHandshake(socket, 503); return; }
  upstream.removeAllListeners('unexpected-response');
  req.upstreamSubprotocol = upstream.protocol;
  let accepted = false;
  try {
    wss.handleUpgrade(req, socket, head, (client) => {
      accepted = true;
      cleanup();
      active.set(upstream, trace);
      bridge(upstream, client, () => active.delete(upstream), trace, blocked);
      trace?.ready();
    });
  } catch (error) {
    trace?.error(error);
    trace?.end('error');
    socket.destroy();
  }
  if (!accepted) abandon();
}

function watchPending(context) {
  const { upstream, socket, pending, trace } = context;
  const cleanup = () => {
    pending.delete(upstream);
    socket.removeListener('close', abandon);
    socket.removeListener('end', closed);
    socket.removeListener('error', discard);
    upstream.removeListener('error', discard);
    upstream.removeListener('close', closed);
  };
  const abandon = () => {
    cleanup();
    trace?.end('aborted');
    upstream.on('error', () => {});
    terminate(upstream);
  };
  const discard = (error) => {
    cleanup();
    trace?.error(error);
    trace?.end('error');
    upstream.on('error', () => {});
    terminate(upstream);
    socket.destroy();
  };
  const closed = () => {
    abandon();
    socket.destroy();
  };
  socket.once('close', abandon);
  socket.once('end', closed);
  socket.once('error', discard);
  upstream.once('error', discard);
  upstream.once('close', closed);
  upstream.once('unexpected-response', (request, response) => {
    cleanup();
    upstream.on('error', () => {});
    const status = safeUpstreamStatus(response.statusCode);
    trace?.end('rejected', { status });
    response.destroy();
    request.destroy();
    rejectHandshake(socket, status);
  });
  upstream.once('open', () => acceptUpgrade(context, cleanup, abandon));
}

export function createWsProxy(diagnostics, blocked) {
  const pending = new Map();
  const active = new Map();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WS_PAYLOAD_BYTES,
    // Echo only the upstream's negotiated subprotocol after its handshake succeeds.
    handleProtocols: (_protocols, req) => req.upstreamSubprotocol || false,
  });

  function handleUpgrade(req, socket, head, targetBase) {
    const trace = diagnostics?.ws(req);
    if (blocked?.()) { trace?.end('rejected', { status: 503 }); rejectHandshake(socket, 503); return; }
    let upstream;
    try {
      upstream = connectUpstream(req, targetBase);
    } catch (error) {
      trace?.error(error);
      trace?.end('error', { status: 400 });
      rejectHandshake(socket);
      return;
    }
    pending.set(upstream, { socket, trace });
    watchPending({ upstream, req, socket, head, wss, pending, active, trace, blocked });
  }

  function closeConnections() {
    for (const [upstream, { socket, trace }] of pending) {
      trace?.end('shutdown');
      socket.destroy();
      upstream.on('error', () => {});
      terminate(upstream);
    }
    pending.clear();
    for (const [upstream, trace] of active) {
      trace?.end('shutdown');
      terminate(upstream);
    }
    active.clear();
  }

  return { wss, handleUpgrade, closeConnections };
}
