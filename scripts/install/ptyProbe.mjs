import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function probePty(root, shell, windows = process.platform === 'win32') {
  let pty;
  try { pty = createRequire(join(root, 'package.json'))('node-pty'); }
  catch (error) {
    return { status: /Cannot find module|Failed to load native module/.test(error.message) ? 'missing' : 'failed' };
  }
  return new Promise((done) => {
    let child;
    let output = '';
    let timer;
    let stopping = false;
    const finish = (status) => { clearTimeout(timer); done({ status }); };
    const fail = () => {
      if (!child) return finish('failed');
      stopping = true;
      clearTimeout(timer);
      timer = setTimeout(() => finish('unconfirmed'), 2000);
      try { child.kill(); } catch {}
    };
    try {
      const args = windows ? ['--noprofile', '--norc', '-c', 'printf open-kimi-pty-ok'] : ['-c', 'printf open-kimi-pty-ok'];
      child = pty.spawn(shell, args, { name: 'xterm', cols: 80, rows: 24, cwd: root, env: process.env });
      child.onExit(({ exitCode }) => {
        finish(!stopping && exitCode === 0 && output.includes('open-kimi-pty-ok') ? 'ok' : 'failed');
      });
      child.onData((chunk) => { if (output.length < 4096) output += chunk; });
      timer = setTimeout(fail, 10000);
    } catch { fail(); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await probePty(process.argv[2], process.argv[3], process.argv[4] === 'win32')));
  process.exit(0);
}
