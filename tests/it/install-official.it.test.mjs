import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adjacentNpm, makeInstallContext, runInstallProcess } from '../../scripts/install.mjs';
import { ensureGitBash } from '../../scripts/install/gitBash.mjs';
import { verifyPty } from '../../scripts/install/pty.mjs';
import { dependencyRoot } from '../../scripts/install/ptyAudit.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { discoverOfficial, officialPaths, prepareOfficial } from '../../scripts/install/official.mjs';

let directory;
let ctx;
let stage;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'okw-official-real-'));
  stage = join(directory, 'stage');
  await mkdir(stage);
  for (const name of ['user.npmrc', 'global.npmrc']) await writeFile(join(stage, name), '');
  ctx = makeInstallContext({ env: { ...process.env, OPEN_KIMI_WEB_HOME: directory,
    KIMI_CODE_HOME: join(directory, 'user-config'), OPEN_KIMI_REAL_KIMI: undefined }, log: () => {} });
  delete ctx.env.OPEN_KIMI_REAL_KIMI;
  ctx.npm = await adjacentNpm(ctx.node);
  await ensureGitBash(ctx);
}, 30000);

afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

async function ready(url, child) {
  for (let n = 0; n < 100; n++) {
    if (child.exitCode !== null) throw new Error('isolated official Web exited before health check');
    try { const response = await fetch(`${url}/api/v1/meta`); if (response.ok) return response; } catch {}
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error('isolated official Web readiness timed out');
}

describe('real pinned official npm dependency', () => {
  it('keeps top-level scripts disabled, verifies real CLI/PTY/Web and reuses owned 2.1.1', async () => {
    const progress = {};
    await prepareOfficial(ctx, { kind: 'missing' }, stage, progress);
    const paths = officialPaths(ctx);
    expect(ctx.kimi).toBe(paths.kimi);
    const record = JSON.parse(await readFile(paths.record, 'utf8'));
    expect(record).toMatchObject({ schema: 1, version: '2.1.1', entry: paths.entry });
    const manifest = JSON.parse(await readFile(join(paths.root, 'package.json'), 'utf8'));
    expect(manifest.name).toBe('@moonshot-ai/kimi-code');
    expect(await verifyPty(ctx, paths.root)).toBe('ok');
    expect(await runInstallProcess(ctx.node, [paths.entry, '--version'], { env: ctx.env })).toContain('2.1.1');
    expect(await runInstallProcess(ctx.node, [paths.entry, 'web', '--help'], { env: ctx.env })).toContain('--no-open');
    const found = await discoverOfficial({ ...ctx, env: { ...ctx.env, PATH: '' }, kimi: undefined });
    expect(found).toMatchObject({ kind: 'npm', path: paths.kimi });
    const snapshot = await readFile(paths.record, 'utf8');
    await prepareOfficial(ctx, found, stage, progress);
    expect(await readFile(paths.record, 'utf8')).toBe(snapshot);
    expect((await readdir(directory)).sort()).toEqual(['bootstrap-official.json', 'official', 'stage']);
  }, 180000);

  it('runs real official Web metadata/static health without lifecycle scripts, login or model calls', async () => {
    await ensureGitBash(ctx);
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    const child = spawn(ctx.node, [officialPaths(ctx).entry, 'web', '--host', '127.0.0.1', '--port', String(port),
      '--no-open', '--dangerous-bypass-auth'], { cwd: directory, env: ctx.env, stdio: 'ignore' });
    const stopped = once(child, 'exit');
    try {
      const response = await ready(url, child);
      expect(response.status).toBe(200);
      const meta = await response.json();
      expect(meta).toBeTypeOf('object');
      const page = await fetch(`${url}/`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('<html');
    } finally {
      await fetch(`${url}/api/v1/shutdown`, { method: 'POST' }).catch(() => {});
      if (child.exitCode === null) child.kill();
      await stopped;
    }
  }, 30000);

});

describe('real owned official dependency failures', () => {
  it('rejects a missing owned PTY binary without rewriting or rebuilding', async () => {
    const paths = officialPaths(ctx);
    const pty = dependencyRoot(paths.root, 'node-pty');
    const binding = process.platform === 'win32' ? 'conpty.node' : 'pty.node';
    const binary = process.platform === 'linux' ? join(pty, 'build/Release', binding) :
      join(pty, `prebuilds/${process.platform}-${process.arch}`, binding);
    const disabled = `${binary}.qa-disabled`;
    const snapshot = await readFile(paths.record, 'utf8');
    await rename(binary, disabled);
    try {
      await expect(prepareOfficial(ctx, { kind: 'npm', path: paths.kimi }, stage, {})).rejects.toThrow('repair manually');
      expect(await readFile(paths.record, 'utf8')).toBe(snapshot);
      await expect(readFile(binary)).rejects.toThrow();
    } finally { await rename(disabled, binary); }
    expect(await verifyPty(ctx, paths.root)).toBe('ok');
  }, 30000);

  it('rejects changed owned entry rather than reinstalling over a partial or modified install', async () => {
    await writeFile(officialPaths(ctx).entry, 'modified fixture');
    await expect(discoverOfficial(ctx)).rejects.toThrow('ownership or version changed');
  });
});
