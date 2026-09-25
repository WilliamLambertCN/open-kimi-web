/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { addMobilePresentation } from '../src/officialPresentation.mjs';

const source = readFileSync(resolve('packages/launcher/src/mobile/workspaceSortDefault.js'), 'utf8');
const STORAGE_KEY = 'kimi-web.workspace-sort';
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

describe('official workspace sorting default', () => {
  it('sets recent sorting before the official module reads its preference', () => {
    const html = '<head><script type="module" src="/assets/index.js"></script></head>';
    const injected = addMobilePresentation(html);

    expect(injected.indexOf('/__open-kimi-mobile/workspaceSortDefault.js'))
      .toBeLessThan(injected.indexOf('<script type="module"'));
    expect(install()).toBe('recent');
  });

  it.each(['manual', 'recent'])('preserves an explicit %s selection', (storedValue) => {
    expect(install(storedValue)).toBe(storedValue);
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
