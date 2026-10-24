import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCronInventory } from '../src/cron/inventory.mjs';
import { MAX_RESPONSE_BYTES, REQUEST_TIMEOUT_MS } from '../src/cron/transport.mjs';

const homes = [];
const target = 'http://127.0.0.1:12345';
const authorization = 'Bearer fictional-inventory-token';
const args = { authorization };
const workspaceId = 'wd_fixture_0123456789ab';
const meta = { server_version: '2.1.1', backend: 'v2', dangerous_bypass_auth: false };
const task = { id: 'deadbeef', cron: '7 9 * * *', prompt: 'Fictional reminder', createdAt: 100 };
const line = (type, fields = {}) => ({ type, time: 1000, ...fields });
const native = (id, fields = {}) => ({
  id, workspace: { id: workspaceId, cwd: 'C:\\fictional\\workspace-name' },
  meta: { title: `Fixture ${id}`, archived: false }, activity: { status: 'idle', model: null }, ...fields,
});
const page = (items, hasMore = false, cursor = null) => ({ items, has_more: hasMore, next_page_token: cursor });
const envelope = (data, code = 0) => Response.json({ code, data });

async function fixture(overrides = {}) {
  const home = await mkdtemp(join(tmpdir(), 'okw-cron-inventory-'));
  homes.push(home);
  const values = { meta, directory: page([native('session-fixture')]), loaded: [], ...overrides };
  const fetchImpl = vi.fn(async (url, options) => {
    let value;
    if (url.pathname === '/api/v1/meta') value = values.meta;
    else if (url.pathname === '/api/v2/sessions') value = values.directory;
    else if (url.pathname === '/api/v1/debug/sessionManager/list') value = values.loaded;
    else if (/^\/api\/v1\/sessions\/[^/]+\/profile$/.test(url.pathname)) {
      value = values.profile ?? { id: url.pathname.split('/').at(-2), workspace_id: workspaceId };
    } else throw new Error('Unexpected cold-read request');
    return typeof value === 'function' ? value(url, options) : envelope(value);
  });
  const inventory = createCronInventory({ home, target, fetchImpl });
  return { home, inventory, values, fetchImpl };
}

async function wire(home, sessionId, records, workspace = workspaceId) {
  const path = join(home, 'sessions', workspace, sessionId, 'agents', 'main', 'wire.jsonl');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
}

