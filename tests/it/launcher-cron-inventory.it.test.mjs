import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createCronInventory } from '../../packages/launcher/src/cron/inventory.mjs';

const authorization = 'Bearer fictional-cron-inventory-tcp-token';
const workspaceId = 'wd_repo..backup_eaed49d41ffd';
const task = { id: 'deadbeef', cron: '7 9 * * *', prompt: 'Fictional TCP reminder', createdAt: 100, recurring: true };
const resources = [];
const multilineTitle = 'First line\r\nSecond line';
const native = (id, archived = false) => ({
  id, workspace: { id: workspaceId, cwd: '/fictional/tcp-workspace' },
  meta: { title: multilineTitle, archived }, activity: { status: 'idle', model: null },
});
const event = (type, fields = {}) => ({ type, time: 1000, ...fields });

function send(res, data, code = 0) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ code, data }));
}

async function writeWire(home, id, records) {
  const path = join(home, 'sessions', workspaceId, id, 'agents', 'main', 'wire.jsonl');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
  return path;
}

function dispatch(req, res, state) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/api/v1/meta') return send(res, state.meta);
  if (url.pathname === '/api/v1/debug/sessionManager/list') return send(res, state.loaded);
  if (url.pathname === '/api/v2/sessions') {
    if (state.directoryError) return send(res, null, state.directoryError);
    const more = !url.searchParams.has('page_token');
    return send(res, { items: more ? [native('first'), native('no-tasks', true)] : [native('last', true)],
      has_more: more, next_page_token: more ? state.cursor : null });
  }
  const match = /^\/api\/v1\/sessions\/([^/]+)\/profile$/.exec(url.pathname);
  if (match !== null) return send(res, { id: match[1], workspace_id: workspaceId });
  state.unexpected.push(req.url);
  res.writeHead(404).end();
}

async function fixture(version = '2.1.1') {
  const home = await mkdtemp(join(tmpdir(), 'okw-cron-inventory-tcp-'));
  const state = {
    meta: { server_version: version, backend: 'v2', dangerous_bypass_auth: false },
    loaded: [], unexpected: [], directoryError: null, cursor: 'opaque+/=&cursor',
  };
  const calls = [];
  const server = createServer((req, res) => {
    calls.push({ path: req.url, method: req.method, authorization: req.headers.authorization });
    if (req.headers.authorization !== authorization) return res.writeHead(401).end();
    if (req.method !== 'GET') return res.writeHead(405).end();
    dispatch(req, res, state);
  });
  resources.push({ home, server });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const target = `http://127.0.0.1:${server.address().port}`;
  return { home, state, calls, target, inventory: createCronInventory({ home, target }) };
}

afterEach(async () => {
  await Promise.all(resources.splice(0).map(async ({ server, home }) => {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    await rm(home, { recursive: true, force: true });
  }));
});

describe('real TCP global native Cron cold inventory', () => {
  it.each(['2.1.1', '2.2.0', '2.3.1', '2.4.1'])(
    'projects original saved tasks for exact %s without loading agents', async (version) => {
    const { home, inventory, calls, state } = await fixture(version);
    const records = [event('cron.add', { task }), event('context.undo'), event('forked', { agentId: 'main' })];
    const path = await writeWire(home, 'first', records);
    await writeWire(home, 'no-tasks', [event('context.clear')]);
    await writeWire(home, 'last', [event('cron.add', { task: { ...task, id: 'cafebabe' } })]);
    const before = await readFile(path);
    const first = await inventory.sessions({ authorization });
    expect(first.items.map((item) => item.id)).toEqual(['first', 'no-tasks']);
    expect(first.items.map((item) => item.title)).toEqual([multilineTitle, multilineTitle]);
    expect(first.items[0]).toMatchObject({ loaded: false, workspace: { id: workspaceId, name: 'tcp-workspace' } });
    expect(first.items[0].tasks).toHaveLength(version === '2.1.1' ? 1 : 0);
    expect(first.items[1]).toMatchObject({ archived: true, tasks: [], quality: { complete: true, reasons: [] } });
    const second = await inventory.sessions({ authorization, cursor: first.cursor });
    expect(second).toMatchObject({ hasMore: false, cursor: null });
    expect(second.items[0].tasks[0].id).toBe('cafebabe');
    expect(calls.filter((call) => call.path.startsWith('/api/v2/sessions')).map((call) => call.path)).toEqual([
      '/api/v2/sessions?meta.archived=all&page_size=20',
      '/api/v2/sessions?meta.archived=all&page_size=20&page_token=opaque%2B%2F%3D%26cursor',
    ]);
    expect(calls.every((call) => call.method === 'GET' && call.authorization === authorization)).toBe(true);
    expect(calls.some((call) => /snapshot|status|resume|agentCronService/.test(call.path))).toBe(false);
    expect(state.unexpected).toEqual([]);
    expect(await readFile(path)).toEqual(before);
  });

  it('keeps actual live alias distinct from saved cold models, with missing files visibly incomplete', async () => {
    const { home, inventory, state } = await fixture();
    state.loaded = [{ id: 'first', kind: 'session', accessor: {} }];
    await writeWire(home, 'first', [event('profile.bind', { agentId: 'main', modelAlias: 'saved-alias' })]);
    const first = await inventory.sessions({ authorization });
    expect(first.items[0]).toMatchObject({ loaded: true, model: 'saved-alias', modelSource: 'saved' });
    expect(first.items[1]).toMatchObject({ loaded: false, quality: { complete: false, reasons: ['wire-missing'] } });
    state.loaded = { unknown: [] };
    expect((await inventory.sessions({ authorization })).items[0]).toMatchObject({
      loaded: null, quality: { complete: false, reasons: ['live-list-invalid-shape'] },
    });
  });

});

