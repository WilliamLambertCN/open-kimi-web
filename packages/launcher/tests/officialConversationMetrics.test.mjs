import { describe, expect, it } from 'vitest';
import { patchOfficialRequestMetrics } from '../src/officialRequestMetrics.mjs';
import { conversationFixture as fixture, conversationTurn } from './testkit/officialConversationMetrics.mjs';

async function executable(source = fixture) {
  const result = patchOfficialRequestMetrics(source);
  expect(result.patched).toBe(true);
  return import(`data:text/javascript;base64,${Buffer.from(result.text + '\nexport {project,Timing,ij};').toString('base64')}`);
}

describe('conversation item metrics adapter', () => {
  it('projects exact terminal request metadata at the last rendered item without backend debug', async () => {
    const { project, Timing } = await executable();
    const rows = project([conversationTurn()]);
    expect(rows[0].debug).toBeUndefined();
    const metadata = rows[1].debug[0].__okw;
    expect(metadata).toEqual({ session: 'session', turn: 't_123456789abc', index: 1, item: 'step-uuid:1',
      type: 'assistant_message', state: 'completed', ended: '2026-01-01T00:00:10.000Z',
      usage: { output: 100, input_other: 10, input_cache_read: 30, input_cache_creation: 0 }, timing: undefined });
    const node = Timing.setup({ debug: rows[1].debug[0] })();
    expect(node.props['data-okw-step-id']).toBe('["t_123456789abc",1,"step-uuid:1"]');
    expect(node.props['data-okw-step-state']).toBe('completed');
    expect(JSON.parse(node.props['data-okw-conversation'])).not.toHaveProperty('text');
    expect(node.children).toBeNull();
  });
  it('does not create metrics for a running step, empty text, unknown step or user message', async () => {
    const { project } = await executable();
    for (const steps of [[], [{ index: 1, outcome: 'running' }]]) {
      expect(project([conversationTurn({ steps })]).every((row) => !row.debug)).toBe(true);
    }
    const turn = conversationTurn();
    turn.items[1].text = '';
    expect(project([turn])[0].debug).toHaveLength(1);
  });
  it('preserves native block merging and creates one exact request per step, not per whole reply', async () => {
    const { project, ij } = await executable();
    const turn = conversationTurn();
    turn.steps.push({ ...turn.steps[0], index: 2 });
    turn.items.push({ type: 'tool_call', item_id: 'tool-id', step_index: 2, status: 'ended' });
    const rows = project([turn]);
    expect(rows[2].debug[0].__okw.item).toBe('tool-id');
    expect(ij(rows[1], rows[2]).debug.map((item) => item.__okw.index)).toEqual([1, 2]);
  });
  it('indexes a large turn once per projection and does not retain stale undo or terminal state', async () => {
    const { project } = await executable(); const turn = conversationTurn();
    turn.steps = Array.from({ length: 400 }, (_, n) => ({ ...turn.steps[0], index: n + 1 }));
    const original = turn.items;
    turn.items = turn.steps.flatMap((step) => original.map((item) => ({ ...item,
      step_index: step.index, item_id: `step-${step.index}:${item.type}` })));
    let visits = 0;
    for (const item of turn.items) {
      const index = item.step_index;
      Object.defineProperty(item, 'step_index', { get() { visits += 1; return index; } });
    }
    expect(project([turn]).filter((row) => row.debug)).toHaveLength(400);
    expect(visits).toBeLessThan(turn.items.length * 4);
    turn.items.splice(2); turn.steps[0].outcome = 'running';
    expect(project([turn]).every((row) => !row.debug)).toBe(true);
    turn.steps[0].outcome = 'interrupted';
    expect(project([turn]).filter((row) => row.debug)).toHaveLength(1);
    const replacement = conversationTurn({ turn_id: 't_abc123456789' });
    expect(project([replacement])[1].debug[0].__okw.turn).toBe('t_abc123456789');
  });
  it('retains official timing when explicitly provided, without forcing debug on', async () => {
    const { project } = await executable(); const turn = conversationTurn();
    turn.items[1].debug = { timing: { first_token_ms: 100, stream_ms: 1000 } };
    expect(project([turn])[1].debug[0].__okw.timing).toEqual({ first_token_ms: 100, stream_ms: 1000 });
    expect(patchOfficialRequestMetrics(fixture).text).not.toMatch(/KIMI_CODE_DEBUG|localStorage|__vue|debug-endpoints/);
  });
  it('matches semantic structure across minified names and fails atomically on missing or duplicate contracts', () => {
    const renamed = fixture.replace(/\bmS\b/g, '$metadata').replace(/\bC\b/g, '$item').replace(/\bp\b/g, '$turn');
    expect(patchOfficialRequestMetrics(renamed).patched).toBe(true);
    for (const changed of [fixture + fixture, fixture.replace('RequestDebugRow', 'DifferentRow'),
      fixture.replace('role:"note"', 'role:"status"'), fixture.replace('function activity', 'function changed')
        .replace('Nt.debug??[]', 'Nt.unknown??[]'),
      fixture.replace('case"reasoning"', 'case"thought"').replace('...mS(C)', '')]) {
      expect(patchOfficialRequestMetrics(changed)).toEqual({ text: changed, patched: false });
    }
  });
});
