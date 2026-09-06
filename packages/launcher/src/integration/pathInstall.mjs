// PATH installation for the wrapper. Unix: a uniquely marked block in the
// user's shell rc (updated in place, never duplicated). Windows: prepend the
// wrapper bin dir to the *User* PATH only, via powershell, touching entries
// that match exactly. All side effects go through small injectable seams so
// tests run entirely in a temporary HOME / against a mock runner.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { runCapture } from './proc.mjs';

export const RC_MARKER_START = '# >>> open-kimi-web >>>';
export const RC_MARKER_END = '# <<< open-kimi-web <<<';

const RC_CANDIDATES = ['.bashrc', '.zshrc', '.profile'];

export function renderRcBlock(binDir) {
  return `${RC_MARKER_START}\nexport PATH="${binDir}:$PATH"\n${RC_MARKER_END}\n`;
}

/** Insert or replace the marker block. Idempotent. */
export function upsertRcBlock(content, binDir) {
  const block = renderRcBlock(binDir);
  const pattern = new RegExp(
    `${escapeRegExp(RC_MARKER_START)}[\\s\\S]*?${escapeRegExp(RC_MARKER_END)}\\n?`,
  );
  if (pattern.test(content)) return content.replace(pattern, block);
  const separator = content === '' || content.endsWith('\n') ? '' : '\n';
  return `${content}${separator}${block}`;
}

