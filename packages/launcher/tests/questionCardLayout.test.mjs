/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve('packages/launcher/src/mobile/questionCardLayout.js'), 'utf8');
const LONG_QUESTION = '在移动端验证较长问题时，需要完整阅读背景、限制条件与选择标准。'.repeat(12);
const frames = [];
const nativeObservers = [];

const settle = async (passes = 12) => {
  for (let pass = 0; pass < passes; pass += 1) await Promise.resolve();
};

function rect(width, height) {
  return { bottom: height, height, left: 0, right: width, top: 0, width, x: 0, y: 0 };
}

function makeCard(view, layout = {}) {
  const state = {
    cardHeight: 422,
    titleHeight: 357,
    titleWidth: 326,
    width: 390,
    ...layout,
  };
  const host = view.document.createElement('div');
  host.className = 'app mobile';
  host.innerHTML = `<div class="qcard" style="border: .5px solid transparent">
    <div class="qh" style="padding: 12px 16px 0; gap: 8px">
      <span class="qh-chip">1</span><div class="qtitle"></div>
      <button class="qmin" type="button">−</button><button class="qclose" type="button">×</button>
    </div>
    <div class="qpane"><div class="qpane-inner"><div class="qbody" style="padding: 12px 16px 16px"><div class="qopts">
      <button class="qopt" type="button">A</button><button class="qopt" type="button">B</button>
    </div></div><div class="qfoot" style="margin-top: 12px"></div></div></div>
  </div>`;
  const card = host.querySelector('.qcard');
  const header = host.querySelector('.qh');
  const title = host.querySelector('.qtitle');
  const body = host.querySelector('.qbody');
  const footer = host.querySelector('.qfoot');
  title.textContent = layout.text ?? LONG_QUESTION;
  card.getBoundingClientRect = () => rect(state.width, state.cardHeight);
  header.getBoundingClientRect = () => rect(state.width, state.titleHeight + 12);
  title.getBoundingClientRect = () => rect(state.titleWidth, state.titleHeight);
  footer.getBoundingClientRect = () => rect(state.width, 56);
  host.querySelectorAll('.qh-chip, .qmin, .qclose').forEach((node) => {
    node.getBoundingClientRect = () => rect(28, 28);
  });
  Object.defineProperty(header, 'clientWidth', { get: () => state.width });
  return { body, card, host, state, title };
}

function install({ storedHeight = null } = {}) {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const view = frame.contentWindow;
  view.localStorage.clear();
  if (storedHeight !== null) view.localStorage.setItem('open-kimi-web.question-card-height', storedHeight);
  const media = { matches: true, listeners: [], addEventListener(_name, callback) {
    this.listeners.push(callback);
  } };
  view.matchMedia = vi.fn(() => media);
  let frameId = 0;
  view.requestAnimationFrame = (callback) => {
    const id = ++frameId;
    Promise.resolve().then(() => callback(view.performance.now()));
    return id;
  };
  const resizeObservers = [];
  view.ResizeObserver = class ResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Set();
      resizeObservers.push(this);
    }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
  };
  const observerState = { callbacks: 0, exceeded: false };
  const NativeMutationObserver = view.MutationObserver;
  view.MutationObserver = class MutationObserver {
    constructor(callback) {
      this.observer = new NativeMutationObserver((records) => {
        observerState.callbacks += 1;
        if (observerState.callbacks > 100) {
          observerState.exceeded = true;
          nativeObservers.forEach((observer) => observer.disconnect());
          return;
        }
        callback(records);
      });
      nativeObservers.push(this.observer);
    }
    observe(target, options) { this.observer.observe(target, options); }
    disconnect() { this.observer.disconnect(); }
  };
  view.eval(`(() => { ${source}\n})()`);
  const triggerResize = (target) => resizeObservers.forEach((observer) => {
    if (observer.targets.has(target)) observer.callback([{ target }]);
  });
  return { media, observerState, triggerResize, view };
}

afterEach(() => {
  nativeObservers.splice(0).forEach((observer) => observer.disconnect());
  frames.splice(0).forEach((frame) => frame.remove());
});

