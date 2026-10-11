import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureGitBash } from '../../scripts/install/gitBash.mjs';
import { runInstallProcess } from '../../scripts/install.mjs';
import { installGitBashScenarios } from '../testkit/installGitBash.mjs';

installGitBashScenarios();

describe.skipIf(process.platform !== 'win32')('native Windows Git Bash reuse', () => {
  it('probes an existing Git without reading isolated shell startup files or writing registry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'okw-native-git-'));
    try {
      const env = { ...process.env, HOME: root, USERPROFILE: root, KIMI_SHELL_PATH: '',
        BASH_ENV: join(root, 'forbidden-startup') };
      await writeFile(env.BASH_ENV, 'echo startup-must-not-run; exit 89\n');
      await writeFile(join(root, '.bashrc'), 'echo startup-must-not-run; exit 89\n');
      const ctx = { platform: 'win32', home: join(root, 'install'), env, run: runInstallProcess,
        gitBashDownload: async () => {
          throw new Error('Native QA needs an existing Git Bash; downloads are not authorized here');
        } };
      const found = await ensureGitBash(ctx);
      expect(found.kind).toBe('existing');
      expect(env.KIMI_SHELL_PATH).toBe(found.shellPath);
      const output = await runInstallProcess(found.shellPath, ['--noprofile', '--norc', '-c',
        'printf "%s\\n" "$BASH_VERSION"; /usr/bin/cygpath -w /'], {
        env: { ...env, BASH_ENV: '' }, timeoutMs: 10_000,
      });
      expect(output).not.toContain('startup-must-not-run');
      expect(output).toMatch(/\d+\.\d+\.\d+/);
      expect(ctx.gitBashPathDirectories).toEqual([found.pathDirectory]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
