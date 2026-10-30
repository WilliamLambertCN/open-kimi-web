/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync('packages/launcher/src/mobile/effortOrder.js', 'utf8');
const tick = () => new Promise((done) => setTimeout(done, 0));
const frames = [];
const observers = [];
const raw = ['low', 'medium', 'max', 'high', 'xhigh', 'future_b', 'future_a'];
const labels = (node) => [...node.querySelectorAll('button')].map((button) => button.textContent.trim());
const segment = (values, extra = '') => `<div class="ui-seg ui-seg--xs" role="tablist" ${extra}>
  ${values.map((value) => `<button class="ui-seg__item" role="tab" aria-selected="${value === 'max'}">
    ${value}</button>`).join('\n')}</div>`;
const mobile = (title, row, values) => `<div class="sheet-root"><div class="sheet-panel" role="dialog"
  aria-label="${title}"><span class="sheet-title">${title}</span><div class="sheet-body"><div class="srow read-only">
  <span class="srow-main"><span class="srow-label">${row}</span></span>${segment(values)}</div></div></div></div>`;
const flyout = (values, name = 'Thinking effort') => `<button class="sm-picker__trigger" role="combobox"
  aria-controls="sm-picker-fixture" aria-expanded="true">Subagent model</button>
  <div id="sm-picker-fixture" class="sm-picker__menu" role="dialog"><div class="sm-picker__models" role="listbox">
  <button class="sm-picker__option" role="option" aria-selected="true">Fixture model</button></div>
  <div class="sm-picker__flyout" role="listbox" aria-label="${name}"><div class="sm-picker__group">${name}</div>
  ${values.map((value) => `<button class="sm-picker__option" role="option" aria-selected="${value === 'medium'}">
    <span class="sm-picker__check"></span><span class="sm-picker__option-label">${value}</span></button>`).join('\n')}
  </div></div>`;

afterEach(() => {
  observers.splice(0).forEach((observer) => observer.disconnect());
  frames.splice(0).forEach((frame) => frame.remove());
});

function instrument(view) {
  const Native = view.MutationObserver;
  const state = { calls: 0, stopped: false, installs: 0 };
  view.MutationObserver = class extends Native {
    constructor(callback) {
      super((records, observer) => {
        state.calls += 1;
        if (state.calls > 100) { state.stopped = true; observer.disconnect(); return; }
        callback(records, observer);
      });
      state.installs += 1;
      observers.push(this);
    }
  };
  return state;
}

function install(markup = '', setup = () => {}) {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const view = frame.contentWindow;
  const doc = view.document;
  doc.body.innerHTML = `<div class="app"><div class="chat-scroll"></div><div class="sc-body"></div></div>${markup}`;
  const state = instrument(view);
  Object.defineProperty(view, 'localStorage', { value: { getItem: vi.fn(), setItem: vi.fn() } });
  view.fetch = vi.fn();
  const key = (value, node = doc.querySelector('.sm-picker__trigger'), options = {}) => {
    const event = new view.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options });
    node.dispatchEvent(event);
    return event;
  };
  const settled = async () => {
    await tick();
    const calls = state.calls;
    await tick();
    expect(state.stopped).toBe(false);
    expect(state.calls).toBe(calls);
  };
  const ui = { view, doc, state, key, settled };
  ui.native = setup(ui);
  view.eval(source);
  return ui;
}