describe('real TCP cursor byte budget', () => {
  it('round-trips 4096 UTF8 bytes and rejects over-budget input/output cursors', async () => {
    const { inventory, state, calls } = await fixture();
    const cursor = '中'.repeat(1365) + 'a';
    state.cursor = cursor;
    const first = await inventory.sessions({ authorization });
    expect(first.cursor).toBe(cursor);
    expect(await inventory.sessions({ authorization, cursor })).toMatchObject({ cursor: null, hasMore: false });
    const call = calls.find((call) => call.path.includes('page_token='));
    expect(new URL(call.path, 'http://127.0.0.1').searchParams.get('page_token')).toBe(cursor);
    const previousCalls = calls.length;
    await expect(inventory.sessions({ authorization, cursor: cursor + 'b' }))
      .rejects.toMatchObject({ code: 'invalid-input' });
    expect(calls).toHaveLength(previousCalls);
    state.cursor = cursor + 'b';
    await expect(inventory.sessions({ authorization })).rejects.toMatchObject({ code: 'invalid-response' });
  });
});

describe('real TCP cold Cron history evidence', () => {
  it.each(['2.1.1', '2.3.1', '2.4.1'])(
    'cold %s history preserves deleted jobs, exact models and shared steer end evidence without guessing', async (version) => {
      const { home, inventory, calls, state } = await fixture(version);
      await writeWire(home, 'first', [
        event('cron.add', { task }), event('turn.prompt', { agentId: 'main', turnId: 0,
          input: [], origin: { kind: 'cron_job', jobId: task.id } }),
        event('forked', { agentId: 'main' }), event('turn.prompt', { agentId: 'main', turnId: 1, origin: { kind: 'user' } }),
        event('llm.request', { agentId: 'main', kind: 'loop', turnStep: '1.0', model: 'actual-id', provider: 'openai' }),
        event('turn.steer', { agentId: 'main', turnId: 1, input: [], origin: { kind: 'cron_job', jobId: task.id } }),
        event('turn.ended', { agentId: 'main', turnId: 1, reason: 'cancelled', time: 1200, durationMs: 50 }),
        event('cron.delete', { ids: [task.id] }),
      ]);
      const history = await inventory.history({ authorization, sessionId: 'first' });
      expect(history.available).toBe(true);
      expect(history.quality).toEqual({ complete: false, reasons: ['server-missing'] });
      const inherited = history.items.find((item) => item.inherited);
      expect(inherited).toMatchObject({ kind: 'started', taskId: task.id, turnId: 0 });
      expect(inherited).not.toHaveProperty('endReason');
      const steered = history.items.find((item) => item.kind === 'steered');
      expect(steered).toMatchObject({ turnId: 1, endReason: 'cancelled', endedAt: 1200, durationMs: 50 });
      expect(steered.models).toEqual([{ model: 'actual-id', provider: 'openai', time: 1000 }]);
      expect(calls.map((call) => call.path)).toEqual(['/api/v1/meta', '/api/v1/sessions/first/profile']);
      expect(state.unexpected).toEqual([]);
    });

  it('adds observed server submission evidence without joining by time or claiming completion', async () => {
    const { home, inventory } = await fixture();
    await writeWire(home, 'first', [event('cron.cursor', { id: task.id, lastFiredAt: 1000 })]);
    const path = join(home, 'server', 'events', 'first.jsonl');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ kind: 'event', envelope: {
      type: 'cron.fired', session_id: 'first', timestamp: new Date(1000).toISOString(),
      payload: { origin: { kind: 'cron_job', jobId: task.id }, prompt: 'Fictional submission' },
    } }) + '\n');
    const history = await inventory.history({ authorization, sessionId: 'first' });
    expect(history).toEqual({ available: true, hasMore: false, items: [
      { time: 1000, taskId: task.id, kind: 'submitted', inherited: false },
    ], quality: { complete: true, reasons: [] } });
  });

  it('rejects upstream auth, business errors and changed metadata before any recovery request', async () => {
    const { inventory, state, calls } = await fixture();
    await expect(inventory.sessions({ authorization: 'Bearer expired-fixture' }))
      .rejects.toMatchObject({ code: 'unauthorized' });
    state.directoryError = 50001;
    await expect(inventory.sessions({ authorization })).rejects.toMatchObject({ code: 'upstream-business' });
    state.meta.server_version = '2.3.0';
    await expect(inventory.history({ authorization, sessionId: 'first' }))
      .rejects.toMatchObject({ code: 'unsupported-version' });
    expect(calls.some((call) => /profile|status|snapshot|resume|agentCronService/.test(call.path))).toBe(false);
    expect(state.unexpected).toEqual([]);
  });
});