describe('mobile long question layout', () => {
  it('moves only an over-budget title into the body reading area', async () => {
    const { observerState, view } = install();
    const long = makeCard(view);
    const short = makeCard(view, { cardHeight: 300, text: '选择下一步。', titleHeight: 22 });
    view.document.body.append(long.host, short.host);
    await settle();

    expect(long.card.classList.contains('okw-question-title-in-body')).toBe(true);
    expect(long.body.firstElementChild.className).toBe('okw-question-title-body');
    expect(long.body.firstElementChild.textContent).toBe(LONG_QUESTION);
    expect(long.title.isConnected).toBe(true);
    expect(short.card.classList.contains('okw-question-title-in-body')).toBe(false);
    expect(short.body.querySelector('.okw-question-title-body')).toBeNull();
    expect(observerState.exceeded).toBe(false);
    const settledCallbacks = observerState.callbacks;
    await settle();
    expect(observerState.callbacks).toBe(settledCallbacks);
  });

  it('updates a new question and preserves the same question position across resize', async () => {
    const { triggerResize, view } = install();
    const fixture = makeCard(view);
    view.document.body.append(fixture.host);
    await settle();
    fixture.body.scrollTop = 180;
    fixture.state.cardHeight = 380;
    triggerResize(fixture.card);
    await settle();
    expect(fixture.body.scrollTop).toBe(180);

    const nextQuestion = `${LONG_QUESTION} 新题目`;
    fixture.title.textContent = nextQuestion;
    await settle();
    expect(fixture.body.firstElementChild.textContent).toBe(nextQuestion);
    expect(fixture.body.scrollTop).toBe(0);
  });

  it('restores the official title while collapsed or desktop and reactivates on mobile', async () => {
    const { media, view } = install();
    const fixture = makeCard(view);
    view.document.body.append(fixture.host);
    await settle();
    fixture.card.classList.add('minimized');
    await settle();
    expect(fixture.card.classList.contains('okw-question-title-in-body')).toBe(false);
    expect(fixture.body.querySelector('.okw-question-title-body')).toBeNull();
    expect(fixture.card.querySelector('.okw-question-height-handle')).toBeNull();

    fixture.card.classList.remove('minimized');
    await settle();
    expect(fixture.card.classList.contains('okw-question-title-in-body')).toBe(true);
    media.matches = false;
    media.listeners.forEach((listener) => listener());
    await settle();
    expect(fixture.card.classList.contains('okw-question-title-in-body')).toBe(false);
    expect(fixture.body.querySelector('.okw-question-title-body')).toBeNull();
    expect(fixture.card.querySelector('.okw-question-height-handle')).toBeNull();

    media.matches = true;
    media.listeners.forEach((listener) => listener());
    await settle();
    expect(fixture.card.classList.contains('okw-question-title-in-body')).toBe(true);
  });

  it('handles short to long to short without retaining mirror text or scroll', async () => {
    const { view } = install();
    const fixture = makeCard(view, { cardHeight: 300, text: '短题', titleHeight: 22 });
    view.document.body.append(fixture.host);
    await settle();
    expect(fixture.body.querySelector('.okw-question-title-body')).toBeNull();

    fixture.state.cardHeight = 422;
    fixture.state.titleHeight = 357;
    fixture.title.textContent = LONG_QUESTION;
    fixture.body.scrollTop = 90;
    await settle();
    expect(fixture.body.firstElementChild.textContent).toBe(LONG_QUESTION);
    expect(fixture.body.scrollTop).toBe(0);

    fixture.state.titleHeight = 22;
    fixture.title.textContent = '另一道短题';
    await settle();
    expect(fixture.card.classList.contains('okw-question-title-in-body')).toBe(false);
    expect(fixture.body.querySelector('.okw-question-title-body')).toBeNull();
    expect(fixture.title.textContent).toBe('另一道短题');
  });
});

