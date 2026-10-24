import { CronClientError } from './errors.mjs';

const RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
const MINUTE_MS = 60_000;
const FIVE_YEARS_MS = 5 * 366 * 24 * 60 * MINUTE_MS;
export const MAX_CRON_BYTES = 1024;

function invalid() {
  throw new CronClientError('invalid-input');
}

function integer(text) {
  const value = Number(text);
  if (!Number.isSafeInteger(value)) invalid();
  return value;
}

function rangeBounds(range, min, max, stepped) {
  if (range === '*') return [min, max];
  const bounds = range.split('-').map(integer);
  if (bounds.length === 2) return bounds;
  return [bounds[0], stepped ? max : bounds[0]];
}

function termValues(term, min, max) {
  const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(term);
  if (!match) invalid();
  const [, range, stepText] = match;
  const step = stepText === undefined ? 1 : integer(stepText);
  if (step < 1) invalid();
  const [first, last] = rangeBounds(range, min, max, stepText !== undefined);
  if (first < min || last > max || first > last) invalid();
  const values = [];
  for (let value = first; value <= last; value += step) values.push(value);
  return values;
}

export function parseCronExpression(cron) {
  if (typeof cron !== 'string' || cron.length > MAX_CRON_BYTES || !cron.isWellFormed()) invalid();
  if (Buffer.byteLength(cron, 'utf8') > MAX_CRON_BYTES) invalid();
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) invalid();
  const values = fields.map((field, index) => {
    const [min, max] = RANGES[index];
    const numbers = field.split(',').flatMap((term) => termValues(term, min, max));
    return new Set(index === 4 ? numbers.map((value) => value % 7) : numbers);
  });
  return {
    cron: fields.join(' '),
    values,
    wildcardDayOfMonth: fields[2] === '*',
    wildcardDayOfWeek: fields[4] === '*',
  };
}

function matchesDay(expression, date) {
  const dayOfMonth = expression.values[2].has(date.getDate());
  const dayOfWeek = expression.values[4].has(date.getDay());
  if (expression.wildcardDayOfMonth) return expression.wildcardDayOfWeek || dayOfWeek;
  return expression.wildcardDayOfWeek ? dayOfMonth : dayOfMonth || dayOfWeek;
}

function advanceLocalCalendar(date, field) {
  switch (field) {
    case 'month':
      date.setDate(1);
      date.setHours(0, 0, 0, 0);
      date.setMonth(date.getMonth() + 1);
      break;
    case 'day':
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() + 1);
      break;
    case 'hour':
      date.setMinutes(0, 0, 0);
      date.setHours(date.getHours() + 1);
      break;
    case 'minute':
      date.setSeconds(0, 0);
      date.setMinutes(date.getMinutes() + 1);
      break;
  }
}

export function nextCronRun(expression, fromMs) {
  if (!Number.isSafeInteger(fromMs) || fromMs < 0 || fromMs > 8.64e15 - FIVE_YEARS_MS) {
    throw new CronClientError('invalid-response');
  }
  const deadline = fromMs + FIVE_YEARS_MS;
  const start = new Date(fromMs);
  start.setSeconds(0, 0);
  const candidate = new Date(start.getTime() + MINUTE_MS);
  let iterations = 0;
  while (candidate.getTime() <= deadline && iterations++ < 10_000_000) {
    if (!expression.values[3].has(candidate.getMonth() + 1)) {
      advanceLocalCalendar(candidate, 'month');
    } else if (!matchesDay(expression, candidate)) {
      advanceLocalCalendar(candidate, 'day');
    } else if (!expression.values[1].has(candidate.getHours())) {
      advanceLocalCalendar(candidate, 'hour');
    } else if (!expression.values[0].has(candidate.getMinutes())) {
      advanceLocalCalendar(candidate, 'minute');
    } else {
      return candidate.getTime();
    }
  }
  return null;
}
