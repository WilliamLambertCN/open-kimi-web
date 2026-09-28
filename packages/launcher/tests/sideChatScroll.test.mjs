/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { addMobilePresentation } from '../src/officialPresentation.mjs';

const source = readFileSync(resolve('packages/launcher/src/mobile/sideChatScroll.js'), 'utf8');
const frames = [];

function createBody(view, { height = 1000, viewport = 200 } = {}) {
  const body = view.document.createElement('div');
  body.className = 'sc-body';
  const dimensions = { height, viewport, heightReads: 0, viewportReads: 0 };
  Object.defineProperty(body, 'scrollHeight', { get: () => {
    dimensions.heightReads += 1;
    return dimensions.height;
  } });
  Object.defineProperty(body, 'clientHeight', { get: () => {
    dimensions.viewportReads += 1;
    return dimensions.viewport;
  } });
  view.document.body.append(body);
  return { body, dimensions };
}

function userScroll(view, body, top) {
  Object.getOwnPropertyDescriptor(view.Element.prototype, 'scrollTop').set.call(body, top);
  body.dispatchEvent(new view.Event('scroll'));
}

async function install({ clampScroll = false } = {}) {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const view = frame.contentWindow;
  if (clampScroll) {
    const native = Object.getOwnPropertyDescriptor(view.Element.prototype, 'scrollTop');
    Object.defineProperty(view.Element.prototype, 'scrollTop', {
      configurable: true,
      get() { return native.get.call(this); },
      set(value) {
        const bottom = Math.max(0, this.scrollHeight - this.clientHeight);
        native.set.call(this, Math.min(Number(value), bottom));
      },
    });
  }
  view.eval(`(() => { ${source}\n})()`);
  const { body, dimensions } = createBody(view);
  await Promise.resolve();
  return { view, body, dimensions };
}

afterEach(() => {
  frames.splice(0).forEach((frame) => frame.remove());
});

describe('Side Chat streaming scroll guard', () => {
  it('loads before the official module', () => {
    const html = '<head><script type="module" src="/assets/index.js"></script></head>';
    const injected = addMobilePresentation(html);
    expect(injected.indexOf('/__open-kimi-mobile/sideChatScroll.js'))
      .toBeLessThan(injected.indexOf('<script type="module"'));
  });

  it('follows new output until the reader scrolls up, then resumes at the bottom', async () => {
    const { view, body, dimensions } = await install();
    body.scrollTop = 800;
    body.dispatchEvent(new view.Event('scroll'));

    dimensions.height = 1100;
    body.scrollTop = body.scrollHeight;
    expect(body.scrollTop).toBe(1100);

    body.dispatchEvent(new view.WheelEvent('wheel', { deltaY: -120 }));
    body.scrollTop = 250;
    body.dispatchEvent(new view.Event('scroll'));
    dimensions.height = 1400;
    body.scrollTop = body.scrollHeight;
    expect(body.scrollTop).toBe(250);

    dimensions.height = 1800;
    body.scrollTop = body.scrollHeight;
    expect(body.scrollTop).toBe(250);

    userScroll(view, body, 1600);
    dimensions.height = 1900;
    body.scrollTop = body.scrollHeight;
    expect(body.scrollTop).toBe(1900);
  });

  it('guards each panel once and leaves unrelated scroll containers alone', async () => {
    const { view, body } = await install();
    const originalSetter = Object.getOwnPropertyDescriptor(body, 'scrollTop').set;
    view.eval(`(() => { ${source}\n})()`);
    expect(Object.getOwnPropertyDescriptor(body, 'scrollTop').set).toBe(originalSetter);

    const other = view.document.createElement('div');
    other.className = 'conversation-body';
    view.document.body.append(other);
    await Promise.resolve();
    expect(Object.hasOwn(other, 'scrollTop')).toBe(false);

    const next = createBody(view).body;
    await Promise.resolve();
    expect(Object.hasOwn(next, 'scrollTop')).toBe(true);
  });
});

