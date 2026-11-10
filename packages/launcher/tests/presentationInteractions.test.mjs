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

describe('official send ownership', () => {
  it.each([false, true])('does not add a duplicate control on mobile=%s or viewport changes', (isMobile) => {
    const fixture = install({ isMobile, withComposer: true });
    expect(fixture.composer.querySelector('.okw-steer-button')).toBeNull();
    fixture.media.matches = !isMobile;
    fixture.mediaListeners[0]();
    expect(fixture.composer.querySelector('.okw-steer-button')).toBeNull();
    expect(fixture.nativeFetch).not.toHaveBeenCalled();
  });

  it('passes native queued draft submissions through without a follow-up steer request', async () => {
    const response = Response.json({ code: 0, data: { prompt_id: 'draft', status: 'queued' } });
    const nativeFetch = vi.fn().mockResolvedValue(response);
    const fixture = install({ nativeFetch, withComposer: true });
    const init = { method: 'POST', body: JSON.stringify({ content: 'draft' }) };
    let sent;
    fixture.composer.send.addEventListener('click', () => {
      sent = fixture.window.fetch('/api/v1/sessions/session-a/prompts', init);
    });
    fixture.window.setTimeout(() => fixture.composer.send.click());
    runNextTimer(fixture.timers);
    expect(await sent).toBe(response);
    expect(nativeFetch).toHaveBeenCalledExactlyOnceWith('/api/v1/sessions/session-a/prompts', init);
    expect(fixture.timers).toHaveLength(0);
  });

  it('preserves the official steer request, authentication, body and response', async () => {
    const response = Response.json({ code: 0, data: { steered: true } });
    const nativeFetch = vi.fn().mockResolvedValue(response);
    const fixture = install({ nativeFetch, withComposer: true });
    const init = { method: 'POST', headers: { authorization: 'Bearer fictional-only' },
      body: JSON.stringify({ prompt_ids: ['official-draft'] }) };
    const url = '/api/v1/sessions/session-a/prompts:steer';
    expect(await fixture.window.fetch(url, init)).toBe(response);
    expect(nativeFetch).toHaveBeenCalledExactlyOnceWith(url, init);
  });

  it('propagates the official network error without retrying or steering', async () => {
    const error = new TypeError('network unavailable');
    const nativeFetch = vi.fn().mockRejectedValue(error);
    const fixture = install({ nativeFetch });
    await expect(fixture.window.fetch('/api/v1/sessions/session-a/prompts', { method: 'POST' })).rejects.toBe(error);
    expect(nativeFetch).toHaveBeenCalledOnce();
  });
});
