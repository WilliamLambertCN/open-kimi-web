import { appendFile, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readSessionSize, serveSessionSize } from '../src/sessionSize.mjs';

const PREFIX = '/__open-kimi-mobile/session-size';
const INVALID_IDS = [
  '', '.', '..', '../other', 'other/session', 'other\\session', 'C:drive', 'wire:stream', '\0',
  'bad\nname', 'bad\x7fname', 'bad<name', 'bad>name', 'bad"name', 'bad|name', 'bad?name', 'bad*name',
  'trailing.', 'trailing ', ' leading', 'CON', 'nul.txt', 'COM1', 'lpt9.log', 'COM¹', '%2f', 'x'.repeat(256),
  'CONIN$', 'conout$.txt', 'NUL .txt', 'COM1 .log',
];
const UNREADABLE = { available: false, reason: 'unreadable' };
let root;

beforeEach(async () => {
  const base = join(process.cwd(), '.tmp', 'session-size');
  await mkdir(base, { recursive: true });
  root = await mkdtemp(join(base, 'unit-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

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

async function writeWire(home, agent = 'main', content = '') {
  const path = join(home, 'sessions', 'workspace', 'session', 'agents', agent, 'wire.jsonl');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return path;
}

function mockFilesystem({ names = ['main'], size = 1, statFor } = {}) {
  const directory = { isDirectory: () => true, isSymbolicLink: () => false };
  const file = { isFile: () => true, isSymbolicLink: () => false, size };
  return {
    lstat: vi.fn(async (path) => statFor ? statFor(path) : path.endsWith('wire.jsonl') ? file : directory),
    opendir: vi.fn(async () => (async function* () {
      for (const name of names) yield { name };
    })()),
  };
}

function request({ id = 'session', method = 'GET', authorization = 'Bearer fixture-token', url } = {}) {
  return {
    method,
    url: url ?? `${PREFIX}?session_id=${encodeURIComponent(id)}`,
    headers: authorization === undefined ? {} : { authorization },
  };
}

function response() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
      return this;
    },
    end(body) {
      this.body = Buffer.from(body).toString('utf8');
    },
  };
}

function officialResponse(data = { id: 'session', workspace_id: 'workspace' }) {
  return Response.json({ code: 0, data });
}

async function invoke(req = request(), options = {}) {
  const res = response();
  const fetchImpl = options.fetchImpl ?? vi.fn(async () => officialResponse());
  const served = await serveSessionSize(req, res, {
    target: 'http://upstream.invalid', usageHome: root, ...options, fetchImpl,
  });
  return { res, fetchImpl, served, body: res.body === null ? null : JSON.parse(res.body) };
}

describe('session size filesystem accounting', () => {
  it('counts exact wire bytes for main and direct subagents, observes growth, and ignores other content', async () => {
    const path = await writeWire(root, 'main', '中文\ninvalid json');
    await writeWire(root, 'side', 'side-log');
    await mkdir(join(root, 'sessions', 'workspace', 'session', 'attachments'), { recursive: true });
    await writeFile(join(dirname(path), 'diagnostics.log'), 'not counted');
    await writeFile(join(root, 'sessions', 'workspace', 'session', 'attachments', 'image.png'), 'not counted');
    await writeFile(join(root, 'sessions', 'workspace', 'session', 'state.json'), 'not counted');
    const bytes = Buffer.byteLength('中文\ninvalid jsonside-log');
    expect(await readSessionSize(root, 'workspace', 'session')).toEqual({ available: true, bytes });
    await appendFile(path, 'growth');
    expect(await readSessionSize(root, 'workspace', 'session')).toEqual({ available: true, bytes: bytes + 6 });
  });

  it('accepts an actual empty main wire as zero', async () => {
    await writeWire(root);
    expect(await readSessionSize(root, 'workspace', 'session')).toEqual({ available: true, bytes: 0 });
  });

  it.each([null, undefined, '', 7])('does not read a local home for unmanaged input %s', async (home) => {
    const fsImpl = mockFilesystem();
    expect(await readSessionSize(home, 'workspace', 'session', fsImpl))
      .toEqual({ available: false, reason: 'unmanaged_target' });
    expect(fsImpl.lstat).not.toHaveBeenCalled();
  });

  it.each(INVALID_IDS)('rejects unsafe session/workspace segments %j before filesystem access', async (id) => {
    const fsImpl = mockFilesystem();
    for (const [workspace, session] of [[id, 'session'], ['workspace', id]]) {
      expect(await readSessionSize(root, workspace, session, fsImpl))
        .toEqual({ available: false, reason: 'invalid_session' });
    }
    expect(fsImpl.lstat).not.toHaveBeenCalled();
  });

  it.each(['home', 'sessions', 'workspace', 'session', 'agents', 'main', 'wire'])
  ('does not report missing %s as zero', async (missing) => {
    const segments = ['home', 'sessions', 'workspace', 'session', 'agents', 'main'];
    const index = missing === 'wire' ? segments.length : segments.indexOf(missing);
    if (index > 0) await mkdir(join(root, ...segments.slice(0, index)), { recursive: true });
    expect(await readSessionSize(join(root, 'home'), 'workspace', 'session')).toEqual(UNREADABLE);
  });

  it('rejects a missing side-agent wire instead of returning a partial main total', async () => {
    const path = await writeWire(root, 'main', 'main');
    await mkdir(join(dirname(dirname(path)), 'side'));
    expect(await readSessionSize(root, 'workspace', 'session')).toEqual(UNREADABLE);
  });

  it.each(['main', 'wire'])('rejects non-regular %s entries', async (kind) => {
    const agents = join(root, 'sessions', 'workspace', 'session', 'agents');
    await mkdir(agents, { recursive: true });
    if (kind === 'main') await writeFile(join(agents, 'main'), 'not a directory');
    else await mkdir(join(agents, 'main', 'wire.jsonl'), { recursive: true });
    expect(await readSessionSize(root, 'workspace', 'session')).toEqual(UNREADABLE);
  });

  it('rejects unsafe or unrelated files in the agent listing', async () => {
    const path = await writeWire(root);
    await writeFile(join(dirname(dirname(path)), 'not-an-agent'), 'unknown');
    expect(await readSessionSize(root, 'workspace', 'session')).toEqual(UNREADABLE);
    expect(await readSessionSize(root, 'workspace', 'session', mockFilesystem({ names: ['main', 'NUL.txt'] })))
      .toEqual(UNREADABLE);
  });

});

describe('session size bounded metadata operations', () => {
  it('uses only lstat and a bounded opendir on the selected session, never reads wire contents', async () => {
    const fsImpl = mockFilesystem();
    expect(await readSessionSize(root, 'workspace', 'session', fsImpl)).toEqual({ available: true, bytes: 1 });
    const agents = join(resolve(root), 'sessions', 'workspace', 'session', 'agents');
    expect(fsImpl.opendir.mock.calls).toEqual([[agents]]);
    expect(fsImpl.lstat.mock.calls.map(([path]) => path)).toEqual([
      resolve(root), join(root, 'sessions'), join(root, 'sessions', 'workspace'),
      join(root, 'sessions', 'workspace', 'session'), agents, join(agents, 'main'), join(agents, 'main', 'wire.jsonl'),
    ]);
  });

  it.each([Number.MAX_SAFE_INTEGER + 1, -1, 0.5, NaN, Infinity])('rejects unsafe stat.size %s', async (size) => {
    expect(await readSessionSize(root, 'workspace', 'session', mockFilesystem({ size }))).toEqual(UNREADABLE);
  });

  it('rejects an unsafe sum even when individual wire sizes are safe', async () => {
    const fsImpl = mockFilesystem({ names: ['main', 'side'], size: Number.MAX_SAFE_INTEGER });
    expect(await readSessionSize(root, 'workspace', 'session', fsImpl)).toEqual(UNREADABLE);
  });

  it('accepts at most 512 agents and closes enumeration when the limit is exceeded', async () => {
    const names = ['main', ...Array.from({ length: 511 }, (_, index) => `side-${index}`)];
    expect(await readSessionSize(root, 'workspace', 'session', mockFilesystem({ names })))
      .toEqual({ available: true, bytes: 512 });
    let closed = false;
    const fsImpl = mockFilesystem();
    fsImpl.opendir.mockImplementation(async () => (async function* () {
      try {
        for (const name of [...names, 'extra']) yield { name };
      } finally {
        closed = true;
      }
    })());
    expect(await readSessionSize(root, 'workspace', 'session', fsImpl)).toEqual(UNREADABLE);
    expect(closed).toBe(true);
    expect(fsImpl.lstat).toHaveBeenCalledTimes(5 + 512 * 2);
  });

  it('treats an empty listing and filesystem failures as unknown', async () => {
    expect(await readSessionSize(root, 'workspace', 'session', mockFilesystem({ names: [] }))).toEqual(UNREADABLE);
    const fsImpl = mockFilesystem();
    fsImpl.lstat.mockRejectedValue(new Error('EACCES private path fixture'));
    expect(await readSessionSize(root, 'workspace', 'session', fsImpl)).toEqual(UNREADABLE);
    fsImpl.lstat.mockImplementation(lstat);
    await writeWire(root);
    fsImpl.opendir.mockRejectedValue(new Error('EACCES private path fixture'));
    expect(await readSessionSize(root, 'workspace', 'session', fsImpl)).toEqual(UNREADABLE);
  });
});

describe('session size symlink boundaries', () => {
  it.each(['home', 'sessions', 'workspace', 'session', 'agents', 'main', 'wire.jsonl'])
  ('rejects real junction/symlink at %s without following it', async (layer) => {
    const segments = ['home', 'sessions', 'workspace', 'session', 'agents', 'main', 'wire.jsonl'];
    const index = segments.indexOf(layer);
    const target = join(root, 'outside');
    await mkdir(target);
    const link = join(root, ...segments.slice(0, index + 1));
    await mkdir(dirname(link), { recursive: true });
    await createLink(target, link);
    expect(await readSessionSize(join(root, 'home'), 'workspace', 'session')).toEqual(UNREADABLE);
  });

  it('allows configured home parents to be symlinks but still validates the home itself', async () => {
    const trusted = join(root, 'trusted');
    await writeWire(join(trusted, 'home'), 'main', 'valid');
    const configured = join(root, 'configured');
    await createLink(trusted, configured);
    expect(await readSessionSize(join(configured, 'home'), 'workspace', 'session'))
      .toEqual({ available: true, bytes: 5 });
  });

  it('rejects regular-file symlinks even if their target reports a safe size', async () => {
    const fsImpl = mockFilesystem();
    fsImpl.lstat.mockImplementation(async (path) => path.endsWith('wire.jsonl')
      ? { isSymbolicLink: () => true, isFile: () => true, size: 1 }
      : { isSymbolicLink: () => false, isDirectory: () => true });
    expect(await readSessionSize(root, 'workspace', 'session', fsImpl)).toEqual(UNREADABLE);
  });
});

describe('session size request and authorization', () => {
  it('declines unrelated routes without fetching or writing a response', async () => {
    const result = await invoke(request({ url: '/__open-kimi-mobile/session-size.js' }));
    expect(result.served).toBe(false);
    expect(result.fetchImpl).not.toHaveBeenCalled();
    expect(result.res.status).toBeNull();
  });

  it.each([null, '', 'Basic fixture', 'Bearer ', 'Bearer two tokens', ['Bearer fixture']])
  ('requires one bearer token immediately for authorization %j', async (authorization) => {
    const result = await invoke(request({ authorization, method: 'POST' }));
    expect(result.res.status).toBe(401);
    expect(result.body.error).toBeTruthy();
    expect(result.fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a missing authorization header without contacting the upstream', async () => {
    const req = request();
    req.headers = {};
    const result = await invoke(req);
    expect(result.res.status).toBe(401);
    expect(result.fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['POST', 'HEAD', 'PUT', 'DELETE'])('rejects method %s with a readable no-store error', async (method) => {
    const result = await invoke(request({ method }));
    expect(result.res.status).toBe(405);
    expect(result.res.headers).toMatchObject({ allow: 'GET', 'cache-control': 'no-store' });
    expect(result.body.error).toContain('GET');
    expect(result.fetchImpl).not.toHaveBeenCalled();
  });

  it.each(INVALID_IDS)('rejects malformed requested ID %j before authorization fetch', async (id) => {
    const result = await invoke(request({ id }));
    expect(result.res.status).toBe(400);
    expect(result.fetchImpl).not.toHaveBeenCalled();
    expect(result.body.error).toBe('会话 ID 无效');
  });

  it.each(['', '?session_id=session&session_id=other', '?session_id=session&workspace_id=other',
    '?session_id=session&home=other', '?session_id=%ED%A0%80'])
  ('rejects missing, duplicate, or browser-controlled path query %s', async (query) => {
    const result = await invoke(request({ url: `${PREFIX}${query}` }));
    expect(result.res.status).toBe(400);
    expect(result.fetchImpl).not.toHaveBeenCalled();
  });

  it('authorizes with official GET session, bearer, manual redirects, and a finite abort timeout', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await writeWire(root, 'main', 'fixture');
    const result = await invoke();
    expect(result.body).toEqual({ available: true, bytes: 7 });
    expect(result.res.headers).toMatchObject({
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(result.res.body),
    });
    expect(result.fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = result.fetchImpl.mock.calls[0];
    expect(url.href).toBe('http://upstream.invalid/api/v1/sessions/session');
    expect(init).toMatchObject({ method: 'GET', redirect: 'manual', headers: { authorization: 'Bearer fixture-token' } });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenCalledWith(3_000);
    timeout.mockRestore();
  });

  it('encodes valid non-ASCII session IDs into the official URL', async () => {
    const fetchImpl = vi.fn(async () => officialResponse({ id: '会话', workspace_id: 'workspace' }));
    const result = await invoke(request({ id: '会话' }), { usageHome: null, fetchImpl });
    expect(result.body).toEqual({ available: false, reason: 'unmanaged_target' });
    expect(fetchImpl.mock.calls[0][0].pathname).toBe('/api/v1/sessions/%E4%BC%9A%E8%AF%9D');
  });
});

describe('session size upstream failures and privacy', () => {
  it.each([[401, 401], [403, 403], [302, 502], [500, 502]])
  ('keeps HTTP %i failure readable at HTTP %i without reflecting upstream content', async (upstreamStatus, status) => {
    const fetchImpl = vi.fn(async () => new Response('fixture-private-path fixture-token', {
      status: upstreamStatus, headers: { location: 'http://private.invalid' },
    }));
    const result = await invoke(request(), { fetchImpl });
    expect(result.res.status).toBe(status);
    expect(result.body.error).toBeTruthy();
    expect(result.res.body).not.toMatch(/private|fixture-token/);
  });

  it.each([null, {}, { id: 'other', workspace_id: 'workspace' }, { id: 'session' },
    { id: 'session', workspace_id: '../escape' }, { id: 'session', workspace_id: 'NUL.txt' }])
  ('returns invalid_session for unconfirmed official identity %j', async (data) => {
    const result = await invoke(request(), { fetchImpl: async () => officialResponse(data) });
    expect(result.res.status).toBe(200);
    expect(result.body).toEqual({ available: false, reason: 'invalid_session' });
  });

  it('treats an official 404 as invalid_session, not empty bytes', async () => {
    const result = await invoke(request(), { fetchImpl: async () => new Response(null, { status: 404 }) });
    expect(result.res.status).toBe(200);
    expect(result.body).toEqual({ available: false, reason: 'invalid_session' });
  });

  it.each(['wrong-code', 'bad-json', 'empty', 'declared-too-large', 'stream-too-large'])
  ('rejects malformed or unbounded official response %s', async (kind) => {
    const responses = {
      'wrong-code': Response.json({ code: 1, msg: 'fixture-private-path' }),
      'bad-json': new Response('{ fixture-private-path'),
      empty: new Response(null),
      'declared-too-large': new Response('{}', { headers: { 'content-length': String(1024 * 1024 + 1) } }),
      'stream-too-large': new Response('x'.repeat(1024 * 1024 + 1)),
    };
    const result = await invoke(request(), { fetchImpl: async () => responses[kind] });
    expect(result.res.status).toBe(502);
    expect(result.body.error).toBeTruthy();
    expect(result.res.body).not.toContain('fixture-private-path');
  });

  it('does not reflect network, timeout, or parsing error details', async () => {
    const result = await invoke(request(), { fetchImpl: async () => {
      throw new Error('fixture-private-path fixture-token session workspace');
    } });
    expect(result.res.status).toBe(502);
    expect(result.body).toEqual({ error: '无法验证官方会话' });
  });

  it('returns unreadable without local paths or session details', async () => {
    const result = await invoke();
    expect(result.res.status).toBe(200);
    expect(result.body).toEqual(UNREADABLE);
    expect(result.res.body).not.toMatch(/fixture-token|workspace/);
    expect(result.res.body).not.toContain(root);
  });

  it('sanitizes unexpected internal failures as a generic readable error', async () => {
    const req = request();
    req.url = { split: () => [PREFIX], toString: () => { throw new Error('fixture-private-path'); } };
    const result = await invoke(req);
    expect(result.res.status).toBe(500);
    expect(result.body).toEqual({ error: '会话体积暂时不可用' });
    expect(result.fetchImpl).not.toHaveBeenCalled();
  });
});
