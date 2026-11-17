import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { readWindowsUserPath } from '../../packages/launcher/src/integration/pathInstall.mjs';
import { runCapture } from '../../packages/launcher/src/integration/proc.mjs';

const isWindows = process.platform === 'win32';
let valueName;

async function removeProbe() {
  if (valueName === undefined) return;
  await runCapture('reg.exe', ['delete', 'HKCU\\Environment', '/v', valueName, '/f']);
  valueName = undefined;
}

afterEach(removeProbe);

describe.skipIf(!isWindows)('Windows PATH registry reader', () => {
  it('preserves UTF-8 text and unexpanded environment references', async (context) => {
    valueName = `OPEN_KIMI_WEB_TEST_${randomUUID().replaceAll('-', '')}`;
    const expected = 'C:\\用户目录\\工具;%SystemRoot%\\System32';
    const written = await runCapture('reg.exe', ['add', 'HKCU\\Environment', '/v', valueName,
      '/t', 'REG_EXPAND_SZ', '/d', expected, '/f']);
    if (written.code !== 0 && /access is denied/i.test(written.stderr)) {
      context.skip();
      return;
    }
    expect(written.code, written.stderr).toBe(0);
    await expect(readWindowsUserPath(runCapture, valueName)).resolves.toBe(expected);
  });
});
