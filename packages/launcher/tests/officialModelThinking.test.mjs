import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { patchOfficialModelThinking } from '../src/officialModelThinking.mjs';
import { composerThinkingFixture, modelThinkingFixture, preview, registry, switcher } from './testkit/officialModelThinking.mjs';

const version = '2.7.2';
const models = {
  first: { id: 'first', efforts: ['off', 'high', 'xhigh'], defaultEffort: 'high' },
  second: { id: 'second', efforts: ['off', 'high', 'xhigh'], defaultEffort: 'high' },
  limited: { id: 'limited', efforts: ['off', 'medium'], defaultEffort: 'medium' },
  always: { id: 'always', efforts: ['high'], defaultEffort: 'high' },
};

function setup(thinking, activeSessionId = 'fixture-session', officialVersion = version) {
  const state = { activeSessionId, thinking, config: { thinking: { enabled: true, effort: 'high' } } };
  let active = 'first';
  const save = vi.fn();
  const store = { setDraftModel: vi.fn((alias) => { active = alias; }) };
  const source = officialVersion === '2.8.0' ? composerThinkingFixture : modelThinkingFixture;
  const result = patchOfficialModelThinking(source, officialVersion);
  expect(result.patched).toBe(true);
  const apply = runInNewContext(result.text + '\napply', {
    state, get: (id) => models[id], active: () => active, save, store, define: (component) => component,
  });
  return { apply, state, save, store };
}

describe('official main model picker', () => {
  it.each([['2.7.2', 'xhigh'], ['2.7.2', 'off'], ['2.8.0', 'xhigh'], ['2.8.0', 'off']])(
    'saves supported %s session effort %s without consulting global defaults', async (officialVersion, effort) => {
      const { apply, state, save } = setup(effort, 'fixture-session', officialVersion);
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

  it.each(['2.7.2', '2.8.0'])('binds by structure and leaves other resolver calls unchanged on %s', (exact) => {
    const full = (exact === '2.7.2' ? modelThinkingFixture : composerThinkingFixture) +
      ';const other=()=>pick(model,current,changed,global)';
    const source = full.replaceAll('pick(', 'a$4(').replaceAll('apply(', 'b$1(');
    const result = patchOfficialModelThinking(source, exact);
    expect(result.patched).toBe(true);
    expect(result.text).toContain('async function b$1(');
    expect(result.text).toContain(registry.replaceAll('pick(', 'a$4('));
    expect(result.text).toContain('const other=()=>a$4(model,current,changed,global)');
    expect(patchOfficialModelThinking(result.text, exact)).toEqual({ text: result.text, patched: false });
  });

  it.each([
    [modelThinkingFixture, '2.7.3'], [composerThinkingFixture, '2.8.0-rc.1'], [composerThinkingFixture, '2.8.1'],
    [registry, version], [switcher, version], [composerThinkingFixture + switcher, '2.8.0'],
    [registry + modelThinkingFixture, version], [modelThinkingFixture + switcher, version],
    [modelThinkingFixture.replace('next===current', 'next!==current'), version],
    [modelThinkingFixture.replace('supports(target,level)', 'defaults(target,level)'), version],
    [modelThinkingFixture, '2.8.0'], [composerThinkingFixture + preview, '2.8.0'],
    [composerThinkingFixture.replace('"Composer"', '"SideChat"'), '2.8.0'],
  ])('retains the original for unknown or ambiguous structures %#', (source, exact) => {
    expect(patchOfficialModelThinking(source, exact)).toEqual({ text: source, patched: false });
  });
});

describe('official 2.8.0 composer effort preview', () => {
  it.each([
    ['second', 'xhigh', undefined, 'xhigh'], ['second', 'off', undefined, 'off'],
    ['limited', 'xhigh', undefined, 'medium'], ['always', 'off', undefined, 'high'],
    ['second', 'xhigh', 'high', 'high'], ['first', 'xhigh', undefined, 'xhigh'],
    ['unknown', 'xhigh', undefined, 'xhigh'], ['second', undefined, undefined, 'high'],
  ])('shows the committed choice for model=%s, current=%s, explicit=%s', (alias, effort, override, expected) => {
    const { text } = patchOfficialModelThinking(composerThinkingFixture, '2.8.0');
    const result = runInNewContext(text + '\ncomposer.setup().shown.value', {
      define: (component) => component, computed: (get) => ({ get value() { return get(); } }),
      activeModel: { value: models.first }, target: { value: models[alias] },
      effort: { value: effort }, override: { value: override }, session: { value: null },
      stores: { config: { value: { thinking: { enabled: true, effort: 'high' } } } },
      normalize: (model, current) => current ?? model?.defaultEffort,
      normalizeExplicit: (_model, explicit) => explicit,
    });
    expect(result).toBe(expected);
  });

  it('keeps the original preview code on 2.7.2', () => {
    const result = patchOfficialModelThinking(composerThinkingFixture, '2.7.2');
    expect(result.patched).toBe(true);
    expect(result.text).toContain(preview);
  });
});
