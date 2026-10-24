import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { parseCronExpression, nextCronRun } from '../src/cron/expression.mjs';
import { validateCronInit, validateCronSchedule, strictRecord } from '../src/cron/validation.mjs';

const local = (year, month, day, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute).getTime();
const next = (cron, time) => nextCronRun(parseCronExpression(cron), time);
const init = (cron, recurring = true) => ({ cron, prompt: 'Fictional reminder', recurring });

function code(operation, expected) {
  try {
    operation();
    expect.fail(`Expected ${expected}`);
  } catch (error) {
    expect(error.code).toBe(expected);
  }
}

describe('strict scheduled-task input', () => {
  it('normalizes only cron whitespace and defaults recurring without changing prompt text', () => {
    expect(validateCronInit({ cron: ' \t7  9 * * 1-5\n', prompt: '  Fictional reminder\n' })).toEqual({
      cron: '7 9 * * 1-5', prompt: '  Fictional reminder\n', recurring: true,
    });
  });

  it.each([
    null, [], 'text', {}, { cron: '* * * * *' }, { prompt: 'Reminder' },
    { cron: '* * * * *', prompt: 'Reminder', recurring: undefined },
    { cron: '* * * * *', prompt: 'Reminder', recurring: 'false' },
    { cron: '* * * * *', prompt: 'Reminder', tags: {} },
    { cron: '* * * * *', prompt: 'Reminder', lastFiredAt: 1 },
    { cron: '* * * * *', prompt: 'Reminder', model: 'fixture' },
    { cron: '* * * * *', prompt: '' }, { cron: '* * * * *', prompt: ' \n\t' },
    { cron: '* * * * *', prompt: 7 }, { cron: '* * * * *', prompt: '\ud800' },
    { cron: '* * * * *', prompt: '\udc00' }, { cron: '* * * * *', prompt: '中'.repeat(2731) },
    { cron: '* * * * *', prompt: 'x'.repeat(8193) },
  ])('rejects invalid create input %#', (value) => {
    code(() => validateCronInit(value), 'invalid-input');
  });

  it('counts actual UTF-8 bytes and accepts well-formed supplementary Unicode at the exact limit', () => {
    const prompt = '😀'.repeat(2048);
    expect(Buffer.byteLength(prompt)).toBe(8192);
    expect(validateCronInit({ cron: '* * * * *', prompt }).prompt).toBe(prompt);
    code(() => validateCronInit({ cron: '* * * * *', prompt: prompt + 'x' }), 'invalid-input');
  });

  it('rejects accessor, hidden, inherited, symbol and prototype-bearing arguments', () => {
    let accessed = false;
    const getter = { get cron() { accessed = true; return '* * * * *'; }, prompt: 'Reminder' };
    const hidden = Object.defineProperty({ prompt: 'Reminder' }, 'cron', { value: '* * * * *' });
    const inherited = Object.create({ cron: '* * * * *' });
    inherited.prompt = 'Reminder';
    for (const value of [getter, hidden, inherited, { cron: '* * * * *', prompt: 'Reminder', [Symbol()]: 1 }]) {
      code(() => validateCronInit(value), 'invalid-input');
    }
    expect(accessed).toBe(false);
    expect(strictRecord(Object.assign(Object.create(null), { a: 1 }), ['a'])).toEqual({ a: 1 });
  });
});

