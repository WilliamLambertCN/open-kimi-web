import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'windowsTreeCleanup.cs'), 'utf8');
const creationWindows = new WeakMap();

export function recordProcessStart(child, startedAt) {
  creationWindows.set(child, [startedAt, Date.now() + 1]);
}

function fileTime(milliseconds) {
  return (BigInt(milliseconds) + 11644473600000n) * 10000n;
}

function cleanupCommand(child) {
  const span = creationWindows.get(child);
  if (!span) throw new Error('parent creation time unavailable; descendants unconfirmed');
  return `$ErrorActionPreference='Stop'; Add-Type -TypeDefinition @'\n${source}\n'@; ` +
    `[OkwWindowsTreeCleanup]::Stop(${child.pid},[long]${fileTime(span[0])},[long]${fileTime(span[1])});`;
}

export function stopWindowsTree(child, options) {
  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error('parent already exited; refusing cleanup of an exited or reusable PID; descendants unconfirmed');
  }
  const encoded = Buffer.from(cleanupCommand(child), 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const executable = join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const killer = (options.spawn ?? spawn)(executable,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
      });
    let stderr = '';
    killer.stderr?.on('data', (chunk) => { stderr = (stderr + chunk.toString('utf8')).slice(0, 2_000); });
    const timer = setTimeout(() => {
      killer.kill();
      reject(new Error('native Windows cleanup timed out; child-tree cleanup could not be verified'));
    }, 3_000);
    killer.on('error', (error) => { clearTimeout(timer); reject(error); });
    killer.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`native Windows cleanup failed (${code}); child-tree cleanup unconfirmed: ${stderr.trim()}`));
    });
  });
}
