// Proves the five quality gates in eslint.config.mjs actually bite:
// an 81-line function, cyclomatic complexity 11, nesting depth 5, a
// 6-parameter function, and a 501-line file must each fail lint, while the
// boundary-valid shapes (80 lines / 10 / 4 / 5 params / 500 lines) must not.
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replaceAll('\\', '/');
const PROBE = `${ROOT}tests/__lint_probe__.ts`;

async function lintedRuleIds(code: string): Promise<Set<string>> {
  const eslint = new ESLint({ cwd: ROOT });
  const [result] = await eslint.lintText(code, { filePath: PROBE });
  return new Set((result?.messages ?? []).map((m) => m.ruleId).filter(Boolean) as string[]);
}

function counterFunction(bodyLines: number): string {
  const lines = ['export function counted(): number {', '  let mark = 0;'];
  for (let i = 0; i < bodyLines; i += 1) lines.push(`  mark += ${i};`);
  lines.push('  return mark;', '}');
  return lines.join('\n');
}

function branchyFunction(ifCount: number): string {
  const lines = ['export function branchy(v: number): number {', '  let r = 0;'];
  for (let i = 0; i < ifCount; i += 1) lines.push(`  if (v === ${i}) r += 1;`);
  lines.push('  return r;', '}');
  return lines.join('\n');
}

function nestedFunction(depth: number): string {
  const open = [];
  for (let i = 1; i <= depth; i += 1) open.push(`${'  '.repeat(i)}if (v > ${i}) {`);
  const close = [];
  for (let i = depth; i >= 1; i -= 1) close.push(`${'  '.repeat(i)}}`);
  return [
    'export function deep(v: number): number {',
    '  let r = 0;',
    ...open,
    `${'  '.repeat(depth + 1)}r = ${depth};`,
    ...close,
    '  return r;',
    '}',
  ].join('\n');
}

function paramFunction(paramCount: number): string {
  const params = Array.from({ length: paramCount }, (_, i) => `p${i}: number`).join(', ');
  return ['export function wide(' + params + '): number {', '  return p0;', '}'].join('\n');
}

// max-lines counts physical lines, so the filler mixes blank and comment
// lines in: with skipBlankLines/skipComments the file would slip under the
// bar; the gate must still fire.
function longFile(totalLines: number, header = ''): string {
  const lines = header === '' ? [] : header.split('\n');
  while (lines.length < totalLines) {
    lines.push('// filler comment', '', `export const filler${lines.length} = 0;`);
  }
  return lines.slice(0, totalLines).join('\n');
}

// Loading ESLint and its plugins can take longer on a cold Windows filesystem.
describe('complexity lint gates', { timeout: 30_000 }, () => {
  it('rejects a function over 80 lines, accepts 80', async () => {
    // bodyLines=79 → 82 total lines (signature + let + body + return + brace) → over 80
    expect(await lintedRuleIds(counterFunction(79))).toContain('max-lines-per-function');
    expect(await lintedRuleIds(counterFunction(76))).not.toContain('max-lines-per-function');
  });

  it('rejects cyclomatic complexity 11, accepts 10', async () => {
    expect(await lintedRuleIds(branchyFunction(10))).toContain('complexity');
    expect(await lintedRuleIds(branchyFunction(9))).not.toContain('complexity');
  });

  it('rejects nesting depth 5, accepts 4', async () => {
    expect(await lintedRuleIds(nestedFunction(5))).toContain('max-depth');
    expect(await lintedRuleIds(nestedFunction(4))).not.toContain('max-depth');
  });

  it('rejects a 6-parameter function, accepts 5', async () => {
    expect(await lintedRuleIds(paramFunction(6))).toContain('max-params');
    expect(await lintedRuleIds(paramFunction(5))).not.toContain('max-params');
  });

  it('rejects a 501-line file counting blanks/comments, accepts 500', async () => {
    expect(await lintedRuleIds(longFile(501))).toContain('max-lines');
    expect(await lintedRuleIds(longFile(500))).not.toContain('max-lines');
  });

});
