import tseslint from 'typescript-eslint';

const complexityRules = {
  'max-lines-per-function': [
    'error',
    { max: 80, skipBlankLines: true, skipComments: true },
  ],
  complexity: ['error', 10],
  'max-depth': ['error', 4],
  'max-params': ['error', 5],
  // Whole-file budget: physical lines, blanks and comments included.
  'max-lines': ['error', { max: 500, skipBlankLines: false, skipComments: false }],
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '.cache/**',
      'contracts/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,cts,js,mjs,cjs}'],
    rules: complexityRules,
  },
  {
    files: ['**/*.test.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
