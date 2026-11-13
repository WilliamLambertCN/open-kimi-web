import { appendFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequestMetricsReader } from '../src/metrics/journal.mjs';

let home; let path;
const request = (extra = {}) => ({ id: 'exact-request', turn: 't_123456789abc', index: 1, item: 'step-uuid:1',
  type: 'assistant_message', ended: new Date(10000).toISOString(), ...extra });
const record = (event, extra = {}) => JSON.stringify({ type: 'context.append_loop_event', agentId: 'main', time: 10000,
  event, ...extra }) + '\n';
const end = (extra = {}, outer) => record({ type: 'step.end', uuid: 'step-uuid', step: 1,
  llmFirstTokenLatencyMs: 1200, llmStreamDurationMs: 2000, ...extra }, outer);
const read = (reader, items = [request()], agent = 'main') => reader.read('work', 'session', agent, items);

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'okw-timing-'));
  path = join(home, 'sessions/work/session/agents/main/wire.jsonl');
  await mkdir(join(home, 'sessions/work/session/agents/main'), { recursive: true });
});
afterEach(async () => { await rm(home, { recursive: true, force: true }); });

describe('bounded read-only official request timing', () => {
  it('returns numeric timing for the exact persisted item without content or diagnostic fields', async () => {
    const bytes = end({ usage: { output: 100 }, llmServerDecodeMs: 999, text: 'PRIVATE FIXTURE CONTENT' });
    await writeFile(path, bytes);
    const result = await read(createRequestMetricsReader(home));
    expect(result).toMatchObject({ available: true, pending: false, bytesRead: Buffer.byteLength(bytes), items: [
      { id: 'exact-request', llmTiming: { llmFirstTokenLatencyMs: 1200, llmStreamDurationMs: 2000 } },
    ] });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|usage|ServerDecode|step-uuid/);
    expect(await readFile(path, 'utf8')).toBe(bytes);
  });
  it('keeps retry UUID, step index, exact end time and agent separate', async () => {
    await writeFile(path, end() + end({ uuid: 'retry-uuid' }) + end({}, { agentId: 'different' }));
    const reader = createRequestMetricsReader(home);
    for (const wrong of [{ item: 'missing:1' }, { index: 2 }, { ended: new Date(9999).toISOString() }]) {
      expect((await read(reader, [request(wrong)])).items).toEqual([]);
    }
    expect((await read(reader, [request({ item: 'retry-uuid:0' })])).items).toHaveLength(1);
    expect((await read(reader)).items).toHaveLength(1);
  });
  it('joins tool request IDs through their recorded step UUID, never through their numeric index alone', async () => {
    await writeFile(path, end() + record({ type: 'tool.call', toolCallId: 'call-id', stepUuid: 'step-uuid' }));
    const reader = createRequestMetricsReader(home);
    expect((await read(reader, [request({ type: 'tool_call', item: 'call-id' })])).items).toHaveLength(1);
    expect((await read(reader, [request({ type: 'tool_call', item: 'unrelated' })])).items).toEqual([]);
  });
  it('ignores truncated tail, oversized lines and malformed records without losing earlier exact timing', async () => {
    await writeFile(path, end() + '{bad}\n' + record({ type: 'content.part', text: 'x'.repeat(1200000) }) +
      record({ type: 'step.end', uuid: 'invalid', step: 1 }, { agentId: 'wrong' }) + end().trimEnd());
    const result = await read(createRequestMetricsReader(home));
    expect(result.available).toBe(true); expect(result.items).toHaveLength(1);
  });
  it('refuses duplicate exact step-end identities instead of choosing one', async () => {
    await writeFile(path, end() + end({ llmFirstTokenLatencyMs: 999 }));
    expect((await read(createRequestMetricsReader(home))).items).toEqual([]);
  });
  it('reads the recent tail of a very large sparse session, caches numbers, and invalidates on file changes', async () => {
    const { open } = await import('node:fs/promises');
    const handle = await open(path, 'w');
    await handle.write('\n' + end(), 400 * 1024 * 1024); await handle.close();
    const reader = createRequestMetricsReader(home);
    const first = await read(reader); expect(first.items).toHaveLength(1); expect(first.bytesRead).toBeLessThan(300000);
    expect((await read(reader)).bytesRead).toBe(0);
    await writeFile(path, end({ llmFirstTokenLatencyMs: 777 }));
    expect((await read(reader)).items[0].llmTiming.llmFirstTokenLatencyMs).toBe(777);
    await appendFile(path, end({ uuid: 'new-step' }));
    expect((await read(reader, [request({ item: 'new-step:1' })])).items).toHaveLength(1);
  });
});

describe('request timing bounds and path isolation', () => {
  it('limits each scan to eight MiB and resumes from the cursor without rescanning the whole file', async () => {
    const filler = record({ type: 'content.part', text: 'x'.repeat(64000) });
    await writeFile(path, end() + filler.repeat(160));
    const reader = createRequestMetricsReader(home); const first = await read(reader);
    expect(first).toMatchObject({ available: true, pending: true, items: [] });
    expect(first.bytesRead).toBeLessThanOrEqual(8 * 1024 * 1024);
    const second = await read(reader); expect(second.items).toHaveLength(1);
    expect(second.bytesRead).toBeLessThan(3 * 1024 * 1024);
  });
  it('rescans for a different request after bounded numeric cache eviction, including revisiting recent history', async () => {
    const events = Array.from({ length: 4100 }, (_, i) => end({ uuid: `unique-${i}` }));
    await writeFile(path, events.join(''));
    const reader = createRequestMetricsReader(home);
    const recent = [request({ item: 'unique-4099:1' })];
    const oldest = [request({ item: 'unique-0:1' })];
    expect((await read(reader, recent)).items).toHaveLength(1);
    expect((await read(reader, oldest)).items).toHaveLength(1);
    const revisited = await read(reader, recent);
    expect(revisited.items).toHaveLength(1); expect(revisited.bytesRead).toBeGreaterThan(0);
    expect((await read(reader, recent)).bytesRead).toBe(0);
    const batch = createRequestMetricsReader(home);
    expect((await read(batch, [...recent, ...oldest])).items).toHaveLength(1);
    expect((await read(batch, recent)).items).toHaveLength(1);
  });
  it.each(['../work', 'work/child', 'CON', 'work.'])('rejects unsafe workspace %s', async (workspace) => {
    const result = await createRequestMetricsReader(home).read(workspace, 'session', 'main', [request()]);
    expect(result.available).toBe(false); expect(result.items).toEqual([]);
  });
  it('rejects linked agent directories and missing data without revealing paths or raw errors', async () => {
    await writeFile(path, end());
    await symlink(join(home, 'sessions/work/session/agents/main'), join(home, 'sessions/work/session/agents/linked'),
      process.platform === 'win32' ? 'junction' : 'dir');
    const reader = createRequestMetricsReader(home);
    for (const agent of ['linked', 'absent']) {
      expect(await read(reader, [request()], agent)).toEqual({
        available: false, reason: 'unreadable', items: [], pending: false,
      });
    }
  });
});
