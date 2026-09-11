/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve('packages/launcher/src/mobile/completionModal.js'),
  'utf8',
).replace('const SETTLE_DELAY_MS = 120;', 'const SETTLE_DELAY_MS = 0;');
const frames = [];

const settle = () => new Promise((resolveWait) => setTimeout(resolveWait, 10));

function installMedia(view, initialMatches) {
  let matches = initialMatches;
  const listeners = new Set();
  view.matchMedia = () => ({
    get matches() { return matches; },
    addEventListener(type, listener) {
      if (type === 'change') listeners.add(listener);
    },
  });
  return (nextMatches) => {
    matches = nextMatches;
    listeners.forEach((listener) => listener({ matches }));
  };
}

function installWebSocket(view, sockets) {
  class FakeWebSocket extends view.EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    constructor(url) {
      super();
      this.url = url;
      this.sent = [];
      sockets.push(this);
    }
    send(data) { this.sent.push(data); }
    message(data) {
      this.dispatchEvent(new view.MessageEvent('message', {
        data: typeof data === 'string' ? data : JSON.stringify(data),
      }));
    }
    close() { this.dispatchEvent(new view.Event('close')); }
  }
  Object.defineProperty(view, 'WebSocket', { configurable: true, value: FakeWebSocket });
}

function makeComposer(view, running) {
  if (!view.document.documentElement) view.document.append(view.document.createElement('html'));
  if (!view.document.body) view.document.documentElement.append(view.document.createElement('body'));
  const app = view.document.createElement('div');
  app.className = 'app mobile';
  const composer = view.document.createElement('div');
  composer.className = 'composer';
  app.append(composer);
  view.document.body.append(app);
  if (running) composer.append(Object.assign(view.document.createElement('button'), { className: 'stop' }));
  return composer;
}

function install({ mobile = true, route = '/sessions/session-a', running = false } = {}) {
  const frame = document.createElement('iframe');
  frame.src = route;
  document.body.append(frame);
  frames.push(frame);
  const view = frame.contentWindow;
  const sockets = [];
  const setMobile = installMedia(view, mobile);
  installWebSocket(view, sockets);
  const composer = makeComposer(view, running);

  view.eval(`(() => { ${source}\n})()`);

  return {
    composer,
    createSocket(id = `hello-${sockets.length + 1}`, code = 0) {
      const socket = new view.WebSocket('ws://localhost/api/v1/ws');
      socket.send(JSON.stringify({ type: 'client_hello', id, payload: { client_id: 'test' } }));
      socket.message({ type: 'ack', id, code, msg: '', payload: {} });
      return socket;
    },
    removeRunning() { composer.querySelector('.stop')?.remove(); },
    setMobile,
    startRunning() {
      if (composer.querySelector('.stop')) return;
      const stop = view.document.createElement('button');
      stop.className = 'stop';
      composer.append(stop);
    },
    view,
  };
}

afterEach(() => {
  frames.splice(0).forEach((frame) => frame.remove());
});

