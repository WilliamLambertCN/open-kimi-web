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
import { fileURLToPath, pathToFileURL } from 'node:url';

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

function assertUpdateCommand(pkgDir) {
  const invoke = (args) => spawnSync(process.execPath, ['bin/open-kimi-web.mjs', 'update', ...args], {
    cwd: pkgDir,
    encoding: 'utf8',
    shell: false,
    timeout: 15_000,
  });
  const help = invoke(['--help']);
  if (help.error || help.status !== 0 || !help.stdout.includes('--check')) {
    throw new Error('installed update --help failed before runtime dependency installation');
  }
  const invalid = invoke(['--force']);
  if (invalid.error || invalid.status !== 2) throw new Error('installed update did not reject unknown arguments');
  const check = invoke(['--check']);
  if (check.error || check.status !== 1) {
    throw new Error('update --check must reject an unregistered unpacked directory without changing another install');
  }
  console.log('update command ok: help works without runtime deps; unsafe layout and arguments refused');
}

async function assertInstalledUpdateCleanup(pkgDir) {
  const { runProcess } = await import(pathToFileURL(join(pkgDir, 'src/update/process.mjs')).href);
  try {
    await runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 40 });
    throw new Error('installed updater did not enforce its deadline');
  } catch (error) {
    if (!/timed out after 40ms/.test(error.message) || error.cleanupUnconfirmed === true) throw error;
  }
  console.log('update cleanup ok: installed sources terminate and confirm their owned process');
}

async function assertLocalCaPackage(pkgDir, publicDir, target, home) {
  const invoke = (command) => {
    const result = spawnSync(process.execPath, ['bin/open-kimi-web.mjs', 'tls', command], {
      cwd: pkgDir, encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, OPEN_KIMI_WEB_HOME: home },
    });
    if (result.error || result.status !== 0 || /BEGIN.*(?:PRIVATE KEY|CERTIFICATE)/.test(result.stdout)) {
      throw new Error(`installed tls ${command} failed or exposed PEM material`);
    }
    return result.stdout;
  };
  const { ensureLocalCaTls } = await import(pathToFileURL(join(pkgDir, 'src/tls/localCaStore.mjs')).href);
  const { createLauncher } = await import(pathToFileURL(join(pkgDir, 'src/serve.mjs')).href);
  const { X509Certificate } = await import('node:crypto');
  const { request } = await import('node:https');
  invoke('setup');
  const tls = await ensureLocalCaTls({ home, host: '127.0.0.1', interfaces: {} });
  if (!invoke('status').includes(tls.publicCa.fingerprint)) throw new Error('installed tls status fingerprint mismatch');
  invoke('setup');
  const reused = await ensureLocalCaTls({ home, host: '127.0.0.1', interfaces: {} });
  if (tls.publicCa.fingerprint !== reused.publicCa.fingerprint) throw new Error('installed tls setup replaced its root');
  const launcher = await createLauncher({ target, publicDir, host: '127.0.0.1', port: 0, tls });
  try {
    const body = await new Promise((resolve, reject) => {
      const req = request(launcher.url + '/__open-kimi-mobile/tls/ca.cer', {
        ca: new X509Certificate(tls.publicCa.certificate).toString(), agent: false,
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => res.statusCode === 200 ? resolve(Buffer.concat(chunks)) : reject(new Error('CA download failed')));
        res.on('error', reject);
      });
      req.on('error', reject); req.end();
    });
    if (!body.equals(tls.publicCa.certificate)) throw new Error('installed CA download is not the exact root DER');
  } finally { await launcher.close(); }
  invoke('disable');
  if (await ensureLocalCaTls({ home })) throw new Error('installed tls disable did not disable selection');
  console.log('local CA ok: installed setup/status/reuse/disable and root-trusted HTTPS certificate download');
}

async function assertDebugLog(home) {
  const directory = join(home, 'logs');
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const files = existsSync(directory) ? readdirSync(directory) : [];
    if (files.length === 1) {
      const text = readFileSync(join(directory, files[0]), 'utf8');
      const rows = text.split('\n').slice(0, -1).map((line) => JSON.parse(line));
      const started = rows.some((row) => row.event === 'launcher_start');
      const served = rows.some((row) => row.event === 'http_end' && row.route === 'index' && row.status === 200);
      const proxied = rows.some((row) => row.event === 'http_end' && row.route === 'health' && row.status === 200);
      if (started && served && proxied) {
        if (text.includes(home) || text.includes('127.0.0.1') || text.includes('fake-target')) {
          throw new Error('installed diagnostic log leaked fixture context');
        }
        console.log('debug log ok: installed CLI emitted safe startup, static and proxy records');
        return;
      }
    }
    await delay(30);
  }
  throw new Error('installed CLI did not write the expected diagnostic records');
}