async function serverEvents(home, sessionId, records) {
  const path = join(home, 'server', 'events', `${sessionId}.jsonl`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe('global native Cron inventory', () => {
  it('lists all page items including no-task/archived sessions without per-agent RPCs or recovery', async () => {
    const rows = [native('one'), native('two', { meta: { title: 'Archived', archived: true } })];
    const { inventory, home, fetchImpl } = await fixture({ directory: page(rows), loaded: [{
      id: 'one', kind: 'session', accessor: {},
    }] });
    await wire(home, 'one', [line('cron.add', { task })]);
    await wire(home, 'two', [line('context.clear')]);
    const result = await inventory.sessions(args);
    expect(Object.keys(inventory)).toEqual(['sessions', 'history']);
    expect(result.items.map((item) => [item.id, item.loaded, item.archived, item.tasks.length]))
      .toEqual([['one', true, false, 1], ['two', false, true, 0]]);
    expect(result.items.every((item) => item.quality.complete)).toBe(true);
    expect(result.items[0].workspace).toEqual({ id: workspaceId, name: 'workspace-name' });
    expect(JSON.stringify(result)).not.toContain('fictional');
    expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual([
      '/api/v1/meta', '/api/v2/sessions', '/api/v1/debug/sessionManager/list',
    ]);
    expect(fetchImpl.mock.calls[1][0].search).toBe('?meta.archived=all&page_size=20');
    for (const [, options] of fetchImpl.mock.calls) {
      expect(options).toMatchObject({ method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store' });
      expect(options.headers.authorization).toBe(authorization);
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('maps opaque cursor only to encoded page_token and preserves global archived query on every page', async () => {
    const cursor = 'opaque+/=&?cursor';
    const { inventory, home, values, fetchImpl } = await fixture({ directory: page([native('first')], true, cursor) });
    await wire(home, 'first', []);
    await wire(home, 'second', []);
    expect(await inventory.sessions(args)).toMatchObject({ hasMore: true, cursor });
    values.directory = page([native('second')]);
    expect(await inventory.sessions({ ...args, cursor })).toMatchObject({ hasMore: false, cursor: null });
    const urls = fetchImpl.mock.calls.filter(([url]) => url.pathname === '/api/v2/sessions').map(([url]) => url);
    expect(urls[1].searchParams.get('page_token')).toBe(cursor);
    expect(urls[1].search).toBe('?meta.archived=all&page_size=20&page_token=opaque%2B%2F%3D%26%3Fcursor');
    expect([...urls[1].searchParams.keys()]).toEqual(['meta.archived', 'page_size', 'page_token']);
  });

  it('distinguishes live model from saved alias, never inferring loaded from idle or model-null', async () => {
    const { inventory, home } = await fixture({
      directory: page([native('live', { activity: { model: 'live-alias' } }), native('cold'), native('unbound')]),
      loaded: [{ id: 'live', kind: 'session', accessor: {} }, { id: 'unbound', kind: 'session', accessor: {} }],
    });
    for (const id of ['live', 'cold', 'unbound']) {
      await wire(home, id, [line('profile.bind', { agentId: 'main', modelAlias: 'saved-alias' }),
        line('config.update', { agentId: 'main' })]);
    }
    const result = await inventory.sessions(args);
    expect(result.items.map(({ loaded, model, modelSource }) => ({ loaded, model, modelSource }))).toEqual([
      { loaded: true, model: 'live-alias', modelSource: 'live' },
      { loaded: false, model: 'saved-alias', modelSource: 'saved' },
      { loaded: true, model: 'saved-alias', modelSource: 'saved' },
    ]);
  });

  it.each([{}, ['session-fixture'], [{ id: 'session-fixture', kind: 'session', accessor: { secret: true } }]])
  ('marks malformed live shape unknown, not cold %#', async (loaded) => {
    const { inventory, home } = await fixture({ loaded });
    await wire(home, 'session-fixture', []);
    const result = await inventory.sessions(args);
    expect(result.items[0]).toMatchObject({ loaded: null, quality: {
      complete: false, reasons: ['live-list-invalid-shape'],
    } });
  });

  it.each(['2.1.1', '2.2.0', '2.3.1'])(
    'reads actual %s runtime metadata for fork handling on each operation', async (version) => {
      const { inventory, home } = await fixture({ meta: { ...meta, server_version: version } });
      await wire(home, 'session-fixture', [line('cron.add', { task }), line('forked', { agentId: 'main' })]);
      expect((await inventory.sessions(args)).items[0].tasks).toHaveLength(version === '2.1.1' ? 1 : 0);
    });
});

describe('native directory compatibility regressions', () => {
  it('reads sessions and history under native workspace IDs containing internal consecutive dots', async () => {
    const workspace = 'wd_repo..backup_eaed49d41ffd';
    const row = native('dotted', { workspace: { id: workspace, cwd: '/fictional/repo..backup' } });
    const { inventory, home } = await fixture({ directory: page([row]),
      profile: { id: 'dotted', workspace_id: workspace } });
    await wire(home, 'dotted', [line('cron.add', { task })], workspace);
    expect((await inventory.sessions(args)).items[0]).toMatchObject({
      id: 'dotted', workspace: { id: workspace, name: 'repo..backup' }, tasks: [task], quality: { complete: true },
    });
    expect(await inventory.history({ ...args, sessionId: 'dotted' })).toMatchObject({
      available: true, quality: { complete: false, reasons: ['server-missing'] },
    });
  });

  it.each(['First line\nSecond line', 'First line\r\nSecond line'])
  ('preserves a native multiline title as plain text %#', async (title) => {
    const { inventory, home } = await fixture({ directory: page([native('multiline', {
      meta: { title, archived: false },
    }), native('normal')]) });
    await wire(home, 'multiline', []);
    await wire(home, 'normal', []);
    const result = await inventory.sessions(args);
    expect(result.items.map((item) => item.title)).toEqual([title, 'Fixture normal']);
    expect(result.items.every((item) => item.quality.complete)).toBe(true);
  });

  it.each(['a'.repeat(4097), '中'.repeat(1365) + 'ab'])
  ('rejects cursor input exceeding 4096 UTF8 bytes before fetching %#', async (cursor) => {
    const { inventory, fetchImpl } = await fixture({ directory: page([]) });
    await expect(inventory.sessions({ ...args, cursor })).rejects.toMatchObject({ code: 'invalid-input' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['a'.repeat(4097), '中'.repeat(1365) + 'ab'])
  ('does not return a next cursor that exceeds the HTTP UTF8 budget %#', async (cursor) => {
    const { inventory } = await fixture({ directory: page([], true, cursor) });
    await expect(inventory.sessions(args)).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('round-trips an exactly 4096-byte multibyte cursor without truncation', async () => {
    const cursor = '中'.repeat(1365) + 'a';
    const { inventory, values, fetchImpl } = await fixture({ directory: page([], true, cursor) });
    expect(await inventory.sessions(args)).toMatchObject({ cursor, hasMore: true });
    values.directory = page([]);
    expect(await inventory.sessions({ ...args, cursor })).toMatchObject({ cursor: null, hasMore: false });
    const [url] = fetchImpl.mock.calls.find(([url]) => url.searchParams.has('page_token'));
    expect(url.searchParams.get('page_token')).toBe(cursor);
  });
});

describe('cold native Cron history', () => {
  it('reads cold profile identity, preserving deleted task evidence and separate submissions', async () => {
    const { inventory, home, fetchImpl } = await fixture();
    await wire(home, 'session-fixture', [
      line('cron.add', { task }), line('turn.prompt', { agentId: 'main', turnId: 0,
        input: [], origin: { kind: 'cron_job', jobId: task.id } }),
      line('llm.request', { agentId: 'main', kind: 'loop', turnStep: '0.1', model: 'actual', provider: 'openai' }),
      line('turn.ended', { agentId: 'main', turnId: 0, reason: 'completed', time: 1100 }),
      line('cron.delete', { ids: [task.id] }),
    ]);
    await serverEvents(home, 'session-fixture', [{
      kind: 'journal_header', version: 1, epoch: 'ep_fixture', created_at: 100,
    }, { kind: 'event', envelope: {
      type: 'cron.fired', session_id: 'session-fixture', timestamp: new Date(900).toISOString(),
      payload: { origin: { kind: 'cron_job', jobId: task.id }, prompt: 'Do not return this prompt' },
    } }]);
    const result = await inventory.history({ ...args, sessionId: 'session-fixture' });
    expect(result).toMatchObject({ available: true, hasMore: false, quality: { complete: true, reasons: [] } });
    expect(result.items).toEqual([
      { time: 1000, taskId: task.id, kind: 'started', inherited: false, turnId: 0,
        endReason: 'completed', endedAt: 1100, models: [{ model: 'actual', provider: 'openai', time: 1000 }] },
      { time: 900, taskId: task.id, kind: 'submitted', inherited: false },
    ]);
    expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual([
      '/api/v1/meta', '/api/v1/sessions/session-fixture/profile',
    ]);
    expect(JSON.stringify(result)).not.toContain('Do not return');
  });

  it('reports missing server journal as potentially missing history, without inventing successful runs', async () => {
    const { inventory, home } = await fixture();
    await wire(home, 'session-fixture', [line('cron.add', { task }), line('cron.cursor', {
      id: task.id, lastFiredAt: 2000,
    })]);
    expect(await inventory.history({ ...args, sessionId: 'session-fixture' })).toEqual({
      available: true, items: [], hasMore: false, quality: { complete: false, reasons: ['server-missing'] },
    });
  });

  it('reports unknown server schema and rejects unverified session workspace identity', async () => {
    const { inventory, home, values } = await fixture();
    await wire(home, 'session-fixture', []);
    await serverEvents(home, 'session-fixture', [{ kind: 'unknown' }, { kind: 'event', envelope: {
      type: 'cron.fired', timestamp: 'invalid', payload: { origin: { kind: 'cron_job', jobId: task.id } },
    } }]);
    expect((await inventory.history({ ...args, sessionId: 'session-fixture' })).quality.reasons)
      .toEqual(['server-unknown-schema', 'server-invalid-cron-fired']);
    values.profile = { id: 'session-fixture', workspace_id: '../other' };
    await expect(inventory.history({ ...args, sessionId: 'session-fixture' }))
      .rejects.toMatchObject({ code: 'invalid-response' });
  });
});

describe('inventory fail-closed protocol and ownership', () => {
  it('returns unavailable without guessing external home or making network calls', async () => {
    const fetchImpl = vi.fn();
    const inventory = createCronInventory({ target, fetchImpl });
    expect(await inventory.sessions(args)).toMatchObject({ available: false, quality: { reasons: ['home-unavailable'] } });
    expect(await inventory.history({ ...args, sessionId: 'fixture' })).toMatchObject({ available: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...meta, server_version: '2.2.1' }, 'unsupported-version'],
    [{ ...meta, dangerous_bypass_auth: true }, 'unsafe-auth'],
    [{ ...meta, backend: 'v1' }, 'unsupported-version'],
  ])('rejects actual unsafe metadata before directory/file access %#', async (actual, code) => {
    const { inventory, fetchImpl } = await fixture({ meta: actual });
    await expect(inventory.sessions(args)).rejects.toMatchObject({ code });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects unsafe paths, claims, unknown input and malformed cursor/auth before network', async () => {
    const { inventory, fetchImpl } = await fixture();
    for (const input of [{ ...args, cursor: '' }, { ...args, cursor: 1 }, { ...args, path: '/tmp' },
      { authorization: 'Basic invalid' }]) await expect(inventory.sessions(input)).rejects.toBeDefined();
    await expect(inventory.history({ ...args, sessionId: 'x:stream' })).rejects.toBeDefined();
    expect(() => createCronInventory({ target, version: '2.1.1' })).toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([page([native('../other')]), page([], true, null), page(Array.from({ length: 21 }, (_, i) => native(`s${i}`)))])
  ('rejects anomalous directory responses %#', async (directory) => {
    const { inventory } = await fixture({ directory });
    await expect(inventory.sessions(args)).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it.each([
    [() => envelope(null, 50001), 'upstream-business'],
    [() => new Response('{}', { status: 401 }), 'unauthorized'],
    [() => new Response('{}', { status: 302 }), 'redirect'],
    [() => Response.json({ data: [] }), 'invalid-response'],
    [() => new Response('{}', { headers: { 'content-type': 'application/json',
      'content-length': String(MAX_RESPONSE_BYTES + 1) } }), 'response-too-large'],
  ])('uses bounded transport envelope/auth/size/redirect checks %#', async (response, code) => {
    const { inventory } = await fixture({ directory: response });
    await expect(inventory.sessions(args)).rejects.toMatchObject({ code });
  });

  it('enforces streaming response size without trusting Content-Length', async () => {
    const response = () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    } }), { headers: { 'content-type': 'application/json' } });
    const { inventory } = await fixture({ directory: response });
    await expect(inventory.sessions(args)).rejects.toMatchObject({ code: 'response-too-large' });
  });

  it('uses transport timeout, including a fetch implementation that ignores abort', async () => {
    const { inventory } = await fixture({ directory: () => new Promise(() => {}) });
    vi.useFakeTimers();
    const result = inventory.sessions(args);
    const assertion = expect(result).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
    await assertion;
  });
});
