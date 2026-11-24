import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import { fixtureRegistry, globalRoot, identityOptions, packageFixture, put, supportFixture } from './updateFixture.mjs';
import { listenHttp } from '../testkit/httpPort.mjs';

let directory;
let oldTgz;
let newTgz;
let supportTgz;
let npm;
let upstream;
let upstreamUrl;
const children = new Set();
const version = '2.1.1-r10';
const name = `open-kimi-web-${version}.tgz`;
const repo = 'https://github.com/WilliamLambertCN/open-kimi-web';
const proxy = 'https://ghfast.top';
const releaseUrl = `${repo}/releases/download/v${version}/${name}`;
const proxyUrl = `${proxy}/${releaseUrl}`;
const metadataUrl = 'https://api.github.com/repos/WilliamLambertCN/open-kimi-web/releases/latest';

async function npmRun(args, cwd = directory) {
  return checkedRun(npm.command, [...npm.args, ...args], { cwd, timeoutMs: 90_000 });
}

async function probeLauncher(entry) {
  const publicDir = join(directory, 'public');
  await put(join(publicDir, 'index.html'), '<html>updated launcher fixture</html>');
  const child = spawn(process.execPath, [entry, 'serve', '--web-dir', publicDir,
    '--target', upstreamUrl, '--no-token-link'], { shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, OPEN_KIMI_WEB_HOME: join(directory, 'fixture-okw'), KIMI_CODE_HOME: join(directory, 'fixture-kimi') },
  });
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

function registryHandler(packages) {
  const files = new Map([...packages.values()].flat().map(({ dist }) => [dist.filename, join(directory, dist.filename)]));
  files.set('open-kimi-web-2.1.1-r9.tgz', oldTgz);
  files.set('fixture-support-1.0.0.tgz', supportTgz);
  files.set(name, newTgz);
  return async (req, res) => {
    const path = decodeURIComponent(req.url.slice(1));
    if (files.has(path)) return res.end(await readFile(files.get(path)));
    const versions = packages.get(path);
    if (versions) {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ name: path, 'dist-tags': { latest: versions.at(-1).version },
        versions: Object.fromEntries(versions.map((pkg) => [pkg.version, { ...pkg, dist: { integrity: pkg.dist.integrity,
          tarball: `${upstreamUrl}/${encodeURIComponent(pkg.dist.filename)}` } }])) }));
    }
    if (path === 'redirect-r10.tgz') return res.writeHead(302, { Location: `/${name}` }).end();
    if (path === 'api/v1/fixture') return res.end('independent upstream unchanged');
    return res.writeHead(404).end();
  };
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'okw update & % fixture-'));
  npm = await resolveTool('npm');
  oldTgz = await packageFixture(directory, '2.1.1-r9');
  newTgz = await packageFixture(directory, version, { bundle: false });
  supportTgz = await supportFixture(directory);
  upstream = createServer(registryHandler(await fixtureRegistry(directory)));
  await listenHttp(upstream);
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

async function update(root, npmEnv, useProxy = false) {
  const identify = () => identifyInstallation(identityOptions(root));
  const lines = [];
  const calls = [];
  const bytes = await readFile(newTgz);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
  const download = async (url, options) => {
    calls.push(url);
    if (options.metadata) {
      expect(url).toBe(metadataUrl);
      return Buffer.from(JSON.stringify({ draft: false, prerelease: false, tag_name: `v${version}`,
        html_url: `${repo}/releases/tag/v${version}`, assets: [{ name, state: 'uploaded', digest: `sha256:${digest}`,
          browser_download_url: releaseUrl }] }));
    }
    if (useProxy && url === releaseUrl) throw new Error('fixture GitHub asset unavailable');
    expect(url).toBe(useProxy ? proxyUrl : releaseUrl);
    expect(options.proxyVersion).toBe(useProxy ? version : undefined);
    const path = useProxy ? name : 'redirect-r10.tgz';
    return Buffer.from(await (await fetch(`${upstreamUrl}/${path}`, { signal: options.signal })).arrayBuffer());
  };
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key)));
  const run = (command, args, options) => checkedRun(command, args,
    { ...options, quietFailure: false, env: { ...inherited, ...npmEnv } });
  const deps = { identify, download, env: {}, run, log: (line) => lines.push(line), error: (line) => lines.push(line) };
  const result = await updateMain([], deps);
  expect(result, lines.join('\n')).toBe(0);
  expect(calls).toEqual(useProxy ? [metadataUrl, releaseUrl, proxyUrl] : [metadataUrl, releaseUrl]);
  expect(lines.some((line) => line.includes('via the GitHub download proxy'))).toBe(useProxy);
  expect((await identify()).version).toBe(version);
  expect(await checkedRun(process.execPath, [join(root, 'bin/open-kimi-web.mjs'), '--version'])).toBe(version);
  expect(await exists(join(root, 'UNSAFE-LIFECYCLE'))).toBe(false);
  await probeLauncher(join(root, 'bin/open-kimi-web.mjs'));
  expect(await (await fetch(`${upstreamUrl}/api/v1/fixture`)).text()).toBe('independent upstream unchanged');
  for (const name of ['integration-state', 'official-data', 'certificate-sentinel']) {
    expect(await readFile(join(directory, name), 'utf8')).toBe(`${name}:unchanged`);
  }
  calls.length = 0;
  expect(await updateMain(['--check'], deps)).toBe(0);
  expect(calls).toEqual([metadataUrl]);
  return { url: releaseUrl, integrity };
}

