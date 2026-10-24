import { afterEach, describe, expect, it, vi } from 'vitest';

import { CronClientError, createCronClient } from '../src/cron/client.mjs';
import { createCronTransport, MAX_RESPONSE_BYTES, REQUEST_TIMEOUT_MS } from '../src/cron/transport.mjs';

const target = 'http://127.0.0.1:12345';
const sessionId = 'session-fixture';
const authorization = 'Bearer fictional-current-token';
const args = { sessionId, authorization };
const init = { cron: '7 9 * * *', prompt: 'Fictional reminder' };
const now = new Date(2026, 9, 19, 8).getTime();
const meta = { server_version: '2.1.1', backend: 'v2', dangerous_bypass_auth: false };
const task = { ...init, id: '01K7Y36F6R2H6TXMNDS8WM0N9B', createdAt: now, recurring: true };
const envelope = (data, code = 0) => Response.json({ code, data });
const methodOf = (url) => url.pathname.split('/').at(-1);

function fixture(overrides = {}) {
  const values = { meta, list: [], isDisabled: false, now, addTask: task, removeTasks: [task.id], ...overrides };
  const fetchImpl = vi.fn(async (url, options) => {
    const value = values[methodOf(url)];
    if (typeof value === 'function') return value(url, options);
    return envelope(value);
  });
  return { client: createCronClient({ target, fetchImpl }), fetchImpl, values };
}

function methods(fetchImpl) {
  return fetchImpl.mock.calls.map(([url]) => methodOf(url));
}

afterEach(() => vi.useRealTimers());

