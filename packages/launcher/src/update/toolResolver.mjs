import { realpath } from 'node:fs/promises';
import { delimiter, dirname, join, resolve } from 'node:path';
import { assertBinTarget } from './binEvidence.mjs';
import { exists, readJson, readText, samePath, within } from './files.mjs';

const TOOL_ENTRIES = { npm: 'bin/npm-cli.js', corepack: 'dist/corepack.js' };

async function validateCli(root, name) {
  const manifest = await readJson(join(root, 'package.json'));
  const expected = TOOL_ENTRIES[name];
  if (manifest.name !== name || !samePath(join(root, manifest.bin?.[name] || ''), join(root, expected))) {
    throw new Error(`${name} tool manifest.bin is not a verified JavaScript CLI`);
  }
  const cli = await realpath(join(root, expected));
  if (!within(await realpath(root), cli) || !/^#!.*\bnode\b/.test(await readText(cli, 2 * 1024 * 1024))) {
    throw new Error(`${name} tool CLI is not a verified Node entry`);
  }
  return { command: process.execPath, args: [cli] };
}

function officialNpmShim() {
  return ":: Created by npm, please don't edit manually.\n@ECHO OFF\n\nSETLOCAL\n\n" +
    'SET "NODE_EXE=%~dp0\\node.exe"\nIF NOT EXIST "%NODE_EXE%" (\n  SET "NODE_EXE=node"\n)\n\n' +
    'SET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"\n' +
    'SET "NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js"\n' +
    'FOR /F "delims=" %%F IN (\'CALL "%NODE_EXE%" "%NPM_PREFIX_JS%"\') DO (\n' +
    '  SET "NPM_PREFIX_NPM_CLI_JS=%%F\\node_modules\\npm\\bin\\npm-cli.js"\n)\n' +
    'IF EXIST "%NPM_PREFIX_NPM_CLI_JS%" (\n  SET "NPM_CLI_JS=%NPM_PREFIX_NPM_CLI_JS%"\n)\n\n' +
    '"%NODE_EXE%" "%NPM_CLI_JS%" %*\n';
}

async function fromCandidate(candidate, name, platform) {
  if (platform === 'win32') {
    const root = join(dirname(candidate), 'node_modules', name);
    const tool = await validateCli(root, name);
    const text = (await readText(candidate, 16 * 1024)).replaceAll('\r\n', '\n');
    if (name === 'npm' && text === officialNpmShim()) return tool;
    await assertBinTarget(candidate, tool.args[0], platform);
    return tool;
  }
  const cli = await realpath(candidate);
  let parent = dirname(cli);
  while (dirname(parent) !== parent) {
    if (await exists(join(parent, 'package.json'))) {
      const tool = await validateCli(parent, name);
      if (!samePath(tool.args[0], cli)) throw new Error(`unknown ${name} wrapper`);
      return tool;
    }
    parent = dirname(parent);
  }
  throw new Error(`unknown ${name} wrapper; install a standard ${name} distribution`);
}

function searchPaths(options) {
  const nodeDir = dirname(options.nodePath ?? process.execPath);
  const env = options.env ?? process.env;
  return [nodeDir, ...(env.PATH ?? env.Path ?? '').split(delimiter)].filter(Boolean);
}

export async function resolveTool(name, options = {}) {
  if (!TOOL_ENTRIES[name]) throw new Error('unsupported update tool');
  const platform = options.platform ?? process.platform;
  const paths = searchPaths(options);
  for (const dir of paths) {
    const candidate = resolve(dir, platform === 'win32' ? `${name}.cmd` : name);
    if (await exists(candidate)) return fromCandidate(candidate, name, platform);
  }
  throw new Error(`${name} is unavailable; install it manually before updating`);
}
