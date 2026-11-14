/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve('packages/launcher/src/mobile/touchTooltip.js'), 'utf8');
const frames = [];
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function install({ direct = false, patched = true } = {}) {
  const frame = document.createElement('iframe');
  document.body.append(frame); frames.push(frame);
  const view = frame.contentWindow;
  const doc = view.document;
  doc.body.innerHTML = `<div class="sheet-root"><div class="list"><span class="ui-tip">
    <button aria-describedby="details" aria-label="Open file">Fictional long path</button></span></div></div>
    <input aria-label="Draft"><p id="details">File details</p><div class="unrelated" role="tooltip">Other tip</div>`;
  const button = doc.querySelector('button');
  if (direct) { button.className = 'ui-icon-button'; button.parentElement.className = ''; }
  const target = direct ? button : button.parentElement;
  const state = { pending: false, hovered: false, hides: 0 };
  const render = () => {
    if (!state.pending) return;
    state.pending = false;
    const bubble = doc.createElement('div');
    bubble.className = 'ui-tip__bubble'; bubble.setAttribute('role', 'tooltip'); bubble.textContent = 'Fictional path';
    doc.body.append(bubble);
  };
  const hide = () => {
    state.hides += 1; state.pending = false; state.hovered = false;
    doc.querySelectorAll('.ui-tip__bubble').forEach(node => node.remove());
  };
  target.addEventListener('pointermove', () => {
    if (state.hovered) return;
    state.hovered = true; state.pending = true;
  }, { passive: true });
  target.addEventListener('focusin', () => { state.pending = true; });
  target.addEventListener('focusout', hide);
  target.addEventListener(direct ? 'mouseleave' : 'mouseout', event => {
    if (!direct && event.relatedTarget instanceof view.Element && target.contains(event.relatedTarget)) return;
    hide();
  });
  const pointer = (type, pointerType = 'touch', node = button, extra = {}) => {
    const event = new view.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { pointerType, ...extra }); node.dispatchEvent(event); return event;
  };
  if (patched) view.eval(source);
  return { view, doc, button, target, state, render, hide, pointer,
    tips: () => doc.querySelectorAll('.ui-tip__bubble'),
    key: key => doc.dispatchEvent(new view.KeyboardEvent('keydown', { key, bubbles: true })),
    focus: () => button.dispatchEvent(new view.FocusEvent('focusin', { bubbles: true })) };
}

afterEach(() => { frames.splice(0).forEach(frame => frame.remove()); });

