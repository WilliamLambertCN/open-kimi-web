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
  const dimensions = { height, viewport };
  Object.defineProperty(body, 'scrollHeight', { get: () => dimensions.height });
  Object.defineProperty(body, 'clientHeight', { get: () => dimensions.viewport });
  view.document.body.append(body);
  return { body, dimensions };
}

function userScroll(view, body, top) {
  Object.getOwnPropertyDescriptor(view.Element.prototype, 'scrollTop').set.call(body, top);
  body.dispatchEvent(new view.Event('scroll'));
}

async function install() {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const view = frame.contentWindow;
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
