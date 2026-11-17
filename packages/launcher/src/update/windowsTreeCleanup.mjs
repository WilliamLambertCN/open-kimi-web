import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = join(dirname(fileURLToPath(import.meta.url)), 'windowsTreeCleanup.cs');
const creationWindows = new WeakMap();

export function recordProcessStart(child, startedAt) {
  creationWindows.set(child, [startedAt, Date.now() + 1]);
}

function fileTime(milliseconds) {
  return String((BigInt(milliseconds) + 11644473600000n) * 10000n);
}

const timedOut = () => new Error('native Windows cleanup timed out; child-tree cleanup could not be verified');

function runNative(command, args, options, deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw timedOut();
  return new Promise((resolve, reject) => {
    const child = (options.spawn ?? spawn)(command, args, {
      shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const capture = (chunk) => { output = (output + chunk.toString('utf8')).slice(0, 2_000); };
    child.stdout?.on('data', capture); child.stderr?.on('data', capture);
    let expired = false;
    const timer = setTimeout(() => { expired = true; child.kill(); }, remaining);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (expired) reject(timedOut());
      else if (code === 0) resolve();
      else reject(new Error(`native Windows cleanup failed (${code}); child-tree cleanup unconfirmed: ${output.trim()}`));
    });
  });
}

async function compilerDirectory(io) {
  const root = process.env.SystemRoot || 'C:/Windows';
  for (const framework of ['Framework64', 'Framework']) {
    const path = join(root, 'Microsoft.NET', framework, 'v4.0.30319');
    try { await io.access(join(path, 'csc.exe')); return path; } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error('Windows .NET Framework compiler unavailable; descendants unconfirmed');
}

export async function stopWindowsTree(child, options) {
  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error('parent already exited; refusing cleanup of an exited or reusable PID; descendants unconfirmed');
  }
  const span = creationWindows.get(child);
  if (!span) throw new Error('parent creation time unavailable; descendants unconfirmed');
  const deadline = Date.now() + 3_000;
  const io = options.fs ?? fs;
  const compiler = await compilerDirectory(io);
  const directory = await io.mkdtemp(join(tmpdir(), 'okw-native-cleanup-'));
  try {
    const input = join(directory, 'cleanup.cs');
    const executable = join(directory, 'cleanup.exe');
    await io.copyFile(source, input);
    await runNative(join(compiler, 'csc.exe'), ['/nologo', '/noconfig', '/target:exe', `/out:${executable}`,
      `/reference:${join(compiler, 'System.dll')}`, input], options, deadline);
    await runNative(executable, [String(child.pid), fileTime(span[0]), fileTime(span[1])], options, deadline);
  } finally { await io.rm(directory, { recursive: true, force: true }); }
}
