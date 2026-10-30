import { open, readFile, realpath } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { pathStat } from './npm.mjs';
import { pythonConsoleEntry } from './officialPython.mjs';

export function canonicalNpmCmd() {
  const target = '%dp0%\\node_modules\\@moonshot-ai\\kimi-code\\dist\\main.mjs';
  return '@ECHO off\nGOTO start\n:find_dp0\nSET dp0=%~dp0\nEXIT /b\n:start\nSETLOCAL\nCALL :find_dp0\n\n' +
    'IF EXIST "%dp0%\\node.exe" (\n  SET "_prog=%dp0%\\node.exe"\n) ELSE (\n  SET "_prog=node"\n' +
    '  SET PATHEXT=%PATHEXT:;.JS;=;%\n)\n\n' +
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "${target}" %*\n`;
}

export function canonicalNpmPs1() {
  const target = '$basedir/node_modules/@moonshot-ai/kimi-code/dist/main.mjs';
  return '#!/usr/bin/env pwsh\n$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent\n\n' +
    '$exe=""\nif ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {\n' +
    '  # Fix case when both the Windows and Linux builds of Node\n  # are installed in the same directory\n' +
    '  $exe=".exe"\n}\n$ret=0\nif (Test-Path "$basedir/node$exe") {\n  # Support pipeline input\n' +
    `  if ($MyInvocation.ExpectingInput) {\n    $input | & "$basedir/node$exe"  "${target}" $args\n` +
    `  } else {\n    & "$basedir/node$exe"  "${target}" $args\n  }\n  $ret=$LASTEXITCODE\n} else {\n` +
    `  # Support pipeline input\n  if ($MyInvocation.ExpectingInput) {\n    $input | & "node$exe"  "${target}" $args\n` +
    `  } else {\n    & "node$exe"  "${target}" $args\n  }\n  $ret=$LASTEXITCODE\n}\nexit $ret\n`;
}

export function canonicalNpmSh() {
  const target = '$basedir/node_modules/@moonshot-ai/kimi-code/dist/main.mjs';
  return '#!/bin/sh\nbasedir=$(dirname "$(echo "$0" | sed -e \'s,\\\\,/,g\')")\n\n' +
    'case `uname` in\n    *CYGWIN*|*MINGW*|*MSYS*)\n        if command -v cygpath > /dev/null 2>&1; then\n' +
    '            basedir=`cygpath -w "$basedir"`\n        fi\n    ;;\nesac\n\n' +
    `if [ -x "$basedir/node" ]; then\n  exec "$basedir/node"  "${target}" "$@"\nelse \n` +
    `  exec node  "${target}" "$@"\nfi\n`;
}

async function windowsEntry(candidate) {
  const stat = await pathStat(candidate);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > 16384) {
    throw new Error('official npm shim is unsafe or unsupported; set OPEN_KIMI_REAL_KIMI');
  }
  const shell = !/\.[^/\\]+$/.test(candidate);
  const expected = shell ? canonicalNpmSh() : /\.ps1$/i.test(candidate) ? canonicalNpmPs1() : canonicalNpmCmd();
  const text = (await readFile(candidate, 'utf8')).replaceAll('\r\n', '\n');
  if (!shell && !/\.(cmd|ps1)$/i.test(candidate) || text !== expected) {
    throw new Error('official npm shim does not match the standard kimi npm target; set OPEN_KIMI_REAL_KIMI');
  }
  return join(dirname(candidate), 'node_modules/@moonshot-ai/kimi-code/dist/main.mjs');
}

async function assertNative(target, platform) {
  const file = await open(target, 'r');
  const buffer = Buffer.alloc(4);
  try { await file.read(buffer, 0, 4, 0); } finally { await file.close(); }
  const magic = buffer.toString('hex');
  const supported = platform === 'win32' ? magic.startsWith('4d5a') :
    ['7f454c46', 'feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca'].includes(magic);
  if (supported || platform !== 'win32' && await pythonConsoleEntry(target)) return;
  throw new Error('unsupported official shell shim or wrapper; use a native executable, standard npm entry or ' +
    'supported Python console entry; OPEN_KIMI_REAL_KIMI does not bypass identity checks');
}

export async function officialEntry(candidate, ctx) {
  if (ctx.platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(candidate)) return windowsEntry(candidate);
  const target = await realpath(candidate);
  if (ctx.platform !== 'win32' && target.endsWith(`${sep}dist${sep}main.mjs`)) return target;
  if (ctx.platform === 'win32' && !target.toLowerCase().endsWith('.exe')) return windowsEntry(candidate);
  await assertNative(target, ctx.platform);
  return null;
}

export async function runtimeCandidate(candidate, ctx) {
  if (ctx.platform !== 'win32' || /\.(exe|cmd|bat)$/i.test(candidate)) return candidate;
  await windowsEntry(candidate);
  const cmd = join(dirname(candidate), 'kimi.cmd');
  if (!await pathStat(cmd)) {
    throw new Error('standard npm shim has no runtime kimi.cmd; ' +
      'set OPEN_KIMI_REAL_KIMI to a native executable or standard kimi.cmd');
  }
  await windowsEntry(cmd);
  return cmd;
}
