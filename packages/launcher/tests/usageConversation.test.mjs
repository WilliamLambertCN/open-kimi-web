import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { aggregateUsage } from '../src/usage/aggregate.mjs';
import { createUsageScanner } from '../src/usage/scanner.mjs';

let home;
afterEach(async () => { if (home) await rm(home, { recursive: true, force: true }); });

describe('2.6 conversation usage identity', () => {
  it('preserves totals without inventing model IDs from aliases or saved bindings', async () => {
    home = await mkdtemp(join(tmpdir(), 'okw-conversation-usage-'));
    const dir = join(home, 'sessions', 'workspace', 'conversation', 'agents', 'main');
    await mkdir(dir, { recursive: true });
    const usage = { inputOther: 10, inputCacheRead: 20, inputCacheCreation: 0, output: 30 };
    const records = [
      { type: 'profile.bind', agentId: 'main', modelAlias: 'rebound-alias', time: 900 },
      { type: 'turn.prompt', agentId: 'main', turnId: 0, input: [], time: 950 },
      { type: 'context.append_loop_event', agentId: 'main',
        event: { type: 'step.begin', uuid: 'fictional-step', turnId: '0', step: 1 }, time: 999 },
      { type: 'usage.record', agentId: 'main', model: 'rebound-alias', usage, usageScope: 'turn', time: 1000 },
      { type: 'context.append_loop_event', agentId: 'main', event: {
        type: 'step.end', uuid: 'fictional-step', turnId: '0', step: 1, usage,
      }, time: 1001 },
    ];
    await writeFile(join(dir, 'wire.jsonl'), records.map((record) => JSON.stringify(record)).join('\n') + '\n');
    const scan = await createUsageScanner(home).scan();
    expect(scan.facts).toMatchObject([{ alias: 'rebound-alias', modelId: null, output: 30 }]);
    expect(scan.quality.unresolvedModels).toBe(1);
    const data = aggregateUsage(scan, { catalog: [], mappings: {} }, {
      from: 900, to: 1100, model: null, workspace: null, bucket: 'hour',
    });
    expect(data.totals).toMatchObject({ totalInput: 30, output: 30, requests: 1, costUsd: null, costComplete: false });
    expect(data.models[0]).toMatchObject({ id: 'unresolved', aliases: ['rebound-alias'], price: null });
  });
});
