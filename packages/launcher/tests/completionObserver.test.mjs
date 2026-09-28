/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve('packages/launcher/src/mobile/completionModal.js'), 'utf8');
const frames = [];
const observers = [];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function install() {
  const frame = document.createElement('iframe');
  frame.src = '/sessions/session-fixture';
  document.body.append(frame);
  frames.push(frame);
  const view = frame.contentWindow;
  if (!view.document.documentElement) view.document.append(view.document.createElement('html'));
  if (!view.document.body) view.document.documentElement.append(view.document.createElement('body'));
  view.document.body.innerHTML = '<div class="app mobile"><div class="composer"></div></div>' +
    '<div class="sc-body"><div class="composer"></div><div class="topbar"></div></div>';
  view.matchMedia = () => ({ matches: true, addEventListener() {} });
  class Socket extends view.EventTarget { send() {} }
  view.WebSocket = Socket;
  const NativeMutationObserver = view.MutationObserver;
  const state = { callbacks: 0, exceeded: false };
  view.MutationObserver = class MutationObserver {
    constructor(callback) {
      const observer = new NativeMutationObserver((records) => {
        state.callbacks += 1;
        if (state.callbacks > 100) {
          state.exceeded = true;
          observer.disconnect();
          return;
        }
        callback(records);
      });
      observers.push(observer);
      return observer;
    }
  };
  view.eval(source);
  const socket = new view.WebSocket();
  socket.send(JSON.stringify({ type: 'client_hello', id: 'fixture-hello' }));
  socket.dispatchEvent(new view.MessageEvent('message', {
    data: JSON.stringify({ type: 'ack', id: 'fixture-hello', code: 0 }),
  }));
  return { view, state };
}

afterEach(() => {
  observers.splice(0).forEach((observer) => observer.disconnect());
  frames.splice(0).forEach((frame) => frame.remove());
});

describe('completion observer scope', () => {
  it.each(['.sc-body', '.sc-body .composer', '.sc-body .topbar'])(
    'does not postpone a pending request because %s keeps streaming', async (selector) => {
      const { view, state } = install();
      const doc = view.document;
      const side = doc.querySelector(selector);
      const timers = vi.spyOn(view, 'setTimeout');
      doc.body.insertAdjacentHTML('beforeend', '<div class="dock-question"><button>Answer</button></div>');
      await tick();
      const pendingTimers = timers.mock.calls.length;
      expect(pendingTimers).toBe(1);
      for (let batch = 0; batch < 20; batch += 1) {
        side.append(doc.createElement('span'));
        await tick();
      }
      expect(timers).toHaveBeenCalledTimes(pendingTimers);
      await new Promise((resolve) => setTimeout(resolve, 140));
      expect(doc.querySelector('[role="dialog"] h2').textContent).toBe('需要回答');
      expect(state.exceeded).toBe(false);
    });
});
