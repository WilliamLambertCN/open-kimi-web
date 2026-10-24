import { getEventListeners } from 'node:events';
import { IncomingMessage } from 'node:http';
import { Agent, createServer, request } from 'node:https';
import { Socket } from 'node:net';
import { Writable } from 'node:stream';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { assertDownloadUrl, downloadBytes } from '../../scripts/install/network.mjs';
import { generateSelfSignedCertificate } from '../../packages/launcher/src/tlsCertificate.mjs';

const repository = 'https://github.com/WilliamLambertCN/open-kimi-web';
const official = 'https://registry.npmjs.org/@moonshot-ai/kimi-code/-/kimi-code-2.3.1.tgz';
const asset = `${repository}/releases/download/v2.1.1-r9/open-kimi-web-2.1.1-r9.tgz`;
const metadata = 'https://api.github.com/repos/WilliamLambertCN/open-kimi-web/releases/latest';
const networkError = 'HTTPS download failed; check network/proxy and certificate trust';

async function tlsFixture() {
  const pair = await generateSelfSignedCertificate(['127.0.0.1']);
  const routes = new Map();
  const sockets = new Set();
  const server = createServer(pair, (req, res) => routes.get(req.url)(req, res));
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, routes, sockets, cert: pair.cert, port: server.address().port };
}

function transport(fixture, steps, trust = true) {
  const agents = [];
  const requests = [];
  const responses = [];
  const paths = [];
  const agentFactory = vi.fn((settings) => {
    const agent = new Agent(settings);
    vi.spyOn(agent, 'destroy');
    agents.push(agent);
    return agent;
  });
  const send = vi.fn((url, options, callback) => {
    const path = `/fixture-${fixture.routes.size}`;
    const handler = steps.shift();
    expect(handler).toBeTypeOf('function');
    fixture.routes.set(path, handler);
    paths.push(path);
    const req = request({ ...options, hostname: '127.0.0.1', port: fixture.port, path,
      ...(trust ? { ca: fixture.cert } : {}) }, (res) => {
      responses.push(res);
      callback(res);
    });
    vi.spyOn(req, 'setTimeout');
    requests.push(req);
    return req;
  });
  return { agents, requests, responses, paths, options: { request: send, agentFactory, env: {} }, send, agentFactory };
}

function assertReleased(harness, abortSpy) {
  expect(harness.agents).toHaveLength(1);
  expect(harness.agents[0].destroy).toHaveBeenCalledOnce();
  for (const req of harness.requests) {
    expect(req.setTimeout).toHaveBeenLastCalledWith(0);
    expect(req.listenerCount('timeout')).toBe(0);
  }
  const signals = abortSpy.mock.calls.flatMap(([event, callback], index) =>
    event === 'abort' && callback.name === 'cancel' ? [abortSpy.mock.contexts[index]] : []);
  expect(signals.length).toBeGreaterThanOrEqual(harness.requests.length);
  for (const signal of signals) expect(getEventListeners(signal, 'abort')).toHaveLength(0);
}

function ok(bytes) {
  return (_req, res) => { res.writeHead(200); res.end(bytes); };
}

function redirect(status, location) {
  return (_req, res) => {
    res.writeHead(status, location === undefined ? {} : { location });
    res.end('redirect fixture');
  };
}

