import { realpath } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { readText, samePath } from './files.mjs';

export function npmCmdShim(target) {
  const path = target.replaceAll('/', '\\');
  return '@ECHO off\nGOTO start\n:find_dp0\nSET dp0=%~dp0\nEXIT /b\n:start\nSETLOCAL\nCALL :find_dp0\n' +
    '\nIF EXIST "%dp0%\\node.exe" (\n  SET "_prog=%dp0%\\node.exe"\n) ELSE (\n' +
    '  SET "_prog=node"\n  SET PATHEXT=%PATHEXT:;.JS;=;%\n)\n\n' +
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${path}" %*\n`;
}

function corepackCmdShim(target) {
  const path = target.replaceAll('/', '\\');
  return '@SETLOCAL\n@IF EXIST "%~dp0\\node.exe" (\n' +
    `  "%~dp0\\node.exe"  "%~dp0\\${path}" %*\n) ELSE (\n` +
    `  @SET PATHEXT=%PATHEXT:;.JS;=;%\n  node  "%~dp0\\${path}" %*\n)\n`;
}

export async function assertBinTarget(bin, entry, platform = process.platform) {
  if (platform !== 'win32') {
    if (!samePath(await realpath(bin), entry, platform)) throw new Error('installation bin target does not match itself');
    return;
  }
  const target = relative(dirname(bin), entry).replaceAll('\\', '/');
  const text = (await readText(bin, 16 * 1024)).replaceAll('\r\n', '\n');
  if (text !== npmCmdShim(target) && text !== corepackCmdShim(target)) {
    throw new Error('unknown Windows bin shim; manual installation required');
  }
  if (!samePath(await realpath(resolve(dirname(bin), target)), entry, platform)) {
    throw new Error('installation bin target does not match itself');
  }
}
