/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fixtureConfig, install, requestLog, switchLocale } from './testkit/subagentPool.mjs';

const styles = readFileSync(resolve('packages/launcher/src/mobile/subagentPool.css'), 'utf8');

afterEach(cleanup);
const pool = {
  defaultModel: 'fixture/under_score', defaultEffort: 'medium',
  models: { 'fixture/under_score': 'line one\nline two', 'fixture/fast': 'keep fast', 'fixture/always': '',
    pool_a: 'Alpha note', pool_b: 'B' },
};
const openMobile = (ui) => ui.open(ui.doc.querySelector('.okw-pool-trigger'));

describe('subagent pool entries and scopes', () => {
  it('mounts beside the existing subagent row on mobile and inside Subagents on desktop, idempotently', async () => {
    const ui = await install();
    const mobileEntry = ui.doc.querySelector('.sheet-body .okw-pool-entry');
    const desktopEntry = ui.doc.querySelector('.ui-dialog .sec .okw-pool-entry');
    expect(mobileEntry).not.toBeNull();
    expect(desktopEntry).not.toBeNull();
    const legacy = ui.doc.querySelector('.okw-subagent-section');
    expect(legacy.previousElementSibling).toBe(mobileEntry);
    const words = ui.copy();
    expect(mobileEntry.querySelector('.okw-pool-entry-label').textContent).toBe(words.entry);
    expect(mobileEntry.querySelector('.okw-pool-note').textContent).toBe(words.entryHint);
    const trigger = mobileEntry.querySelector('.okw-pool-trigger');
    expect(trigger.textContent).toBe(words.manage);
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(ui.dialog()).toBeNull();
    await switchLocale(ui, 'zh');
    expect(ui.entries()).toHaveLength(2);
    expect(ui.doc.querySelector('.okw-pool-entry-label').textContent).toBe(ui.copy().entry);
    expect(ui.posts).toEqual([]);
  });
  it('mounts the desktop entry alone without a mobile breakpoint', async () => {
    const ui = await install({ mobile: false });
    expect(ui.doc.querySelector('.ui-dialog .sec .okw-pool-entry')).not.toBeNull();
    expect(ui.doc.querySelector('.sheet-body .okw-pool-entry')).toBeNull();
    expect(ui.doc.querySelector('.okw-subagent-section')).toBeNull();
  });
  it.each([
    ['providers sheet', { title: 'Providers', desktop: false }],
    ['sheet without cache note', { scoped: false, desktop: false }],
    ['desktop without Subagents section', { mobile: false, desktopSection: false }],
    ['desktop with an unrelated tab', { mobile: false, desktopTab: 'Appearance' }],
    ['hidden desktop panel', { mobile: false, hiddenPanel: true }],
  ])('does not mount for %s', async (_name, options) => {
    const ui = await install(options);
    expect(ui.entries()).toHaveLength(0);
    expect(ui.posts).toEqual([]);
  });
  it('mounts asynchronously when the hidden panel and a later sheet appear', async () => {
    const ui = await install({ title: 'Providers', hiddenPanel: true });
    expect(ui.entries()).toHaveLength(0);
    ui.doc.querySelectorAll('.ui-dialog .panel')[2].hidden = false;
    await ui.settled();
    expect(ui.entries()).toHaveLength(1);
    ui.doc.body.insertAdjacentHTML('beforeend', ui.doc.querySelector('.sheet-root').outerHTML.replace('Providers', '设置'));
    await ui.settled();
    expect(ui.entries()).toHaveLength(2);
    expect(ui.doc.querySelectorAll('.okw-subagent-section')).toHaveLength(1);
  });
  it('cleans entry and open dialog when the settings root is removed or the breakpoint leaves mobile', async () => {
    const ui = await install({ desktop: false });
    await openMobile(ui);
    ui.root.remove();
    await ui.settled();
    expect(ui.entries()).toHaveLength(0);
    expect(ui.dialog()).toBeNull();
    await ui.settled();
    const detached = await install({ desktop: false });
    await detached.media.setBreakpoint(false);
    await detached.settled();
    expect(detached.entries()).toHaveLength(0);
    expect(detached.posts).toEqual([]);
  });
  it('keeps one shared dialog while two mounts exist', async () => {
    const ui = await install();
    await ui.open(ui.doc.querySelector('.ui-dialog .okw-pool-trigger'));
    expect(ui.dialog().hasAttribute('open')).toBe(true);
    ui.doc.querySelector('.sheet-body .okw-pool-trigger').click();
    await ui.settled();
    expect(ui.doc.querySelectorAll('.okw-pool-dialog')).toHaveLength(1);
  });
});

