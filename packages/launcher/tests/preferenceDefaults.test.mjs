/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { addMobilePresentation } from '../src/officialPresentation.mjs';

const source = readFileSync(resolve('packages/launcher/src/mobile/preferenceDefaults.js'), 'utf8');
const FOLDING_KEY = 'kimi-web.activity-run-folding';
const NOTIFY_KEY = 'kimi-web.notify-enabled';
const frames = [];

function install(storedValues = {}) {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const view = frame.contentWindow;
  view.localStorage.clear();
  for (const [key, value] of Object.entries(storedValues)) view.localStorage.setItem(key, value);
  view.eval(`(() => { ${source}\n})()`);
  return view.localStorage;
}

afterEach(() => {
  frames.splice(0).forEach((frame) => frame.remove());
});

describe('official preference defaults', () => {
  it('loads defaults before the official module reads its preferences', () => {
    const html = '<head><script type="module" src="/assets/index.js"></script></head>';
    const injected = addMobilePresentation(html);

    expect(injected.indexOf('/__open-kimi-mobile/preferenceDefaults.js'))
      .toBeLessThan(injected.indexOf('<script type="module"'));
  });

  it('keeps tool calls expanded and notifications opt-in for a new origin', () => {
    const storage = install();

    expect(storage.getItem(FOLDING_KEY)).toBe('0');
    expect(storage.getItem(NOTIFY_KEY)).toBe('0');
  });

  it.each(['0', '1'])('preserves explicit %s preferences', (storedValue) => {
    const storage = install({ [FOLDING_KEY]: storedValue, [NOTIFY_KEY]: storedValue });

    expect(storage.getItem(FOLDING_KEY)).toBe(storedValue);
    expect(storage.getItem(NOTIFY_KEY)).toBe(storedValue);
  });

  it('does not block startup when localStorage is unavailable', () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    frames.push(frame);
    const view = frame.contentWindow;
    Object.defineProperty(view, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage disabled');
      },
    });

    expect(() => view.eval(`(() => { ${source}\n})()`)).not.toThrow();
  });
});