describe('mobile question card height control', () => {
  it('keeps the default short card natural and exposes an accessible slider', async () => {
    const { view } = install();
    const fixture = makeCard(view, { cardHeight: 300, text: '短题', titleHeight: 22 });
    view.document.body.append(fixture.host);
    await settle();

    const handle = fixture.card.querySelector('.okw-question-height-handle');
    expect(handle.getAttribute('role')).toBe('slider');
    expect(handle.getAttribute('aria-valuemin')).toBe('35');
    expect(handle.getAttribute('aria-valuemax')).toBe('85');
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-valuenow')).toBe('50');
    expect(fixture.card.classList.contains('okw-question-height-fixed')).toBe(false);
    expect(view.localStorage.getItem('open-kimi-web.question-card-height')).toBeNull();
  });

  it('previews a pointer drag and saves one validated snapped height on release', async () => {
    const { view } = install();
    const fixture = makeCard(view);
    view.document.body.append(fixture.host);
    await settle();
    const handle = fixture.card.querySelector('.okw-question-height-handle');
    const setItem = vi.spyOn(view.Storage.prototype, 'setItem');
    const pointer = (type, values) => {
      const event = new view.Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, values);
      handle.dispatchEvent(event);
    };

    pointer('pointerdown', { button: 0, clientY: 320, pointerId: 7 });
    pointer('pointermove', { clientY: 100, pointerId: 7 });
    expect(fixture.card.classList.contains('okw-question-height-dragging')).toBe(true);
    expect(fixture.card.style.getPropertyValue('--okw-question-card-preview-height')).toMatch(/px$/);
    pointer('pointerup', { clientY: 100, pointerId: 7 });
    await settle();

    expect(view.localStorage.getItem('open-kimi-web.question-card-height')).toBe('85');
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(fixture.card.classList.contains('okw-question-height-fixed')).toBe(true);
    expect(fixture.card.classList.contains('okw-question-height-dragging')).toBe(false);
    expect(fixture.card.style.getPropertyValue('--okw-question-card-height-tier')).toBe('0.85');
    expect(handle.getAttribute('aria-valuenow')).toBe('85');
  });

  it('raises a 35 percent preview to the dynamic option reachability minimum', async () => {
    const { view } = install();
    Object.defineProperty(view, 'innerHeight', { configurable: true, value: 440 });
    const fixture = makeCard(view, { cardHeight: 154 });
    view.document.body.append(fixture.host);
    await settle();
    const handle = fixture.card.querySelector('.okw-question-height-handle');
    handle.getBoundingClientRect = () => rect(96, 24);
    const pointer = (type, values) => {
      const event = new view.Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, values);
      handle.dispatchEvent(event);
    };

    pointer('pointerdown', { button: 0, clientY: 100, pointerId: 8 });
    pointer('pointermove', { clientY: 400, pointerId: 8 });
    const preview = Number.parseFloat(
      fixture.card.style.getPropertyValue('--okw-question-card-preview-height'),
    );
    pointer('pointerup', { clientY: 400, pointerId: 8 });
    await settle();

    const minimum = Number.parseFloat(
      fixture.card.style.getPropertyValue('--okw-question-card-min-height'),
    );
    expect(view.localStorage.getItem('open-kimi-web.question-card-height')).toBe('35');
    expect(preview).toBe(minimum);
    expect(minimum).toBeGreaterThan(440 * .35);
    expect(minimum).toBeGreaterThanOrEqual(44 + 24 + 40 + 68 + 28);
  });
});

describe('question card drag floors', () => {
  it('keeps the drag minimum at 35 percent when the dynamic budget is lower', async () => {
    const { view } = install();
    Object.defineProperty(view, 'innerHeight', { configurable: true, value: 844 });
    const fixture = makeCard(view, { cardHeight: 422 });
    view.document.body.append(fixture.host);
    await settle();
    const handle = fixture.card.querySelector('.okw-question-height-handle');
    handle.getBoundingClientRect = () => rect(96, 24);
    const pointer = (type, values) => {
      const event = new view.Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, values);
      handle.dispatchEvent(event);
    };
    pointer('pointerdown', { button: 0, clientY: 100, pointerId: 11 });
    pointer('pointermove', { clientY: 600, pointerId: 11 });
    const preview = Number.parseFloat(
      fixture.card.style.getPropertyValue('--okw-question-card-preview-height'),
    );
    expect(preview).toBeCloseTo(844 * .35);
    expect(Number(handle.getAttribute('aria-valuenow'))).toBe(35);
    pointer('pointercancel', { clientY: 600, pointerId: 11 });
  });
});

