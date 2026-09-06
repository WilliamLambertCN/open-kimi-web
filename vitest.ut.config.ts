import { defineConfig } from 'vitest/config';

const coverageInclude = [
  'packages/launcher/src/**/*.mjs',
];

const coverageExclude = [
  '**/*.test.ts',
  '**/*.test.mjs',
  '**/*.d.ts',
  // Launcher process entry glue is exercised by focused CLI tests and pack smoke.
  'packages/launcher/src/cli.mjs',
  // Test doubles shared by unit/integration suites (not shipped code).
  '**/testkit/**',
];

export const sharedCoverage = {
  provider: 'v8' as const,
  include: coverageInclude,
  exclude: coverageExclude,
  thresholds: {
    branches: 60,
  },
};

export default defineConfig({
  test: {
    name: 'ut',
    environment: 'node',
    include: [
      'packages/launcher/tests/**/*.test.mjs',
      'tests/lint/**/*.test.ts',
    ],
    coverage: sharedCoverage,
  },
});
