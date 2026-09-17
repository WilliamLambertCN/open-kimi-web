import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../src/mobile/presentation.js', import.meta.url), 'utf8');

class FakeTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener, options) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({ listener, once: options?.once === true });
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item.listener !== listener));
  }

  dispatchEvent(event) {
    event.target ??= this;
    event.currentTarget = this;
    for (const item of [...(this.listeners.get(event.type) ?? [])]) {
      item.listener(event);
      if (item.once) this.removeEventListener(event.type, item.listener);
      if (event.immediatePropagationStopped) break;
    }
    return !event.defaultPrevented;
  }
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
}

const event = (type, values = {}) => ({
  type,
  defaultPrevented: false,
  immediatePropagationStopped: false,
  preventDefault() { this.defaultPrevented = true; },
  stopImmediatePropagation() { this.immediatePropagationStopped = true; },
  ...values,
});

const runNextTimer = (timers) => timers.shift()?.();

class FakeChip extends FakeTarget {
  constructor(document, active = false) {
    super();
    this.document = document;
    this.disabled = false;
    this.active = active;
    this.scrollIntoView = vi.fn();
  }

  closest(selector) { return selector === '.chip' ? this : null; }
  focus() { this.document.activeElement = this; }
}

class FakeStrip extends FakeTarget {
  constructor(document) {
    super();
    this.classList = new FakeClassList();
    this.scrollLeft = 20;
    this.scrollWidth = 500;
    this.clientWidth = 200;
    this.chips = [new FakeChip(document), new FakeChip(document, true), new FakeChip(document)];
  }

  querySelectorAll(selector) { return selector === '.chip' ? this.chips : []; }
  querySelector(selector) { return selector === '.chip.is-active' ? this.chips.find((chip) => chip.active) : null; }
}

class FakeButton extends FakeTarget {
  constructor() {
    super();
    this.attributes = new Map();
    this.disabled = false;
    this.parent = null;
  }

  click() {
    if (!this.disabled) this.dispatchEvent(event('click'));
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
}

class FakeToolbar {
  constructor(stop) {
    this.stop = stop;
    this.stopWrapper = { parentElement: this };
    stop.parentElement = this.stopWrapper;
    this.children = [this.stopWrapper];
  }

  querySelector(selector) { return selector === '.stop' ? this.stop : null; }
  insertBefore(button, reference) {
    button.parent = this;
    button.parentElement = this;
    const index = reference ? this.children.indexOf(reference) : this.children.length;
    this.children.splice(index, 0, button);
  }
}

class FakeComposer {
  constructor(editor) {
    this.editor = editor;
    this.stop = {};
    this.send = new FakeButton();
    this.toolbar = new FakeToolbar(this.stop);
  }