function registryEnv() {
  return { npm_config_registry: `${upstreamUrl}/`, npm_config_fetch_retries: '0' };
}

describe('real isolated npm replacement', () => {
  it('updates only the current custom global prefix with spaces, ampersands and percent signs', async () => {
    const prefix = join(directory, 'global prefix & % value');
    await npmRun(['install', '-g', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', oldTgz]);
    const root = globalRoot(prefix);
    expect((await identifyInstallation(identityOptions(root))).prefix).toBe(prefix);
    await update(root, registryEnv());
  }, 120_000);

  it.each([['dependencies', 2], ['devDependencies', 3]])
    ('replaces local %s with a real npm v%s lock and preserves another dependency', async (category, lockVersion) => {
      const owner = join(directory, `local ${category} & % value`);
      await put(join(owner, 'package.json'), { name: 'fixture-owner', version: '1.0.0', private: true,
        scripts: { preinstall: 'node -e "require(\'fs\').writeFileSync(\'OWNER-LIFECYCLE\',\'ran\')"' } });
      const common = ['install', '--prefix', owner, '--ignore-scripts', '--no-audit', '--no-fund',
        '--lockfile-version', String(lockVersion)];
      await npmRun([...common, category === 'devDependencies' ? '--save-dev' : '--save-prod',
        `${upstreamUrl}/open-kimi-web-2.1.1-r9.tgz`]);
      await npmRun([...common, '--save-dev', `${upstreamUrl}/fixture-support-1.0.0.tgz`]);
      const root = join(owner, 'node_modules/open-kimi-web');
      const env = { ...registryEnv(), npm_config_location: 'global', npm_config_save: 'false', npm_config_global: 'true',
        npm_config_replace_registry_host: category === 'dependencies' ? 'always' : 'github.com' };
      const verified = await update(root, env, true);
      expect((await identifyInstallation(identityOptions(root))).owner).toBe(owner);
      expect(await exists(join(owner, 'open-kimi-web.cmd'))).toBe(false);
      expect(await exists(join(owner, 'bin/open-kimi-web'))).toBe(false);
      expect(await exists(join(owner, 'node_modules/fixture-support/index.js'))).toBe(true);
      expect(await exists(join(root, 'UNSAFE-LIFECYCLE'))).toBe(false);
      const manifest = JSON.parse(await readFile(join(owner, 'package.json'), 'utf8'));
      const lock = JSON.parse(await readFile(join(owner, 'package-lock.json'), 'utf8'));
      expect(manifest[category]['open-kimi-web']).toBe(verified.url);
      expect(lock.lockfileVersion).toBe(lockVersion);
      expect(lock.packages['node_modules/open-kimi-web']).toMatchObject({ version, resolved: verified.url,
        integrity: verified.integrity });
      expect(Boolean(lock.packages['node_modules/open-kimi-web'].dev)).toBe(category === 'devDependencies');
      expect(await exists(join(owner, 'OWNER-LIFECYCLE'))).toBe(false);
    }, 120_000);
});
