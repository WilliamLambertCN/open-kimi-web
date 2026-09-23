import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';

import { MAX_WS_PAYLOAD_BYTES, createWsProxy, relayCloseCode } from '../src/wsProxy.mjs';

const servers = [];

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    servers.push(server);
    resolve(`http://127.0.0.1:${server.address().port}`);
  }));
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  })));
});

// A client-facing HTTP server whose upgrade requests all run through the WS
// proxy to the given target.
async function listenProxy(targetBase) {
  const { wss, handleUpgrade } = createWsProxy();
  const server = createServer();
  server.on('upgrade', (req, socket, head) => {
    handleUpgrade(req, socket, head, targetBase);
  });
  server.on('close', () => wss.close());
  return listen(server);
}

describe('relayCloseCode', () => {
  it('maps RFC 6455 reserved codes (unsendable) to 1000', () => {
    expect(relayCloseCode(1005)).toBe(1000);
    expect(relayCloseCode(1006)).toBe(1000);
    expect(relayCloseCode(1015)).toBe(1000);
  });

  it('passes normal and application codes through', () => {
    for (const code of [1000, 1001, 1011, 3000, 4000, 4999]) {
      expect(relayCloseCode(code)).toBe(code);
    }
  });
});

describe('createWsProxy payload bound', () => {
  // Connects a real ws client through the proxy to an upstream that sends
  // `send` once the connection is bridged; resolves on client close.
  async function proxiedSession(send) {
    const upstream = new WebSocketServer({ noServer: true });
    const upstreamHttp = createServer();
    upstreamHttp.on('upgrade', (req, socket, head) => {
      upstream.handleUpgrade(req, socket, head, (ws) => send(ws));
    });
    const target = await listen(upstreamHttp);
    const url = await listenProxy(target);
    const client = new WebSocket(url.replace('http:', 'ws:') + '/api/v1/ws');
    return new Promise((resolve) => {
      const received = [];
      client.on('message', (data) => received.push(data));
      client.once('open', () => client.once('close', (code) => resolve({ client, received, code })));
    });
  }

  it('relays multi-megabyte frames: prompts may inline base64 attachments', async () => {
    // 9 MiB — above the naive 8 MiB cap that would break a photo-bearing
    // prompt, well below the real one.
    const frame = Buffer.alloc(9 * 1024 * 1024);
    frame.write('attachment-payload');
    const { client, received, code } = await proxiedSession((ws) => {
      ws.send(frame);
      ws.close(1000);
    });
    expect(code).toBe(1000);
    expect(received).toHaveLength(1);
    expect(received[0].length).toBe(frame.length);
    expect(received[0].subarray(0, 18).toString()).toBe('attachment-payload');
    client.close();
  });

  it('caps frames at 64 MiB and closes the session instead of relaying a bigger one', async () => {
    expect(MAX_WS_PAYLOAD_BYTES).toBe(64 * 1024 * 1024);
    const { client, received, code } = await proxiedSession((ws) =>
      // Oversized frame: one byte past the proxy's per-message cap.
      ws.send(Buffer.alloc(MAX_WS_PAYLOAD_BYTES + 1)));
    // The oversized upstream frame is rejected (peer closes 1009 or the
    // proxy aborts with 1011) — never relayed to the client.
    expect([1009, 1011]).toContain(code);
    expect(received).toHaveLength(0);
    expect(client.readyState).toBe(WebSocket.CLOSED);
  });
});
