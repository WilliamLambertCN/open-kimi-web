/** @vitest-environment jsdom */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { TextEncoder } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { createCronRouteService, serveCron } from '../../packages/launcher/src/cron/routes.mjs';
import { listenHttp } from '../testkit/httpPort.mjs';

const sources = ['navigationApi.js', 'navigationSearchView.js', 'cronApi.js', 'cronView.js', 'cron.js']
  .map((name) => readFileSync(resolve(`packages/launcher/src/mobile/${name}`), 'utf8'));
const authorization = 'Bearer fictional-pagination-token';
const workspaceId = 'wd_pagination_fixture';
const task = { id: 'deadbeef', cron: '7 9 * * *', prompt: 'Fictional pagination reminder', createdAt: 100 };
const resources = [];

function send(res, data) {
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 0, data }));
}

function page(url, state) {
  const raw = url.searchParams.get('page_token');
  if (raw !== null) state.rows[60].updated_at = new Date(100000).toISOString();
  const key = state.mutableSort || url.searchParams.get('sort') !== 'created_at_desc' ? 'updated_at' : 'created_at';
  const sorted = state.rows.toSorted((a, b) => b[key].localeCompare(a[key]) || b.id.localeCompare(a.id));
  const anchor = raw === null ? null : JSON.parse(Buffer.from(raw, 'base64url').toString()).k;
  const remaining = sorted.filter((row) => anchor === null || Date.parse(row[key]) < anchor[0] ||
    Date.parse(row[key]) === anchor[0] && row.id < anchor[1]);
  const items = remaining.slice(0, 20);
  const last = items.at(-1);
  const hasMore = remaining.length > items.length;
  const next = hasMore ? Buffer.from(JSON.stringify({ v: 1, f: 'fictional-query',
    k: [Date.parse(last[key]), last.id] })).toString('base64url') : undefined;
  if (state.overlap && raw !== null) items[0] = sorted[0];
  return { items, total: state.rows.length, has_more: hasMore,
    ...(hasMore ? { next_page_token: next } : {}) };
}

function upstream(req, res, state) {
  const url = new URL(req.url, 'http://127.0.0.1');
  state.calls.push({ path: url.pathname, query: url.search, method: req.method });
  if (req.headers.authorization !== authorization) return res.writeHead(401).end();
  if (req.method !== 'GET') return res.writeHead(405).end();
  if (url.pathname === '/api/v1/meta') return send(res, { server_version: '2.7.2',
    kimi_agent_protocol_version: '1.0.0', dangerous_bypass_auth: false });
  if (url.pathname === '/api/v1/remote-control') return send(res, { enabled: false, state: 'off' });
  if (url.pathname === '/api/v1/debug/sessionManager/list') return send(res, []);
  if (url.pathname === '/api/v1/sessions') return send(res, page(url, state));
  if (url.pathname === '/api/v1/sessions/fixture-60') return send(res, { id: 'fixture-60', workspace_id: workspaceId });
  state.unexpected.push(req.url); res.writeHead(404).end();
}

async function fixture({ mutableSort = false, overlap = false } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'okw-cron-pagination-'));
  const state = { mutableSort, overlap, calls: [], unexpected: [],
    rows: Array.from({ length: 61 }, (_, index) => ({
      id: `fixture-${index}`, workspace_id: workspaceId, cwd: '/fictional/pagination', title: `Fixture ${index}`,
      archived: index % 2 === 0, activity: 'idle', pending_interaction: 'none',
      created_at: new Date(1000 * (61 - Math.floor(index / 3))).toISOString(),
      updated_at: new Date(1000 * (61 - index)).toISOString(),
    })) };
  const backend = createServer((req, res) => upstream(req, res, state));
  const server = createServer();
  const resource = { home, backend, server, frame: null }; resources.push(resource);
  const wire = join(home, 'sessions', workspaceId, 'fixture-60', 'agents', 'main', 'wire.jsonl');
  await mkdir(dirname(wire), { recursive: true });
  await writeFile(wire, JSON.stringify({ type: 'cron.add', time: 100, task }) + '\n');
  await listenHttp(backend);
  const target = `http://127.0.0.1:${backend.address().port}`;
  const service = createCronRouteService({ target, home, enabled: true });
  server.on('request', (req, res) => {
    void serveCron(req, res, service).then((handled) => { if (!handled) res.writeHead(404).end(); });
  });
  await listenHttp(server);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const frame = document.createElement('iframe'); frame.src = origin; document.body.append(frame); resource.frame = frame;
  const view = frame.contentWindow;
  view.document.open(); view.document.write('<!doctype html><html><body></body></html>'); view.document.close();
  view.TextEncoder = TextEncoder; view.Request = Request; view.Headers = Headers;
  view.document.body.innerHTML = '<div id="app"><button id="entry">Tasks</button></div>';
  view.fetch = (url, options) => fetch(new URL(url, origin), options);
  view.__okwLocale = { text: (_zh, en) => en, observe() {} };
  for (const source of sources) view.eval(source);
  await view.fetch('/api/v1/meta', { headers: { authorization } });
  const find = (selector) => view.document.querySelector(selector);
  const click = (action) => find(`[data-cron-action="${action}"]`).click();
  view.__okwCron.open(find('#entry')); await ready(find);
  expect(find('.okw-cron-panel > .okw-cron-status').textContent, JSON.stringify(state.calls)).toContain('Read-only');
  return { state, view, find, click };
}