function registerUrlBoundaries() {
  describe('download URL trust boundaries', () => {
    it.each([
      asset,
      official,
      'https://release-assets.githubusercontent.com/asset?signature=fixture',
      'https://objects.githubusercontent.com/asset',
    ])('allows approved asset URL %s', (url) => {
      expect(assertDownloadUrl(url).href).toBe(url);
    });

    it.each([
      metadata,
      'https://api.github.com/repos/WilliamLambertCN/open-kimi-web/releases/tags/v2.1.1-r9',
    ])('allows repository metadata URL %s', (url) => {
      expect(assertDownloadUrl(url, true).href).toBe(url);
    });

    it.each([
      ['http:', asset.replace('https:', 'http:')],
      ['username', asset.replace('https://', 'https://fixture@')],
      ['password', asset.replace('https://', 'https://:fixture@')],
      ['port', asset.replace('github.com/', 'github.com:8443/')],
      ['fragment', `${asset}#fixture`],
      ['host', asset.replace('github.com', 'github.com.example.invalid')],
      ['path', asset.replace('WilliamLambertCN/', 'other/')],
      ['legacy official', official.replace('2.3.1', '2.1.1')],
      ['unpinned official', official.replace('2.3.1', '2.3.2')],
      ['official query', `${official}?download=1`],
      ['official encoded path', official.replace('@moonshot-ai/', '@moonshot-ai%2F')],
      ['official mirror', official.replace('registry.npmjs.org', 'registry.npmmirror.com')],
      ['localhost', 'https://127.0.0.1/release.tgz'],
      ['malformed', 'not a URL'],
    ])('rejects unsafe %s before constructing any network request', async (_name, url) => {
      const agent = { destroy: vi.fn() };
      const send = vi.fn();
      await expect(downloadBytes(url, { request: send, agentFactory: () => agent })).rejects.toThrow();
      expect(send).not.toHaveBeenCalled();
      expect(agent.destroy).toHaveBeenCalledOnce();
    });

    it.each([
      asset,
      official,
      'https://objects.githubusercontent.com/release',
      'https://api.github.com/repos/other/open-kimi-web/releases/latest',
      'https://api.github.com/repos/WilliamLambertCN/open-kimi-web/releases',
    ])('refuses asset hosts and unrelated metadata paths in metadata mode: %s', (url) => {
      expect(() => assertDownloadUrl(url, true)).toThrow('download host/path is not allowed');
    });
  });
}

function registerSuccess(fixture, active) {
  describe('real HTTPS bytes and headers', () => {
    it.each([false, true])('returns complete binary bytes for metadata=%s', async (isMetadata) => {
      const bytes = Buffer.from([0, 255, 195, 169, 10]);
      const harness = active(transport(fixture(), [(_req, res) => {
        res.writeHead(200, { 'content-length': bytes.length });
        res.write(bytes.subarray(0, 2));
        setImmediate(() => res.end(bytes.subarray(2)));
      }]));
      const url = isMetadata ? metadata : asset;
      await expect(downloadBytes(url, { ...harness.options, metadata: isMetadata })).resolves.toEqual(bytes);
      expect(harness.send.mock.calls[0][0]).toBe(url);
      expect(harness.send.mock.calls[0][1]).toEqual({ agent: harness.agents[0], headers: {
        Accept: isMetadata ? 'application/vnd.github+json' : 'application/octet-stream',
        'User-Agent': 'open-kimi-web-install',
      } });
      expect(harness.responses[0]).toBeInstanceOf(IncomingMessage);
      expect(harness.responses[0].complete).toBe(true);
      expect(harness.responses[0].socket.authorized).toBe(true);
      expect(harness.requests[0].setTimeout.mock.calls[0][0]).toBe(15_000);
      expect(harness.agentFactory).toHaveBeenCalledWith({ proxyEnv: {} });
    });

    it('downloads the exact official 2.3.1 URL through the verified TLS transport', async () => {
      const harness = active(transport(fixture(), [ok('official fixture')]));
      await expect(downloadBytes(official, harness.options)).resolves.toEqual(Buffer.from('official fixture'));
      expect(harness.send).toHaveBeenCalledOnce();
      expect(harness.send.mock.calls[0][0]).toBe(official);
      expect(harness.responses[0].socket.authorized).toBe(true);
    });

    it('passes only the supplied proxy environment to its agent', async () => {
      const harness = active(transport(fixture(), [ok('fixture')]));
      const env = { HTTPS_PROXY: 'http://proxy.example.invalid:8080', NO_PROXY: '127.0.0.1' };
      await expect(downloadBytes(asset, { ...harness.options, env })).resolves.toEqual(Buffer.from('fixture'));
      expect(harness.agentFactory).toHaveBeenCalledWith({ proxyEnv: env });
    });

    it('returns an empty complete response without inventing bytes', async () => {
      const harness = active(transport(fixture(), [ok('')]));
      await expect(downloadBytes(asset, harness.options)).resolves.toEqual(Buffer.alloc(0));
    });

    it('releases the default HTTPS agent after rejecting an unsafe URL without going online', async () => {
      const destroy = vi.spyOn(Agent.prototype, 'destroy');
      try {
        await expect(downloadBytes('http://example.invalid/fixture')).rejects.toThrow('unsafe HTTPS download URL');
        expect(destroy).toHaveBeenCalledOnce();
      } finally { destroy.mockRestore(); }
    });
  });
}