const required = [
  'bin/open-kimi-web.mjs',
  'src/serve.mjs',
  'src/localCaRoute.mjs',
  'src/tls/localCaStore.mjs',
  'src/tls/localCaCertificate.mjs',
  'src/tls/localCaFiles.mjs',
  'src/tls/tlsMain.mjs',
  'src/tls/x509Profile.mjs',
  'src/responseCompression.mjs',
  'src/transcriptPaging.mjs',
  'src/debugLog.mjs',
  'src/debugLogSchema.mjs',
  'src/debugLogSink.mjs',
  'src/diagnosticContext.mjs',
  'src/httpDiagnostics.mjs',
  'src/transportDiagnostics.mjs',
  'src/wsDiagnostics.mjs',
  'src/wsConversationDiagnostics.mjs',
  'src/update/updateMain.mjs',
  'src/update/windowsTreeCleanup.mjs',
  'src/update/windowsTreeCleanup.cs',
  'src/mobile/mobileWorkspaceSort.js',
  'src/mobile/mobileWorkspaceSort.css',
  'src/mobile/sessionActionsApi.js',
  'src/mobile/desktopSessionMenu.js',
  'src/mobile/desktopSessionMenu.css',
  'src/mobile/mobileSessionMenu.js',
  'src/mobile/mobileSessionMenu.css',
  'src/mobile/locale.js',
  'src/mobile/providerLocale.js',
  'src/mobile/usageLocale.js',
  'src/mobile/effortOrder.js',
  'src/mobile/conversationMetadata.js',
  'src/mobile/mobileSubagentModelApi.js',
  'src/mobile/mobileSubagentModelView.js',
  'src/mobile/mobileSubagentModel.js',
  'src/mobile/mobileSubagentModel.css',
  'src/mobile/sideChatModelIdentity.js',
  'src/mobile/sideChatModelApi.js',
  'src/mobile/sideChatModelView.js',
  'src/mobile/sideChatModel.js',
  'src/mobile/sideChatModel.css',
  'src/mobile/requestMetricsModel.js',
  'src/mobile/requestMetricsTransport.js',
  'src/mobile/requestMetricsConversation.js',
  'src/officialConversationMetrics.mjs',
  'src/metrics/journal.mjs',
  'src/metrics/routes.mjs',
  'src/mobile/requestMetrics.js',
  'src/mobile/requestMetrics.css',
  'src/mobile/serviceRestartView.js',
  'src/mobile/serviceRestart.js',
  'src/mobile/serviceRestart.css',
  'src/restart/worker.mjs',
  'src/restart/launch.mjs',
  'src/restart/controller.mjs',
  'src/restart/routes.mjs',
  'src/restart/http.mjs',
  'src/mobile/navigationApi.js',
  'src/mobile/navigationSearchView.js',
  'src/mobile/navigationSearch.js',
  'src/mobile/navigationWorkspace.js',
  'src/mobile/navigation.js',
  'src/mobile/navigation.css',
  'src/mobile/pwaInstallView.js',
  'src/mobile/pwaInstall.js',
  'src/mobile/pwaInstall.css',
  'src/mobile/manifest.webmanifest',
  'src/mobile/icons/app-192.png',
  'src/mobile/icons/app-512.png',
  'src/mobile/icons/app-maskable-512.png',
  'src/mobile/icons/apple-touch-180.png',
  'src/mobile/cronApi.js',
  'src/mobile/cronView.js',
  'src/mobile/cron.js',
  'src/mobile/cron.css',
  'src/apiPathPolicy.mjs',
  'src/cron/client.mjs',
  'src/cron/routes.mjs',
  'src/cron/guard.mjs',
  'src/cron/inventory.mjs',
  'README.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
];

async function assertConversationAssets(pkgDir, launcher, html) {
  const prefix = '/__open-kimi-mobile/';
  const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
  if (!html.includes(`<meta name="open-kimi-web-version" content="${version}">`) ||
      !html.includes(`rel="icon" type="image/png" sizes="192x192" href="${prefix}icons/app-192.png"`)) {
    throw new Error('installed branding metadata or favicon does not match the package');
  }
  const assets = ['branding.js', 'branding.css', 'mobileConversationToc.js', 'mobileConversationToc.css',
    'mobileConversationTocMetadata.js', 'mobileConversationTocNavigate.js', 'mobileConversationTocView.js',
    'requestMetricsModel.js', 'requestMetricsTransport.js', 'requestMetricsConversation.js',
    'requestMetrics.js', 'requestMetrics.css',
    'sideChatModelIdentity.js', 'sideChatModelApi.js', 'sideChatModelView.js', 'sideChatModel.js', 'sideChatModel.css',
    'serviceRestartView.js', 'serviceRestart.js', 'serviceRestart.css'];
  for (const name of assets) {
    const attribute = name.endsWith('.js') ? 'src' : 'href';
    if (!html.includes(`${attribute}="${prefix}${name}"`)) throw new Error(`installed page does not load ${name}`);
    const response = await fetch(launcher.url + prefix + name);
    if (!response.ok || !(await response.text()).trim()) throw new Error(`installed asset unavailable: ${name}`);
  }
  console.log('conversation assets ok: branding, mobile outline, per-request speeds and side chat model picker');
}

