/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { addMobilePresentation } from '../src/officialPresentation.mjs';

const source = readFileSync(resolve('packages/launcher/src/mobile/foldingDefaults.js'), 'utf8');
const STORAGE_KEY = 'kimi-web.activity-run-folding';
const frames = [];

function install(storedValue) {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const view = frame.contentWindow;
  view.localStorage.clear();
  if (storedValue !== undefined) view.localStorage.setItem(STORAGE_KEY, storedValue);
  view.eval(`(() => { ${source}\n})()`);
  return view.localStorage.getItem(STORAGE_KEY);
}

afterEach(() => {
  frames.splice(0).forEach((frame) => frame.remove());
});

describe('official tool-call folding default', () => {
  it('loads the default before the official module reads its preference', () => {
    const html = '<head><script type="module" src="/assets/index.js"></script></head>';
    const injected = addMobilePresentation(html);

    expect(injected.indexOf('/__open-kimi-mobile/foldingDefaults.js'))
      .toBeLessThan(injected.indexOf('<script type="module"'));
  });

  it('folds completed tool activity when no preference exists', () => {
    expect(install()).toBe('1');
  });

  it.each(['0', '1', '', 'unknown'])('preserves an existing %s preference', (storedValue) => {
    expect(install(storedValue)).toBe(storedValue);
  });

  it('preserves a preference changed after the first execution', () => {
    install();
    const view = frames.at(-1).contentWindow;
    view.localStorage.setItem(STORAGE_KEY, '0');

    view.eval(`(() => { ${source}\n})()`);
    view.eval(`(() => { ${source}\n})()`);

    expect(view.localStorage.getItem(STORAGE_KEY)).toBe('0');
  });

  it('does not block startup when saving the default fails', () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    frames.push(frame);
    const view = frame.contentWindow;
    Object.defineProperty(view, 'localStorage', {
      configurable: true,
      value: { getItem: () => null, setItem: () => { throw new Error('storage full'); } },
    });

    expect(() => view.eval(`(() => { ${source}\n})()`)).not.toThrow();
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
