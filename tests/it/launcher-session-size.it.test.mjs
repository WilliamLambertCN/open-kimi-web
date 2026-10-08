import { appendFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createLauncher } from '../../packages/launcher/src/serve.mjs';

const PREFIX = '/__open-kimi-mobile/session-size';
const TOKEN = 'Bearer fixture-session-size-token';
let root;
let upstream;
let upstreamUrl;
let lastRequest;
let requestCount = 0;

function reply(res, status, data, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(data));
}

function officialSession(req, res) {
  requestCount += 1;
  lastRequest = { path: req.url, method: req.method, authorization: req.headers.authorization };
  if (req.headers.authorization !== TOKEN) return reply(res, 401, { msg: 'fixture-private-path' });
  const prefix = '/api/v1/sessions/';
  if (!req.url.startsWith(prefix)) return reply(res, 500, { msg: 'unexpected official request' });
  const id = decodeURIComponent(req.url.slice(prefix.length));
  if (['missing', 'denied', 'failed'].includes(id)) {
    return reply(res, { missing: 404, denied: 403, failed: 500 }[id], { msg: 'fixture-private-path' });
  }
  if (id === 'redirect') {
    return reply(res, 302, { msg: 'fixture-private-path' }, { location: `${upstreamUrl}/api/v1/sessions/redirected` });
  }
  if (id === 'bad-code') return reply(res, 200, { code: 1, msg: 'fixture-private-path' });
  if (id === 'invalid-json') return res.writeHead(200).end('{fixture-private-path');
  if (id === 'timeout') return;
  const data = {
    id: id === 'mismatched' ? 'other-session' : id,
    workspace_id: id === 'unsafe-workspace' ? '../outside' : 'workspace',
    title: 'fictional private title', cwd: 'fixture-private-path',
  };
  return reply(res, 200, { code: 0, data });
}

beforeAll(async () => {
  const base = join(process.cwd(), '.tmp', 'session-size');
  await mkdir(base, { recursive: true });
  root = await mkdtemp(join(base, 'launcher-it-'));
  upstream = createServer(officialSession);
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
});

afterAll(async () => {
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
  await rm(root, { recursive: true, force: true });
});

async function launch(options = {}) {
  const publicDir = join(root, 'web');
  await mkdir(publicDir, { recursive: true });
  await writeFile(join(publicDir, 'index.html'), '<html><head></head><body>custom web fixture</body></html>');
  const usageFetch = vi.fn((url, init) => fetch(url, init));
  const launcher = await createLauncher({
    target: upstreamUrl, publicDir, usageFetch,
    officialPresentation: true, host: '127.0.0.1', port: 0, ...options,
  });
  return { launcher, usageFetch };
}

function request(base, id, { token = TOKEN, method = 'GET', query = '' } = {}) {
  const url = new URL(`${base}${PREFIX}?session_id=${encodeURIComponent(id)}${query}`);
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method, headers: token ? { authorization: token } : {} }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), {
        status: res.statusCode, headers: res.headers,
      })));
    });
    req.on('error', reject);
    req.end();
  });
}

async function createLink(target, link) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
      return;
    } catch (error) {
      if (error.code !== 'EBUSY' || attempt === 2) throw error;
      await delay(25);
    }
  }
}

async function writeWire(home, session, agent = 'main', contents = '') {
  const path = join(home, 'sessions', 'workspace', session, 'agents', agent, 'wire.jsonl');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  return path;
}

async function expectJson(response, status, expected) {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-type')).toContain('application/json');
  const text = await response.text();
  expect(Buffer.byteLength(text)).toBe(Number(response.headers.get('content-length')));
  expect(text).not.toMatch(/fixture-private-path|fictional private title|fixture-session-size-token/);
  expect(text).not.toContain(root);
  const body = JSON.parse(text);
  expect(body).toEqual(expected);
}

