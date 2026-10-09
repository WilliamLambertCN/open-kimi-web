import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { npmArguments } from '../../packages/launcher/src/update/npmUpdate.mjs';
import { resolveTool } from '../../packages/launcher/src/update/toolResolver.mjs';
import { checkedRun } from '../../packages/launcher/src/update/process.mjs';
import { put } from './updateFixture.mjs';

const directories = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
const url = 'https://github.com/WilliamLambertCN/open-kimi-web/releases/download/' +
  'v2.1.1-r10/open-kimi-web-2.1.1-r10.tgz';
const probe = `
const {createRequire}=require('node:module');
const requireNpm=createRequire(process.argv[1]);
const Config=requireNpm('@npmcli/config');
const {definitions,flatten,nerfDarts,shorthands}=requireNpm('@npmcli/config/lib/definitions');
const config=new Config({npmPath:process.argv[2],definitions,flatten,nerfDarts,shorthands,
  argv:[process.execPath,process.argv[1],...JSON.parse(process.argv[3])]});
(async()=>{
  await config.load();
  const pacote=requireNpm('pacote');
  const asset=new pacote.RemoteFetcher(process.argv[4],config.flat);
  console.log(JSON.stringify({url:asset.resolved,global:config.get('global')||config.get('location')==='global',
    save:config.get('save'),location:config.get('location')}));
})().catch(error=>{console.error(error.message);process.exitCode=1});
`;

describe('actual npm configuration and asset host resolution', () => {
  it.each(['always', 'github.com'])('fixed arguments defeat conflicting host/mode/save config %s', async (host) => {
    const directory = await mkdtemp(join(tmpdir(), 'okw-update-npm-config-'));
    directories.push(directory);
    const owner = join(directory, 'owner');
    await put(join(owner, 'package.json'), { name: 'fixture-owner', private: true });
    const configFile = join(directory, 'fixture-user-npmrc');
    const globalConfig = join(directory, 'fixture-global-npmrc');
    await put(configFile, '');
    await put(globalConfig, '');
    await mkdir(join(directory, 'home'));
    const tool = await resolveTool('npm');
    const args = npmArguments({ kind: 'local', owner, category: 'dependencies' }, url);
    const inherited = { ...process.env, NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/' };
    const env = Object.fromEntries(Object.entries(inherited).filter(([key]) => !/^npm_config_/i.test(key)));
    const options = { cwd: owner, env: { ...env, npm_config_userconfig: configFile,
      npm_config_globalconfig: globalConfig, npm_config_location: 'global', npm_config_save: 'false',
      npm_config_global: 'true', npm_config_replace_registry_host: host, npm_config_registry: 'https://example.invalid/' } };
    const result = JSON.parse(await checkedRun(process.execPath, ['-e', probe, tool.args[0], dirname(dirname(tool.args[0])),
      JSON.stringify(args), url], options));
    expect(result).toEqual({ url, global: false, save: true, location: 'project' });
    const fixed = ['--replace-registry-host=never', '--location=project', '--save=true'];
    const withoutFixes = args.filter((arg) => !fixed.includes(arg));
    const unsafe = JSON.parse(await checkedRun(process.execPath, ['-e', probe, tool.args[0], dirname(dirname(tool.args[0])),
      JSON.stringify(withoutFixes), url], options));
    expect(unsafe.url).toContain('https://example.invalid/');
    expect(unsafe.global).toBe(true);
    expect(unsafe.save).toBe(false);
  });
});
