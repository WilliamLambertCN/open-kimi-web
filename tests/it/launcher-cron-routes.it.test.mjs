import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCronRouteService, serveCron, CRON_PREFIX } from '../../packages/launcher/src/cron/routes.mjs';

const authorization = 'Bearer fictional-http-cron-token';
const now = new Date(2026, 9, 19, 8).getTime();
const init = { cron: '7 9 * * *', prompt: 'Fictional HTTP reminder', recurring: true };
const path = CRON_PREFIX + '/sessions/http-fixture/tasks';
const servers = [];
const homes = [];

async function fixtureHome() {
  const home = await mkdtemp(join(tmpdir(), 'cron-route-inventory-'));
  homes.push(home);
  const agent = join(home, 'sessions', 'fixture-workspace', 'http-fixture', 'agents', 'main');
  const events = join(home, 'server', 'events');
  await mkdir(agent, { recursive: true });
  await mkdir(events, { recursive: true });
  const records = [
    { type: 'cron.add', task: { ...init, id: 'deadbeef', createdAt: now } },
    { type: 'profile.bind', agentId: 'main', modelAlias: 'fictional-saved-model' },
    { type: 'turn.prompt', agentId: 'main', turnId: 1, time: now + 1, origin: { kind: 'cron_job', jobId: 'deadbeef' } },
    { type: 'turn.ended', agentId: 'main', turnId: 1, time: now + 2, reason: 'completed' },
  ];
  await writeFile(join(agent, 'wire.jsonl'), records.map((record) => JSON.stringify(record)).join('\n') + '\n');
  const header = { kind: 'journal_header', version: 1, epoch: 'fictional-fixture-epoch', created_at: now };
  await writeFile(join(events, 'http-fixture.jsonl'), JSON.stringify(header) + '\n');
  return home;
}

function json(res, data, code = 0) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ code, data }));
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

async function fixture({ enabled = true, version = '2.2.0', onUnsafeBackend, home = null } = {}) {
  const state = { tasks: [], loaded: true, rc: { enabled: false, state: 'off' }, calls: [],
    hold: null, mismatch: false, failMutation: false };
  const upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    const body = raw ? JSON.parse(raw) : undefined;
    const method = req.url.split('/').at(-1);
    state.calls.push({ method, verb: req.method, body, url: req.url });
    if (req.headers.authorization !== authorization) {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 40101 }));
    } else if (method === 'meta') {
      if (state.hold) await state.hold;
      json(res, { server_version: version, backend: 'v2', dangerous_bypass_auth: false });
    } else if (method === 'remote-control') json(res, state.rc);
    else if (inventoryCall(req, res)) return;
    else if (!state.loaded) json(res, null, 40401);
    else nativeCall({ req, res, state, method, body });
  });
  const target = await listen(upstream);
  const service = createCronRouteService({ target, enabled, onUnsafeBackend, home });
  const server = createServer((req, res) => {
    void serveCron(req, res, service).then((handled) => {
      if (!handled) res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ asset: req.url }));
    });
  });
  const origin = await listen(server);
  return { origin, state };
}

function inventoryCall(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/api/v2/sessions') {
    const item = { id: 'http-fixture', workspace: { id: 'fixture-workspace', cwd: '/fictional/workspace' },
      meta: { archived: false, title: 'Fictional inventory session' }, activity: { model: null } };
    const next = url.searchParams.has('page_token');
    json(res, { items: next ? [] : [item], has_more: !next, next_page_token: next ? null : 'next+opaque/value=' });
  } else if (url.pathname === '/api/v1/debug/sessionManager/list') json(res, []);
  else if (url.pathname === '/api/v1/sessions/http-fixture/profile') {
    json(res, { id: 'http-fixture', workspace_id: 'fixture-workspace' });
  } else return false;
  return true;
}

function nativeCall({ req, res, state, method, body }) {
  const reads = { list: state.tasks, isDisabled: false, now };
  if (Object.hasOwn(reads, method)) json(res, reads[method]);
  else if (method === 'addTask') {
    const task = { ...body[0], id: 'deadbeef', createdAt: now };
    state.tasks.push(task);
    if (state.failMutation) req.socket.destroy();
    else json(res, state.mismatch ? { ...task, recurring: !task.recurring } : task);
  } else if (method === 'removeTasks') {
    const removed = state.tasks.filter((task) => body[0].includes(task.id)).map((task) => task.id);
    state.tasks = state.tasks.filter((task) => !removed.includes(task.id));
    json(res, removed);
  } else res.writeHead(404).end();
}