describe('subagent pool candidate cards', () => {
  it('uses flat candidates and compact one-to-two-line description fields', async () => {
    const ui = await install({ section: pool });
    await openMobile(ui);
    const descriptions = ui.cards().map((card) => card.querySelector('.okw-pool-description'));
    expect(descriptions.every((field) => field.rows === 1)).toBe(true);
    expect(styles).toMatch(/\.okw-pool-card\s*\{[^}]*border:\s*0[^}]*background:\s*transparent/su);
    expect(styles).toMatch(/\.okw-pool-card\s*\{[^}]*border-bottom:\s*1px solid var\(--color-line\)/su);
    expect(styles).toMatch(/\.okw-pool-description\s*\{[^}]*field-sizing:\s*content/su);
    expect(styles).toMatch(/\.okw-pool-description\s*\{[^}]*max-height:\s*calc\(3em \+ 11px\)/su);
    expect(styles).toMatch(/\.okw-pool-description\s*\{[^}]*overflow-y:\s*auto[^}]*resize:\s*none/su);
    expect(styles).toMatch(/\.okw-pool-description\s*\{[^}]*border:\s*0[^}]*background:\s*transparent/su);
    expect(styles).not.toMatch(/\.okw-pool-description\s*\{[^}]*surface-overlay/su);
  });
  it('shows every saved candidate with descriptions, the default and the retained effort', async () => {
    const ui = await install({ section: pool });
    await openMobile(ui);
    expect(ui.cards().map((card) => card.dataset.model))
      .toEqual(['fixture/under_score', 'fixture/fast', 'fixture/always', 'pool_a', 'pool_b']);
    expect(ui.count()).toBe('5 candidates');
    expect(ui.description('fixture/under_score').value).toBe('line one\nline two');
    expect(ui.description('fixture/always').value).toBe('');
    expect(ui.radioFor('fixture/under_score').checked).toBe(true);
    expect(ui.radioFor('fixture/fast').checked).toBe(false);
    expect(ui.cardFor('pool_a').querySelector('.okw-pool-model').textContent).toBe('pool_a');
    const effort = ui.doc.querySelectorAll('.okw-pool-body > .okw-pool-note')[2];
    expect(effort.textContent).toBe('Global thinking effort: Medium');
    expect(ui.notes().some((note) => note.includes('not fixed dispatch rules'))).toBe(true);
    expect(ui.button('save').disabled).toBe(true);
  });
  it('applies both templates to the draft, survives re-editing and cancels without a write', async () => {
    const ui = await install({ section: pool });
    await openMobile(ui);
    const words = ui.copy();
    ui.cardFor('fixture/fast').querySelector('[data-template="strong"]').click();
    expect(ui.description('fixture/fast').value).toBe(words.strongText);
    expect(ui.doc.activeElement).toBe(ui.description('fixture/fast'));
    ui.cardFor('fixture/fast').querySelector('[data-template="fast"]').click();
    expect(ui.description('fixture/fast').value).toBe(words.fastText);
    ui.write('fixture/fast', 'custom mix');
    expect(ui.button('save').disabled).toBe(false);
    expect(ui.posts).toEqual([]);
    ui.click('cancel');
    expect(ui.dialog()).toBeNull();
    expect(ui.doc.activeElement).toBe(ui.doc.querySelector('.sheet-body .okw-pool-trigger'));
    expect(ui.posts).toEqual([]);
    await openMobile(ui);
    expect(ui.description('fixture/fast').value).toBe('keep fast');
  });
  it('moves only the default candidate through the radio and discards it on cancel', async () => {
    const ui = await install({ section: pool });
    await openMobile(ui);
    ui.radioFor('fixture/fast').click();
    expect(ui.radioFor('fixture/fast').checked).toBe(true);
    expect(ui.radioFor('fixture/under_score').checked).toBe(false);
    expect(ui.button('save').disabled).toBe(false);
    ui.click('cancel');
    expect(ui.posts).toEqual([]);
  });
});

