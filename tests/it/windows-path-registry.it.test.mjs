import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { readWindowsUserPath } from '../../packages/launcher/src/integration/pathInstall.mjs';
import { runCapture } from '../../packages/launcher/src/integration/proc.mjs';

const isWindows = process.platform === 'win32';
let valueName;

async function removeProbe() {
  if (valueName === undefined) return;
  const script =
    "Remove-ItemProperty -Path 'HKCU:\\Environment' -Name $env:OPEN_KIMI_WEB_PATH_NAME " +
    '-ErrorAction SilentlyContinue';
  await runCapture('powershell', ['-NoProfile', '-Command', script], {
    env: { ...process.env, OPEN_KIMI_WEB_PATH_NAME: valueName },
  });
  valueName = undefined;
}

afterEach(removeProbe);

describe.skipIf(!isWindows)('Windows PATH registry reader', () => {
  it('preserves UTF-8 text and unexpanded environment references', async (context) => {
    valueName = `OPEN_KIMI_WEB_TEST_${randomUUID().replaceAll('-', '')}`;
    const expected = 'C:\\用户目录\\工具;%SystemRoot%\\System32';
    const script =
      "New-ItemProperty -Path 'HKCU:\\Environment' -Name $env:OPEN_KIMI_WEB_PATH_NAME " +
      '-Value $env:OPEN_KIMI_WEB_PATH_VALUE -PropertyType ExpandString -Force | Out-Null';
    const written = await runCapture('powershell', ['-NoProfile', '-Command', script], {
      env: {
        ...process.env,
        OPEN_KIMI_WEB_PATH_NAME: valueName,
        OPEN_KIMI_WEB_PATH_VALUE: expected,
      },
    });
    if (written.code !== 0 && /registry access is not allowed/i.test(written.stderr)) {
      context.skip();
      return;
    }
    expect(written.code, written.stderr).toBe(0);
    await expect(readWindowsUserPath(runCapture, valueName)).resolves.toBe(expected);
  });
});