describe('Side Chat reading position', () => {
  it('keeps following when a prior scroll event arrives after the next content growth', async () => {
    const { body, dimensions, view } = await install({ clampScroll: true });
    body.scrollTop = body.scrollHeight;
    dimensions.height = 1100;
    body.scrollTop = body.scrollHeight;
    dimensions.height = 1400;
    body.dispatchEvent(new view.Event('scroll'));
    body.scrollTop = body.scrollHeight;
    expect(body.scrollTop).toBe(1200);

    userScroll(view, body, 1200);
    dimensions.height = 1500;
    body.dispatchEvent(new view.Event('scroll'));
    body.scrollTop = body.scrollHeight;
    expect(body.scrollTop).toBe(1300);
  });

  it('recognizes a real scrollbar move even with a programmatic event pending', async () => {
    const { body, dimensions, view } = await install({ clampScroll: true });
    body.scrollTop = body.scrollHeight;
    dimensions.height = 1100;
    body.scrollTop = body.scrollHeight;
    userScroll(view, body, 200);
    dimensions.height = 1200;
    body.scrollTop = body.scrollHeight;
    expect(body.scrollTop).toBe(200);
    userScroll(view, body, 1000);
    dimensions.height = 1300;
    body.scrollTop = body.scrollHeight;
    expect(body.scrollTop).toBe(1100);
  });

  it('lets an ordinary programmatic non-bottom assignment leave follow mode', async () => {
    const { body, dimensions, view } = await install({ clampScroll: true });
    body.scrollTop = body.scrollHeight;
    body.scrollTop = 300;
    body.dispatchEvent(new view.Event('scroll'));
    dimensions.height = 1200;
    body.scrollTop = body.scrollHeight;
    expect(body.scrollTop).toBe(300);
  });
});

describe('Side Chat input and panel behavior', () => {
  it('avoids extra layout reads while following and still allows non-bottom programmatic scrolls', async () => {
    const { body, dimensions, view } = await install();
    body.scrollTop = body.scrollHeight;
    expect(dimensions.heightReads).toBe(1);
    expect(dimensions.viewportReads).toBe(0);

    body.dispatchEvent(new view.WheelEvent('wheel', { deltaY: -120 }));
    dimensions.height = 1200;
    body.scrollTop = body.scrollHeight;
    expect(body.scrollTop).toBe(1000);
    body.scrollTop = 300;
    expect(body.scrollTop).toBe(300);
  });

  it('keeps follow state separate when the reader switches to a new Side Chat body', async () => {
    const { body, view } = await install();
    body.scrollTop = 800;
    body.dispatchEvent(new view.Event('scroll'));
    body.dispatchEvent(new view.WheelEvent('wheel', { deltaY: -120 }));
    userScroll(view, body, 250);
    body.remove();

    const next = createBody(view).body;
    await Promise.resolve();
    next.scrollTop = next.scrollHeight;
    expect(next.scrollTop).toBe(1000);
    expect(body.scrollTop).toBe(250);
  });

  it('lets keyboard and touch reading gestures detach from the live tail', async () => {
    const { view, body, dimensions } = await install();
    body.scrollTop = 800;
    body.dispatchEvent(new view.Event('scroll'));
    body.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'PageUp' }));
    dimensions.height = 1200;
    body.scrollTop = body.scrollHeight;
    expect(body.scrollTop).toBe(800);

    userScroll(view, body, 1000);
    const start = new view.Event('touchstart');
    Object.defineProperty(start, 'touches', { value: [{ clientY: 100 }] });
    body.dispatchEvent(start);
    const move = new view.Event('touchmove');
    Object.defineProperty(move, 'touches', { value: [{ clientY: 140 }] });
    body.dispatchEvent(move);
    dimensions.height = 1300;
    body.scrollTop = body.scrollHeight;
    expect(body.scrollTop).toBe(1000);
  });
});