  querySelector(selector) {
    if (selector === '.okw-steer-button') {
      return this.toolbar.children.find((child) => child.className === 'okw-steer-button') ?? null;
    }
    if (selector.startsWith('.ph ')) return this.editor;
    if (selector === '.stop') return this.stop;
    if (selector === '.send:not(:disabled)') return this.send.disabled ? null : this.send;
    if (selector === '.toolbar-right') return this.toolbar;
    return null;
  }
}

function install({
  isMobile = false,
  nativeFetch = vi.fn(),
  pathname = '/sessions/session-a',
  withComposer = false,
  withStrip = false,
} = {}) {
  const mediaListeners = [];
  const media = {
    matches: isMobile,
    addEventListener: (_type, listener) => mediaListeners.push(listener),
  };
  const timers = [];
  const document = new FakeTarget();
  document.activeElement = null;
  document.documentElement = {};
  document.createElement = () => new FakeButton();
  const editor = new FakeTarget();
  const composer = withComposer ? new FakeComposer(editor) : null;
  const strip = withStrip ? new FakeStrip(document) : null;
  document.querySelector = () => null;
  document.querySelectorAll = (selector) => {
    if (selector === '.mp > .chip-strip') return strip ? [strip] : [];
    if (selector === '.app .composer') return composer ? [composer] : [];
    if (selector === '.okw-steer-button') {
      const button = composer?.querySelector('.okw-steer-button');
      return button ? [button] : [];
    }
    return [];
  };

  let observerCallback;
  let observerOptions;
  class MutationObserver {
    constructor(callback) {
      observerCallback = callback;
    }
    observe(_root, options) { observerOptions = options; }
  }
  class KeyboardEvent {
    constructor(type, values) { Object.assign(this, event(type), values); }
  }
  const window = new FakeTarget();
  window.fetch = nativeFetch;
  window.matchMedia = () => media;
  window.setTimeout = (callback) => { timers.push(callback); };

  runInNewContext(source, {
    Array,
    Headers,
    KeyboardEvent,
    Map,
    MutationObserver,
    Request,
    Response,
    URL,
    WeakMap,
    WeakSet,
    decodeURIComponent,
    document,
    location: { href: `http://localhost${pathname}`, origin: 'http://localhost', pathname },
    navigator: { language: 'zh-CN' },
    window,
  });

  return {
    composer,
    document,
    editor,
    media,
    mediaListeners,
    nativeFetch,
    observer: { callback: observerCallback, options: observerOptions },
    strip,
    timers,
    window,
  };
}

describe('model provider navigation', () => {
  it('supports wheel, focus, arrow keys, and mouse drag without swallowing clicks', () => {
    const { document, strip, timers } = install({ withStrip: true });
    const [, active, last] = strip.chips;

    expect(strip.classList.contains('okw-provider-strip')).toBe(true);
    expect(active.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });

    const wheel = event('wheel', { deltaX: 0, deltaY: 30, deltaMode: 0 });
    strip.dispatchEvent(wheel);
    expect(strip.scrollLeft).toBe(50);
    expect(wheel.defaultPrevented).toBe(true);

    const arrow = event('keydown', { key: 'ArrowRight', target: active });
    strip.dispatchEvent(arrow);
    expect(arrow.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    expect(last.scrollIntoView).toHaveBeenCalled();

    const officialClick = vi.fn();
    strip.addEventListener('click', officialClick);
    strip.dispatchEvent(event('pointerdown', { pointerType: 'mouse', button: 0, clientX: 100, pointerId: 1 }));
    document.dispatchEvent(event('pointermove', { clientX: 96, pointerId: 1 }));
    document.dispatchEvent(event('pointerup', { pointerId: 1 }));
    strip.dispatchEvent(event('click', { target: active }));
    expect(officialClick).toHaveBeenCalledOnce();

    strip.dispatchEvent(event('pointerdown', { pointerType: 'mouse', button: 0, clientX: 100, pointerId: 2 }));
    const move = event('pointermove', { clientX: 70, pointerId: 2 });
    document.dispatchEvent(move);
    document.dispatchEvent(event('pointerup', { pointerId: 2 }));
    const draggedClick = event('click', { target: active });
    strip.dispatchEvent(draggedClick);
    expect(move.defaultPrevented).toBe(true);
    expect(draggedClick.defaultPrevented).toBe(true);
    expect(officialClick).toHaveBeenCalledOnce();
    expect(document.listeners.get('pointermove')).toEqual([]);
    timers.forEach((callback) => callback());
  });

  it('leaves horizontal wheel motion and touch pointer gestures native', () => {
    const { document, strip } = install({ withStrip: true });
    const wheel = event('wheel', { deltaX: 20, deltaY: 5, deltaMode: 0 });
    strip.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);

    strip.dispatchEvent(event('pointerdown', { pointerType: 'touch', button: 0, clientX: 100, pointerId: 3 }));
    expect(document.listeners.get('pointermove')).toBeUndefined();
  });
});

