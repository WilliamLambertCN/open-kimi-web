/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync('packages/launcher/src/mobile/completionModal.js', 'utf8')
  .replace('const SETTLE_DELAY_MS = 120;', 'const SETTLE_DELAY_MS = 0;');
const instances = [];
const tick = () => new Promise((done) => setTimeout(done, 0));

async function install(kind = 'approval', executions = 1) {
  const frame = document.createElement('iframe');
  frame.src = '/sessions/keyboard-fixture';
  document.body.append(frame);
  const view = frame.contentWindow;
  const doc = view.document;
  if (!doc.documentElement) doc.append(doc.createElement('html'));
  if (!doc.body) doc.documentElement.append(doc.createElement('body'));
  doc.body.innerHTML = '<button class="previous">Previous</button><div class="app mobile">' +
    '<div class="composer"></div></div>';
  view.matchMedia = () => ({ matches: true, addEventListener() {} });
  class Socket extends view.EventTarget { send() {} }
  view.WebSocket = Socket;
  const state = { calls: 0, stopped: false };
  const observers = [];
  const Native = view.MutationObserver;
  view.MutationObserver = class extends Native {
    constructor(callback) {
      super((records, observer) => {
        state.calls += 1;
        if (state.calls > 100) { state.stopped = true; observer.disconnect(); return; }
        callback(records, observer);
      });
      observers.push(this);
    }
  };
  instances.push({ frame, observers });
  const nativeKeys = vi.fn();
  const nativeResponse = vi.fn();
  doc.addEventListener('keydown', (event) => {
    nativeKeys(event.key);
    if (event.key === 'Escape') nativeResponse(kind === 'approval' ? 'rejected' : 'dismissed');
    if (event.key === 'Enter') nativeResponse(kind === 'approval' ? 'approved' : 'answered');
  }, true);
  const previous = doc.querySelector('.previous');
  previous.focus();
  for (let index = 0; index < executions; index += 1) view.eval(source);
  const socket = new view.WebSocket();
  socket.send(JSON.stringify({ type: 'client_hello', id: 'keyboard-hello' }));
  socket.dispatchEvent(new view.MessageEvent('message', {
    data: JSON.stringify({ type: 'ack', id: 'keyboard-hello', code: 0 }),
  }));
  let pending;
  let nativeControl;
  if (kind === 'completion') {
    const stop = doc.createElement('button');
    stop.className = 'stop';
    doc.querySelector('.composer').append(stop);
    await new Promise((done) => setTimeout(done, 10));
    stop.remove();
  } else {
    pending = doc.createElement('div');
    pending.className = `dock-${kind}`;
    nativeControl = doc.createElement('button');
    nativeControl.textContent = 'Native response';
    pending.append(nativeControl);
    doc.body.append(pending);
  }
  const dialog = () => doc.querySelector('.okw-completion-modal');
  await vi.waitFor(() => expect(dialog()).not.toBeNull());
  const key = (value, options = {}, target = doc.activeElement) => {
    const event = new view.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options });
    target.dispatchEvent(event);
    return event;
  };
  const settled = async () => {
    await tick();
    const count = state.calls;
    await tick();
    expect(state.stopped).toBe(false);
    expect(state.calls).toBe(count);
  };
  return { view, doc, previous, pending, nativeControl, nativeKeys, nativeResponse, dialog, key, settled };
}

afterEach(() => {
  instances.splice(0).forEach(({ frame, observers }) => {
    observers.forEach((observer) => observer.disconnect());
    frame.remove();
  });
});

describe('completion modal keyboard isolation before native document capture', () => {
  it.each(['approval', 'question', 'completion'])('isolates %s Escape and restores native keys', async (kind) => {
    const ui = await install(kind, 2);
    const escape = ui.key('Escape');
    expect(escape.defaultPrevented).toBe(true);
    expect(ui.nativeKeys).not.toHaveBeenCalled();
    expect(ui.nativeResponse).not.toHaveBeenCalled();
    expect(ui.dialog()).toBeNull();
    expect(ui.doc.activeElement).toBe(ui.previous);
    if (ui.pending) expect(ui.pending.isConnected).toBe(true);
    const outside = ui.key('Escape');
    expect(outside.defaultPrevented).toBe(false);
    expect(ui.nativeKeys).toHaveBeenCalledExactlyOnceWith('Escape');
    expect(ui.nativeResponse).toHaveBeenCalledExactlyOnceWith(kind === 'approval' ? 'rejected' : 'dismissed');
    await ui.settled();
  });

  it('traps Tab and ShiftTab locally without reaching earlier native capture', async () => {
    const ui = await install('question');
    const [close, action] = ui.dialog().querySelectorAll('button');
    expect(ui.doc.activeElement).toBe(action);
    expect(ui.key('Tab').defaultPrevented).toBe(true);
    expect(ui.doc.activeElement).toBe(close);
    ui.key('Tab');
    expect(ui.doc.activeElement).toBe(action);
    ui.key('Tab', { shiftKey: true });
    expect(ui.doc.activeElement).toBe(close);
    ui.key('Tab', { shiftKey: true });
    expect(ui.doc.activeElement).toBe(action);
    expect(ui.nativeKeys).not.toHaveBeenCalled();
    await ui.settled();
  });

  it.each(['approval', 'question', 'completion'])('preserves %s button defaults and action focus', async (kind) => {
    const ui = await install(kind);
    const action = ui.dialog().querySelector('.okw-completion-modal-result');
    expect(ui.key('Enter').defaultPrevented).toBe(false);
    expect(ui.key(' ').defaultPrevented).toBe(false);
    expect(ui.nativeResponse).not.toHaveBeenCalled();
    expect(ui.nativeKeys).not.toHaveBeenCalled();
    action.click();
    expect(ui.dialog()).toBeNull();
    expect(ui.doc.activeElement).toBe(kind === 'completion' ? ui.previous : ui.nativeControl);
    expect(ui.pending?.isConnected ?? true).toBe(true);
    await ui.settled();
  });

  it('isolates other, composition and modifier keys without swallowing their defaults or closing the dialog', async () => {
    const ui = await install('question');
    const dialog = ui.dialog();
    for (const [key, options] of [
      ['1', {}], ['ArrowDown', {}], ['Escape', { isComposing: true }], ['Escape', { keyCode: 229 }],
      ['Escape', { ctrlKey: true }], ['Escape', { altKey: true }], ['Enter', { metaKey: true }],
      ['Tab', { ctrlKey: true }],
    ]) {
      expect(ui.key(key, options).defaultPrevented).toBe(false);
      expect(ui.dialog()).toBe(dialog);
    }
    expect(ui.nativeKeys).not.toHaveBeenCalled();
    expect(ui.nativeResponse).not.toHaveBeenCalled();
    const outside = ui.key('ArrowDown', {}, ui.previous);
    expect(outside.defaultPrevented).toBe(false);
    expect(ui.nativeKeys).toHaveBeenCalledExactlyOnceWith('ArrowDown');
    await ui.settled();
  });

  it.each(['approval', 'question', 'completion'])('keeps %s pointer close and focus restoration unchanged', async (kind) => {
    const ui = await install(kind);
    ui.dialog().querySelector('.okw-completion-modal-close').click();
    expect(ui.dialog()).toBeNull();
    expect(ui.doc.activeElement).toBe(ui.previous);
    expect(ui.nativeResponse).not.toHaveBeenCalled();
    expect(ui.pending?.isConnected ?? true).toBe(true);
    await ui.settled();
  });
});
