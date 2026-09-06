// cli.mjs is process entry glue and excluded from coverage thresholds, but
// the --version precheck that skills/open-kimi-web/SKILL.md relies on is
// worth a direct assertion: the flag must print the package version without
// falling through to parseArgs (which would exit 2 as an unknown command).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { run } from '../src/cli.mjs';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
);
const argv = (...args) => ['node', 'open-kimi-web', ...args];

describe('cli --version', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it.each(['--version', '-v'])('prints the package version for %s', async (flag) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await run(argv(flag));
    expect(log).toHaveBeenCalledWith(pkg.version);
    expect(err).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });
});