describe('priority-send control', () => {
  it('submits and steers the exact current draft without promoting an older queued prompt', async () => {
    const nativeFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: { prompt_id: 'current-draft', status: 'queued' },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: { prompt_ids: ['current-draft'], steered: true },
      }), { status: 200 }));
    const fixture = install({ isMobile: true, nativeFetch, withComposer: true });
    const keydowns = [];
    fixture.editor.addEventListener('keydown', (keydown) => keydowns.push(keydown));
    fixture.composer.send.addEventListener('click', () => {
      void fixture.window.fetch('/api/v1/sessions/session-a/prompts', {
        method: 'POST',
        headers: { authorization: 'Bearer page-token', 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'current draft' }),
      });
    });
    const button = fixture.composer.querySelector('.okw-steer-button');

    expect(button).not.toBeNull();
    expect(button.textContent).toBe('插队');
    expect(button.attributes.get('aria-label')).toContain('优先发送');
    button.dispatchEvent(event('click'));
    runNextTimer(fixture.timers);
    await vi.waitFor(() => expect(nativeFetch).toHaveBeenCalledTimes(2));

    expect(keydowns).toHaveLength(0);
    expect(nativeFetch.mock.calls[1][0]).toBe('/api/v1/sessions/session-a/prompts:steer');
    expect(nativeFetch.mock.calls[1][1].headers.get('authorization')).toBe('Bearer page-token');
    expect(JSON.parse(nativeFetch.mock.calls[1][1].body)).toEqual({ prompt_ids: ['current-draft'] });
    expect(button.disabled).toBe(false);

    fixture.composer.send.disabled = true;
    fixture.observer.callback();
    expect(fixture.composer.querySelector('.okw-steer-button')).toBeNull();
  });

  it('waits for the official compositionend task before submitting the current draft', () => {
    const { composer, timers } = install({ isMobile: true, withComposer: true });
    let composing = true;
    const composingAtSubmit = [];
    composer.send.addEventListener('click', () => composingAtSubmit.push(composing));
    timers.push(() => { composing = false; });

    composer.querySelector('.okw-steer-button').dispatchEvent(event('click'));
    expect(composingAtSubmit).toHaveLength(0);
    runNextTimer(timers);
    expect(composingAtSubmit).toHaveLength(0);
    runNextTimer(timers);

    expect(composingAtSubmit).toEqual([false]);
  });

  it('works on desktop and remains available across viewport changes', () => {
    const desktop = install({ withComposer: true });
    const desktopEvents = [];
    const desktopSubmits = [];
    desktop.editor.addEventListener('keydown', (keydown) => desktopEvents.push(keydown));
    desktop.composer.send.addEventListener('click', () => desktopSubmits.push(true));
    const desktopButton = desktop.composer.querySelector('.okw-steer-button');
    expect(desktopButton).not.toBeNull();
    desktop.editor.dispatchEvent(event('keydown', { key: 's', ctrlKey: true }));
    desktopButton.dispatchEvent(event('click'));
    runNextTimer(desktop.timers);
    expect(desktopEvents).toHaveLength(1);
    expect(desktopSubmits).toHaveLength(1);

    const mobile = install({ isMobile: true, withComposer: true });
    expect(mobile.composer.querySelector('.okw-steer-button')).not.toBeNull();
    mobile.media.matches = false;
    mobile.mediaListeners[0]();
    expect(mobile.composer.querySelector('.okw-steer-button')).not.toBeNull();
  });
});

describe('priority-send isolation', () => {
  it('uses the current official send after a rerender and leaves an already-running prompt alone', async () => {
    const nativeFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: { prompt_id: 'current-draft', status: 'running' },
    }), { status: 200 }));
    const fixture = install({ nativeFetch, withComposer: true });
    const staleSend = fixture.composer.send;
    const currentSend = new FakeButton();
    const staleClicks = vi.fn();
    const currentClicks = vi.fn();
    staleSend.addEventListener('click', staleClicks);
    currentSend.addEventListener('click', () => {
      currentClicks();
      void fixture.window.fetch('/api/v1/sessions/session-a/prompts', { method: 'POST' });
    });
    fixture.composer.send = currentSend;
    const button = fixture.composer.querySelector('.okw-steer-button');

    button.dispatchEvent(event('click'));
    runNextTimer(fixture.timers);
    await vi.waitFor(() => expect(button.disabled).toBe(false));

    expect(staleClicks).not.toHaveBeenCalled();
    expect(currentClicks).toHaveBeenCalledOnce();
    expect(nativeFetch).toHaveBeenCalledOnce();
  });

  it('does not retain an intent when the official send becomes unavailable', async () => {
    const nativeFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: { prompt_id: 'ordinary-draft', status: 'queued' },
    }), { status: 200 }));
    const fixture = install({ nativeFetch, withComposer: true });
    const button = fixture.composer.querySelector('.okw-steer-button');

    button.dispatchEvent(event('click'));
    fixture.composer.send.disabled = true;
    runNextTimer(fixture.timers);
    expect(button.disabled).toBe(false);

    await fixture.window.fetch('/api/v1/sessions/session-a/prompts', { method: 'POST' });
    expect(nativeFetch).toHaveBeenCalledOnce();
  });

  it('does not steer an ordinary prompt submission without a priority-send intent', async () => {
    const nativeFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: { prompt_id: 'ordinary-draft', status: 'queued' },
    }), { status: 200 }));
    const fixture = install({ nativeFetch, withComposer: true });

    await fixture.window.fetch('/api/v1/sessions/session-a/prompts', {
      method: 'POST',
      headers: { authorization: 'Bearer page-token', 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'ordinary draft' }),
    });

    expect(nativeFetch).toHaveBeenCalledOnce();
    expect(nativeFetch.mock.calls[0][0]).toBe('/api/v1/sessions/session-a/prompts');
  });
});