/** Remove exactly the marker block; returns null when nothing was present. */
export function removeRcBlock(content) {
  const pattern = new RegExp(
    `${escapeRegExp(RC_MARKER_START)}[\\s\\S]*?${escapeRegExp(RC_MARKER_END)}\\n?`,
  );
  if (!pattern.test(content)) return null;
  return content.replace(pattern, '');
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** First existing rc file wins; when none exist, fall back to ~/.profile. */
export async function pickRcFile(homeDir, read = readFile) {
  for (const name of RC_CANDIDATES) {
    const file = join(homeDir, name);
    try {
      const content = await read(file, 'utf8');
      return { file, content };
    } catch {
      // try the next candidate
    }
  }
  return { file: join(homeDir, '.profile'), content: '' };
}

export async function installRcBlock(homeDir, binDir) {
  const { file, content } = await pickRcFile(homeDir);
  const next = upsertRcBlock(content, binDir);
  if (next !== content) await writeFile(file, next, 'utf8');
  return { file, changed: next !== content };
}

/** Removes the block from every rc file that has it; returns touched files. */
export async function removeRcBlocks(homeDir) {
  const touched = [];
  for (const name of RC_CANDIDATES) {
    const file = join(homeDir, name);
    let content;
    try {
      content = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    const next = removeRcBlock(content);
    if (next !== null) {
      await writeFile(file, next, 'utf8');
      touched.push(file);
    }
  }
  return touched;
}

/* ---------------- Windows User PATH (pure logic + powershell seam) ------- */

export function splitWindowsPath(value) {
  return (value ?? '').split(';').filter((entry) => entry.trim() !== '');
}

function normalizedWindowsPathEntry(entry) {
  const trimmed = entry.trim();
  const withoutTrailingSlashes = trimmed.replace(/\\+$/, '');
  return (/^[a-z]:$/i.test(withoutTrailingSlashes)
    ? `${withoutTrailingSlashes}\\`
    : withoutTrailingSlashes
  ).toLowerCase();
}

export function windowsPathHasEntry(value, entry) {
  const wanted = normalizedWindowsPathEntry(entry);
  return splitWindowsPath(value).some(
    (existing) => normalizedWindowsPathEntry(existing) === wanted,
  );
}

/** Prepend `entry`, dropping any pre-existing exact (case-insensitive)
 *  duplicates first. */
export function prependWindowsPath(value, entry) {
  const wanted = normalizedWindowsPathEntry(entry);
  const kept = splitWindowsPath(value).filter(
    (existing) => normalizedWindowsPathEntry(existing) !== wanted,
  );
  return [entry, ...kept].join(';');
}

/** Remove exact matches only; returns null when nothing matched. */
export function removeWindowsPathEntry(value, entry) {
  const wanted = normalizedWindowsPathEntry(entry);
  const kept = splitWindowsPath(value).filter(
    (existing) => normalizedWindowsPathEntry(existing) !== wanted,
  );
  if (kept.length === splitWindowsPath(value).length) return null;
  return kept.join(';');
}

const READ_USER_PATH_PS =
  "$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.Encoding]::UTF8;" +
  "$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment');" +
  'if($null-ne $k){try{' +
  '$v=$k.GetValue($env:OPEN_KIMI_WEB_PATH_NAME,$null,' +
  '[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);' +
  'if($null-ne $v){[Console]::Write([string]$v)}' +
  '}finally{$k.Dispose()}}';
const READ_SYSTEM_PATH_PS =
  "$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.Encoding]::UTF8;" +
  '$k=[Microsoft.Win32.Registry]::LocalMachine.OpenSubKey(' +
  "'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment');" +
  'if($null-ne $k){try{' +
  '$v=$k.GetValue($env:OPEN_KIMI_WEB_PATH_NAME,$null,' +
  '[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);' +
  'if($null-ne $v){[Console]::Write([string]$v)}' +
  '}finally{$k.Dispose()}}';
// Write the registry value directly and notify via SendMessageTimeout with
// SMTO_ABORTIFHUNG. [Environment]::SetEnvironmentVariable(...,'User') also
// broadcasts WM_SETTINGCHANGE but can block for seconds on an unresponsive
// top-level window; here the broadcast is bounded and cannot hang install.
const WRITE_USER_PATH_PS =
  "$ErrorActionPreference='Stop';$k='HKCU:\\Environment';" +
  'if(-not (Test-Path $k)){New-Item -Path $k | Out-Null};' +
  "$t='ExpandString';try{$t=(Get-Item $k).GetValueKind('PATH')}catch{};" +
  "Set-ItemProperty -Path $k -Name 'PATH' -Value $env:OPEN_KIMI_WEB_PATH_VALUE -Type $t;" +
  'try{Add-Type -Namespace OkwPath -Name U32 -MemberDefinition ' +
  '\'[DllImport("user32.dll")] public static extern System.IntPtr SendMessageTimeout(' +
  'System.IntPtr h,uint m,System.IntPtr w,string l,uint f,uint t,out System.IntPtr r);\';' +
  '$r=[System.IntPtr]::Zero;' +
  '[OkwPath.U32]::SendMessageTimeout([System.IntPtr]0xffff,0x1A,[System.IntPtr]::Zero,' +
  "'Environment',2,1000,[ref]$r) | Out-Null}catch{}";
const WRITE_USER_PATH_TIMEOUT_MS = 15_000; // Add-Type compiles on first use.

async function readWindowsPath(script, label, run, valueName) {
  const result = await run('powershell', ['-NoProfile', '-Command', script], {
    env: { ...process.env, OPEN_KIMI_WEB_PATH_NAME: valueName },
  });
  if (result.code !== 0) {
    throw new Error(`powershell failed to read the ${label} PATH: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

export function readWindowsUserPath(run = runCapture, valueName = 'PATH') {
  return readWindowsPath(READ_USER_PATH_PS, 'user', run, valueName);
}

export function readWindowsSystemPath(run = runCapture) {
  return readWindowsPath(READ_SYSTEM_PATH_PS, 'system', run, 'PATH');
}

export async function writeWindowsUserPath(value, run = runCapture) {
  const result = await run('powershell', ['-NoProfile', '-Command', WRITE_USER_PATH_PS], {
    env: { ...process.env, OPEN_KIMI_WEB_PATH_VALUE: value },
    timeoutMs: WRITE_USER_PATH_TIMEOUT_MS,
  });
  if (result.code !== 0) {
    throw new Error(`powershell failed to write the user PATH: ${result.stderr.trim()}`);
  }
}
