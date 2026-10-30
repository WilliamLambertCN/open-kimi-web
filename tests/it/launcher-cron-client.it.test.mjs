import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { createCronClient } from '../../packages/launcher/src/cron/client.mjs';

const authorization = 'Bearer fictional-cron-tcp-token';
const now = new Date(2026, 9, 19, 8).getTime();
const meta = { server_version: '2.1.1', backend: 'v2', dangerous_bypass_auth: false };
const args = { sessionId: 'tcp-fixture-session', authorization };
const init = { cron: '7 9 * * *', prompt: 'Fictional TCP reminder' };
const servers = [];

function send(res, data, code = 0) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ code, data }));
}

function task(index, values = init) {
  return { ...values, id: index.toString(16).padStart(8, '0'), createdAt: now, recurring: true };
}

async function startFixture(overrides = {}) {
  const state = { tasks: [], loaded: true, disabled: false, meta, reject: null, ...overrides };
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    const body = text ? JSON.parse(text) : undefined;
    calls.push({ path: req.url, method: req.method, authorization: req.headers.authorization, body });
    if (req.headers.authorization !== authorization) {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 40101 }));
      return;
    }
    if (req.url === '/api/v1/meta') {
      send(res, state.meta);
      return;
    }
    if (state.reject) {
      send(res, null, state.reject);
      return;
    }
    if (!state.loaded) {
      send(res, null, 40401);
      return;
    }
    await dispatch(req, res, body, state);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const target = `http://127.0.0.1:${server.address().port}`;
  return { target, client: createCronClient({ target }), state, calls };
}

async function dispatch(req, res, body, state) {
  const prefix = `/api/v1/debug/session/${args.sessionId}/agent/main/agentCronService/`;
  if (!req.url.startsWith(prefix)) {
    res.writeHead(404).end();
    return;
  }
  const method = req.url.slice(prefix.length);
  const getters = { list: state.tasks, now, isDisabled: state.disabled };
  if (Object.hasOwn(getters, method) && req.method === 'GET') {
    send(res, getters[method]);
  } else if (method === 'addTask' && req.method === 'POST') {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const added = task(state.tasks.length + 1, body[0]);
    state.tasks.push(added);
    send(res, added);
  } else if (method === 'removeTasks' && req.method === 'POST') {
    const removed = state.tasks.filter((entry) => body[0].includes(entry.id)).map((entry) => entry.id);
    state.tasks = state.tasks.filter((entry) => !removed.includes(entry.id));
    send(res, removed);
  } else {
    res.writeHead(404).end();
  }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  })));
});