function raw(origin, route = CRON_PREFIX, { method = 'GET', body, headers = {}, slow = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(origin, { path: route, method, headers: { authorization, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers,
        body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.on('error', reject);
    if (slow) { req.flushHeaders(); req.write('{'); }
    else req.end(body);
  });
}

const write = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  })));
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe('Cron assets and read-only inventory on TCP', () => {
  it.each(['cronApi.js', 'cronView.js', 'cron.js', 'cron.css'])('leaves asset %s to the static handler', async (name) => {
    const { origin, state } = await fixture();
    const asset = '/__open-kimi-mobile/' + name;
    const result = await raw(origin, asset, { headers: { authorization: '' } });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ asset });
    expect(state.calls).toEqual([]);
  });

  it('reads cold inventory and saved history from the controlled fixture home without restoring a session', async () => {
    const home = await fixtureHome();
    const { origin, state } = await fixture({ home });
    state.loaded = false;
    expect((await raw(origin)).body.capabilities).toMatchObject({ inventory: true, history: true });
    const inventory = await raw(origin, CRON_PREFIX + '/sessions');
    expect(inventory.status).toBe(200);
    expect(inventory.body).toMatchObject({ hasMore: true, cursor: 'next+opaque/value=', items: [{
      id: 'http-fixture', title: 'Fictional inventory session', loaded: false, model: 'fictional-saved-model',
      tasks: [{ ...init, id: 'deadbeef', createdAt: now }], quality: { complete: true, reasons: [] },
    }] });
    const next = await raw(origin, CRON_PREFIX + '/sessions?cursor=' + encodeURIComponent(inventory.body.cursor));
    expect(next.body).toEqual({ items: [], hasMore: false, cursor: null });
    const urls = state.calls.map((call) => new URL(call.url, origin));
    expect(urls.filter((url) => url.pathname === '/api/v2/sessions').at(-1).searchParams.get('page_token'))
      .toBe('next+opaque/value=');
    const history = await raw(origin, CRON_PREFIX + '/sessions/http-fixture/history');
    expect(history.status).toBe(200);
    expect(history.body).toEqual({ available: true, hasMore: false, quality: { complete: true, reasons: [] },
      items: [{ taskId: 'deadbeef', kind: 'started', inherited: false, turnId: 1, time: now + 1,
        endReason: 'completed', endedAt: now + 2 }] });
    expect(state.calls.some((call) => /agentCronService|snapshot|resume|:status/.test(call.url))).toBe(false);
    expect(JSON.stringify(inventory.body)).not.toContain(home);
    expect(JSON.stringify(inventory.body)).not.toContain('/fictional/workspace');
  });

  it('rejects inventory before disk reads for invalid auth, disabled mode or unsafe RC', async () => {
    const home = await fixtureHome();
    const { origin, state } = await fixture({ home });
    const endpoint = CRON_PREFIX + '/sessions';
    expect((await raw(origin, endpoint, { headers: { authorization: 'Bearer rejected-token' } })).status).toBe(401);
    expect(state.calls.map((call) => call.method)).toEqual(['meta']);
    state.calls.length = 0;
    state.rc = { enabled: true, state: 'on' };
    expect((await raw(origin, endpoint)).body.error.code).toBe('unsafe-backend');
    expect(state.calls.map((call) => call.method)).toEqual(['meta', 'remote-control']);
    const disabled = await fixture({ home, enabled: false });
    expect((await raw(disabled.origin, endpoint)).body.error.code).toBe('not-enabled');
    expect(disabled.state.calls.map((call) => call.method)).toEqual(['meta']);
  });
});

