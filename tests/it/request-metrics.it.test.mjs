import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLauncher } from '../../packages/launcher/src/serve.mjs';
import { conversationFixture } from '../../packages/launcher/tests/testkit/officialConversationMetrics.mjs';
import { METRICS_ASSET_PREFIX } from '../../packages/launcher/src/officialRequestMetrics.mjs';

let root; let home; let publicDir; let upstream; let target; let launcher; let wirePath;
const headers = { authorization: 'Bearer fictional-metrics-test', 'content-type': 'application/json' };
const request = { turn: 't_123456789abc', index: 1, item: 'step-uuid:1', type: 'assistant_message',
  ended: new Date(10000).toISOString() };
const payload = (extra = {}) => ({ session: 'session', agent: 'main', requests: [request], ...extra });
const calls = [];
const wire = (event, agentId = 'main') =>
  JSON.stringify({ type: 'context.append_loop_event', agentId, time: 10000, event }) + '\n';
const end = (uuid = 'step-uuid') => wire({ type: 'step.end', uuid, step: 1, llmFirstTokenLatencyMs: 1200,
  llmStreamDurationMs: 2000, llmServerDecodeMs: 300, text: 'PRIVATE FIXTURE MESSAGE' });
const send = (body = payload(), init = {}, url = launcher.url) => fetch(url + '/__open-kimi-mobile/request-metrics', {
  method: 'POST', headers, body: JSON.stringify(body), ...init,
});

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'okw-conversation-metrics-'));
  home = join(root, 'home'); publicDir = join(root, 'public');
  await mkdir(join(home, 'sessions/work/session/agents/main'), { recursive: true });
  await mkdir(join(home, 'sessions/work/session/agents/side'), { recursive: true });
  await mkdir(join(publicDir, 'assets'), { recursive: true });
  wirePath = join(home, 'sessions/work/session/agents/main/wire.jsonl');
  await writeFile(wirePath, end());
  await writeFile(join(home, 'sessions/work/session/agents/side/wire.jsonl'),
    wire({ type: 'step.end', uuid: 'side-step', step: 1, llmFirstTokenLatencyMs: 500, llmStreamDurationMs: 2000 }, 'side'));
  await writeFile(join(publicDir, 'index.html'), '<html><head><script type="module" src="/assets/main.js"></script>' +
    '</head><body>Fictional app</body></html>');
  await writeFile(join(publicDir, 'assets/main.js'), conversationFixture);
  upstream = createServer((req, res) => {
    calls.push(req.url);
    if (req.headers.authorization !== headers.authorization) { res.writeHead(401).end(); return; }
    if (req.url === '/api/v1/sessions/missing') { res.writeHead(404).end(); return; }
    if (req.url === '/api/v1/sessions/failed') { res.writeHead(500).end(); return; }
    const id = req.url.endsWith('/escape') ? 'escape' : 'session';
    const workspace_id = id === 'escape' ? '../outside' : 'work';
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 0, data: { id, workspace_id } }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  target = `http://127.0.0.1:${upstream.address().port}`;
  launcher = await createLauncher({ publicDir, target, usageHome: home, host: '127.0.0.1', port: 0, interfaces: {},
    officialPresentation: true, officialWebVersion: '2.6.0' });
});
afterAll(async () => {
  await launcher?.close(); await new Promise((resolve) => upstream.close(resolve));
  await rm(root, { recursive: true, force: true });
});