function registerRedirects(fixture, active) {
  describe('real HTTPS redirect handling', () => {
    it.each([301, 302, 303, 307, 308])('follows approved HTTP %s asset redirects', async (status) => {
      const next = 'https://release-assets.githubusercontent.com/fixture?signature=fixture';
      const harness = active(transport(fixture(), [redirect(status, next), ok('archive fixture')]));
      await expect(downloadBytes(asset, harness.options)).resolves.toEqual(Buffer.from('archive fixture'));
      expect(harness.send.mock.calls.map(([url]) => url)).toEqual([asset, next]);
      expect(harness.send.mock.calls[1][1].agent).toBe(harness.agents[0]);
    });

    it('resolves relative asset redirects against the preceding URL', async () => {
      const harness = active(transport(fixture(), [redirect(302, './renamed.tgz'), ok('fixture')]));
      await expect(downloadBytes(asset, harness.options)).resolves.toEqual(Buffer.from('fixture'));
      expect(harness.send.mock.calls[1][0]).toBe(new URL('./renamed.tgz', asset).href);
    });

    it.each([
      undefined,
      'https://example.invalid/archive.tgz',
      official.replace('2.3.1', '2.1.1'),
      official.replace('2.3.1', '2.3.2'),
      `${official}?download=1`,
      'http://objects.githubusercontent.com/asset',
      'https://fixture@objects.githubusercontent.com/asset',
      'https://objects.githubusercontent.com:8443/asset',
      'https://objects.githubusercontent.com/asset#fixture',
      'https://[broken',
    ])('refuses absent or unsafe Location %s without following it', async (location) => {
      const harness = active(transport(fixture(), [redirect(302, location)]));
      await expect(downloadBytes(asset, harness.options)).rejects.toThrow('download redirect refused');
      expect(harness.send).toHaveBeenCalledOnce();
    });

    it('never redirects GitHub metadata even to its own approved metadata URL', async () => {
      const harness = active(transport(fixture(), [redirect(302, metadata)]));
      await expect(downloadBytes(metadata, { ...harness.options, metadata: true })).rejects.toThrow('download redirect refused');
      expect(harness.send).toHaveBeenCalledOnce();
    });

    it('allows four redirects but rejects a fifth hop', async () => {
      const first = active(transport(fixture(), [...Array.from({ length: 4 }, () => redirect(302, asset)), ok('fixture')]));
      await expect(downloadBytes(asset, first.options)).resolves.toEqual(Buffer.from('fixture'));
      const second = active(transport(fixture(), Array.from({ length: 5 }, () => redirect(302, asset))));
      await expect(downloadBytes(asset, second.options)).rejects.toThrow('download redirect refused');
      expect(first.send).toHaveBeenCalledTimes(5);
      expect(second.send).toHaveBeenCalledTimes(5);
    });
  });
}