describe('official 2.1.1 numeric cron semantics', () => {
  it.each([
    '', '* * * *', '* * * * * *', '@daily', '* * * JAN *', '* * * * MON',
    '60 * * * *', '* 24 * * *', '* * 0 * *', '* * 32 * *', '* * * 0 *', '* * * 13 *', '* * * * 8',
    '1,,2 * * * *', ',1 * * * *', '1, * * * *', '2-1 * * * *', '-1 * * * *', '+1 * * * *',
    '*/0 * * * *', '*/ * * * *', '/2 * * * *', '*//2 * * * *', '1-2-3 * * * *', '1.5 * * * *',
    '1e1 * * * *', '* * ? * *', '* * L * *', '* * * * 1#2', '\ud800 * * * *',
    '9'.repeat(1025), '*/9007199254740992 * * * *',
  ])('rejects unsupported or malformed expression %#', (cron) => {
    code(() => parseCronExpression(cron), 'invalid-input');
  });

  it('supports lists, ascending ranges, numeric steps, leading zeroes and stepped numeric starts', () => {
    const expression = parseCronExpression('05,10-20/5,50/4 01-03/2 1-31/3 1,3-5 0,7');
    expect([...expression.values[0]]).toEqual([5, 10, 15, 20, 50, 54, 58]);
    expect([...expression.values[1]]).toEqual([1, 3]);
    expect([...expression.values[3]]).toEqual([1, 3, 4, 5]);
    expect([...expression.values[4]]).toEqual([0]);
    expect(next('0 9 * * 7', local(2026, 10, 19))).toBe(local(2026, 10, 25, 9));
  });

  it('uses DOM/DOW OR only when neither original field is exactly a wildcard', () => {
    const start = local(2026, 10, 19);
    expect(next('0 9 25 * 1', start)).toBe(local(2026, 10, 19, 9));
    expect(next('0 9 * * 0', start)).toBe(local(2026, 10, 25, 9));
    expect(next('0 9 */1 * 0', start)).toBe(local(2026, 10, 19, 9));
    expect(next('0 9 25 * */1', start)).toBe(local(2026, 10, 19, 9));
    expect(next('0 9 25 * *', start)).toBe(local(2026, 10, 25, 9));
    expect(next('0 9 *,25 * 0', start)).toBe(local(2026, 10, 19, 9));
  });

  it('is strictly in the future, with local wall-clock fields and leap-day handling', () => {
    expect(next('* * * * *', local(2026, 10, 19, 10, 7) + 59_000)).toBe(local(2026, 10, 19, 10, 8));
    expect(next('7 9 * * *', local(2026, 10, 19, 9, 7))).toBe(local(2026, 10, 20, 9, 7));
    expect(next('7 9 29 2 *', local(2026, 10, 19))).toBe(local(2028, 2, 29, 9, 7));
    expect(next('0 0 31 2 *', local(2026, 10, 19))).toBeNull();
  });

  it('uses local calendar progression across DST rollback when enforcing the one-shot horizon', () => {
    const expressionUrl = new URL('../src/cron/expression.mjs', import.meta.url).href;
    const validationUrl = new URL('../src/cron/validation.mjs', import.meta.url).href;
    const script = `
      import { nextCronRun, parseCronExpression } from ${JSON.stringify(expressionUrl)};
      import { validateCronSchedule } from ${JSON.stringify(validationUrl)};
      const cron = '30 1 1 11 *';
      const now = Date.parse('2026-11-01T01:31:00-04:00');
      let errorCode;
      try { validateCronSchedule({ cron, recurring: false }, now); } catch (error) { errorCode = error.code; }
      const run = (from) => new Date(nextCronRun(parseCronExpression(cron), Date.parse(from))).toISOString();
      process.stdout.write(JSON.stringify({
        zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        afterFirstOccurrence: run('2026-11-01T01:31:00-04:00'),
        beforeFirstOccurrence: run('2026-11-01T01:29:00-04:00'),
        errorCode,
      }));
    `;
    const result = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8', timeout: 5000,
    });
    expect(JSON.parse(result)).toEqual({
      zone: 'America/New_York',
      afterFirstOccurrence: '2027-11-01T05:30:00.000Z',
      beforeFirstOccurrence: '2026-11-01T05:30:00.000Z',
      errorCode: 'one-shot-too-far',
    });
  });

  it('checks the five-year window and inclusive 350-day one-shot limit using upstream now', () => {
    const now = local(2026, 1, 1);
    code(() => validateCronSchedule(init('0 0 31 2 *'), now), 'no-future-fire');
    expect(() => validateCronSchedule(init('0 0 29 2 *'), now)).not.toThrow();
    expect(() => validateCronSchedule(init('0 0 17 12 *', false), now)).not.toThrow();
    code(() => validateCronSchedule(init('1 0 17 12 *', false), now), 'one-shot-too-far');
    code(() => validateCronSchedule(init('0 0 18 12 *', false), now), 'one-shot-too-far');
    for (const clock of [null, undefined, '1', NaN, Infinity, -1, 8.64e15]) {
      code(() => validateCronSchedule(init('* * * * *'), clock), 'invalid-response');
    }
  });
});
