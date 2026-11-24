import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { patchOfficialModelThinking } from '../src/officialModelThinking.mjs';
import { registry, switcher, modelThinkingFixture } from './testkit/officialModelThinking.mjs';

const version = '2.7.2';
const models = {
  first: { id: 'first', efforts: ['off', 'high', 'xhigh'], defaultEffort: 'high' },
  second: { id: 'second', efforts: ['off', 'high', 'xhigh'], defaultEffort: 'high' },
  limited: { id: 'limited', efforts: ['off', 'medium'], defaultEffort: 'medium' },
  always: { id: 'always', efforts: ['high'], defaultEffort: 'high' },
};

function setup(thinking, activeSessionId = 'fixture-session') {
  const state = { activeSessionId, thinking, config: { thinking: { enabled: true, effort: 'high' } } };
  let active = 'first';
  const save = vi.fn();
  const store = { setDraftModel: vi.fn((alias) => { active = alias; }) };
  const result = patchOfficialModelThinking(modelThinkingFixture, version);
  expect(result.patched).toBe(true);
  const apply = runInNewContext(result.text + '\napply', { state, get: (id) => models[id], active: () => active, save, store });
  return { apply, state, save, store };
}

describe('official 2.7.2 main model picker', () => {
  it.each(['xhigh', 'off'])('saves supported session effort %s without consulting global defaults', async (effort) => {
    const { apply, state, save } = setup(effort);
    await apply('second');
    expect(save).toHaveBeenCalledExactlyOnceWith('fixture-session', 'second', effort);
    expect(state.thinking).toBe(effort);
    expect(state.config.thinking.effort).toBe('high');
  });

  it.each([['xhigh', 'limited', 'medium'], ['off', 'always', 'high'], [undefined, 'second', 'high']])(
    'uses the target default for unavailable %s on %s', async (current, alias, effort) => {
      const { apply, state, save } = setup(current);
      await apply(alias);
      expect(save).toHaveBeenCalledExactlyOnceWith('fixture-session', alias, effort);
      expect(state.thinking).toBe(effort);
    });

  it.each(['first', 'unknown'])('does not rewrite effort without a known model change to %s', async (alias) => {
    const { apply, state, save } = setup('xhigh');
    await apply(alias);
    expect(save).toHaveBeenCalledExactlyOnceWith('fixture-session', alias, undefined);
    expect(state.thinking).toBe('xhigh');
  });

  it('holds the visible draft effort against the official default-model watcher', async () => {
    const { apply, state, save, store } = setup('xhigh', null);
    expect(await apply('second')).toBe(true);
    expect(store.setDraftModel).toHaveBeenCalledWith('second');
    expect(state).toMatchObject({ thinking: 'xhigh', draftThinkingExplicit: true });
    expect(save).not.toHaveBeenCalled();
    await apply('limited');
    expect(state).toMatchObject({ thinking: 'medium', draftThinkingExplicit: true });
  });

  it('binds by structure and leaves every other use of the official resolver unchanged', () => {
    const source = modelThinkingFixture.replaceAll('pick(', 'a$4(').replaceAll('apply(', 'b$1(') +
      ';const other=()=>a$4(model,current,changed,global)';
    const result = patchOfficialModelThinking(source, version);
    expect(result.patched).toBe(true);
    expect(result.text).toContain('async function b$1(');
    expect(result.text).toContain(registry.replaceAll('pick(', 'a$4('));
    expect(result.text).toContain('const other=()=>a$4(model,current,changed,global)');
    expect(patchOfficialModelThinking(result.text, version)).toEqual({ text: result.text, patched: false });
  });

  it.each([
    [modelThinkingFixture, '2.7.3'], [registry, version], [switcher, version],
    [registry + modelThinkingFixture, version], [modelThinkingFixture + switcher, version],
    [modelThinkingFixture.replace('next===current', 'next!==current'), version],
    [modelThinkingFixture.replace('supports(target,level)', 'defaults(target,level)'), version],
  ])('retains the original for unknown or ambiguous structures %#', (source, exact) => {
    expect(patchOfficialModelThinking(source, exact)).toEqual({ text: source, patched: false });
  });
});
