import { appendFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createScanBudget, JOURNAL_LIMITS, readCronWire, safeCronPathId } from '../src/cron/journal.mjs';
import { createCronProjection, PROJECTION_LIMITS } from '../src/cron/projection.mjs';

const homes = [];
const workspaceId = 'wd_fixture_0123456789ab';
const sessionId = 'session-fixture';
const task = { id: 'deadbeef', cron: '7 9 * * *', prompt: 'Fictional reminder', createdAt: 100, recurring: true };
const event = (type, fields = {}) => ({ type, time: 1000, ...fields });
const prompt = (turnId, fields = {}) => event('turn.prompt', {
  agentId: 'main', turnId, input: [], origin: { kind: 'cron_job', jobId: task.id }, ...fields,
});

async function fixture(content = '') {
  const home = await mkdtemp(join(tmpdir(), 'okw-cron-journal-'));
  homes.push(home);
  const path = join(home, 'sessions', workspaceId, sessionId, 'agents', 'main', 'wire.jsonl');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return { home, path };
}

function project(records, options = {}) {
  const projection = createCronProjection({ version: '2.1.1', budget: createScanBudget(), withHistory: true, ...options });
  for (const record of records) projection.consume(record);
  return projection.result();
}

async function scan(home, budget = createScanBudget(), consume = () => {}) {
  return readCronWire({ home, workspaceId, sessionId, budget, consume });
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe('Cron journal bounded safe reads', () => {
  it('streams native no-agent cron records, with no file writes or body copies', async () => {
    const content = `${JSON.stringify(event('cron.add', { task }))}\n`;
    const { home, path } = await fixture(content);
    const seen = [];
    expect(await scan(home, createScanBudget(), (record) => seen.push(record))).toEqual({
      available: true, quality: { complete: true, reasons: [] },
    });
    expect(seen).toEqual([event('cron.add', { task })]);
    expect(await readFile(path, 'utf8')).toBe(content);
    expect(JOURNAL_LIMITS).toMatchObject({ highWaterMark: 65536, bytes: 134217728, durationMs: 5000 });
  });

  it('reports bad UTF8, malformed, oversized and partial lines, not a complete empty result', async () => {
    const content = `null\n[]\n{bad}\n${'x'.repeat(JOURNAL_LIMITS.lineBytes + 1)}\n{"type":`;
    const { home } = await fixture(Buffer.concat([Buffer.from([0xff, 10]), Buffer.from(content)]));
    const result = await scan(home);
    expect(result.available).toBe(true);
    expect(result.quality).toEqual({
      complete: false, reasons: ['wire-bad-line', 'wire-oversized-line', 'wire-truncated-tail'],
    });
  });

  it.each([
    [{ bytes: 10 }, 'wire-byte-limit'], [{ lines: 1 }, 'wire-line-limit'],
    [{ durationMs: -1 }, 'wire-time-limit'],
  ])('shares explicit byte/line/time limits without reporting completeness %#', async (limits, reason) => {
    const { home } = await fixture(`${JSON.stringify(event('context.clear'))}\n`.repeat(10));
    const result = await scan(home, createScanBudget(limits));
    expect(result.quality.complete).toBe(false);
    expect(result.quality.reasons).toContain(reason);
  });

  it('counts lines across separate chunks, and detects a changed file after scanning', async () => {
    const line = `${JSON.stringify(event('context.clear', { body: 'x'.repeat(40000) }))}\n`;
    const { home, path } = await fixture(line.repeat(5));
    const records = [];
    const budget = createScanBudget({ lines: 3 });
    const result = await scan(home, budget, (record) => {
      records.push(record);
      if (records.length === 1) appendFileSync(path, '\n');
    });
    expect(records).toHaveLength(3);
    expect(budget.remainingLines).toBe(0);
    expect(result.quality.reasons).toEqual(expect.arrayContaining(['wire-line-limit', 'wire-changed']));
  });

  it('reports missing and non-file journals without treating them as empty success', async () => {
    const { home, path } = await fixture();
    expect((await readCronWire({ home, workspaceId, sessionId: 'missing', consume() {} })).quality.reasons)
      .toEqual(['wire-missing']);
    await rm(path);
    await mkdir(path);
    expect((await scan(home)).quality.reasons).toEqual(['wire-unsafe-path']);
  });

  it('rejects a symlinked directory even when it resolves inside the same home', async () => {
    const { home } = await fixture('{}\n');
    const link = join(home, 'sessions', workspaceId, 'linked-session');
    await symlink(join(home, 'sessions', workspaceId, sessionId), link, 'junction');
    const result = await readCronWire({ home, workspaceId, sessionId: 'linked-session', consume() {} });
    expect(result.quality.reasons).toEqual(['wire-unsafe-path']);
  });

  it.each(['x..y', 'wd_repo..backup_eaed49d41ffd'])('accepts internal dots in a single native path segment %#', (id) => {
    expect(safeCronPathId(id)).toBe(true);
  });

  it.each(['../other', '..', '.', 'x/y', 'x\\y', 'C:other', 'x:stream', 'x\0bad', 'x%2fother', 'NUL', 'x.'])
  ('rejects unsafe path ID %#', async (id) => {
    expect(safeCronPathId(id)).toBe(false);
    expect((await readCronWire({ home: 'unused', workspaceId, sessionId: id, consume() {} })).quality.reasons)
      .toEqual(['wire-invalid-id']);
  });
});

describe('native whole-journal Cron projection', () => {
  it.each(['2.3.0', '2.3.2', '2.3.1-modified'])('rejects an unverified journal version %s', (version) => {
    expect(() => project([], { version })).toThrow('Unsupported Cron journal version.');
  });

  it.each(['2.1.1', '2.2.0', '2.3.1'])('keeps journal order, undo independence and precise %s fork semantics', (version) => {
    const result = project([
      event('cron.add', { task }), event('cron.cursor', { id: task.id, lastFiredAt: 200 }),
      event('context.undo'), event('context.clear'), prompt(0),
      event('turn.ended', { agentId: 'main', turnId: 0, reason: 'completed', time: 1100 }),
      event('forked', { agentId: 'main', time: 1200 }),
      event('cron.add', { task: { ...task, id: 'cafebabe' } }),
    ], { version });
    expect(result.tasks.map((value) => value.id)).toEqual(version === '2.1.1' ? [task.id, 'cafebabe'] : ['cafebabe']);
    if (version === '2.1.1') expect(result.tasks[0].lastFiredAt).toBe(200);
    expect(result.items[0]).toMatchObject({ inherited: true, endReason: 'completed', turnId: 0 });
    expect(result.quality.complete).toBe(true);
  });

  it('removes by exact ID, preserves deleted-task history and strips unknown task secrets', () => {
    const result = project([
      event('cron.add', { task: { ...task, apiKey: 'fixture-only-not-exposed', tags: { fixture: 'yes' } } }),
      prompt(0), event('cron.delete', { ids: [task.id] }), event('context.undo'),
      event('cron.add', { task: { ...task, id: 'new-job', key: 'fixture-only-not-exposed' } }),
    ]);
    expect(result.tasks).toEqual([{ ...task, id: 'new-job' }]);
    expect(result.items).toEqual([{ time: 1000, taskId: task.id, kind: 'started', inherited: false, turnId: 0 }]);
    expect(JSON.stringify(result)).not.toContain('fixture-only-not-exposed');
  });

  it('uses only exact cron origin and explicit ended evidence, not cursor/date/notification', () => {
    const result = project([
      event('cron.add', { task }), prompt(1), prompt(2, { origin: { kind: 'cron_missed', count: 2 } }),
      prompt(3, { origin: { kind: 'task', taskId: task.id } }), event('task.notified', { sourceId: task.id }),
      event('cron.cursor', { id: task.id, lastFiredAt: 2000 }), event('turn.cancel', { turnId: 1 }),
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).not.toHaveProperty('endReason');
  });

});

describe('Cron journal model and history evidence', () => {
  it('associates numeric turnStep models exactly, retaining retries and shared steer results', () => {
    const request = (turnStep, fields = {}) => event('llm.request', {
      agentId: 'main', kind: 'loop', turnStep, model: 'actual-id', modelAlias: 'alias', provider: 'openai', ...fields,
    });
    const result = project([
      prompt(1, { origin: { kind: 'user' } }), request('1.0'),
      event('turn.steer', { ...prompt(1), type: 'turn.steer' }), request('1.1', { model: 'retry-id' }),
      request('10.0', { model: 'wrong-turn' }), request(undefined, { model: 'must-not-guess' }),
      request('01.0', { model: 'must-not-guess' }),
      event('turn.ended', { agentId: 'main', turnId: 1, reason: 'blocked', durationMs: 80, time: 1080 }),
      prompt(2),
    ]);
    const steered = result.items.find((item) => item.kind === 'steered');
    expect(steered).toMatchObject({ endReason: 'blocked', endedAt: 1080, durationMs: 80, turnId: 1 });
    expect(steered.models.map((model) => model.model)).toEqual(['actual-id', 'retry-id']);
    expect(steered.models[0]).toEqual({ model: 'actual-id', alias: 'alias', provider: 'openai', time: 1000 });
    expect(result.items.find((item) => item.turnId === 2)).not.toHaveProperty('endReason');
    expect(result.quality.reasons).toContain('wire-unassociated-model');
  });

  it('does not cross-associate reused turn IDs after a fork and preserves saved model on absent fields', () => {
    const result = project([
      event('profile.bind', { agentId: 'main', modelAlias: 'saved' }),
      event('config.update', { agentId: 'main' }), prompt(0), event('forked', { agentId: 'main' }),
      prompt(0, { time: 1100 }), event('turn.ended', { agentId: 'main', turnId: 0, reason: 'failed', time: 1200 }),
    ]);
    expect(result.model).toBe('saved');
    expect(result.items.find((item) => item.inherited)).not.toHaveProperty('endReason');
    expect(result.items.find((item) => !item.inherited).endReason).toBe('failed');
  });

  it('marks unsupported relevant schemas rather than silently asserting completeness', () => {
    const result = project([
      {}, event('cron.add', { task: { ...task, recurring: 1 } }), event('cron.delete', { ids: [null] }),
      event('cron.cursor', { id: task.id, lastFiredAt: 'yesterday' }), event('cron.unknown'),
      event('profile.bind', { agentId: 'main', modelAlias: null }), prompt(1, { origin: { kind: 'cron_job' } }),
    ]);
    expect(result.tasks).toEqual([]);
    expect(result.quality.complete).toBe(false);
    expect(result.quality.reasons).toHaveLength(7);
  });

});

describe('Cron projection resource boundaries', () => {
  it('bounds pathological native task state, recent history, per-turn models and turn maps', () => {
    const records = Array.from({ length: 1025 }, (_, i) => event('cron.add', { task: { ...task, id: `job-${i}` } }));
    records.push(...Array.from({ length: 300 }, (_, i) => prompt(i, { time: i })));
    const result = project(records);
    expect(result.tasks).toHaveLength(PROJECTION_LIMITS.tasks);
    expect(result.items).toHaveLength(PROJECTION_LIMITS.history);
    expect(result.hasMore).toBe(true);
    expect(result.quality.reasons).toEqual(expect.arrayContaining(['wire-task-limit', 'history-limit', 'wire-turn-map-limit']));
    expect(result.items[0].time).toBe(299);
    expect(result.items.at(-1).time).toBe(200);
  });

  it('shares retained task bytes across page sessions and does not retain unknown fields', () => {
    const budget = createScanBudget({ taskBytes: Buffer.byteLength(JSON.stringify(task)) + 1 });
    const first = project([event('cron.add', { task })], { budget });
    const second = project([event('cron.add', { task })], { budget });
    expect(first.tasks).toHaveLength(1);
    expect(second.tasks).toHaveLength(0);
    expect(second.quality.reasons).toEqual(['wire-task-limit']);
  });

  it('bounds retry models and flags missing turn association instead of guessing', () => {
    const records = [prompt(undefined), prompt(0)];
    records.push(...Array.from({ length: 33 }, (_, i) => event('llm.request', {
      agentId: 'main', kind: 'loop', turnStep: `0.${i}`, model: 'actual-id', provider: 'openai',
    })));
    const result = project(records);
    expect(result.items.find((item) => item.turnId === 0).models).toHaveLength(32);
    expect(result.items.find((item) => item.turnId === undefined)).not.toHaveProperty('models');
    expect(result.quality.reasons).toEqual(['wire-unassociated-turn', 'wire-model-limit']);
  });

  it('keeps compaction identity only with explicit turnStep, never with timestamp proximity', () => {
    const result = project([prompt(1), event('llm.request', {
      agentId: 'main', kind: 'compaction', turnStep: '1.0', model: 'compact-id', provider: 'openai',
    }), event('llm.request', { agentId: 'main', kind: 'compaction', model: 'unassociated', provider: 'openai' })]);
    expect(result.items[0].models).toEqual([{ model: 'compact-id', provider: 'openai', time: 1000 }]);
    expect(result.quality.reasons).toEqual(['wire-unassociated-model']);
  });

  it('reports consumer failures as unreadable while retaining scanner limits', async () => {
    const { home } = await fixture(`${JSON.stringify(event('cron.add', { task }))}\n`);
    const result = await scan(home, createScanBudget(), () => { throw new Error('fixture read failure'); });
    expect(result.quality.complete).toBe(false);
    expect(result.quality.reasons).toContain('wire-unreadable');
  });
});
