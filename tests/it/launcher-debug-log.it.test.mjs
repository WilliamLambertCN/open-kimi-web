import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanup, event, fixture, markers, own, page, payload, raw, records, requestEvents, transcript,
} from './launcher-debug-helper.mjs';

afterEach(cleanup);

function delayedResponse(headersMs, bodyMs) {
  return (_req, res) => {
    const timers = [];
    res.once('close', () => timers.forEach(clearTimeout));
    timers.push(setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': payload.length });
      res.flushHeaders();
      timers.push(setTimeout(() => res.end(payload), bodyMs));
    }, headersMs));
  };
}

function expectCounts(end, rawBytes, result, encoding = 'identity') {
  expect(end).toMatchObject({ measured: true, outcome: 'finished', status: 200, rawBytes,
    wireBytes: result.bytes.length, encoding });
}

function expectTimings(events, headerFloor, bodyFloor) {
  const upstream = event(events, 'http_upstream');
  const first = event(events, 'http_first_byte');
  const end = event(events, 'http_end');
  expect(upstream.upstreamMs).toBeGreaterThanOrEqual(headerFloor);
  expect(first.firstByteMs - upstream.upstreamMs).toBeGreaterThanOrEqual(bodyFloor);
  expect(end.elapsedMs).toBeGreaterThanOrEqual(first.firstByteMs);
  expect(end.firstByteMs).toBe(first.firstByteMs);
}

describe('real debug-log HTTP measurements', () => {
  it.each([
    { headersMs: 160, bodyMs: 0, headerFloor: 100, bodyFloor: 0 },
    { headersMs: 0, bodyMs: 160, headerFloor: 0, bodyFloor: 100 },
  ])('separates header and body wait ($headersMs/$bodyMs ms)', async (timing) => {
    const context = await fixture({ handler: delayedResponse(timing.headersMs, timing.bodyMs) });
    const response = await raw(context.launcher.url, transcript + page);
    expect(response.bytes).toEqual(payload);
    const events = requestEvents(await records(context));
    expectTimings(events, timing.headerFloor, timing.bodyFloor);
    expectCounts(event(events, 'http_end'), payload.length, response);
    expect(events.map((row) => row.event)).toEqual(['http_begin', 'http_upstream', 'http_first_byte', 'http_end']);
  });

  it('counts local gzip output exactly as a raw Node client receives it', async () => {
    const context = await fixture();
    const response = await raw(context.launcher.url, transcript + page, { headers: { 'accept-encoding': 'gzip' } });
    expect(response.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(response.bytes)).toEqual(payload);
    const end = event(requestEvents(await records(context)), 'http_end');
    expectCounts(end, payload.length, response, 'gzip');
    expect(end.upstreamEncoding).toBe('identity');
    expect(end.wireBytes).toBeLessThan(end.rawBytes);
  });

  it('counts already encoded upstream bytes without decompressing or recompressing', async () => {
    const compressed = gzipSync(payload);
    const context = await fixture({ handler: (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip',
        'content-length': compressed.length });
      res.end(compressed);
    } });
    const response = await raw(context.launcher.url, transcript + page, { headers: { 'accept-encoding': 'gzip' } });
    expect(response.bytes).toEqual(compressed);
    const end = event(requestEvents(await records(context)), 'http_end');
    expectCounts(end, compressed.length, response, 'gzip');
    expect(end.upstreamEncoding).toBe('gzip');
  });

  it('measures static sendResponse bodies but not direct-end small errors', async () => {
    const context = await fixture();
    const response = await raw(context.launcher.url, '/assets/fixture-HASH.txt');
    expect(response.bytes).toEqual(payload);
    expect((await raw(context.launcher.url, '/api/v1/debug')).status).toBe(404);
    const rows = await records(context);
    const first = requestEvents(rows);
    expectCounts(event(first, 'http_end'), payload.length, response);
    expect(event(first, 'http_begin').route).toBe('static');
    const end = event(requestEvents(rows, 1), 'http_end');
    expect(end).toMatchObject({ measured: false, status: 404, outcome: 'finished' });
    expect(end.firstByteMs).toBeUndefined();
  });
});

