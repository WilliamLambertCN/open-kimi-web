import { createServer, request } from 'node:http';
import { gzipSync, gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import { createLauncher } from '../../packages/launcher/src/serve.mjs';

const active = [];
const basePath = '/api/v1/sessions/qa-session_1/transcript';
const query = '?agent_id=main&page_size=10';
const responseBody = Buffer.from(JSON.stringify({ code: 0, data: {
  agent_id: 'main', items: [{ kind: 'turn', turnId: 'exact-turn-7', ordinal: 7 }],
  seq: 927, has_more: true, next_before_turn: 7,
  tasks: [{ taskId: 'fixture-task', outputTail: 'Fictional output. '.repeat(100) }],
  attachments: [{ attachmentId: 'fixture-attachment', size: 123 }],
  agents: [{ agentId: 'main', type: 'main' }], interactions: [], pending_interactions: [],
} }));

async function start(options = {}, handler) {
  const received = [];
  const upstream = createServer((req, res) => {
    received.push({ url: req.url, method: req.method, auth: req.headers.authorization,
      accept: req.headers.accept, range: req.headers.range });
    if (handler) return handler(req, res);
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': responseBody.length });
    res.end(responseBody);
  });
  await new Promise((done) => upstream.listen(0, '127.0.0.1', done));
  active.push(() => new Promise((done) => { upstream.closeAllConnections(); upstream.close(done); }));
  const launcher = await createLauncher({ target: `http://127.0.0.1:${upstream.address().port}`,
    publicDir: '.', host: '127.0.0.1', port: 0, interfaces: [], officialPresentation: true,
    officialWebVersion: '2.4.1', ...options });
  active.push(() => launcher.close());
  return { launcher, received };
}

function raw(url, path, { method = 'GET', headers = {} } = {}) {
  const origin = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ hostname: origin.hostname, port: origin.port, path, method,
      headers: { authorization: 'Bearer fictional-transcript-token', accept: 'application/json', ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.once('error', reject);
      res.once('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
    });
    req.once('error', reject); req.end();
  });
}

afterEach(async () => {
  for (const close of active.splice(0).reverse()) await close();
});

describe('real launcher initial transcript paging', () => {
  it.each(['2.3.1', '2.4.1'])('changes only the upstream page size for enhanced %s', async (officialWebVersion) => {
    const { launcher, received } = await start({ officialWebVersion });
    const result = await raw(launcher.url, basePath + query);
    expect(received).toEqual([{ url: basePath + '?agent_id=main&page_size=1', method: 'GET',
      auth: 'Bearer fictional-transcript-token', accept: 'application/json', range: undefined }]);
    expect(result.status).toBe(200);
    expect(result.bytes).toEqual(responseBody);
    expect(JSON.parse(result.bytes).data).toMatchObject({ seq: 927, has_more: true, next_before_turn: 7 });
  });

  it.each([
    '?agent_id=main&page_size=10&before_turn=7', '?agent_id=main&page_size=10&after_turn=7',
    '?agent_id=child-agent&page_size=10', '?agent_id=main&page_size=10&before_turn=',
    '?agent_id=main&page_size=10&unknown=1', '?agent_id=main&agent_id=main&page_size=10',
    '?agent_id=main&page_size=10&page_size=10', '?agent_id=main&page_size=%31%30',
  ])('preserves cursor, subagent or non-exact query %s', async (search) => {
    const { launcher, received } = await start();
    const result = await raw(launcher.url, basePath + search);
    expect(received[0].url).toBe(basePath + search);
    expect(result.bytes).toEqual(responseBody);
  });

  it.each([
    { officialPresentation: false, officialWebVersion: '2.4.1' },
    { officialPresentation: true, officialWebVersion: '2.1.1' },
    { officialPresentation: true, officialWebVersion: '2.4.2' },
    { officialPresentation: true, officialWebVersion: undefined },
  ])('leaves a custom UI or unverified version transparent (%j)', async (options) => {
    const { launcher, received } = await start(options);
    const result = await raw(launcher.url, basePath + query);
    expect(received[0].url).toBe(basePath + query);
    expect(result.bytes).toEqual(responseBody);
  });

  it('preserves encoded path bytes without normalizing the session ID', async () => {
    const { launcher, received } = await start();
    const path = '/api/v1/sessions/qa%2Dsession_1/transcript' + query;
    const result = await raw(launcher.url, path);
    expect(received[0].url).toBe(path);
    expect(result.bytes).toEqual(responseBody);
  });

  it('preserves Range and its request path', async () => {
    const { launcher, received } = await start();
    await raw(launcher.url, basePath + query, { headers: { range: 'bytes=0-20' } });
    expect(received[0].url).toBe(basePath + query);
    expect(received[0].range).toBe('bytes=0-20');
  });

  it('preserves a non-GET method and its request path', async () => {
    const { launcher, received } = await start();
    const result = await raw(launcher.url, basePath + query, { method: 'POST' });
    expect(received[0].method).toBe('POST');
    expect(received[0].url).toBe(basePath + query);
    expect(result.bytes).toEqual(responseBody);
  });

});

describe('optimized transcript transport boundaries', () => {
  it('passes an upstream error status and body through on the optimized path', async () => {
    const { launcher, received } = await start({}, (_req, res) => res.writeHead(409).end('fictional conflict'));
    const result = await raw(launcher.url, basePath + query);
    expect(received[0].url).toBe(basePath + '?agent_id=main&page_size=1');
    expect(result.status).toBe(409);
    expect(result.bytes.toString()).toBe('fictional conflict');
  });

  it('cancels the optimized upstream response when the client disconnects', async () => {
    let cancelled;
    const closed = new Promise((done) => { cancelled = done; });
    const { launcher, received } = await start({}, (_req, res) => {
      res.on('close', cancelled);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"items":[');
    });
    const response = await fetch(launcher.url + basePath + query);
    const reader = response.body.getReader();
    const first = await reader.read();
    expect(Buffer.from(first.value).toString()).toBe('{"items":[');
    await reader.cancel();
    reader.releaseLock();
    await closed;
    expect(received[0].url).toBe(basePath + '?agent_id=main&page_size=1');
  });

  it('retains existing streaming gzip behavior without changing entities, seq or cursor', async () => {
    const { launcher } = await start();
    const result = await raw(launcher.url, basePath + query, { headers: { 'accept-encoding': 'gzip' } });
    expect(result.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(result.bytes)).toEqual(responseBody);
  });

  it('preserves already encoded upstream bytes on the optimized path', async () => {
    const bytes = gzipSync(responseBody);
    const { launcher } = await start({}, (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip',
        'content-length': bytes.length });
      res.end(bytes);
    });
    const result = await raw(launcher.url, basePath + query, { headers: { 'accept-encoding': 'gzip' } });
    expect(result.bytes).toEqual(bytes);
    expect(Number(result.headers['content-length'])).toBe(bytes.length);
  });
});