function registerFailures(fixture, active) {
  describe('real HTTPS response failure boundaries', () => {
    it.each([204, 403, 404, 429, 500])('rejects HTTP %s instead of returning an error body', async (status) => {
      const harness = active(transport(fixture(), [(_req, res) => { res.writeHead(status); res.end('not an archive'); }]));
      await expect(downloadBytes(asset, harness.options)).rejects.toThrow(`download failed (HTTP ${status})`);
    });

    it('rejects a socket failure before response headers with a sanitized diagnostic', async () => {
      const harness = active(transport(fixture(), [(req) => req.socket.destroy()]));
      await expect(downloadBytes(asset, harness.options)).rejects.toThrow(networkError);
      expect(harness.responses).toHaveLength(0);
    });

    it('rejects untrusted TLS instead of disabling certificate verification', async () => {
      const harness = active(transport(fixture(), [ok('must not be received')], false));
      await expect(downloadBytes(asset, harness.options)).rejects.toThrow(networkError);
      expect(harness.responses).toHaveLength(0);
    });

    it('rejects truncated Content-Length bytes from a closed HTTPS socket', async () => {
      const harness = active(transport(fixture(), [(_req, res) => {
        res.writeHead(200, { 'content-length': 100 });
        res.write('partial');
        setImmediate(() => res.destroy());
      }]));
      await expect(downloadBytes(asset, harness.options)).rejects.toThrow('download response interrupted');
      expect(harness.responses[0].complete).toBe(false);
    });

    it.each([false, true])('rejects streamed bytes over its lowered metadata=%s limit', async (isMetadata) => {
      const harness = active(transport(fixture(), [(_req, res) => {
        res.writeHead(200);
        res.write('1234');
        setImmediate(() => res.end('5'));
      }]));
      await expect(downloadBytes(isMetadata ? metadata : asset, { ...harness.options, metadata: isMetadata, maxBytes: 4 }))
        .rejects.toThrow('download exceeds size limit');
    });

    it('accepts exactly the limit, counting bytes rather than characters', async () => {
      const bytes = Buffer.from('éé');
      const harness = active(transport(fixture(), [ok(bytes)]));
      await expect(downloadBytes(asset, { ...harness.options, maxBytes: 4 })).resolves.toEqual(bytes);
    });

    it.each([false, true])('cannot raise the default metadata=%s body cap through the internal seam', async (isMetadata) => {
      const cap = isMetadata ? 1024 * 1024 : 128 * 1024 * 1024;
      const req = new EventRequest((res) => {
        const chunk = Buffer.alloc(1024 * 1024);
        for (let bytes = 0; bytes < cap; bytes += chunk.length) res.emit('data', chunk);
        res.emit('data', Buffer.alloc(1));
      });
      await expect(downloadBytes(isMetadata ? metadata : asset, {
        metadata: isMetadata, maxBytes: cap + 1, request: req.send, agentFactory: () => ({ destroy() {} }),
      })).rejects.toThrow('download exceeds size limit');
      expect(req.destroyed).toBe(true);
      req.response.destroy();
    });
  });
}

function registerTimeouts(fixture, active) {
  describe('real timers and request cleanup', () => {
    it('enforces the total timer on a raw request with no response headers', async () => {
      const harness = active(transport(fixture(), [() => {}]));
      await expect(downloadBytes(asset, { ...harness.options, timeoutMs: 60, idleTimeoutMs: 1_000 }))
        .rejects.toThrow('download timed out');
      expect(harness.responses).toHaveLength(0);
    });

    it('enforces the idle timer after response bytes have started', async () => {
      const harness = active(transport(fixture(), [(_req, res) => { res.writeHead(200); res.write('partial'); }]));
      await expect(downloadBytes(asset, { ...harness.options, timeoutMs: 2_000, idleTimeoutMs: 30 }))
        .rejects.toThrow('download idle timeout');
      expect(harness.responses).toHaveLength(1);
      expect(harness.responses[0].complete).toBe(false);
    });

    it('does not reset its overall deadline after an allowed redirect', async () => {
      const harness = active(transport(fixture(), [redirect(302, asset), () => {}]));
      await expect(downloadBytes(asset, { ...harness.options, timeoutMs: 100, idleTimeoutMs: 1_000 }))
        .rejects.toThrow('download timed out');
      expect(harness.send).toHaveBeenCalledTimes(2);
    });

    it('clears the overall timer after success rather than aborting a finished request', async () => {
      const harness = active(transport(fixture(), [ok('fixture')]));
      await expect(downloadBytes(asset, { ...harness.options, timeoutMs: 200 })).resolves.toEqual(Buffer.from('fixture'));
      const spy = vi.spyOn(AbortController.prototype, 'abort');
      try {
        await new Promise((resolve) => setTimeout(resolve, 220));
        expect(spy).not.toHaveBeenCalled();
      } finally { spy.mockRestore(); }
    });
  });
}

