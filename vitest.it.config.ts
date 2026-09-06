import { defineConfig } from 'vitest/config';

import { sharedCoverage } from './vitest.ut.config';

export default defineConfig({
  test: {
    name: 'it',
    environment: 'node',
    include: ['tests/it/**/*.it.test.ts', 'tests/it/**/*.it.test.mjs'],
    coverage: {
      ...sharedCoverage,
      include: ['packages/launcher/src/**/*.mjs'],
      // Pure CLI/bootstrap helpers are owned by focused unit tests.
      // cli.mjs stays excluded repo-wide as entry glue.
      // The integrate install/status machinery is likewise UT-owned (temp-HOME
      // mocks); IT covers the supervisor/delegate runtime paths instead.
      exclude: [
        ...sharedCoverage.exclude,
        'packages/launcher/src/args.mjs',
        'packages/launcher/src/launchLinks.mjs',
        'packages/launcher/src/launchToken.mjs',
        'packages/launcher/src/integration/browserOpen.mjs',
        'packages/launcher/src/integration/integrate.mjs',
        'packages/launcher/src/integration/integrateMain.mjs',
        'packages/launcher/src/integration/lock.mjs',
        'packages/launcher/src/integration/pathInstall.mjs',
        'packages/launcher/src/integration/proc.mjs',
        'packages/launcher/src/integration/realKimi.mjs',
        'packages/launcher/src/integration/state.mjs',
        'packages/launcher/src/integration/status.mjs',
        'packages/launcher/src/integration/wrapperGen.mjs',
      ],
    },
  },
});
