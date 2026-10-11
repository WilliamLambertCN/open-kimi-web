import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { auditPtyBuild, auditPtyFile } from '../../../scripts/install/ptyAudit.mjs';

const roots = [];
async function fixture(local = true) {
  const home = await mkdtemp(join(tmpdir(), 'okw-pty-audit-'));
  roots.push(home);
  const root = join(home, 'official');
  await mkdir(root);
  const dependencies = join(local ? root : home, 'node_modules');
  for (const name of ['node-pty', 'node-addon-api']) {
    const target = join(dependencies, name);
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'package.json'), JSON.stringify({ name, version: '1.1.0' }));
  }
  return { root };
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('pinned PTY build-source audit', () => {
  it('rejects a forged local manifest even when names resolve correctly', async () => {
    const paths = await fixture();
    await expect(auditPtyBuild(paths)).rejects.toThrow('audited PTY build file changed: node-pty/package.json');
  });

  it('rejects a dependency resolved above the dedicated official root', async () => {
    const paths = await fixture(false);
    await expect(auditPtyBuild(paths)).rejects.toThrow('escapes official package');
  });

  it('rejects changed, missing or non-regular noexcept.gypi before GYP execution', async () => {
    const { root } = await fixture();
    const file = 'noexcept.gypi';
    const expected = createHash('sha256').update('approved fixture').digest('hex');
    const audit = () => auditPtyFile(root, file, expected, 'node-addon-api');
    await expect(audit()).rejects.toThrow('node-addon-api/noexcept.gypi');
    await writeFile(join(root, file), '{"variables":{"marker":"<!(echo unapproved)"}}');
    await expect(audit()).rejects.toThrow('node-addon-api/noexcept.gypi');
    await rm(join(root, file));
    await mkdir(join(root, file));
    await expect(audit()).rejects.toThrow('node-addon-api/noexcept.gypi');
  });

  it('rejects a linked noexcept.gypi path', async () => {
    const { root } = await fixture();
    const target = join(root, 'approved.gypi');
    const file = join(root, 'noexcept.gypi');
    await mkdir(target);
    await symlink(target, file, process.platform === 'win32' ? 'junction' : 'dir');
    const expected = createHash('sha256').update('approved fixture').digest('hex');
    await expect(auditPtyFile(root, 'noexcept.gypi', expected, 'node-addon-api'))
      .rejects.toThrow('node-addon-api/noexcept.gypi');
  });
});