describe('real debug-log paging and privacy', () => {
  it('links anonymous sessions and clients while keeping each request id unique', async () => {
    const context = await fixture();
    const paths = [
      transcript + page, transcript + page + '&before_turn=7', transcript + '?agent_id=child&page_size=10',
      transcript + '?agent_id=main&page_size=%31%30', transcript + '?agent_id=main&page_size=10&unknown=1',
    ];
    for (const path of paths) expect((await raw(context.launcher.url, path)).bytes).toEqual(payload);
    expect(context.received.map((req) => req.url)).toEqual([
      transcript + '?agent_id=main&page_size=1', ...paths.slice(1),
    ]);
    const rows = await records(context);
    const begins = rows.filter((row) => row.event === 'http_begin');
    expect(new Set(begins.map((row) => row.id)).size).toBe(paths.length);
    expect(new Set(begins.map((row) => row.sessionTag)).size).toBe(1);
    expect(new Set(begins.map((row) => row.clientTag)).size).toBe(1);
    expect(begins[0].sessionTag).toMatch(/^[0-9a-f]{16}$/);
    expect(begins[0].clientTag).toMatch(/^[0-9a-f]{16}$/);
    expect(begins[0]).toMatchObject({ route: 'transcript', pageSize: 10, upstreamPageSize: 1, pagingApplied: true });
    for (const begin of begins.slice(1)) expect(begin.pagingApplied).toBe(false);
    begins.forEach((_begin, index) => requestEvents(rows, index));
  });

  it('never serializes unknown, encoded, workspace or query paths and request/response bodies', async () => {
    const context = await fixture({ handler: (req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.once('end', () => res.end(Buffer.concat(chunks)));
    } });
    const paths = [
      `/api/v1/${markers.workspace}?token=${markers.query}`,
      `/api/v1/sessions/${encodeURIComponent(markers.session).replaceAll('-', '%2D')}/transcript${page}`,
      `/api/v1/fs/C%3A%5Cfictional%5Cworkspace%5C${markers.workspace}:read?secret=${markers.query}`,
    ];
    for (const path of paths) {
      const response = await raw(context.launcher.url, path, { method: 'POST', body: markers.body });
      expect(response.bytes.toString()).toBe(markers.body);
    }
    const rows = await records(context);
    const begins = rows.filter((row) => row.event === 'http_begin');
    expect(begins.map((row) => row.route)).toEqual(['other', 'other', 'files']);
    expect(begins.every((row) => row.sessionTag === undefined)).toBe(true);
    expect(context.received[0].headers.authorization).toBe(`Bearer ${markers.token}`);
    expect(context.received[0].headers.cookie).toBe(`test=${markers.cookie}`);
    expect(context.received.map((req) => req.url)).toEqual(paths);
  });

  it('leaves HTTP response bytes, status, auth and paging unchanged when debug is omitted', async () => {
    const enabled = await fixture();
    const disabled = await fixture({ debug: false });
    const paths = [transcript + page, transcript + page + '&before_turn=7'];
    for (const path of paths) {
      const headers = { 'accept-encoding': 'gzip' };
      const first = await raw(enabled.launcher.url, path, { headers });
      const second = await raw(disabled.launcher.url, path, { headers });
      expect(second.status).toBe(first.status);
      expect(second.headers['content-encoding']).toBe(first.headers['content-encoding']);
      expect(second.bytes).toEqual(first.bytes);
    }
    expect(disabled.received).toEqual(enabled.received.map((req, index) => ({
      ...req, headers: { ...req.headers, host: disabled.received[index].headers.host },
    })));
    await records(enabled);
    await disabled.launcher.close();
    expect(existsSync(join(disabled.home, 'logs'))).toBe(false);
  });
});

async function cancelRequest(context) {
  const origin = new URL(context.launcher.url);
  await new Promise((resolve, reject) => {
    const req = request({ hostname: origin.hostname, port: origin.port, path: transcript + page }, (res) => {
      res.once('data', () => { res.destroy(); resolve(); });
      res.on('error', () => {});
    });
    own(() => req.destroy());
    req.once('error', reject);
    req.end();
  });
}

function streamingBody(bytes, backpressure) {
  return (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length });
    let offset = 0;
    function pump() {
      while (offset < bytes.length) {
        const chunk = bytes.subarray(offset, offset + 16384);
        offset += chunk.length;
        if (!res.write(chunk)) {
          backpressure.count += 1;
          res.once('drain', pump);
          return;
        }
      }
      res.end();
    }
    pump();
  };
}

describe('real debug-log HTTP cancellation and backpressure', () => {
  it('ends an aborted HTTP request exactly once and closes its upstream connection', async () => {
    let closed;
    const upstreamClosed = new Promise((resolve) => { closed = resolve; });
    const context = await fixture({ handler: (_req, res) => {
      res.once('close', closed);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write(payload);
    } });
    await cancelRequest(context);
    await upstreamClosed;
    await delay(20);
    const events = requestEvents(await records(context));
    expect(event(events, 'http_end')).toMatchObject({ measured: true, outcome: 'aborted' });
    expect(context.server.listening).toBe(true);
  });

  it('preserves all bytes and exact totals under a paused raw consumer and upstream backpressure', async () => {
    const bytes = randomBytes(256 * 1024);
    const backpressure = { count: 0 };
    const context = await fixture({ handler: streamingBody(bytes, backpressure) });
    const response = await raw(context.launcher.url, transcript + page, { pauseMs: 180 });
    expect(response.bytes).toEqual(bytes);
    expect(backpressure.count).toBeGreaterThan(0);
    const end = event(requestEvents(await records(context)), 'http_end');
    expectCounts(end, bytes.length, response);
  });

  it('records safe errors and one final event for a real upstream socket failure', async () => {
    const context = await fixture({ handler: (_req, res) => res.destroy(new Error(markers.body)) });
    context.server.on('clientError', (_error, socket) => socket.destroy());
    const response = await raw(context.launcher.url, transcript + page);
    expect(response.status).toBe(502);
    const events = requestEvents(await records(context));
    expect(event(events, 'http_error').errorCode).toBe('ECONNRESET');
    expect(event(events, 'http_end')).toMatchObject({ measured: false, outcome: 'error', status: 502 });
  });
});