describe('subagent pool add-candidate picker', () => {
  const one = { defaultModel: 'fixture/under_score', models: { 'fixture/under_score': 'orig' } };
  const openChooser = async (ui) => {
    await openMobile(ui);
    ui.click('add');
    await ui.settled();
    return ui;
  };
  it('lists configured models without a follow entry and excludes current candidates', async () => {
    const ui = await openChooser(await install({ section: one }));
    expect(ui.pickerRows().map((row) => row.dataset.model)).toEqual(['fixture/fast', 'fixture/always']);
    expect(ui.pickerRows().some((row) => row.dataset.model === '')).toBe(false);
    expect(ui.chips().map((chip) => chip.textContent)).toEqual(['All', 'Provider-A', 'Provider-B']);
    ui.chips()[2].click();
    await ui.settled();
    expect(ui.pickerRows().map((row) => row.dataset.model)).toEqual(['fixture/always']);
    ui.chips()[0].click();
    ui.typeSearch('FAST');
    expect(ui.pickerRows().map((row) => row.dataset.model)).toEqual(['fixture/fast']);
    ui.typeSearch('under');
    expect(ui.pickerRows()).toHaveLength(0);
    expect(ui.dialog().textContent).toContain('No matching models');
  });
  it('adds with ArrowDown/ArrowUp and Enter, focuses the new description and keeps the default', async () => {
    const ui = await openChooser(await install({ section: one }));
    expect(ui.pickerRows()[0].classList.contains('is-selected')).toBe(true);
    ui.key('ArrowDown');
    expect(ui.pickerRows()[1].classList.contains('is-selected')).toBe(true);
    ui.key('ArrowUp');
    ui.key('Enter');
    await ui.settled();
    expect(ui.doc.querySelector('.okw-pool-chooser').hidden).toBe(true);
    expect(ui.cards().map((card) => card.dataset.model)).toEqual(['fixture/under_score', 'fixture/fast']);
    expect(ui.description('fixture/fast').value).toBe('');
    expect(ui.doc.activeElement).toBe(ui.description('fixture/fast'));
    expect(ui.radioFor('fixture/under_score').checked).toBe(true);
    expect(ui.button('save').disabled).toBe(false);
  });
  it('ignores Enter during IME composition and the keyCode 229 boundary before adding once', async () => {
    const ui = await openChooser(await install({ section: one }));
    ui.typeSearch('fast');
    const start = new ui.view.Event('compositionstart', { bubbles: true });
    ui.searchInput().dispatchEvent(start);
    ui.key('Enter', ui.searchInput(), { isComposing: true });
    ui.key('Enter', ui.searchInput(), { keyCode: 229 });
    expect(ui.cards()).toHaveLength(1);
    ui.searchInput().dispatchEvent(new ui.view.Event('compositionend', { bubbles: true }));
    ui.key('Enter');
    await ui.settled();
    expect(ui.cards()).toHaveLength(2);
  });
  it('does not submit from a description textarea and closes with Escape back to the trigger', async () => {
    const ui = await openChooser(await install({ section: one }));
    ui.pickerRows()[0].click();
    await ui.settled();
    const event = ui.key('Enter', ui.description('fixture/fast'));
    await ui.settled();
    expect(event.defaultPrevented).toBe(false);
    expect(ui.posts).toEqual([]);
    expect(ui.dialog()).not.toBeNull();
    ui.key('Escape', ui.description('fixture/fast'));
    await ui.settled();
    expect(ui.dialog()).toBeNull();
    expect(ui.doc.activeElement).toBe(ui.doc.querySelector('.sheet-body .okw-pool-trigger'));
  });
});

describe('subagent pool save flow', () => {
  const editedDraft = (ui) => { ui.write('fixture/under_score', 'new text'); };
  it('posts one incremental patch, ignores busy repeats and keeps main model, effort and other entries', async () => {
    const ui = await install({ section: pool });
    await openMobile(ui);
    editedDraft(ui);
    ui.click('save');
    expect(ui.button('cancel').disabled).toBe(true);
    expect(ui.button('close').disabled).toBe(true);
    ui.button('cancel').click();
    expect(ui.dialog()).not.toBeNull();
    ui.button('save').click();
    await ui.settled();
    expect(ui.posts).toEqual([{ secondary_model: { models: { 'fixture/under_score': 'new text' } } }]);
    expect(ui.invalid).toEqual([]);
    const persisted = ui.getConfig();
    expect(persisted).toMatchObject({ default_model: 'fixture/main', thinking: true, hooks: ['fixture'] });
    expect(persisted.secondary_model.defaultEffort).toBe('medium');
    expect(persisted.secondary_model.models).toEqual({
      'fixture/under_score': 'new text', 'fixture/fast': 'keep fast', 'fixture/always': '',
      pool_a: 'Alpha note', pool_b: 'B',
    });
    expect(requestLog(ui).slice(-5)).toEqual([
      'GET /api/v1/config', 'GET /api/v1/models', 'POST /api/v1/config', 'GET /api/v1/config', 'GET /api/v1/models',
    ]);
    expect(ui.status()).toBe('Saved and verified with the server.');
    expect(ui.button('save').disabled).toBe(true);
    expect(ui.button('cancel').disabled).toBe(false);
  });
  it('keeps the draft on a failed request, shows retry and saves on the second attempt', async () => {
    const ui = await install({ section: pool });
    await openMobile(ui);
    editedDraft(ui);
    ui.nativeFetch.mockRejectedValueOnce(new Error('fixture failure'));
    ui.click('save');
    await ui.settled();
    expect(ui.status()).toBe('Request failed; please retry.');
    expect(ui.button('retry').hidden).toBe(false);
    expect(ui.description('fixture/under_score').value).toBe('new text');
    expect(ui.posts).toEqual([]);
    ui.button('retry').click();
    await ui.settled();
    expect(ui.posts).toHaveLength(1);
    expect(ui.status()).toBe('Saved and verified with the server.');
  });
  it('reports a concurrent same-item change without overwriting the newcomer or effort', async () => {
    const ui = await install({ section: {
      defaultModel: 'fixture/under_score', defaultEffort: 'medium',
      models: { 'fixture/under_score': 'orig', 'fixture/fast': 'keep fast' } } });
    await openMobile(ui);
    ui.setConfig(fixtureConfig({
      defaultModel: 'fixture/under_score', defaultEffort: 'medium',
      models: { 'fixture/under_score': 'theirs', 'fixture/fast': 'keep fast', 'fixture/z': 'newcomer' } }));
    ui.write('fixture/under_score', 'mine');
    ui.click('save');
    await ui.settled();
    expect(ui.posts).toEqual([]);
    expect(ui.status()).toBe(ui.copy().configChanged);
    expect(ui.button('retry').hidden).toBe(true);
    expect(ui.description('fixture/under_score').value).toBe('mine');
    expect(ui.getConfig().secondary_model.models)
      .toEqual({ 'fixture/under_score': 'theirs', 'fixture/fast': 'keep fast', 'fixture/z': 'newcomer' });
    ui.click('cancel');
    await openMobile(ui);
    expect(ui.cards().map((card) => card.dataset.model))
      .toEqual(['fixture/under_score', 'fixture/fast', 'fixture/z']);
    expect(ui.description('fixture/under_score').value).toBe('theirs');
  });
});