async function assertCurrentConversationAsset(pkgDir, launcher) {
  const prefix = '/__open-kimi-mobile/';
  const { addMobilePresentation } = await import(pathToFileURL(join(pkgDir, 'src/officialPresentation.mjs')).href);
  for (const version of ['2.6.0', '2.6.1']) {
    const current = addMobilePresentation('<html><head></head></html>', { officialWebVersion: version });
    if (!current.includes(prefix + 'conversationMetadata.js') || current.includes(prefix + 'foldingDefaults.js') ||
        current.includes(prefix + 'mobileConversationTocMetadata.js')) {
      throw new Error(`installed ${version} presentation must use conversation metadata and native folding defaults`);
    }
  }
  const metadata = await fetch(launcher.url + prefix + 'conversationMetadata.js');
  if (!metadata.ok || !(await metadata.text()).includes('__okwMobileTocMetadata')) {
    throw new Error('installed 2.6 conversation metadata asset is unavailable');
  }
}

async function assertPwaAssets(pkgDir, publicDir, target) {
  const { createLauncher } = await import(pathToFileURL(join(pkgDir, 'src/serve.mjs')).href);
  const launcher = await createLauncher({ target, publicDir, host: '127.0.0.1', port: 0, interfaces: [],
    officialPresentation: true, officialWebVersion: '2.4.1' });
  const prefix = '/__open-kimi-mobile/';
  try {
    const html = await fetch(launcher.url).then((response) => response.text());
    if (!html.includes(`rel="manifest" href="${prefix}manifest.webmanifest"`)) {
      throw new Error('installed enhanced launcher did not inject its manifest');
    }
    await assertConversationAssets(pkgDir, launcher, html);
    await assertCurrentConversationAsset(pkgDir, launcher);
    const response = await fetch(launcher.url + prefix + 'manifest.webmanifest');
    const manifest = await response.json();
    if (!response.headers.get('content-type')?.startsWith('application/manifest+json') ||
        manifest.start_url !== '/' || manifest.id !== '/' || manifest.display !== 'standalone') {
      throw new Error('installed PWA manifest contract is invalid');
    }
    for (const icon of manifest.icons) {
      const resource = await fetch(launcher.url + icon.src);
      const png = Buffer.from(await resource.arrayBuffer());
      if (resource.headers.get('content-type') !== 'image/png' ||
          png.readUInt32BE(16) !== Number(icon.sizes.split('x')[0])) throw new Error('installed PWA icon is invalid');
    }
    console.log('PWA assets ok: installed package serves manifest and correctly sized icons without credentials');
  } finally { await launcher.close(); }
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
    for (const p of required) {
      if (!existsSync(join(pkgDir, p))) throw new Error(`tarball missing ${p}`);
    }
    const allFiles = readdirSync(pkgDir, { recursive: true });
    const leaked = allFiles.filter((file) => {
      const name = String(file).replaceAll('\\', '/');
      return /(?:^|\/)(?:\.git|\.cache|\.tmp|coverage|tests|logs|node_modules|upstream|cron-backend)(?:\/|$)/.test(name) ||
        /^src\/(?:schedules(?:\/|$)|mobile\/schedules[^/]*)/.test(name) ||
        /(?:^|\/)(?:build-cron-backend\.mjs|backend-entry\.mjs|owned-home\.mjs)$/.test(name) ||
        /\.(?:patch|diff)$/.test(name) ||
        /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|id_rsa|id_ed25519)$/.test(name) ||
        /\.(?:test\.mjs|map|log|jsonl|bak|old|key|pem|p12|pfx)$/.test(name);
    });
    if (leaked.length > 0) throw new Error(`tarball contains unexpected private or debug files: ${leaked.join(', ')}`);
    console.log(`tarball contents ok (${required.join(', ')}; no test files)`);
    assertUpdateCommand(pkgDir);
    await assertInstalledUpdateCleanup(pkgDir);

    // 3. Install like a user (prod deps only) and boot the bin.
    run('npm install --omit=dev --no-audit --no-fund', { cwd: pkgDir });
    assertInstalledDependencies(pkgDir);
    assertVersionFlag(pkgDir);
    const customWebDir = join(scratch, 'custom-web');
    const debugHome = join(scratch, 'okw-home');
    mkdirSync(customWebDir);
    writeFileSync(join(customWebDir, 'index.html'), '<!doctype html><html><head><title>pack smoke</title></head></html>');
    await assertPwaAssets(pkgDir, customWebDir, target.url);
    await assertLocalCaPackage(pkgDir, customWebDir, target.url, join(scratch, 'ca-home'));
    const port = 23_000 + Math.floor(Math.random() * 20_000);
    child = spawn(
      process.execPath,
      [
        join(pkgDir, 'bin/open-kimi-web.mjs'),
        'serve',
        '--target', target.url,
        '--port', String(port),
        '--no-token-link',
        '--debug',
        '--web-dir', customWebDir,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, OPEN_KIMI_WEB_HOME: debugHome } },
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
    await assertDebugLog(debugHome);
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