async function ready(find) {
  await expect.poll(() => find('[data-cron-action="reload"]').disabled).toBe(false);
}

async function readAll(test) {
  for (let count = 0; !test.find('[data-cron-action="sessions-more"]').hidden && count < 5; count++) {
    test.click('sessions-more'); await ready(test.find);
  }
  expect(test.find('[data-cron-action="sessions-more"]').hidden).toBe(true);
}

function directoryQueries(state) {
  return state.calls.filter((call) => call.path === '/api/v1/sessions')
    .map((call) => new URLSearchParams(call.query));
}

afterEach(async () => {
  await Promise.all(resources.splice(0).map(async ({ home, backend, server, frame }) => {
    frame?.remove();
    await Promise.all([backend, server].map((instance) => new Promise((done) => {
      instance.close(done); instance.closeAllConnections();
    })));
    await rm(home, { recursive: true, force: true });
  }));
});

describe('2.7.2 Cron pagination through TCP routes and the browser controller with fictional keyset responses', () => {
  it('keeps all 61 sessions when the last one updates and displays its saved task without restoring it', async () => {
    const test = await fixture(); await readAll(test);
    const buttons = [...test.view.document.querySelectorAll('.okw-cron-session')];
    expect(buttons).toHaveLength(61);
    expect(new Set(buttons.map((button) => button.dataset.sessionId)).size).toBe(61);
    expect(test.state.rows[60].updated_at).toBe(new Date(100000).toISOString());
    expect(test.find('.okw-cron-inventory .okw-cron-status').textContent).toBe('');
    test.find('[data-session-id="fixture-60"]').click(); await ready(test.find);
    expect(test.find('.okw-cron-details').textContent).toContain(task.prompt);
    expect(test.find('[data-cron-action="restore"]').hidden).toBe(true);
    const queries = directoryQueries(test.state);
    expect(queries).toHaveLength(4);
    expect(queries.every((query) => query.get('sort') === 'created_at_desc' && query.get('archived') === 'all')).toBe(true);
    expect(test.state.calls.every((call) => call.method === 'GET')).toBe(true);
    expect(test.state.calls.some((call) => /status|resume|agentCronService/.test(call.path))).toBe(false);
    expect(test.state.unexpected).toEqual([]);
  });

  it('marks a skipped 61st session incomplete even with has_more=false and recovers only from a fresh read', async () => {
    const test = await fixture({ mutableSort: true }); await readAll(test);
    expect(test.view.document.querySelectorAll('.okw-cron-session')).toHaveLength(60);
    expect(test.find('[data-session-id="fixture-60"]')).toBeNull();
    expect(test.find('.okw-cron-inventory .okw-cron-status').textContent).toContain('incomplete');
    expect(test.find('.okw-cron-inventory .okw-cron-status').textContent).toContain('Reload');
    test.state.mutableSort = false;
    test.click('reload'); await ready(test.find); await readAll(test);
    expect(test.view.document.querySelectorAll('.okw-cron-session')).toHaveLength(61);
    expect(test.find('[data-session-id="fixture-60"]')).not.toBeNull();
    expect(test.find('.okw-cron-inventory .okw-cron-status').textContent).toBe('');
    expect(directoryQueries(test.state).filter((query) => !query.has('page_token'))).toHaveLength(2);
    expect(test.state.unexpected).toEqual([]);
  });

  it('deduplicates cross-page repeats and never treats the terminal flag as a complete inventory', async () => {
    const test = await fixture({ overlap: true }); await readAll(test);
    const ids = [...test.view.document.querySelectorAll('.okw-cron-session')].map((button) => button.dataset.sessionId);
    expect(new Set(ids).size).toBe(ids.length); expect(ids.length).toBeLessThan(61);
    expect(test.find('.okw-cron-inventory .okw-cron-status').textContent).toContain('incomplete');
    expect(test.find('.okw-cron-inventory .okw-cron-status').textContent).toContain('Reload');
    expect(test.state.unexpected).toEqual([]);
  });
});