describe('restricted Cron client contract', () => {
  it('exposes only list/create/remove, verifying real metadata and current auth for every operation', async () => {
    const { client, fetchImpl } = fixture();
    expect(Object.keys(client)).toEqual(['list', 'create', 'remove']);
    expect(Object.isFrozen(client)).toBe(true);
    await expect(client.list(args)).resolves.toEqual([]);
    await expect(client.create({ ...args, init })).resolves.toEqual(task);
    await expect(client.remove({ ...args, id: task.id })).resolves.toEqual([task.id]);
    expect(methods(fetchImpl)).toEqual([
      'meta', 'list', 'meta', 'isDisabled', 'now', 'list', 'meta', 'addTask', 'meta', 'removeTasks',
    ]);
    const add = fetchImpl.mock.calls.find(([url]) => methodOf(url) === 'addTask');
    const remove = fetchImpl.mock.calls.find(([url]) => methodOf(url) === 'removeTasks');
    expect(JSON.parse(add[1].body)).toEqual([{ ...init, recurring: true }]);
    expect(JSON.parse(remove[1].body)).toEqual([[task.id]]);
    for (const [url, options] of fetchImpl.mock.calls) {
      expect(url.origin).toBe(target);
      expect(options).toMatchObject({ redirect: 'manual', credentials: 'omit', cache: 'no-store' });
      expect(options.headers.authorization).toBe(authorization);
      if (methodOf(url) !== 'meta') {
        expect(url.pathname).toMatch(/^\/api\/v1\/debug\/session\/session-fixture\/agent\/main\/agentCronService\//);
      }
    }
  });

  it('returns native fields unchanged, without inventing history, model, last fire or next fire', async () => {
    const native = { ...task, tags: { fixture: 'preserved' }, lastFiredAt: now - 1000, recurring: undefined };
    const { client } = fixture({ list: [native] });
    const listed = await client.list(args);
    expect(listed).toEqual([JSON.parse(JSON.stringify(native))]);
    expect(listed[0]).not.toHaveProperty('history');
    expect(listed[0]).not.toHaveProperty('model');
    expect(listed[0]).not.toHaveProperty('nextFireAt');
  });

});

describe('exact 2.3.1 read-only client boundary', () => {
  it('reads task memory but rejects create/remove before all debug calls', async () => {
    const { client, fetchImpl } = fixture({ meta: { ...meta, server_version: '2.3.1' }, list: [task] });
    expect(await client.list(args)).toEqual([task]);
    fetchImpl.mockClear();
    for (const write of [() => client.create({ ...args, init }), () => client.remove({ ...args, id: task.id })]) {
      await expect(write()).rejects.toMatchObject({ code: 'read-only-version', message: expect.stringContaining('no write') });
    }
    expect(methods(fetchImpl)).toEqual(['meta', 'meta']);
    expect(fetchImpl.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
  });

  it('rechecks the actual version at the outbound write boundary after create preflight', async () => {
    let checks = 0;
    const { client, fetchImpl } = fixture({
      meta: () => envelope({ ...meta, server_version: ++checks === 1 ? '2.2.0' : '2.3.1' }),
    });
    await expect(client.create({ ...args, init })).rejects.toMatchObject({ code: 'read-only-version' });
    expect(methods(fetchImpl)).toEqual(['meta', 'isDisabled', 'now', 'list', 'meta']);
  });

  it('protects direct transport mutations even without client or route gates', async () => {
    const { fetchImpl } = fixture({ meta: { ...meta, server_version: '2.3.1' } });
    const transport = createCronTransport(target, fetchImpl);
    await expect(transport.authorize(authorization)).resolves.toBe('2.3.1');
    await expect(transport.addTask(sessionId, authorization, init)).rejects.toMatchObject({ code: 'read-only-version' });
    await expect(transport.removeTask(sessionId, authorization, task.id)).rejects.toMatchObject({ code: 'read-only-version' });
    expect(methods(fetchImpl)).toEqual(['meta', 'meta', 'meta']);
  });

  it.each(['2.3.0', '2.3.2', '2.3.1-modified'])('does not extend readonly support to unverified %s', async (version) => {
    const { client, fetchImpl } = fixture({ meta: { ...meta, server_version: version } });
    await expect(client.list(args)).rejects.toMatchObject({ code: 'unsupported-version' });
    expect(methods(fetchImpl)).toEqual(['meta']);
  });
});

describe('target, argument and authorization boundaries', () => {
  it.each([
    'https://example.test', 'http://192.0.2.1', 'http://localhost:12345', 'http://[::ffff:127.0.0.1]',
    'http://user:password@127.0.0.1', 'http://127.0.0.1/path', 'http://127.0.0.1/?arg=x',
    'http://127.0.0.1/#token=x', 'ftp://127.0.0.1', 'not-url', 'http://127.0.0.1:0',
  ])('rejects unsafe or ambiguous target %#', (value) => {
    expect(() => createCronClient({ target: value })).toThrow(CronClientError);
  });

  it('accepts IPv6 literal loopback and rejects claimed version/config credentials', () => {
    expect(Object.keys(createCronClient({ target: 'https://[::1]:12345/' }))).toEqual(['list', 'create', 'remove']);
    expect(() => createCronClient({ target, version: '2.1.1' })).toThrow(CronClientError);
    expect(() => createCronClient({ target, authorization })).toThrow(CronClientError);
  });

  it.each([
    { ...args, sessionId: '../other' }, { ...args, sessionId: 'x%2fother' }, { ...args, sessionId: '' },
    { ...args, sessionId: 'x?arg=[]' }, { ...args, authorization: '' }, { ...args, authorization: 'Basic value' },
    { ...args, authorization: 'Bearer token\r\nHost: example.test' }, { ...args, method: 'tick' },
    { ...args, url: target }, { ...args, service: 'sessionManager' }, { ...args, agentId: 'side' },
  ])('rejects invalid operation arguments before any network call %#', async (input) => {
    const { client, fetchImpl } = fixture();
    await expect(client.list(input)).rejects.toBeInstanceOf(CronClientError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects invalid create and remove before meta or mutation', async () => {
    const { client, fetchImpl } = fixture();
    await expect(client.create({ ...args, init: { ...init, prompt: '\ud800' } })).rejects.toMatchObject({
      code: 'invalid-input',
    });
    await expect(client.remove({ ...args, id: ['12345678'] })).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(client.remove({ ...args, id: 'task/other' })).rejects.toMatchObject({ code: 'invalid-input' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...meta, server_version: '2.2.1' }, 'unsupported-version'],
    [{ ...meta, server_version: '2.2.0-modified' }, 'unsupported-version'],
    [{ ...meta, backend: 'v1' }, 'unsupported-version'],
    [{ ...meta, dangerous_bypass_auth: true }, 'unsafe-auth'],
    [{ server_version: '2.1.1', backend: 'v2' }, 'unsafe-auth'],
  ])('fails closed on actual metadata %#', async (actual, code) => {
    const { client, fetchImpl } = fixture({ meta: actual });
    await expect(client.create({ ...args, init })).rejects.toMatchObject({ code });
    expect(methods(fetchImpl)).toEqual(['meta']);
  });

  it('does not reuse a prior token or prior version decision', async () => {
    const { client, fetchImpl, values } = fixture();
    await client.list(args);
    values.meta = { ...meta, server_version: '2.2.1' };
    await expect(client.list({ ...args, authorization: 'Bearer replacement-token' })).rejects.toMatchObject({
      code: 'unsupported-version',
    });
    expect(fetchImpl.mock.calls.at(-1)[1].headers.authorization).toBe('Bearer replacement-token');
    await expect(client.list({ sessionId })).rejects.toMatchObject({ code: 'invalid-input' });
    expect(methods(fetchImpl)).toEqual(['meta', 'list', 'meta']);
  });
});

describe('created-task response validation', () => {
  it.each([
    { cron: '8 9 * * *' }, { prompt: 'Changed prompt' }, { recurring: true }, { recurring: undefined },
    { id: 'not-a-task-id' }, { createdAt: -1 }, { createdAt: 8.64e15 + 1 },
    { createdAt: 1.5 }, { createdAt: '2026-10-19T00:00:00Z' },
  ])('rejects a mismatched or invalid create response without retry or rollback %#', async (overrides) => {
    const oneShot = { ...init, recurring: false };
    const returned = { ...task, ...oneShot, ...overrides };
    const { client, fetchImpl } = fixture({ addTask: returned });
    await expect(client.create({ ...args, init: oneShot })).rejects.toMatchObject({ code: 'invalid-response' });
    expect(methods(fetchImpl)).toEqual(['meta', 'isDisabled', 'now', 'list', 'meta', 'addTask']);
    expect(JSON.parse(fetchImpl.mock.calls.at(-1)[1].body)).toEqual([oneShot]);
  });

  it('accepts an exact normalized one-shot response without dropping native fields', async () => {
    const normalized = { ...init, recurring: false };
    const returned = { ...task, ...normalized, tags: { fixture: 'preserved' } };
    const { client } = fixture({ addTask: returned });
    const input = { ...normalized, cron: '  7\t9  * * *  ' };
    await expect(client.create({ ...args, init: input })).resolves.toEqual(returned);
  });
});

describe('create preparation and serialization', () => {
  it.each([
    [{ isDisabled: true }, 'disabled', ['meta', 'isDisabled']],
    [{ isDisabled: 'false' }, 'invalid-response', ['meta', 'isDisabled']],
    [{ now: '2026-10-19' }, 'invalid-response', ['meta', 'isDisabled', 'now']],
    [{ list: Array(50).fill(task) }, 'task-limit', ['meta', 'isDisabled', 'now', 'list']],
    [{ list: Array(51).fill(task) }, 'task-limit', ['meta', 'isDisabled', 'now', 'list']],
  ])('never adds when native preconditions fail %#', async (overrides, code, expected) => {
    const { client, fetchImpl } = fixture(overrides);
    await expect(client.create({ ...args, init })).rejects.toMatchObject({ code });
    expect(methods(fetchImpl)).toEqual(expected);
  });

  it('rejects impossible and distant one-shot schedules using native clock, without addTask', async () => {
    const { client, fetchImpl } = fixture({ now: new Date(2026, 0, 1).getTime() });
    await expect(client.create({ ...args, init: { ...init, cron: '0 0 31 2 *' } })).rejects.toMatchObject({
      code: 'no-future-fire',
    });
    await expect(client.create({ ...args, init: { ...init, cron: '0 0 18 12 *', recurring: false } }))
      .rejects.toMatchObject({ code: 'one-shot-too-far' });
    expect(methods(fetchImpl)).not.toContain('addTask');
  });

  it('serializes writes across clients for the same origin/session, keeping the 50-task cap', async () => {
    const tasks = Array(49).fill(task);
    let active = 0;
    let maximumActive = 0;
    const { client, fetchImpl } = fixture({
      list: async () => envelope([...tasks]),
      addTask: async () => {
        active += 1;
        maximumActive = Math.max(active, maximumActive);
        await new Promise((resolve) => setTimeout(resolve, 10));
        tasks.push(task);
        active -= 1;
        return envelope(task);
      },
    });
    const second = createCronClient({ target: target + '/', fetchImpl });
    const results = await Promise.allSettled([
      client.create({ ...args, init }), second.create({ ...args, init }), client.create({ ...args, init }),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'rejected']);
    expect(results[1].reason.code).toBe('task-limit');
    expect(results[2].reason.code).toBe('task-limit');
    expect(maximumActive).toBe(1);
    expect(methods(fetchImpl).filter((method) => method === 'addTask')).toHaveLength(1);
  });

  it('orders remove after create, recovers its lock after a failed write, and never retries a mutation', async () => {
    const { client, fetchImpl, values } = fixture({ addTask: () => envelope(null, 50001) });
    const results = await Promise.allSettled([
      client.create({ ...args, init }), client.remove({ ...args, id: task.id }),
    ]);
    expect(results[0].reason.code).toBe('upstream-business');
    expect(results[1].value).toEqual([task.id]);
    expect(methods(fetchImpl)).toEqual(['meta', 'isDisabled', 'now', 'list', 'meta', 'addTask', 'meta', 'removeTasks']);
    values.addTask = task;
    await expect(client.create({ ...args, init })).resolves.toEqual(task);
  });

  it('does not block a different session behind an in-flight write', async () => {
    let release;
    const barrier = new Promise((resolve) => { release = resolve; });
    const { client } = fixture({ addTask: async (url) => {
      if (url.pathname.includes('/session-fixture/')) await barrier;
      return envelope(task);
    } });
    const first = client.create({ ...args, init });
    await expect(client.create({ ...args, sessionId: 'other-session', init })).resolves.toEqual(task);
    release();
    await expect(first).resolves.toEqual(task);
  });
});

describe('upstream protocol and resource boundaries', () => {
  it.each([
    [() => new Response('PRIVATE upstream stack', { status: 401 }), 'unauthorized'],
    [() => new Response('PRIVATE upstream stack', { status: 500 }), 'upstream-http'],
    [() => new Response(null, { status: 302, headers: { location: 'https://example.test' } }), 'redirect'],
    [() => Response.json({ code: 40101, message: 'PRIVATE' }), 'unauthorized'],
    [() => Response.json({ code: 40401, message: 'PRIVATE' }), 'not-loaded'],
    [() => Response.json({ code: 50001, message: 'PRIVATE' }), 'upstream-business'],
    [() => Response.json({ code: '0', data: [] }), 'invalid-response'],
    [() => Response.json({ code: 0 }), 'invalid-response'],
    [() => new Response('PRIVATE invalid JSON', { headers: { 'content-type': 'application/json' } }), 'invalid-response'],
    [() => new Response('{}'), 'invalid-response'],
    [() => new Response(null, { headers: { 'content-type': 'application/json' } }), 'invalid-response'],
    [() => Response.json({}, { headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) } }), 'response-too-large'],
  ])('sanitizes upstream failure %# without resume or subsequent calls', async (response, code) => {
    const { client, fetchImpl } = fixture({ meta: response });
    const error = await client.list(args).catch((value) => value);
    expect(error).toBeInstanceOf(CronClientError);
    expect(error.code).toBe(code);
    expect(error.message).not.toContain('PRIVATE');
    expect(error.message).not.toContain(authorization);
    expect(methods(fetchImpl)).toEqual(['meta']);
  });

  it('limits streamed decoded bytes and cancels an oversized response', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES));
        controller.enqueue(new Uint8Array(1));
      },
      cancel,
    }), { headers: { 'content-type': 'application/json' } });
    const { client } = fixture({ meta: () => response });
    await expect(client.list(args)).rejects.toMatchObject({ code: 'response-too-large' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects malformed UTF-8 rather than silently replacing bytes', async () => {
    const response = new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'content-type': 'application/json' } });
    const { client } = fixture({ meta: () => response });
    await expect(client.list(args)).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('does not leak a fetch exception or retry a failed mutation', async () => {
    const { client, fetchImpl } = fixture({ addTask: () => { throw new Error('PRIVATE token and task text'); } });
    const error = await client.create({ ...args, init }).catch((value) => value);
    expect(error.code).toBe('upstream-unavailable');
    expect(error.message).not.toContain('PRIVATE');
    expect(error.cause).toBeUndefined();
    expect(methods(fetchImpl).filter((method) => method === 'addTask')).toHaveLength(1);
  });

  it('times out a hanging fetch even when the injected implementation ignores AbortSignal', async () => {
    vi.useFakeTimers();
    const { client, fetchImpl } = fixture({ meta: () => new Promise(() => {}) });
    const result = expect(client.list(args)).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
    await result;
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
  });

});

