// Best-effort browser opening for the supervised `kimi web` replacement.
// Failures are deliberately silent-ish: a warning line, never an error.
import { spawn } from 'node:child_process';

function openCommand(platform, url) {
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '""', url] };
  if (platform === 'darwin') return { cmd: 'open', args: [url] };
  return { cmd: 'xdg-open', args: [url] };
}

/** Fire-and-forget; resolves false (and warns via `warn`) on failure. */
export function openUrl(url, options = {}) {
  const platform = options.platform ?? process.platform;
  const spawnImpl = options.spawn ?? spawn;
  const warn = options.warn ?? ((line) => console.error(line));
  const { cmd, args } = openCommand(platform, url);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(cmd, args, { stdio: 'ignore', detached: true, shell: false });
    } catch {
      warn(`open-kimi-web: could not open a browser; open ${url} yourself`);
      resolve(false);
      return;
    }
    child.on('error', () => {
      warn(`open-kimi-web: could not open a browser; open ${url} yourself`);
      resolve(false);
    });
    child.on('exit', (code) => resolve(code === 0));
    child.unref?.();
  });
}