describe('launcher session size managed HTTP accounting', () => {
  it('authorizes the exact session and counts only its main and direct subagent wire bytes, then observes append', async () => {
    const home = join(root, 'managed-home');
    const main = await writeWire(home, 'session', 'main', '中文 main\n');
    await writeWire(home, 'session', 'side-agent', 'side\n');
    await writeWire(home, 'other-session', 'main', 'not counted');
    await writeFile(join(dirname(main), 'diagnostics.log'), 'not counted');
    const attachments = join(home, 'sessions', 'workspace', 'session', 'attachments');
    await mkdir(attachments);
    await writeFile(join(attachments, 'large.png'), 'not counted');
    const { launcher, usageFetch } = await launch({ usageHome: home });
    const bytes = Buffer.byteLength('中文 main\nside\n');
    try {
      await expectJson(await request(launcher.url, 'session'), 200, { available: true, bytes });
      expect(usageFetch).toHaveBeenCalledTimes(1);
      expect(lastRequest).toEqual({ path: '/api/v1/sessions/session', method: 'GET', authorization: TOKEN });
      expect(usageFetch.mock.calls[0][1].redirect).toBe('manual');
      expect(usageFetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
      await appendFile(main, 'grows');
      await expectJson(await request(launcher.url, 'session'), 200, { available: true, bytes: bytes + 5 });
    } finally {
      await launcher.close();
    }
  });

  it('keeps real zero bytes distinct from missing agents, main, and subagent wires', async () => {
    const home = join(root, 'zero-home');
    await writeWire(home, 'empty');
    await mkdir(join(home, 'sessions', 'workspace', 'no-agents'), { recursive: true });
    await mkdir(join(home, 'sessions', 'workspace', 'no-main', 'agents'), { recursive: true });
    const path = await writeWire(home, 'missing-side');
    await mkdir(join(dirname(dirname(path)), 'side'));
    const { launcher } = await launch({ usageHome: home });
    try {
      await expectJson(await request(launcher.url, 'empty'), 200, { available: true, bytes: 0 });
      for (const id of ['no-agents', 'no-main', 'missing-side', 'no-directory']) {
        await expectJson(await request(launcher.url, id), 200, { available: false, reason: 'unreadable' });
      }
    } finally {
      await launcher.close();
    }
  });

  it('encodes a safe non-ASCII session path and uses the official workspace instead of browser paths', async () => {
    const home = join(root, 'encoded-home');
    await writeWire(home, '会话', 'main', 'valid');
    const { launcher } = await launch({ usageHome: home });
    try {
      await expectJson(await request(launcher.url, '会话'), 200, { available: true, bytes: 5 });
      expect(lastRequest.path).toBe('/api/v1/sessions/%E4%BC%9A%E8%AF%9D');
      for (const query of ['&workspace_id=elsewhere', '&home=elsewhere', '&session_id=another']) {
        const response = await request(launcher.url, '会话', { query });
        expect(response.status).toBe(400);
        expect((await response.json()).error).toBeTruthy();
      }
    } finally {
      await launcher.close();
    }
  });
});

describe('launcher session size mode and request boundaries', () => {
  it('authenticates an unmanaged target but never falls back to local data', async () => {
    const { launcher, usageFetch } = await launch();
    try {
      await expectJson(await request(launcher.url, 'session'), 200, { available: false, reason: 'unmanaged_target' });
      expect(usageFetch).toHaveBeenCalledTimes(1);
      const response = await request(launcher.url, 'session', { token: null });
      expect(response.status).toBe(401);
      expect((await response.json()).error).toBeTruthy();
      expect(usageFetch).toHaveBeenCalledTimes(1);
    } finally {
      await launcher.close();
    }
  });

  it('does not serve the private endpoint in custom web mode', async () => {
    const { launcher, usageFetch } = await launch({ officialPresentation: false, usageHome: join(root, 'managed-home') });
    try {
      const response = await request(launcher.url, 'session');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(await response.text()).toContain('custom web fixture');
      expect(usageFetch).not.toHaveBeenCalled();
    } finally {
      await launcher.close();
    }
  });

  it('rejects missing or incorrect tokens, unsupported methods and unsafe IDs without leaking details', async () => {
    const { launcher, usageFetch } = await launch({ usageHome: join(root, 'managed-home') });
    try {
      const noToken = await request(launcher.url, '../other', { token: null });
      expect(noToken.status).toBe(401);
      expect((await noToken.json()).error).toBeTruthy();
      expect(usageFetch).not.toHaveBeenCalled();
      const badToken = await request(launcher.url, 'session', { token: 'Bearer incorrect' });
      expect(badToken.status).toBe(401);
      expect((await badToken.json()).error).toBeTruthy();
      usageFetch.mockClear();
      for (const id of ['../other', 'other\\session', 'C:drive', '.', '..', 'NUL.txt', 'bad\0id', 'trailing.']) {
        const response = await request(launcher.url, id);
        expect(response.status).toBe(400);
        expect((await response.json()).error).toBe('会话 ID 无效');
      }
      const post = await request(launcher.url, 'session', { method: 'POST' });
      expect(post.status).toBe(405);
      expect(post.headers.get('allow')).toBe('GET');
      expect((await post.json()).error).toContain('GET');
      expect(usageFetch).not.toHaveBeenCalled();
    } finally {
      await launcher.close();
    }
  });
});

describe('launcher session size official API failures', () => {
  it('preserves authorization failures and refuses redirects, backend failures and malformed official envelopes', async () => {
    const { launcher } = await launch({ usageHome: join(root, 'managed-home') });
    try {
      for (const [id, status] of [['denied', 403], ['redirect', 502], ['failed', 502], ['bad-code', 502],
        ['invalid-json', 502]]) {
        const count = requestCount;
        const response = await request(launcher.url, id);
        expect(response.status).toBe(status);
        expect(response.headers.get('cache-control')).toBe('no-store');
        const text = await response.text();
        expect(JSON.parse(text).error).toBeTruthy();
        expect(text).not.toMatch(/fixture-private-path|fixture-session-size-token/);
        expect(requestCount).toBe(count + 1);
      }
      for (const id of ['missing', 'mismatched', 'unsafe-workspace']) {
        await expectJson(await request(launcher.url, id), 200, { available: false, reason: 'invalid_session' });
      }
    } finally {
      await launcher.close();
    }
  });

  it('times out a real stalled official session request without exposing errors', async () => {
    const { launcher } = await launch();
    try {
      await expectJson(await request(launcher.url, 'timeout'), 502, { error: '无法验证官方会话' });
    } finally {
      await launcher.close();
    }
  }, 6_000);
});

describe('launcher session size filesystem failures', () => {
  it.each(['home', 'sessions', 'workspace', 'session', 'agents', 'main', 'wire.jsonl'])
  ('rejects a real Windows junction or symlink at %s', async (layer) => {
    const base = join(root, `symlink-${layer}`);
    const segments = ['home', 'sessions', 'workspace', 'session', 'agents', 'main', 'wire.jsonl'];
    const target = join(base, 'outside');
    await mkdir(target, { recursive: true });
    const link = join(base, ...segments.slice(0, segments.indexOf(layer) + 1));
    await mkdir(dirname(link), { recursive: true });
    await createLink(target, link);
    const { launcher } = await launch({ usageHome: join(base, 'home') });
    try {
      await expectJson(await request(launcher.url, 'session'), 200, { available: false, reason: 'unreadable' });
    } finally {
      await launcher.close();
    }
  });

  it('rejects non-regular agent/wire entries and too many agent directories', async () => {
    const home = join(root, 'invalid-files-home');
    const agents = join(home, 'sessions', 'workspace', 'bad-agent', 'agents');
    await mkdir(agents, { recursive: true });
    await writeFile(join(agents, 'main'), 'not a directory');
    await mkdir(join(home, 'sessions', 'workspace', 'bad-wire', 'agents', 'main', 'wire.jsonl'), { recursive: true });
    const path = await writeWire(home, 'too-many');
    for (let index = 0; index < 512; index += 1) {
      const dir = join(dirname(dirname(path)), `side-${index}`);
      await mkdir(dir);
      await writeFile(join(dir, 'wire.jsonl'), '');
    }
    const { launcher } = await launch({ usageHome: home });
    try {
      for (const id of ['bad-agent', 'bad-wire', 'too-many']) {
        await expectJson(await request(launcher.url, id), 200, { available: false, reason: 'unreadable' });
      }
    } finally {
      await launcher.close();
    }
  });
});
