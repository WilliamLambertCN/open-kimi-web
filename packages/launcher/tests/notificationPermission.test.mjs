/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve('packages/launcher/src/mobile/notificationPermission.js'), 'utf8');
const frames = [];

function install({ nativeImpl, permission = 'default', userActivation = true } = {}) {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const view = frame.contentWindow;
  let currentPermission = permission;
  let activationActive = false;
  const receivers = [];
  const inputListeners = new Map();
  const nativeRequest = vi.fn(function nativeRequestPermission() {
    receivers.push(this);
    return nativeImpl?.() ?? Promise.resolve(currentPermission);
  });
  function NotificationApi() {}
  Object.defineProperty(NotificationApi, 'permission', {
    configurable: true,
    get: () => currentPermission,
  });
  NotificationApi.requestPermission = nativeRequest;
  Object.defineProperty(view, 'Notification', { configurable: true, value: NotificationApi });
  if (userActivation) {
    Object.defineProperty(view.navigator, 'userActivation', {
      configurable: true,
      value: { get isActive() { return activationActive; } },
    });
  }
  const addEventListener = view.addEventListener.bind(view);
  view.addEventListener = (type, listener, options) => {
    if ((type === 'click' || type === 'keydown') && options === true) {
      inputListeners.set(type, listener);
    }
    return addEventListener(type, listener, options);
  };
  view.eval(`(() => { ${source}\n})()`);

  return {
    nativeRequest,
    receivers,
    setActivation: (value) => { activationActive = value; },
    setPermission: (value) => { currentPermission = value; },
    userRequest(type, callback, active = true) {
      const event = { eventPhase: 1, isTrusted: true };
      inputListeners.get(type)(event);
      event.eventPhase = 2;
      activationActive = active;
      try {
        return callback();
      } finally {
        activationActive = false;
        event.eventPhase = 0;
      }
    },
    view,
  };
}

afterEach(() => {
  frames.splice(0).forEach((frame) => frame.remove());
});

describe('notification permission guard', () => {
  it('coalesces concurrent official requests and supports the legacy callback', async () => {
    let resolveNative;
    const nativeResult = new Promise((resolveRequest) => { resolveNative = resolveRequest; });
    const callback = vi.fn();
    const { nativeRequest, receivers, view } = install({ nativeImpl: () => nativeResult });

    const first = view.Notification.requestPermission(callback);
    const second = view.Notification.requestPermission().then((result) => result);
    expect(nativeRequest).toHaveBeenCalledTimes(1);
    expect(receivers).toEqual([view.Notification]);

    resolveNative('granted');
    await expect(first).resolves.toBe('granted');
    await expect(second).resolves.toBe('granted');
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith('granted');
  });

  it('suppresses automatic retries after dismissal when userActivation is unavailable', async () => {
    const callback = vi.fn();
    const { nativeRequest, view } = install({
      nativeImpl: () => Promise.resolve('default'),
      userActivation: false,
    });

    await expect(view.Notification.requestPermission()).resolves.toBe('default');
    await expect(view.Notification.requestPermission(callback)).resolves.toBe('default');

    expect(nativeRequest).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('default');
  });
});

describe('notification permission retry policy', () => {
  it('lets a synchronous settings click retry and joins background callers to it', async () => {
    let resolveRetry;
    const retryResult = new Promise((resolveRequest) => { resolveRetry = resolveRequest; });
    const results = [Promise.resolve('default'), retryResult];
    const fixture = install({ nativeImpl: () => results.shift() });

    await fixture.view.Notification.requestPermission();
    const retry = fixture.userRequest('click', () => fixture.view.Notification.requestPermission());
    const automatic = fixture.view.Notification.requestPermission();

    expect(fixture.nativeRequest).toHaveBeenCalledTimes(2);
    expect(automatic).toBe(retry);
    fixture.setPermission('granted');
    resolveRetry('granted');
    await expect(Promise.all([retry, automatic])).resolves.toEqual(['granted', 'granted']);
  });

  it('does not treat an inactive key event as an explicit retry', async () => {
    const fixture = install({ nativeImpl: () => Promise.resolve('default') });
    await fixture.view.Notification.requestPermission();

    const result = fixture.userRequest(
      'keydown',
      () => fixture.view.Notification.requestPermission(),
      false,
    );

    await expect(result).resolves.toBe('default');
    expect(fixture.nativeRequest).toHaveBeenCalledTimes(1);
  });

  it('suppresses background retries after the input event ends while activation remains active', async () => {
    const fixture = install({ nativeImpl: () => Promise.resolve('default') });
    await fixture.view.Notification.requestPermission();
    fixture.userRequest('click', () => {});
    fixture.setActivation(true);

    await expect(fixture.view.Notification.requestPermission()).resolves.toBe('default');

    expect(fixture.nativeRequest).toHaveBeenCalledTimes(1);
  });

  it.each(['granted', 'denied'])('preserves a %s permission result', async (permission) => {
    const { view } = install({ nativeImpl: () => Promise.resolve(permission) });
    await expect(view.Notification.requestPermission()).resolves.toBe(permission);
  });

  it('clears failed requests so a later call can retry', async () => {
    const failure = new Error('permission request failed');
    const results = [Promise.reject(failure), Promise.resolve('granted')];
    const { nativeRequest, view } = install({ nativeImpl: () => results.shift() });

    await expect(view.Notification.requestPermission()).rejects.toBe(failure);
    await expect(view.Notification.requestPermission()).resolves.toBe('granted');
    expect(nativeRequest).toHaveBeenCalledTimes(2);
  });

  it('does nothing when notifications are unsupported', () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    frames.push(frame);
    const view = frame.contentWindow;
    Object.defineProperty(view, 'Notification', { configurable: true, value: undefined });

    expect(() => view.eval(`(() => { ${source}\n})()`)).not.toThrow();
    expect(view.Notification).toBeUndefined();
  });
});