function nativePicker(ui) {
  const nodes = [...ui.doc.querySelectorAll('.sm-picker__flyout button')];
  const trigger = ui.doc.querySelector('.sm-picker__trigger');
  const state = { lane: 'models', index: 1, commits: [], nativeKeys: [], modelMoves: 0 };
  const active = () => nodes.forEach((node, index) => {
    node.classList.toggle('is-kb-active', state.lane === 'efforts' && index === state.index);
    node.classList.toggle('is-active', state.lane === 'efforts' && index === state.index);
  });
  nodes.forEach((node, index) => {
    node.addEventListener('mouseenter', () => { state.lane = 'efforts'; state.index = index; active(); });
    node.addEventListener('click', () => state.commits.push({ value: node.textContent.trim(), node }));
  });
  ui.doc.querySelector('.sm-picker__models button').addEventListener('mouseenter', () => {
    state.lane = 'models'; active();
  });
  trigger.addEventListener('keydown', (event) => {
    state.nativeKeys.push(event.key);
    if (event.key === 'ArrowLeft') state.lane = 'models';
    else if (event.key === 'ArrowRight') { state.lane = 'efforts'; state.index = 1; }
    else if (event.key === 'Enter' || event.key === ' ') {
      if (state.lane === 'models') state.lane = 'efforts';
      else nodes[state.index].click();
    } else if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
      if (state.lane === 'models') state.modelMoves += 1;
      else state.index = (state.index + (event.key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length;
    }
    active();
  });
  return { nodes, state, active: () => nodes[state.index] };
}

describe('effort display order without metadata mutation', () => {
  it('sorts only supplied entries with stable prefixes and unknown values before Max', () => {
    const ui = install();
    const input = ['', 'on', 'off', 'max', 'future_b', 'high', 'none', 'low', 'future_a', 'minimal', 'medium', 'xhigh'];
    const original = [...input];
    expect(ui.view.__okwEffortOrder.sort(input)).toEqual([
      '', 'on', 'off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'future_b', 'future_a', 'max',
    ]);
    expect(input).toEqual(original);
    const entries = ['Max', 'Low', 'Low', 'Future'].map((value) => ({ value }));
    expect(ui.view.__okwEffortOrder.sort(entries, (entry) => entry.value))
      .toEqual([entries[1], entries[2], entries[3], entries[0]]);
    expect(ui.view.__okwEffortOrder.sort(['on', 'off'])).toEqual(['on', 'off']);
    expect(ui.view.localStorage.getItem).not.toHaveBeenCalled();
    expect(ui.view.localStorage.setItem).not.toHaveBeenCalled();
    expect(ui.view.fetch).not.toHaveBeenCalled();
  });

  it('orders official composer/status buttons while retaining selected values, focus and original click handlers', async () => {
    const values = ['Off', 'Low', 'Medium', 'Max', 'High', 'Xhigh', 'future_b', 'future_a', 'None', 'Minimal'];
    const clicked = vi.fn();
    const ui = install(`<div class="md-thinking">${segment(values)}</div>
      <div class="thinking-value">${segment(values)}</div>`, ({ doc }) => {
      const buttons = [...doc.querySelectorAll('.md-thinking button')];
      buttons[3].setAttribute('aria-selected', 'true');
      buttons[3].focus();
      buttons.forEach((button) => button.addEventListener('click', clicked));
      return buttons;
    });
    await ui.settled();
    const ordered = ['Off', 'None', 'Minimal', 'Low', 'Medium', 'High', 'Xhigh', 'future_b', 'future_a', 'Max'];
    expect(labels(ui.doc.querySelector('.md-thinking'))).toEqual(ordered);
    expect(labels(ui.doc.querySelector('.thinking-value'))).toEqual(ordered);
    expect(ui.doc.activeElement).toBe(ui.native[3]);
    expect(ui.native[3].getAttribute('aria-selected')).toBe('true');
    ui.doc.querySelector('.md-thinking button:last-child').click();
    expect(clicked).toHaveBeenCalledOnce();
    expect(clicked.mock.calls[0][0].target).toBe(ui.native[3]);
    expect(ui.native.every((button) => button.isConnected)).toBe(true);
    expect(values[3]).toBe('Max');
  });

  it.each([
    ['Settings', 'Thinking', 'Thinking by default'], ['会话设置', '思考', '默认开启思考'],
    ['设置', '思考强度', '默认开启思考'],
  ])('matches %s mobile row and default-thinking aria without touching unrelated segments', async (title, row, aria) => {
    const ui = install(`${mobile(title, row, raw)}${mobile('Providers', row, raw)}${mobile(title, 'Font size', raw)}
      <div class="defaults">${segment(raw, `aria-label="${aria}"`)}</div>
      <div class="unrelated">${segment(raw, 'aria-label="Font size"')}</div>`);
    await ui.settled();
    const panels = ui.doc.querySelectorAll('.sheet-panel');
    const expected = ['low', 'medium', 'high', 'xhigh', 'future_b', 'future_a', 'max'];
    expect(labels(panels[0])).toEqual(expected);
    expect(labels(panels[1])).toEqual(raw);
    expect(labels(panels[2])).toEqual(raw);
    expect(labels(ui.doc.querySelector('.defaults'))).toEqual(expected);
    expect(labels(ui.doc.querySelector('.unrelated'))).toEqual(raw);
  });
});

describe('official Teleport effort navigation uses displayed nodes', () => {
  it.each(['Thinking effort', '思考强度'])('orders %s and routes trigger keys through original option events', async (name) => {
    const values = ['Model default', 'Off', ...raw];
    const ui = install(flyout(values, name), nativePicker);
    await ui.settled();
    const lane = ui.doc.querySelector('.sm-picker__flyout');
    expect(labels(lane)).toEqual(['Model default', 'Off', 'low', 'medium', 'high', 'xhigh', 'future_b', 'future_a', 'max']);
    expect(ui.key('ArrowDown').defaultPrevented).toBe(false);
    expect(ui.native.state.modelMoves).toBe(1);
    ui.key('ArrowRight');
    expect(ui.key('End').defaultPrevented).toBe(true);
    expect(ui.native.active().textContent.trim()).toBe('max');
    ui.key('ArrowUp');
    expect(ui.native.active().textContent.trim()).toBe('future_a');
    ui.key('ArrowDown');
    ui.key('ArrowDown');
    expect(ui.native.active().textContent.trim()).toBe('Model default');
    ui.key('ArrowUp');
    expect(ui.native.active().textContent.trim()).toBe('max');
    ui.key('Home'); ui.key('ArrowDown'); ui.key('ArrowDown'); ui.key('Enter');
    expect(ui.native.state.commits).toEqual([{ value: 'low', node: ui.native.nodes[2] }]);
    expect(ui.native.state.nativeKeys).toEqual(['ArrowDown', 'ArrowRight']);
    expect(ui.native.nodes.map((node) => node.textContent.trim())).toEqual(values);
    expect(lane.querySelector('[aria-selected="true"]')).toBe(ui.native.nodes[3]);
    await ui.settled();
  });

  it('keeps model-lane keys native after hover/back and handles pointer-to-effort and focused options', async () => {
    const ui = install(flyout(['Off', ...raw]), nativePicker);
    await ui.settled();
    const max = ui.native.nodes[3];
    max.dispatchEvent(new ui.view.MouseEvent('mouseenter'));
    ui.key('ArrowUp');
    expect(ui.native.active().textContent.trim()).toBe('future_a');
    ui.key(' ');
    expect(ui.native.state.commits[0].value).toBe('future_a');
    ui.key('ArrowLeft');
    expect(ui.key('ArrowDown').defaultPrevented).toBe(false);
    expect(ui.native.state.modelMoves).toBe(1);
    const model = ui.doc.querySelector('.sm-picker__models button');
    model.dispatchEvent(new ui.view.MouseEvent('mouseenter'));
    ui.key('Enter');
    expect(ui.native.state.lane).toBe('efforts');
    ui.key('End');
    expect(ui.native.active()).toBe(max);
    ui.key('Home', max);
    expect(ui.native.active().textContent.trim()).toBe('Off');
    ui.key('ArrowUp', max);
    expect(ui.native.active().textContent.trim()).toBe('future_a');
    ui.key('ArrowRight');
    ui.key('Enter');
    expect(ui.native.state.commits.at(-1).value).toBe('low');
    await ui.settled();
  });

  it('ignores composition/modifiers and leaves unrelated dialogs and closed triggers untouched', async () => {
    const ui = install(flyout(['Off', ...raw]), nativePicker);
    ui.key('ArrowRight');
    const previous = ui.native.active();
    expect(ui.key('End', undefined, { isComposing: true }).defaultPrevented).toBe(false);
    expect(ui.key('End', undefined, { keyCode: 229 }).defaultPrevented).toBe(false);
    expect(ui.key('End', undefined, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(ui.native.active()).toBe(previous);
    ui.doc.querySelector('.sm-picker__trigger').setAttribute('aria-expanded', 'false');
    expect(ui.key('End').defaultPrevented).toBe(false);
    ui.doc.querySelector('.sm-picker__flyout').setAttribute('aria-label', 'Other choices');
    expect(ui.key('Home', ui.native.nodes[0]).defaultPrevented).toBe(false);
    await ui.settled();
  });
});

describe('effort real MutationObserver convergence and scope', () => {
  it('converges with whitespace, nested/late mounts, native re-renders and text changes without replacing buttons', async () => {
    const ui = install();
    const wrapper = ui.doc.createElement('section');
    wrapper.innerHTML = `<div class="md-thinking">${segment(raw)}</div>`;
    const original = [...wrapper.querySelectorAll('button')];
    ui.doc.body.append(wrapper);
    await ui.settled();
    const control = wrapper.querySelector('.ui-seg');
    expect(control.lastElementChild).toBe(original[2]);
    control.replaceChildren(...original);
    await ui.settled();
    expect(control.lastElementChild).toBe(original[2]);
    original[5].firstChild.textContent = 'None';
    await ui.settled();
    expect(control.firstElementChild).toBe(original[5]);
    expect(original.every((node) => node.isConnected)).toBe(true);
    ui.view.eval(source);
    await ui.settled();
    expect(ui.state.installs).toBe(1);
    wrapper.remove();
    ui.doc.body.insertAdjacentHTML('beforeend', flyout(['Off', ...raw]));
    await ui.settled();
    expect(labels(ui.doc.querySelector('.sm-picker__flyout')).at(-1)).toBe('max');
  });

  it('does not rescan document, Settings or chat trees for main/side chat streams', async () => {
    const ui = install(`${mobile('Settings', 'Thinking', raw)}${flyout(['Off', ...raw])}`);
    await ui.settled();
    const documentQueries = vi.spyOn(ui.doc, 'querySelectorAll');
    const sheet = ui.doc.querySelector('.sheet-panel');
    const sheetQueries = vi.spyOn(sheet, 'querySelectorAll');
    const chat = ui.doc.querySelector('.chat-scroll');
    const chatQueries = vi.spyOn(chat, 'querySelectorAll');
    const side = ui.doc.querySelector('.sc-body');
    for (let index = 0; index < 5; index += 1) {
      chat.insertAdjacentHTML('beforeend', '<div class="a-msg"><span>Delta</span></div>');
      chat.lastElementChild.querySelector('span').firstChild.textContent = `Delta ${index}`;
      side.textContent = `Side delta ${index}`;
      await tick();
    }
    await ui.settled();
    expect(documentQueries).not.toHaveBeenCalled();
    expect(sheetQueries).not.toHaveBeenCalled();
    expect(chatQueries).not.toHaveBeenCalled();
    expect(ui.view.fetch).not.toHaveBeenCalled();
  });
});
