// Pack smoke test: builds the npm tarball, installs it into a scratch dir
// (npm, prod deps only — like a real user), then boots the bin against a
// local fake target and verifies static serving + /api proxying for real.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(command, opts = {}) {
  const res = spawnSync(command, { cwd: ROOT, encoding: 'utf8', shell: true, ...opts });
  if (res.status !== 0) {
    throw new Error(`${command} failed (${res.status})\n${res.stdout}\n${res.stderr}`);
  }
  return res.stdout.trim();
}

function startFakeTarget() {
  return new Promise((resolveListen) => {
    const server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ from: 'fake-target', path: req.url }));
    });
    server.listen(0, '127.0.0.1', () =>
      resolveListen({ server, url: `http://127.0.0.1:${server.address().port}` }),
    );
  });
}

async function waitFor(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

function assertInstalledDependencies(pkgDir) {
  if (!existsSync(join(pkgDir, 'node_modules/selfsigned/package.json'))) {
    throw new Error('installed tarball missing selfsigned runtime dependency');
  }
}

function delay(ms, value) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(value), ms);
    timer.unref();
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', () => resolve(true)));
  child.kill();
  const stopped = await Promise.race([exited, delay(5_000, false)]);
  if (!stopped) {
    child.kill('SIGKILL');
    await Promise.race([exited, delay(5_000)]);
  }
}

// The SKILL.md precheck runs `--version` against the installed artifact.
function assertVersionFlag(pkgDir) {
  const version = run(`"${process.execPath}" bin/open-kimi-web.mjs --version`, { cwd: pkgDir });
  const expected = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
  if (version !== expected) {
    throw new Error(`--version printed "${version}", expected "${expected}"`);
  }
  console.log(`--version ok (${version})`);
}

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'pack-smoke-'));
  const target = await startFakeTarget();
  let child;
  try {
    // 1. Pack the launcher without a bundled frontend.
    run(`corepack pnpm --filter open-kimi-web pack --pack-destination "${scratch}"`);
    const tarball = readdirSync(scratch).find((f) => f.endsWith('.tgz'));
    if (!tarball) throw new Error('no tarball produced');
    console.log(`packed ${tarball}`);

    // 2. Extract and assert the publish surface. cwd-relative paths keep
    // Windows drive-letter colons out of tar's remote-host parsing.
    const pkgDir = join(scratch, 'pkg');
    run(`tar -xzf "${tarball}" -C .`, { cwd: scratch });
    renameSync(join(scratch, 'package'), pkgDir);
    const required = [
      'bin/open-kimi-web.mjs',
      'src/serve.mjs',
      'README.md',
      'LICENSE',
      'THIRD_PARTY_NOTICES.md',
    ];
    for (const p of required) {
      if (!existsSync(join(pkgDir, p))) throw new Error(`tarball missing ${p}`);
    }
    const allFiles = readdirSync(pkgDir, { recursive: true });
    const leaked = allFiles.filter((f) => String(f).endsWith('.test.mjs'));
    if (leaked.length > 0) throw new Error(`tarball leaks test files: ${leaked.join(', ')}`);
    console.log(`tarball contents ok (${required.join(', ')}; no test files)`);

    // 3. Install like a user (prod deps only) and boot the bin.
    run('npm install --omit=dev --no-audit --no-fund', { cwd: pkgDir });
    assertInstalledDependencies(pkgDir);
    assertVersionFlag(pkgDir);
    const customWebDir = join(scratch, 'custom-web');
    mkdirSync(customWebDir);
    writeFileSync(join(customWebDir, 'index.html'), '<!doctype html><title>pack smoke</title>');
    const port = 23_000 + Math.floor(Math.random() * 20_000);
    child = spawn(
      process.execPath,
      [
        join(pkgDir, 'bin/open-kimi-web.mjs'),
        'serve',
        '--target', target.url,
        '--port', String(port),
        '--no-token-link',
        '--web-dir', customWebDir,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));

    const base = `http://127.0.0.1:${port}`;
    const index = await waitFor(base);
    const html = await index.text();
    if (!html.includes('<')) throw new Error('index page did not look like HTML');
    if (index.headers.get('cache-control') !== 'no-cache') {
      throw new Error(`index cache-control wrong: ${index.headers.get('cache-control')}`);
    }
    const api = await (await waitFor(`${base}/api/v1/healthz`)).json();
    if (api.from !== 'fake-target') throw new Error(`proxy broken: ${JSON.stringify(api)}`);
    console.log('live check ok: / served (no-cache), /api/v1/healthz proxied');
    console.log(log.trim());
  } finally {
    await stopChild(child);
    await new Promise((r) => target.server.close(r));
    rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