describe('real TCP restricted Cron client', () => {
  it.each(['2.3.1', '2.4.1'])('reads %s task memory but rejects writes before any debug mutation over TCP', async (version) => {
    const saved = task(1);
    const { client, state, calls } = await startFixture({ meta: { ...meta, server_version: version }, tasks: [saved] });
    expect(await client.list(args)).toEqual([saved]);
    await expect(client.create({ ...args, init })).rejects.toMatchObject({ code: 'read-only-version' });
    await expect(client.remove({ ...args, id: saved.id })).rejects.toMatchObject({ code: 'read-only-version' });
    expect(state.tasks).toEqual([saved]);
    expect(calls.map((call) => call.path.split('/').at(-1))).toEqual(['meta', 'list', 'meta', 'meta']);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it.each(['2.1.1', '2.2.0'])('performs list/create/remove against exact version %s over TCP', async (version) => {
    const { client, calls } = await startFixture({ meta: { ...meta, server_version: version } });
    expect(await client.list(args)).toEqual([]);
    const added = await client.create({ ...args, init });
    expect(added).toEqual(task(1));
    expect(await client.list(args)).toEqual([added]);
    expect(await client.remove({ ...args, id: added.id })).toEqual([added.id]);
    expect(await client.list(args)).toEqual([]);
    const mutations = calls.filter((call) => call.method === 'POST');
    expect(mutations.map((call) => call.path.split('/').at(-1))).toEqual(['addTask', 'removeTasks']);
    expect(mutations[0].body).toEqual([{ ...init, recurring: true }]);
    expect(mutations[1].body).toEqual([[added.id]]);
    expect(calls.filter((call) => call.path === '/api/v1/meta')).toHaveLength(6);
    expect(calls.every((call) => call.authorization === authorization)).toBe(true);
    expect(calls.every((call) => !call.path.includes('?'))).toBe(true);
  });

  it('rejects illegal creates without any addTask and rejects expired auth before debug access', async () => {
    const { client, calls } = await startFixture();
    for (const invalid of [
      { ...init, cron: '* * * * * *' }, { ...init, prompt: ' \n\t' },
      { ...init, prompt: '中'.repeat(2731) }, { ...init, recurring: 1 }, { ...init, model: 'fixture' },
    ]) {
      await expect(client.create({ ...args, init: invalid })).rejects.toMatchObject({ code: 'invalid-input' });
    }
    expect(calls).toEqual([]);
    await expect(client.create({ ...args, authorization: 'Bearer expired-fixture-token', init }))
      .rejects.toMatchObject({ code: 'unauthorized' });
    expect(calls.map((call) => call.path)).toEqual(['/api/v1/meta']);
  });

  it('returns not-loaded on cold reads/writes without snapshot, resume or fallback requests', async () => {
    const { client, calls } = await startFixture({ loaded: false });
    await expect(client.list(args)).rejects.toMatchObject({ code: 'not-loaded' });
    await expect(client.create({ ...args, init })).rejects.toMatchObject({ code: 'not-loaded' });
    await expect(client.remove({ ...args, id: 'deadbeef' })).rejects.toMatchObject({ code: 'not-loaded' });
    expect(calls.map((call) => call.path.split('/').at(-1))).toEqual([
      'meta', 'list', 'meta', 'isDisabled', 'meta', 'removeTasks',
    ]);
    expect(calls.some((call) => /snapshot|resume|addTask/.test(call.path))).toBe(false);
  });

  it('rejects HTTP-200 business errors and never retries a native mutation', async () => {
    const { client, state, calls } = await startFixture();
    state.reject = 50001;
    await expect(client.list(args)).rejects.toMatchObject({ code: 'upstream-business' });
    await expect(client.remove({ ...args, id: 'deadbeef' })).rejects.toMatchObject({ code: 'upstream-business' });
    expect(calls.filter((call) => call.path.endsWith('/removeTasks'))).toHaveLength(1);
    expect(calls.some((call) => /snapshot|resume/.test(call.path))).toBe(false);
  });

  it('fails closed on changed runtime version and disabled native scheduling', async () => {
    const { client, state, calls } = await startFixture({ meta: { ...meta, server_version: '2.2.1' } });
    await expect(client.create({ ...args, init })).rejects.toMatchObject({ code: 'unsupported-version' });
    expect(calls).toHaveLength(1);
    state.meta = meta;
    state.disabled = true;
    await expect(client.create({ ...args, init })).rejects.toMatchObject({ code: 'disabled' });
    expect(calls.some((call) => /addTask|\/now$|\/list$/.test(call.path))).toBe(false);
  });

  it('serializes same-session creates across client instances and rejects task 51', async () => {
    const { client, target, state, calls } = await startFixture({ tasks: Array.from({ length: 49 }, (_, i) => task(i + 1)) });
    const second = createCronClient({ target });
    const results = await Promise.allSettled([
      client.create({ ...args, init }), second.create({ ...args, init }), second.create({ ...args, init }),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'rejected']);
    expect(results[1].reason.code).toBe('task-limit');
    expect(results[2].reason.code).toBe('task-limit');
    expect(state.tasks).toHaveLength(50);
    expect(calls.filter((call) => call.path.endsWith('/addTask'))).toHaveLength(1);
  });

});

describe('real TCP mutation response and redirect boundaries', () => {
  it('rejects a native mutation response that changes one-shot to recurring, without retry or rollback', async () => {
    const { client, state, calls } = await startFixture();
    await expect(client.create({ ...args, init: { ...init, recurring: false } }))
      .rejects.toMatchObject({ code: 'invalid-response' });
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].recurring).toBe(true);
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.path.split('/').at(-1)))
      .toEqual(['addTask']);
  });

  it('refuses redirects without forwarding authorization to the redirect destination', async () => {
    const destination = await startFixture();
    const redirector = createServer((req, res) => res.writeHead(307, { location: destination.target + req.url }).end());
    await new Promise((resolve) => redirector.listen(0, '127.0.0.1', resolve));
    servers.push(redirector);
    const client = createCronClient({ target: `http://127.0.0.1:${redirector.address().port}` });
    await expect(client.list(args)).rejects.toMatchObject({ code: 'redirect' });
    expect(destination.calls).toEqual([]);
  });
});