describe('Cron 2.3.1 read-only HTTP on TCP', () => {
  it('serves 2.3.1 cold inventory/history and live snapshots while rejecting both HTTP writes without debug mutations',
    async () => {
      const home = await fixtureHome();
      const { origin, state } = await fixture({ home, version: '2.3.1' });
      const saved = { ...init, id: 'deadbeef', createdAt: now };
      state.tasks = [saved];
      const available = await raw(origin);
      expect(available.status).toBe(200);
      expect(available.body).toMatchObject({ available: true, version: '2.3.1', reason: 'read-only-version',
        capabilities: { list: true, inventory: true, history: true, create: false, remove: false } });
      const inventory = await raw(origin, CRON_PREFIX + '/sessions');
      expect(inventory.status).toBe(200);
      expect(inventory.body.items[0]).toMatchObject({ loaded: false, tasks: [saved] });
      expect((await raw(origin, CRON_PREFIX + '/sessions/http-fixture/history')).body.items).toHaveLength(1);
      expect((await raw(origin, path)).body).toEqual({ tasks: [saved], source: 'live' });
      for (const [route, body] of [[path, init], [path + '/deadbeef:delete', {}]]) {
        const result = await raw(origin, route, write(body));
        expect(result.status).toBe(409);
        expect(result.body.error).toMatchObject({ code: 'read-only-version', message: expect.stringContaining('no write') });
        expect(result.body).not.toHaveProperty('outcomeUnknown');
      }
      expect(state.tasks).toEqual([saved]);
      expect(state.calls.every((call) => call.verb === 'GET')).toBe(true);
      expect(state.calls.some((call) => /addTask|removeTasks|snapshot|resume|\/status|flush|close/.test(call.url))).toBe(false);
    });

  it('keeps ordinary 2.3.1 startup disabled rather than exposing read-only management implicitly', async () => {
    const { origin, state } = await fixture({ version: '2.3.1', enabled: false });
    expect((await raw(origin)).body).toMatchObject({ available: false, reason: 'not-enabled', version: '2.3.1',
      capabilities: { list: false, create: false, remove: false, inventory: false, history: false } });
    expect((await raw(origin, path, write(init))).body.error.code).toBe('not-enabled');
    expect(state.calls.map((call) => call.method)).toEqual(['meta', 'meta']);
  });
});

