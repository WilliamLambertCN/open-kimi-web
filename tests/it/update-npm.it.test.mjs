import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { identifyInstallation } from '../../packages/launcher/src/update/installation.mjs';
import { updateMain } from '../../packages/launcher/src/update/updateMain.mjs';
import { checkedRun } from '../../packages/launcher/src/update/process.mjs';
import { resolveTool } from '../../packages/launcher/src/update/toolResolver.mjs';
import { exists } from '../../packages/launcher/src/update/files.mjs';
import { globalRoot, identityOptions, networkInjectedRun, packageFixture, put, supportFixture } from './updateFixture.mjs';

let directory;
let oldTgz;
let newTgz;
let supportTgz;
let npm;
let upstream;
let upstreamUrl;
const children = new Set();
const releaseUrl = 'https://github.com/WilliamLambertCN/open-kimi-web/releases/download/' +
  'v2.1.1-r10/open-kimi-web-2.1.1-r10.tgz';

async function npmRun(args, cwd = directory) {
  return checkedRun(npm.command, [...npm.args, ...args], { cwd, timeoutMs: 90_000 });
}

async function probeLauncher(entry) {
  const publicDir = join(directory, 'public');
  await put(join(publicDir, 'index.html'), '<html>updated launcher fixture</html>');
  const child = spawn(process.execPath, [entry, 'serve', '--web-dir', publicDir,
    '--target', upstreamUrl, '--no-token-link'], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`fixture launcher did not become ready: ${output.slice(-500)}`)), 10_000);
    const collect = (chunk) => {
      output += chunk.toString();
      const match = /Local:\s+(http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`fixture launcher exited ${code}: ${output}`)); });
  });
  try {
    expect(await (await fetch(url)).text()).toContain('updated launcher fixture');
    expect(await (await fetch(`${url}/api/v1/fixture`)).text()).toBe('independent upstream unchanged');
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit');
    children.delete(child);
  }
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'okw update & % fixture-'));
  npm = await resolveTool('npm');
  oldTgz = await packageFixture(directory, '2.1.1-r9');
  newTgz = await packageFixture(directory, '2.1.1-r10');
  supportTgz = await supportFixture(directory);
  upstream = createServer(async (req, res) => {
    if (req.url === '/open-kimi-web-2.1.1-r9.tgz') res.end(await readFile(oldTgz));
    else if (req.url === '/open-kimi-web-2.1.1-r10.tgz') res.end(await readFile(newTgz));
    else if (req.url === '/fixture-support-1.0.0.tgz') res.end(await readFile(supportTgz));
    else if (req.url === '/redirect-r10.tgz') { res.writeHead(302, { Location: '/open-kimi-web-2.1.1-r10.tgz' }); res.end(); }
    else res.end('independent upstream unchanged');
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  for (const name of ['integration-state', 'official-data', 'certificate-sentinel']) {
    await put(join(directory, name), `${name}:unchanged`);
  }
}, 120_000);

afterAll(async () => {
  for (const child of children) { child.kill('SIGTERM'); await once(child, 'exit'); }
  if (upstream) await new Promise((resolve) => upstream.close(resolve));
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function update(root, env) {
  const identify = () => identifyInstallation(identityOptions(root));
  const lines = [];
  const real = networkInjectedRun(null, `${upstreamUrl}/redirect-r10.tgz`);
  const run = (command, args, options) => real(command, args, env ? { ...options, env: { ...process.env, ...env } } : options);
  const result = await updateMain([], { identify, latestRelease: async () => ({ version: '2.1.1-r10', url: releaseUrl }),
    run,
    log: (line) => lines.push(line), error: (line) => lines.push(line) });
  expect(result, lines.join('\n')).toBe(0);
  expect((await identify()).version).toBe('2.1.1-r10');
  expect(await checkedRun(process.execPath, [join(root, 'bin/open-kimi-web.mjs'), '--version'])).toBe('2.1.1-r10');
  expect(await exists(join(root, 'UNSAFE-LIFECYCLE'))).toBe(false);
  await probeLauncher(join(root, 'bin/open-kimi-web.mjs'));
  expect(await (await fetch(`${upstreamUrl}/api/v1/fixture`)).text()).toBe('independent upstream unchanged');
  for (const name of ['integration-state', 'official-data', 'certificate-sentinel']) {
    expect(await readFile(join(directory, name), 'utf8')).toBe(`${name}:unchanged`);
  }
}

describe('real isolated npm replacement', () => {
  it('updates only the current custom global prefix with spaces, ampersands and percent signs', async () => {
    const prefix = join(directory, 'global prefix & % value');
    await npmRun(['install', '-g', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', oldTgz]);
    const root = globalRoot(prefix);
    expect((await identifyInstallation(identityOptions(root))).prefix).toBe(prefix);
    await update(root);
  }, 120_000);

  it.each(['dependencies', 'devDependencies'])('replaces local %s, preserving owner class/lock and other dev dependencies',
    async (category) => {
      const owner = join(directory, `local ${category} & % value`);
      await put(join(owner, 'package.json'), { name: 'fixture-owner', version: '1.0.0', private: true,
        scripts: { preinstall: 'node -e "require(\'fs\').writeFileSync(\'OWNER-LIFECYCLE\',\'ran\')"' } });
      await npmRun(['install', '--prefix', owner, '--ignore-scripts', '--no-audit', '--no-fund',
        category === 'devDependencies' ? '--save-dev' : '--save-prod', `${upstreamUrl}/open-kimi-web-2.1.1-r9.tgz`]);
      await npmRun(['install', '--prefix', owner, '--ignore-scripts', '--no-audit', '--no-fund', '--save-dev',
        `${upstreamUrl}/fixture-support-1.0.0.tgz`]);
      const root = join(owner, 'node_modules/open-kimi-web');
      const env = { npm_config_location: 'global', npm_config_save: 'false', npm_config_global: 'true',
        npm_config_replace_registry_host: category === 'dependencies' ? 'always' : 'github.com' };
      await update(root, env);
      expect((await identifyInstallation(identityOptions(root))).owner).toBe(owner);
      expect(await exists(join(owner, 'open-kimi-web.cmd'))).toBe(false);
      expect(await exists(join(owner, 'bin/open-kimi-web'))).toBe(false);
      expect(await exists(join(owner, 'node_modules/fixture-support/index.js'))).toBe(true);
      const manifest = JSON.parse(await readFile(join(owner, 'package.json'), 'utf8'));
      const lock = JSON.parse(await readFile(join(owner, 'package-lock.json'), 'utf8'));
      expect(manifest[category]['open-kimi-web']).toContain('r10');
      expect(lock.packages['node_modules/open-kimi-web'].version).toBe('2.1.1-r10');
      expect(Boolean(lock.packages['node_modules/open-kimi-web'].dev)).toBe(category === 'devDependencies');
      expect(await exists(join(owner, 'OWNER-LIFECYCLE'))).toBe(false);
    }, 120_000);
});