describe('question card height persistence and keyboard control', () => {
  it('does not save a canceled drag and supports the four keyboard stops', async () => {
    const { view } = install();
    const fixture = makeCard(view);
    view.document.body.append(fixture.host);
    await settle();
    const handle = fixture.card.querySelector('.okw-question-height-handle');
    const pointer = (type, values) => {
      const event = new view.Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, values);
      handle.dispatchEvent(event);
    };
    pointer('pointerdown', { button: 0, clientY: 320, pointerId: 9 });
    pointer('pointermove', { clientY: 180, pointerId: 9 });
    pointer('lostpointercapture', { clientY: 180, pointerId: 9 });
    await settle();
    expect(view.localStorage.getItem('open-kimi-web.question-card-height')).toBeNull();
    expect(fixture.card.classList.contains('okw-question-height-fixed')).toBe(false);

    pointer('pointerdown', { button: 0, clientY: 320, pointerId: 10 });
    pointer('pointermove', { clientY: 180, pointerId: 10 });
    pointer('pointercancel', { clientY: 180, pointerId: 10 });
    await settle();
    expect(view.localStorage.getItem('open-kimi-web.question-card-height')).toBeNull();

    handle.dispatchEvent(new view.KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' }));
    await settle();
    expect(view.localStorage.getItem('open-kimi-web.question-card-height')).toBe('70');
    handle.dispatchEvent(new view.KeyboardEvent('keydown', { bubbles: true, key: 'Home' }));
    await settle();
    expect(view.localStorage.getItem('open-kimi-web.question-card-height')).toBe('35');
    handle.dispatchEvent(new view.KeyboardEvent('keydown', { bubbles: true, key: 'End' }));
    await settle();
    expect(view.localStorage.getItem('open-kimi-web.question-card-height')).toBe('85');
  });

  it('restores only a valid saved height step', async () => {
    const valid = install({ storedHeight: '70' });
    const validFixture = makeCard(valid.view, { cardHeight: 300, text: '短题', titleHeight: 22 });
    valid.view.document.body.append(validFixture.host);
    await settle();
    expect(validFixture.card.classList.contains('okw-question-height-fixed')).toBe(true);
    expect(validFixture.card.style.getPropertyValue('--okw-question-card-height-tier')).toBe('0.7');

    const invalid = install({ storedHeight: '50bad' });
    const invalidFixture = makeCard(invalid.view, { cardHeight: 300, text: '短题', titleHeight: 22 });
    invalid.view.document.body.append(invalidFixture.host);
    await settle();
    expect(invalidFixture.card.classList.contains('okw-question-height-fixed')).toBe(false);
  });

  it('keeps a keyboard selection for the page when storage throws', async () => {
    const { view } = install();
    const fixture = makeCard(view);
    view.document.body.append(fixture.host);
    await settle();
    const handle = fixture.card.querySelector('.okw-question-height-handle');
    vi.spyOn(view.Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    handle.dispatchEvent(new view.KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' }));
    await settle();
    expect(fixture.card.classList.contains('okw-question-height-fixed')).toBe(true);
    expect(fixture.card.style.getPropertyValue('--okw-question-card-height-tier')).toBe('0.7');
  });
});

describe('question card observer scope', () => {
  it('handles character data updates and a detached card being reattached', async () => {
    const { view } = install();
    const fixture = makeCard(view);
    view.document.body.append(fixture.host);
    await settle();

    fixture.title.firstChild.data = `${LONG_QUESTION} 字符更新`;
    await settle();
    expect(fixture.body.querySelector('.okw-question-title-body').textContent)
      .toBe(`${LONG_QUESTION} 字符更新`);
    fixture.host.remove();
    await settle();
    view.document.body.append(fixture.host);
    await settle();
    expect(fixture.card.querySelector('.okw-question-height-handle')).not.toBeNull();
    expect(fixture.body.querySelector('.okw-question-title-body').textContent)
      .toBe(`${LONG_QUESTION} 字符更新`);
  });

  it('does not rescan the document for unrelated chat or Side Chat mutations', async () => {
    const { observerState, view } = install();
    const fixture = makeCard(view);
    view.document.body.append(fixture.host);
    const history = view.document.createElement('div');
    history.className = 'history';
    const side = view.document.createElement('div');
    side.className = 'sc-body';
    view.document.body.append(history, side);
    await settle();

    let documentQueries = 0;
    const queryAll = view.document.querySelectorAll.bind(view.document);
    view.document.querySelectorAll = (selector) => {
      documentQueries += 1;
      return queryAll(selector);
    };
    for (let index = 0; index < 20; index += 1) {
      history.append(view.document.createElement('span'));
      side.append(view.document.createElement('span'));
      await settle(2);
    }
    expect(documentQueries).toBe(0);
    expect(observerState.exceeded).toBe(false);
  });
});