describe('mobile completion modal trigger', () => {
  it('shows once after the current route is observed running and then becomes idle', async () => {
    const fixture = install();
    const socket = fixture.createSocket();
    expect(socket).toBeInstanceOf(fixture.view.WebSocket);
    expect(socket.sent).toHaveLength(1);
    fixture.startRunning();
    await settle();
    fixture.removeRunning();
    await settle();

    expect(fixture.view.document.querySelectorAll('.okw-completion-modal')).toHaveLength(1);
    fixture.view.document.body.append(fixture.view.document.createElement('span'));
    await settle();
    expect(fixture.view.document.querySelectorAll('.okw-completion-modal')).toHaveLength(1);
  });

  it('ignores initial idle state and pre-ack running history', async () => {
    const idle = install();
    idle.createSocket();
    await settle();
    expect(idle.view.document.querySelector('.okw-completion-modal')).toBeNull();

    const replay = install({ route: '/sessions/session-b', running: true });
    await settle();
    replay.removeRunning();
    replay.createSocket();
    await settle();
    expect(replay.view.document.querySelector('.okw-completion-modal')).toBeNull();
  });

  it('keeps the replay gate closed when client hello is rejected', async () => {
    const fixture = install();
    fixture.createSocket('rejected-hello', 401);
    fixture.startRunning();
    await settle();
    fixture.removeRunning();
    await settle();
    expect(fixture.view.document.querySelector('.okw-completion-modal')).toBeNull();
  });

  it('ignores a malformed encoded session route without stopping the enhancement', async () => {
    const fixture = install({ route: '/sessions/%', running: true });
    expect(() => fixture.createSocket()).not.toThrow();
    await settle();
    fixture.removeRunning();
    await settle();
    expect(fixture.view.document.querySelector('.okw-completion-modal')).toBeNull();
  });

  it('does not carry a running observation across session routes', async () => {
    const fixture = install();
    fixture.createSocket();
    fixture.startRunning();
    await settle();

    fixture.view.history.pushState({}, '', '/sessions/session-b');
    fixture.removeRunning();
    await settle();
    expect(fixture.view.document.querySelector('.okw-completion-modal')).toBeNull();
  });

  it('does not arm on desktop or after resizing an already idle page to mobile', async () => {
    const fixture = install({ mobile: false });
    fixture.createSocket();
    fixture.startRunning();
    await settle();
    fixture.removeRunning();
    await settle();
    fixture.setMobile(true);
    await settle();

    expect(fixture.view.document.querySelector('.okw-completion-modal')).toBeNull();
  });
});

describe('mobile completion modal pending and reconnect behavior', () => {
  it.each(['dock-approval', 'dock-question'])(
    'waits through %s and only reports completion after running resumes',
    async (pendingClass) => {
      const fixture = install();
      fixture.createSocket();
      fixture.startRunning();
      await settle();
      const pending = fixture.view.document.createElement('div');
      pending.className = pendingClass;
      fixture.removeRunning();
      fixture.view.document.body.append(pending);
      await settle();
      expect(fixture.view.document.querySelector('.okw-completion-modal')).toBeNull();

      pending.remove();
      await settle();
      expect(fixture.view.document.querySelector('.okw-completion-modal')).toBeNull();
      fixture.startRunning();
      await settle();
      fixture.removeRunning();
      await settle();
      expect(fixture.view.document.querySelectorAll('.okw-completion-modal')).toHaveLength(1);
    },
  );

  it('preserves an armed task across a websocket reconnect', async () => {
    const fixture = install();
    const first = fixture.createSocket('hello-one');
    fixture.startRunning();
    await settle();
    first.close();
    fixture.removeRunning();
    await settle();
    expect(fixture.view.document.querySelector('.okw-completion-modal')).toBeNull();

    fixture.createSocket('hello-two');
    await settle();
    expect(fixture.view.document.querySelectorAll('.okw-completion-modal')).toHaveLength(1);
  });
});

describe('mobile completion modal accessibility', () => {
  it('labels the blocking dialog, focuses its result button, and closes with Escape', async () => {
    const fixture = install();
    fixture.createSocket();
    fixture.startRunning();
    await settle();
    fixture.removeRunning();
    await settle();

    const dialog = fixture.view.document.querySelector('[role="dialog"]');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('okw-completion-modal-title');
    expect(dialog.getAttribute('aria-describedby')).toBe('okw-completion-modal-description');
    expect(dialog.querySelector('h2').textContent).toBe('任务已完成');
    expect(dialog.querySelector('p').textContent).toBe('当前任务已经完成，可以查看结果。');
    expect(fixture.view.document.activeElement.textContent).toBe('查看结果');

    dialog.dispatchEvent(new fixture.view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(fixture.view.document.querySelector('.okw-completion-modal')).toBeNull();
  });
});