class EventRequest extends Writable {
  constructor(action) {
    super({ autoDestroy: false });
    this.action = action;
    this.response = new IncomingMessage(new Socket());
    this.response.statusCode = 200;
    this.response.headers = {};
    this.send = (_url, _options, callback) => {
      this.callback = callback;
      return this;
    };
  }

  setTimeout() { return this; }

  _write(_chunk, _encoding, done) { done(); }

  _final(done) {
    done();
    queueMicrotask(() => {
      this.callback(this.response);
      this.action(this.response, this);
    });
  }
}

function registerEventFailures() {
  describe('IncomingMessage event ordering and synchronous request errors', () => {
    it.each([
      ['error', (res) => res.emit('error', new Error('private fixture detail'))],
      ['aborted', (res) => res.emit('aborted')],
      ['incomplete end', (res) => { res.emit('data', Buffer.from('partial')); res.emit('end'); }],
      ['incomplete close', (res) => { res.emit('data', Buffer.from('partial')); res.emit('close'); }],
      ['request close', (_res, req) => req.destroy()],
    ])('rejects %s without accepting partial bytes', async (_name, action) => {
      const req = new EventRequest(action);
      const agent = { destroy: vi.fn() };
      await expect(downloadBytes(asset, { request: req.send, agentFactory: () => agent }))
        .rejects.toThrow('download response interrupted');
      expect(agent.destroy).toHaveBeenCalledOnce();
      expect(req.destroyed).toBe(true);
      req.response.destroy();
    });

    it('releases its agent if constructing the HTTPS request throws', async () => {
      const agent = { destroy: vi.fn() };
      await expect(downloadBytes(asset, { request: () => { throw new Error('fixture TLS configuration'); },
        agentFactory: () => agent })).rejects.toThrow('fixture TLS configuration');
      expect(agent.destroy).toHaveBeenCalledOnce();
    });

    it('cancels an abort during request creation before ending the request', async () => {
      const signalSpy = vi.spyOn(AbortController.prototype, 'signal', 'get');
      const req = new EventRequest(() => {});
      const agent = { destroy: vi.fn() };
      try {
        await expect(downloadBytes(asset, { agentFactory: () => agent, request: () => {
          signalSpy.mock.contexts.at(-1).abort();
          return req;
        } })).rejects.toThrow('download timed out');
        expect(req.writableEnded).toBe(false);
        expect(req.destroyed).toBe(true);
        expect(agent.destroy).toHaveBeenCalledOnce();
        expect(getEventListeners(signalSpy.mock.results[0].value, 'abort')).toHaveLength(0);
      } finally { signalSpy.mockRestore(); req.response.destroy(); }
    });
  });
}

export function installNetworkScenarios() {
  let fixture;
  let abortSpy;
  const harnesses = [];
  const active = (harness) => { harnesses.push(harness); return harness; };
  beforeAll(async () => { fixture = await tlsFixture(); });
  beforeAll(() => { abortSpy = vi.spyOn(AbortSignal.prototype, 'addEventListener'); });
  afterEach(() => {
    try { for (const harness of harnesses) assertReleased(harness, abortSpy); }
    finally {
      for (const harness of harnesses.splice(0)) for (const path of harness.paths) fixture.routes.delete(path);
      abortSpy.mockClear();
    }
  });
  afterAll(async () => {
    abortSpy.mockRestore();
    for (const socket of fixture.sockets) socket.destroy();
    await new Promise((resolve) => fixture.server.close(resolve));
  });
  registerUrlBoundaries();
  registerSuccess(() => fixture, active);
  registerRedirects(() => fixture, active);
  registerFailures(() => fixture, active);
  registerTimeouts(() => fixture, active);
  registerEventFailures();
}
