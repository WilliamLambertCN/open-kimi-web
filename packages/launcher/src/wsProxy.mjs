// Transparent WebSocket proxy for /api/v1/ws. The upstream connection is
// opened first (with the client's subprotocol list, e.g.
// `kimi-code.bearer.<token>`); only once the upstream accepts do we complete
// the client handshake, echoing the upstream's negotiated subprotocol.
import { STATUS_CODES } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

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

function bridge(upstream, client, onClose) {
  upstream.on('message', (data, isBinary) => client.send(data, { binary: isBinary }));
  client.on('message', (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
  });
  upstream.on('close', (code, reason) => {
    onClose();
    client.close(relayCloseCode(code), reason);
  });
  client.on('close', (code, reason) => {
    if (code === 1006) terminate(upstream);
    else upstream.close(relayCloseCode(code), reason);
  });
  upstream.on('error', () => client.close(1011));
  client.on('error', () => upstream.close(1011));
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

export function createWsProxy() {
  const pending = new Map();
  const active = new Set();
  const wss = new WebSocketServer({
    noServer: true,
    // proxyUpgrade stashes the upstream's negotiated subprotocol on the
    // request before handleUpgrade runs; echo it to preserve the
    // kimi-code.bearer.<token> handshake semantics.
    handleProtocols: (_protocols, req) => req.upstreamSubprotocol || false,
  });

  function handleUpgrade(req, socket, head, targetBase) {
    const target = new URL(targetBase);
    const targetOrigin = target.origin;
    target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
    const protocols = (req.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const headers = { ...upstreamHeaders(req.headers), host: target.host };
    if (req.headers.origin !== undefined) headers.origin = targetOrigin;
    let upstream;
    try {
      upstream = new WebSocket(new URL(req.url, target), protocols, { headers });
    } catch {
      rejectHandshake(socket);
      return;
    }
    pending.set(upstream, socket);
    const discard = () => {
      pending.delete(upstream);
      socket.destroy();
    };
    const abandon = () => {
      pending.delete(upstream);
      upstream.on('error', () => {});
      terminate(upstream);
    };
    socket.once('close', abandon);
    upstream.once('error', discard);
    upstream.once('unexpected-response', (request, response) => {
      pending.delete(upstream);
      socket.removeListener('close', abandon);
      upstream.removeListener('error', discard);
      upstream.on('error', () => {});
      const status = safeUpstreamStatus(response.statusCode);
      response.destroy();
      request.destroy();
      rejectHandshake(socket, status);
    });
    upstream.once('open', () => {
      upstream.removeListener('error', discard);
      upstream.removeAllListeners('unexpected-response');
      req.upstreamSubprotocol = upstream.protocol;
      let accepted = false;
      try {
        wss.handleUpgrade(req, socket, head, (client) => {
          accepted = true;
          pending.delete(upstream);
          socket.removeListener('close', abandon);
          active.add(upstream);
          bridge(upstream, client, () => active.delete(upstream));
        });
      } catch {
        socket.destroy();
      }
      if (!accepted) abandon();
    });
  }

  function closeConnections() {
    for (const [upstream, socket] of pending) {
      socket.destroy();
      upstream.on('error', () => {});
      terminate(upstream);
    }
    pending.clear();
    for (const upstream of active) terminate(upstream);
    active.clear();
  }

  return { wss, handleUpgrade, closeConnections };
}