describe('pending input and response cleanup', () => {
  it('times out and cancels a stalled response stream', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      headers: { 'content-type': 'application/json' },
    });
    const { client } = fixture({ meta: () => response });
    const result = expect(client.list(args)).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
    await result;
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('captures validated operation values before callers can mutate a queued request', async () => {
    const { client, fetchImpl } = fixture();
    const input = { ...args, init: { ...init } };
    const result = client.create(input);
    input.sessionId = 'other-session';
    input.authorization = 'Bearer changed-token';
    input.init.prompt = 'Changed prompt';
    await expect(result).resolves.toEqual(task);
    expect(fetchImpl.mock.calls.every(([, options]) => options.headers.authorization === authorization)).toBe(true);
    expect(fetchImpl.mock.calls.at(-1)[0].pathname).toContain('/session-fixture/');
    expect(JSON.parse(fetchImpl.mock.calls.at(-1)[1].body)).toEqual([{ ...init, recurring: true }]);
  });

  it('bounds encoded request bytes even for an 8192-byte prompt that JSON must escape', async () => {
    const prompt = '\u0000'.repeat(8192);
    const { client, fetchImpl } = fixture({ addTask: { ...task, prompt } });
    await client.create({ ...args, init: { ...init, prompt } });
    expect(Buffer.byteLength(fetchImpl.mock.calls.at(-1)[1].body)).toBeLessThan(64 * 1024);
  });

  it('rejects malformed task and removal response shapes', async () => {
    const { client, values } = fixture({ list: [{}] });
    await expect(client.list(args)).rejects.toMatchObject({ code: 'invalid-response' });
    values.list = [];
    values.addTask = {};
    await expect(client.create({ ...args, init })).rejects.toMatchObject({ code: 'invalid-response' });
    values.removeTasks = ['wrong-id'];
    await expect(client.remove({ ...args, id: task.id })).rejects.toMatchObject({ code: 'invalid-response' });
    values.removeTasks = [];
    await expect(client.remove({ ...args, id: 'deadbeef' })).resolves.toEqual([]);
  });
});
