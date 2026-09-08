import { describe, expect, it } from 'vitest';

import {
  launcherDependencyMessage,
  missingLauncherDependencies,
} from '../src/launcherDependencies.mjs';

describe('launcher dependency diagnostics', () => {
  it('reports only packages that are actually missing', async () => {
    const missing = await missingLauncherDependencies(async (name) => {
      if (name === 'selfsigned') {
        throw Object.assign(new Error('not installed'), { code: 'MODULE_NOT_FOUND' });
      }
      return {};
    });

    expect(missing).toEqual(['selfsigned']);
    expect(launcherDependencyMessage(missing)).toMatch(
      /missing: selfsigned[\s\S]*corepack pnpm install --frozen-lockfile/,
    );
  });

  it('does not misreport a package that failed to load for another reason', async () => {
    await expect(missingLauncherDependencies(async () => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    })).rejects.toThrow('permission denied');
  });
});
