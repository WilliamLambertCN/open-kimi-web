/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, install, markup, switchLocale } from './testkit/subagentPool.mjs';

afterEach(cleanup);
const openDialog = async (ui) => ui.open(ui.doc.querySelector('.okw-pool-trigger'));

describe('subagent pool real DOM observer', () => {
  it('keeps the open dialog across session-status patches and reopens after the sheet remounts', async () => {
    const ui = await install({ section: { defaultModel: 'fixture/under_score', models: { 'fixture/under_score': 'orig' } } });
    await openDialog(ui);
    ui.panel.querySelector('.sheet-body .card').textContent = 'ctx 5/128k · running';
    ui.panel.querySelector('.sheet-body').insertAdjacentHTML('beforeend', '<div class="card">Status tick</div>');
    await ui.settled();
    expect(ui.dialog()?.hasAttribute('open')).toBe(true);
    const sheetEntries = () => [...ui.doc.querySelectorAll('.sheet-root .okw-pool-entry')];
    expect(sheetEntries()).toHaveLength(1);
    const template = ui.doc.createElement('template');
    template.innerHTML = markup('Settings', true);
    ui.root.replaceWith(template.content.firstElementChild);
    await ui.settled();
    expect(ui.dialog()).toBeNull();
    expect(sheetEntries()).toHaveLength(1);
    const reopened = await ui.open(ui.doc.querySelector('.sheet-root .okw-pool-trigger'));
    expect(reopened?.hasAttribute('open')).toBe(true);
    expect(ui.cards()).toHaveLength(1);
    expect(ui.posts).toEqual([]);
  });
  it('converges after open, draft edits, picker filtering, default moves and locale swaps', async () => {
    const ui = await install({ section: { defaultModel: 'fixture/under_score',
      models: { 'fixture/under_score': 'orig', 'fixture/fast': 'keep' } } });
    await openDialog(ui);
    ui.write('fixture/under_score', 'edited');
    await ui.settled();
    ui.click('add');
    ui.typeSearch('fast');
    await ui.settled();
    ui.chips()[0].click();
    ui.radioFor('fixture/fast').click();
    await ui.settled();
    expect(ui.entries()).toHaveLength(2);
    expect(ui.cards()).toHaveLength(2);
    expect(ui.doc.querySelectorAll('.okw-pool-dialog')).toHaveLength(1);
    await switchLocale(ui, 'zh');
    expect(ui.cards()).toHaveLength(2);
    expect(ui.posts).toEqual([]);
  });
  it('streams one hundred chat deltas with the picker open without scanning document or settings', async () => {
    const ui = await install({ section: { defaultModel: 'fixture/under_score', models: { 'fixture/under_score': 'orig' } } });
    await openDialog(ui);
    ui.click('add');
    await ui.settled();
    const globalQueries = vi.spyOn(ui.doc, 'querySelectorAll');
    const sheetQueries = vi.spyOn(ui.root, 'querySelector');
    const chat = ui.doc.querySelector('.chat-scroll');
    const chatQueries = vi.spyOn(chat, 'querySelectorAll');
    const side = ui.doc.querySelector('.sc-body');
    for (let index = 0; index < 100; index += 1) {
      chat.insertAdjacentHTML('beforeend', '<div class="a-msg">Fixture text</div>');
      chat.lastElementChild.insertAdjacentHTML('beforeend', '<span><b>Stream delta</b></span>');
      side.textContent = `Fixture ${index}`;
    }
    await ui.settled();
    expect(globalQueries).not.toHaveBeenCalled();
    expect(sheetQueries).not.toHaveBeenCalled();
    expect(chatQueries).not.toHaveBeenCalled();
    expect(ui.dialog()).not.toBeNull();
    expect(ui.pickerRows()).toHaveLength(2);
    expect(ui.posts).toEqual([]);
  });
  it('leaves the chat area untouched by dialog renders and reuses card nodes across re-renders', async () => {
    const ui = await install({ section: { defaultModel: 'fixture/under_score', models: { 'fixture/under_score': 'orig' } } });
    await openDialog(ui);
    const card = ui.cardFor('fixture/under_score');
    const chat = ui.doc.querySelector('.chat-scroll');
    ui.write('fixture/under_score', 'first');
    ui.write('fixture/under_score', 'second');
    await ui.settled();
    expect(ui.cardFor('fixture/under_score')).toBe(card);
    expect(card.querySelector('.okw-pool-description').value).toBe('second');
    expect(chat.querySelectorAll('.okw-pool-card')).toHaveLength(0);
    expect(ui.state.calls).toBeLessThan(100);
  });
});
