import { request } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fixture, own, payload, raw } from './launcher-debug-helper.mjs';

afterEach(cleanup);

function watchResponses(server) {
  const responses = [];
  const watch = (_req, res) => {
    const state = { res, limit: res.getMaxListeners(), peak: res.listenerCount('close') };
    const added = (event) => {
      if (event === 'close') state.peak = Math.max(state.peak, res.listenerCount('close') + 1);
    };
    res.on('newListener', added);
    responses.push(state);
    own(() => res.off('newListener', added));
  };
  server.prependListener('request', watch);
  own(() => server.off('request', watch));
  return responses;
}

const cases = [false, true].flatMap((debug) => [false, true].flatMap((gzip) =>
  ['GET', 'POST'].map((method) => ({ debug, gzip, method }))));

describe('response cancellation listener ownership', () => {
  it.each(cases)('bounds close listeners with debug=$debug gzip=$gzip $method', async ({ debug, gzip, method }) => {
    const context = await fixture({ debug });
    const responses = watchResponses(context.launcher.server);
    for (let index = 0; index < 4; index += 1) {
      const result = await raw(context.launcher.url, '/api/v1/meta', {
        method, body: method === 'POST' ? '{}' : undefined,
        headers: gzip ? { 'accept-encoding': 'gzip' } : {},
      });
      expect(result.status).toBe(200);
      expect(gzip ? gunzipSync(result.bytes) : result.bytes).toEqual(payload);
    }
    expect(responses).toHaveLength(4);
    for (const state of responses) {
      expect(state.limit).toBe(10);
      expect(state.res.getMaxListeners()).toBe(state.limit);
      expect(state.peak).toBeLessThanOrEqual(state.limit);
      expect(state.res.listeners('close').some((listener) => listener.name === 'cancelPending')).toBe(false);
    }
    expect(new Set(responses.map((state) => state.peak)).size).toBe(1);
  });

  it('cancels an upstream request before headers without leaving pending listeners', async () => {
    let began; let closed;
    const started = new Promise((resolve) => { began = resolve; });
    const upstreamClosed = new Promise((resolve) => { closed = resolve; });
    const context = await fixture({ handler: (_req, res) => { res.once('close', closed); began(); } });
    const responses = watchResponses(context.launcher.server);
    const req = request(context.launcher.url + '/api/v1/meta');
    req.on('error', () => {});
    own(() => req.destroy());
    req.end();
    await started;
    req.destroy();
    await upstreamClosed;
    await expect.poll(() => responses[0]?.res.destroyed).toBe(true);
    expect(responses[0].res.listeners('close').some((listener) => listener.name === 'cancelPending')).toBe(false);
    expect((await raw(context.launcher.url, '/api/v1/debug')).status).toBe(404);
  });
});