describe('Cron HTTP on real TCP', () => {
  it.each(['2.1.1', '2.2.0'])('serves availability and fixed native CRUD on %s', async (version) => {
    const { origin, state } = await fixture({ version });
    const available = await raw(origin);
    expect(available.status).toBe(200);
    expect(available.body.available).toBe(true);
    expect(available.headers).toMatchObject({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    expect((await raw(origin, path)).body).toEqual({ tasks: [], source: 'live' });
    const created = await raw(origin, path, write(init));
    expect(created.status).toBe(201);
    expect(created.body.task).toEqual({ ...init, id: 'deadbeef', createdAt: now });
    expect((await raw(origin, path)).body.tasks).toHaveLength(1);
    expect((await raw(origin, path + '/deadbeef:delete', write({}))).body).toEqual({ removed: ['deadbeef'] });
    expect(state.tasks).toEqual([]);
    expect(state.calls.filter((call) => call.method === 'remote-control')).toHaveLength(5);
    expect(state.calls.filter((call) => call.verb === 'POST').map((call) => call.body)).toEqual([[init], [['deadbeef']]]);
  });

  it('authenticates unavailable capabilities without querying RC/debug and rejects unauthorized reads', async () => {
    const { origin, state } = await fixture({ enabled: false });
    const invalid = await raw(origin, CRON_PREFIX, { headers: { authorization: 'Bearer expired-fictional-token' } });
    expect(invalid.status).toBe(401);
    expect(invalid.body).not.toHaveProperty('available');
    const disabled = await raw(origin);
    expect(disabled.body).toMatchObject({ available: false, reason: 'not-enabled' });
    expect((await raw(origin, path)).status).toBe(503);
    expect(state.calls.every((call) => call.method === 'meta')).toBe(true);
  });

  it('does not normalize encoded/dot/query paths or expose arbitrary service calls', async () => {
    const { origin, state } = await fixture();
    for (const route of [path + '?arg=[]', path.replace('/tasks', '/%74asks'),
      CRON_PREFIX + '/sessions/x/../http-fixture/tasks', CRON_PREFIX + '/agentCronService/tick']) {
      const result = await raw(origin, route);
      expect([400, 404]).toContain(result.status);
    }
    expect(state.calls.every((call) => call.method === 'meta')).toBe(true);
  });

  it('returns cold-session 409 without snapshot/status/resume and does not mutate', async () => {
    const { origin, state } = await fixture();
    state.loaded = false;
    const cold = await raw(origin, path);
    expect(cold.status).toBe(409);
    expect(cold.body.error.code).toBe('not-loaded');
    expect((await raw(origin, path, write(init))).status).toBe(409);
    expect(state.calls.some((call) => /snapshot|status|resume|addTask/.test(call.method))).toBe(false);
  });

  it('rejects cross-site, invalid JSON, malformed UTF-8, unexpected fields and oversized bodies without mutation', async () => {
    const { origin, state } = await fixture();
    expect((await raw(origin, path, { headers: { origin: 'https://example.test' } })).status).toBe(403);
    expect((await raw(origin, path, { method: 'POST', body: '{}' })).status).toBe(415);
    expect((await raw(origin, path, write({ ...init, method: 'tick' }))).status).toBe(400);
    expect((await raw(origin, path, { ...write({}), body: Buffer.from([0xc3, 0x28]) })).status).toBe(400);
    expect((await raw(origin, path, { ...write({}), body: 'x'.repeat(16 * 1024 + 1) })).status).toBe(413);
    expect(state.calls.map((call) => call.method)).toEqual(Array(4).fill('meta'));
  });
});

describe('Cron HTTP failure and resource bounds on TCP', () => {
  it('rejects eight wrong-token unfinished bodies promptly and releases slots for valid reads', async () => {
    const { origin, state } = await fixture({ home: await fixtureHome() });
    const started = performance.now();
    const pending = Array.from({ length: 8 }, (_, index) => raw(origin, index % 2 ? path : path + '/deadbeef:delete', {
      method: 'POST', slow: true, headers: { authorization: 'Bearer wrong-fictional-token',
        'content-type': 'application/json', 'content-length': '100' },
    }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      expect((await raw(origin)).status).toBe(200);
      const rejected = await Promise.all(pending);
      expect(rejected.map((result) => result.status)).toEqual(Array(8).fill(401));
      expect(performance.now() - started).toBeLessThan(1500);
      expect(rejected.every((result) => result.body.error.code === 'unauthorized')).toBe(true);
      expect(state.calls.map((call) => call.method)).toEqual([...Array(9).fill('meta'), 'remote-control']);
      expect((await raw(origin, path)).status).toBe(200);
      expect(state.tasks).toEqual([]);
    } finally {
      await Promise.all(pending);
    }
  });

  it.each(['starting', 'on', 'stopping', 'conflict'])('refuses RC %s and notifies once without mutation', async (stateName) => {
    let notifications = 0;
    const { origin, state } = await fixture({ onUnsafeBackend: () => { notifications += 1; } });
    state.rc = { enabled: stateName === 'on', state: stateName };
    for (let i = 0; i < 2; i += 1) {
      const result = await raw(origin, path, write(init));
      expect(result.status).toBe(503);
      expect(result.body.error.code).toBe('unsafe-backend');
    }
    expect(notifications).toBe(1);
    expect(state.calls.some((call) => call.method === 'addTask')).toBe(false);
  });

  it.each(['mismatch', 'failMutation'])('marks %s after mutation as outcome unknown', async (failure) => {
    const { origin, state } = await fixture();
    state[failure] = true;
    const result = await raw(origin, path, write(init));
    expect(result.status).toBe(503);
    expect(result.body.outcomeUnknown).toBe(true);
    expect(state.tasks).toHaveLength(1);
    expect(state.calls.filter((call) => call.verb === 'POST').map((call) => call.method)).toEqual(['addTask']);
    expect(JSON.stringify(result.body)).not.toContain(init.prompt);
    expect(JSON.stringify(result.body)).not.toContain(authorization);
  });

  it('rejects a ninth in-flight operation immediately rather than queuing it', async () => {
    const { origin, state } = await fixture();
    let release;
    state.hold = new Promise((resolve) => { release = resolve; });
    const pending = Array.from({ length: 8 }, () => raw(origin));
    for (let i = 0; i < 100 && state.calls.length < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    try {
      expect(state.calls).toHaveLength(8);
      const busy = await raw(origin);
      expect(busy.status).toBe(429);
      expect(busy.body.error.code).toBe('busy');
      expect(state.calls).toHaveLength(8);
    } finally {
      state.hold = null;
      release();
      await Promise.all(pending);
    }
  });

  it('deadlines a slow TCP body and does not start a native operation', async () => {
    const { origin, state } = await fixture();
    const result = await raw(origin, path, { method: 'POST', headers: { 'content-type': 'application/json' }, slow: true });
    expect(result.status).toBe(408);
    expect(result.body.error.code).toBe('body-timeout');
    expect(state.calls.map((call) => call.method)).toEqual(['meta']);
  }, 5000);
});