describe('touch tooltip lifecycle', () => {
  it('reproduces the upstream pending and visible tooltip with no touch-end dismissal', async () => {
    const ui = install({ patched: false });
    ui.pointer('pointermove'); await settle(); ui.render(); ui.pointer('pointerup');
    expect(ui.tips()).toHaveLength(1);
    ui.doc.querySelector('.sheet-root').style.display = 'none';
    expect(ui.tips()).toHaveLength(1);
  });

  it.each([false, true])('cancels the native show after touch dispatch, direct=%s', async direct => {
    const ui = install({ direct });
    ui.pointer('pointerdown'); ui.pointer('pointermove');
    expect(ui.state.pending).toBe(true);
    await settle();
    expect(ui.state.pending).toBe(false);
    ui.render(); expect(ui.tips()).toHaveLength(0);
    ui.pointer('pointermove'); await settle(); ui.render();
    expect(ui.tips()).toHaveLength(0);
    expect(ui.doc.querySelector('.unrelated').textContent).toBe('Other tip');
    expect(ui.button.getAttribute('aria-describedby')).toBe('details');
    expect(ui.button.getAttribute('aria-label')).toBe('Open file');
  });

  it('does not suppress touch scrolling, click, focus, text selection or editing', async () => {
    const ui = install();
    const click = vi.fn(); ui.button.addEventListener('click', click);
    const down = ui.pointer('pointerdown'); const move = ui.pointer('pointermove');
    const up = ui.pointer('pointerup');
    const event = new ui.view.MouseEvent('click', { bubbles: true, cancelable: true });
    ui.button.dispatchEvent(event); await settle();
    expect([down, move, up, event].every(item => !item.defaultPrevented)).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
    const input = ui.doc.querySelector('input'); input.focus(); input.value = 'Untouched draft';
    expect(ui.doc.activeElement).toBe(input); expect(input.value).toBe('Untouched draft');
    input.blur();
    const range = ui.doc.createRange(); range.selectNodeContents(ui.button);
    ui.view.getSelection().removeAllRanges(); ui.view.getSelection().addRange(range);
    expect(ui.view.getSelection().toString()).toBe('Fictional long path');
  });

  it('retains mouse and keyboard tips on the same device after touch', async () => {
    const ui = install();
    ui.pointer('pointermove'); await settle();
    ui.pointer('pointermove', 'mouse'); await settle(); ui.render();
    expect(ui.tips()).toHaveLength(1);
    ui.pointer('pointermove', 'touch'); await settle();
    expect(ui.tips()).toHaveLength(0);
    ui.key('Tab'); ui.focus(); await settle(); ui.render();
    expect(ui.tips()).toHaveLength(1);
    ui.key('Escape'); expect(ui.tips()).toHaveLength(0);
    ui.key('Tab'); ui.focus(); await settle(); ui.render();
    ui.pointer('pointerdown'); await settle();
    expect(ui.tips()).toHaveLength(0);
  });

  it('suppresses compatibility mouse movement and touch-induced focus without changing focus', async () => {
    const ui = install();
    ui.pointer('pointermove', 'mouse', ui.button, { sourceCapabilities: { firesTouchEvents: true } });
    await settle(); ui.render(); expect(ui.tips()).toHaveLength(0);
    ui.button.focus(); await settle(); ui.render();
    expect(ui.tips()).toHaveLength(0); expect(ui.doc.activeElement).toBe(ui.button);
    ui.key('Shift'); ui.focus(); await settle(); ui.render(); expect(ui.tips()).toHaveLength(0);
    ui.key('Tab'); ui.focus(); await settle(); ui.render(); expect(ui.tips()).toHaveLength(1);
  });

});

describe('tooltip dismissal and isolation', () => {
  it('keeps a new mouse or keyboard tooltip when a touch cleanup task is still queued', async () => {
    const ui = install();
    ui.pointer('pointermove', 'touch');
    ui.pointer('pointermove', 'mouse');
    await settle(); ui.render(); expect(ui.tips()).toHaveLength(1);
    ui.pointer('pointerdown', 'touch');
    ui.key('Tab'); ui.focus();
    await settle(); ui.render(); expect(ui.tips()).toHaveLength(1);
  });

  it.each(['pointerup', 'pointercancel'])('cancels delayed display on %s', async type => {
    const ui = install();
    ui.pointer('pointermove', 'mouse'); await settle();
    expect(ui.state.pending).toBe(true);
    ui.pointer(type); await settle(); ui.render();
    expect(ui.state.pending).toBe(false); expect(ui.tips()).toHaveLength(0);
  });

  it.each(['scroll', 'blur', 'pagehide', 'click'])('clears visible and pending tooltips on %s', async type => {
    const ui = install();
    for (const visible of [false, true]) {
      ui.pointer('pointermove', 'mouse'); await settle();
      if (visible) ui.render();
      const node = ['blur', 'pagehide'].includes(type) ? ui.view : ui.doc.querySelector('.list');
      node.dispatchEvent(new ui.view.Event(type, { bubbles: true }));
      ui.render(); expect(ui.tips()).toHaveLength(0); expect(ui.state.pending).toBe(false);
    }
  });

  it('dismisses only the previous hover source and does not scan or observe the page', async () => {
    const ui = install();
    const query = vi.spyOn(ui.doc, 'querySelectorAll');
    const observer = vi.spyOn(ui.view, 'MutationObserver');
    ui.view.eval(source);
    const oldHides = ui.state.hides;
    ui.pointer('pointermove', 'mouse'); await settle();
    ui.pointer('pointermove', 'mouse', ui.doc.querySelector('input')); await settle();
    expect(ui.state.hides - oldHides).toBe(1);
    expect(query).toHaveBeenCalledTimes(1);
    expect(observer).not.toHaveBeenCalled();
    ui.pointer('pointermove', 'mouse'); await settle(); ui.render();
    Object.defineProperty(ui.doc, 'hidden', { value: true });
    ui.doc.dispatchEvent(new ui.view.Event('visibilitychange'));
    expect(ui.tips()).toHaveLength(0);
  });
});
