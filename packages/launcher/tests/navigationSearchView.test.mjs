/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
const source = readFileSync(resolve('packages/launcher/src/mobile/navigationSearchView.js'), 'utf8');
const frames = [];
function install() {
  const frame = document.createElement('iframe'); document.body.append(frame); frames.push(frame);
  const view = frame.contentWindow; view.__okwLocale = { text: (_, en) => en }; view.eval(source);
  const close = vi.fn(); const run = vi.fn(); const schedule = vi.fn();
  const ui = view.__okwNavigationBuildSearch({ close, run, schedule }); ui.root.hidden = false;
  return { view, doc: view.document, ui, close, run, schedule };
}
afterEach(() => { frames.splice(0).forEach((frame) => frame.remove()); });
describe('official search dialog view', () => {
  it('shows supported filters and sends native input changes without interpreting result HTML', () => {
    const test = install();
    expect([...test.ui.role.options].map((option) => option.value)).toEqual(['', 'user', 'assistant', 'title']);
    test.ui.mode.value = 'literal'; test.ui.mode.dispatchEvent(new test.view.Event('change'));
    expect(test.ui.sort.disabled).toBe(true); expect(test.schedule).toHaveBeenCalledOnce();
    const result = test.view.__okwNavigationSearchResult({ session_id: 'demo/one', session_title: '<img src=x>',
      snippet: '<script>unsafe</script>', role: 'assistant' });
    expect(result.querySelector('img, script')).toBeNull();
    expect(result.textContent).toContain('<script>unsafe</script>');
    expect(result.getAttribute('href')).toBe('/sessions/demo%2Fone');
  });
  it('isolates native document question handlers without suppressing editing or IME defaults', () => {
    const test = install();
    const native = vi.fn(); const target = vi.fn();
    test.doc.addEventListener('keydown', (event) => test.view.__okwNavigationSearchKey(event,
      { panel: test.ui.panel, close: test.close }), true);
    test.doc.addEventListener('keydown', native, true); test.doc.addEventListener('keydown', native);
    test.ui.input.addEventListener('keydown', target);
    for (const [key, isComposing] of [['Enter', false], ['a', false], ['ArrowDown', false], ['Enter', true]]) {
      const event = new test.view.KeyboardEvent('keydown', { key, isComposing, bubbles: true, cancelable: true });
      test.ui.input.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
    }
    expect(native).not.toHaveBeenCalled(); expect(target).not.toHaveBeenCalled();
    test.ui.input.dispatchEvent(new test.view.CompositionEvent('compositionend', { bubbles: true, data: '测试' }));
    expect(test.schedule).toHaveBeenCalledOnce();
  });
  it('traps Tab and Shift+Tab, excludes disabled controls, and honors composing Escape', () => {
    const test = install(); const { panel, more, sort } = test.ui; more.hidden = false; sort.disabled = true;
    const trigger = (key, extra = {}) => {
      const event = new test.view.KeyboardEvent('keydown', { key, cancelable: true, ...extra });
      test.view.__okwNavigationSearchKey(event, { panel, close: test.close }); return event;
    };
    more.focus(); expect(trigger('Tab').defaultPrevented).toBe(true);
    expect(test.doc.activeElement).toBe(panel.querySelector('button'));
    trigger('Tab', { shiftKey: true }); expect(test.doc.activeElement).toBe(more);
    trigger('Escape', { isComposing: true }); expect(test.close).not.toHaveBeenCalled();
    trigger('Escape'); expect(test.close).toHaveBeenCalledOnce();
  });
});