describe('authenticated local conversation request metrics', () => {
  it('serves the actual new conversation shape and the complete adapted module graph', async () => {
    expect(launcher.requestMetricsState).toBe('active');
    const html = await (await fetch(launcher.url)).text();
    expect(html).toContain(`src="${METRICS_ASSET_PREFIX}/assets/main.js"`);
    expect(html).toContain('requestMetricsConversation.js');
    const source = await (await fetch(launcher.url + METRICS_ASSET_PREFIX + '/assets/main.js')).text();
    expect(source).toContain('function __okwConversationMetrics');
    expect(source).toContain('data-okw-conversation');
    expect(await readFile(join(publicDir, 'assets/main.js'), 'utf8')).toBe(conversationFixture);
  });
  it('authorizes the exact official session before returning only its requested numeric timing', async () => {
    const response = await send(); expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const data = await response.json();
    expect(data).toMatchObject({ available: true, pending: false, items: [{
      id: '["t_123456789abc",1,"step-uuid:1"]',
      llmTiming: { llmFirstTokenLatencyMs: 1200, llmStreamDurationMs: 2000 },
    }] });
    expect(JSON.stringify(data)).not.toMatch(/PRIVATE|ServerDecode|wire\.jsonl|fixture-message/);
    expect(calls.at(-1)).toBe('/api/v1/sessions/session'); expect(await readFile(wirePath, 'utf8')).toBe(end());
  });
  it('does not return another item or another agent timing', async () => {
    expect((await (await send(payload({ requests: [{ ...request, item: 'wrong:1' }] }))).json()).items).toEqual([]);
    expect((await (await send(payload({ agent: 'side' }))).json()).items).toEqual([]);
    const result = await send(payload({ agent: 'side', requests: [{ ...request, item: 'side-step:1' }] }));
    expect((await result.json()).items).toHaveLength(1);
  });
  it('requires bearer authorization and rejects cross-site requests and unsupported methods', async () => {
    const count = calls.length;
    expect((await send(payload(), { headers: {} })).status).toBe(401); expect(calls).toHaveLength(count);
    expect((await send(payload(), { headers: { ...headers, authorization: 'Bearer incorrect' } })).status).toBe(401);
    expect((await send(payload(), { headers: { ...headers, origin: 'https://other.invalid' } })).status).toBe(403);
    const response = await send(payload(), { method: 'GET', body: undefined });
    expect(response.status).toBe(405); expect(response.headers.get('allow')).toBe('POST');
  });
  it.each([{ session: '../escape' }, { agent: 'CON' }, { requests: [] }, { requests: [null] },
    { requests: [{ ...request, index: 0 }] }, { requests: [{ ...request, ended: 'invalid' }] },
    { requests: [{ ...request, item: 'x'.repeat(257) }] }, { requests: Array(33).fill(request) }])(
    'rejects invalid or oversized identity requests before touching the backend: %o', async (extra) => {
      const before = calls.length; expect((await send(payload(extra))).status).toBe(400);
      expect(calls).toHaveLength(before);
    });
  it('rejects malformed or oversized JSON and keeps API errors generic', async () => {
    expect((await send(payload(), { body: '{invalid' })).status).toBe(400);
    expect((await send(payload(), { body: JSON.stringify({ text: 'x'.repeat(33000) }) })).status).toBe(400);
    expect((await send(payload({ session: 'missing' }))).status).toBe(404);
    expect((await send(payload({ session: 'failed' }))).status).toBe(502);
    expect((await send(payload({ session: 'escape' }))).status).toBe(404);
  });
  it('never treats an external target as a trusted local home', async () => {
    const other = await createLauncher({ publicDir, target, host: '127.0.0.1', port: 0, interfaces: {},
      officialPresentation: true });
    try {
      expect(await (await send(payload(), {}, other.url)).json()).toEqual({
        available: false, reason: 'unmanaged_target', items: [], pending: false,
      });
    } finally { await other.close(); }
  });
  it('rejects linked data directories and never opens general debug access', async () => {
    const agent = join(home, 'sessions/work/session/agents/linked');
    await symlink(join(home, 'sessions/work/session/agents/main'), agent, process.platform === 'win32' ? 'junction' : 'dir');
    const result = await send(payload({ agent: 'linked' }));
    expect((await result.json()).available).toBe(false);
    const before = calls.length;
    expect((await fetch(launcher.url + '/api/v1/debug')).status).toBe(404); expect(calls).toHaveLength(before);
  });
});