describe('subagent pool locale', () => {
  it('retranslates the open dialog without losing typed draft, nodes, focus or requests', async () => {
    const ui = await install({ section: {
      defaultModel: 'fixture/under_score', defaultEffort: 'medium',
      models: { 'fixture/under_score': 'orig', 'fixture/fast': 'keep fast' } } });
    await openMobile(ui);
    ui.write('fixture/under_score', 'user draft text');
    const field = ui.description('fixture/under_score');
    const card = ui.cardFor('fixture/under_score');
    field.focus();
    const requests = ui.nativeFetch.mock.calls.length;
    await switchLocale(ui, 'zh');
    const words = ui.copy();
    expect(ui.cardFor('fixture/under_score')).toBe(card);
    expect(ui.description('fixture/under_score')).toBe(field);
    expect(field.value).toBe('user draft text');
    expect(ui.doc.activeElement).toBe(field);
    expect(ui.count()).toBe('2 个候选');
    expect(ui.button('save').textContent).toBe(words.save);
    expect(ui.doc.querySelector('.okw-pool-entry-label').textContent).toBe(words.entry);
    expect(card.querySelector('.okw-pool-default').textContent).toContain('默认候选');
    expect(ui.notes().some((note) => note.includes('不是固定派发规则'))).toBe(true);
    expect(ui.nativeFetch).toHaveBeenCalledTimes(requests);
    expect(ui.posts).toEqual([]);
    await switchLocale(ui, 'en');
    expect(ui.count()).toBe('2 candidates');
    expect(field.value).toBe('user draft text');
  });
});

describe('subagent pool empty start', () => {
  it('makes the first added candidate the default and preserves blank descriptions on save', async () => {
    const ui = await install();
    await openMobile(ui);
    expect(ui.dialog().textContent).toContain('No separate pool yet');
    expect(ui.dialog().textContent).toContain('Currently following the main model');
    ui.click('add');
    await ui.settled();
    ui.pickerRows()[0].click();
    expect(ui.radioFor('fixture/fast').checked).toBe(true);
    expect(ui.description('fixture/fast').value).toBe('');
    ui.click('add');
    await ui.settled();
    ui.pickerRows()[0].click();
    expect(ui.radioFor('fixture/fast').checked).toBe(true);
    ui.write('fixture/always', 'batch tasks');
    ui.click('save');
    await ui.settled();
    expect(ui.posts).toEqual([{ secondary_model: {
      defaultModel: 'fixture/fast', models: { 'fixture/fast': '', 'fixture/always': 'batch tasks' } } }]);
    expect(ui.invalid).toEqual([]);
    expect(ui.getConfig().secondary_model)
      .toEqual({ defaultModel: 'fixture/fast', models: { 'fixture/fast': '', 'fixture/always': 'batch tasks' } });
    expect(ui.dialog().textContent).toContain('Descriptions guide the main agent');
    expect(ui.status()).toBe('Saved and verified with the server.');
  });
});
