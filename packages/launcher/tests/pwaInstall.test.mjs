/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
const sources = ['navigationSearchView.js', 'navigation.js', 'pwaInstallView.js', 'pwaInstall.js']
  .map((name) => readFileSync(resolve(`packages/launcher/src/mobile/${name}`), 'utf8'));
const body = '<div id="app"><aside class="side"><div class="sidebar-actions">' +
  '<button class="btn-new-chat">New</button><button class="search">Search</button></div></aside>' +
  '<textarea>Unsaved draft</textarea></div><div class="sheet-root"><section class="sheet-panel">' +
  '<div class="sheet-body"><div class="actions"><button class="newrow">New</button>' +
  '<button class="newrow">Workspace</button></div><div class="view-tabs">Tabs</div></div></section></div>';
const frames = []; const observers = [];
const tick = () => new Promise((done) => setTimeout(done, 0));
const pending = () => {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const certificate = (patch = {}) => ({
  source: 'local-ca', fingerprint: Array(32).fill('AB').join(':'), expiresAt: '2099-01-01T00:00:00.000Z', ...patch,
});
const caResponse = (data = certificate()) => ({ ok: true, json: vi.fn().mockResolvedValue(data) });
function setup(options = {}) {
  const frame = document.createElement('iframe'); document.body.append(frame); frames.push(frame);
  const view = frame.contentWindow; const doc = view.document; doc.body.innerHTML = body;
  Object.defineProperty(view, 'isSecureContext', { value: options.secure ?? true, configurable: true });
  for (const name of ['platform', 'userAgent', 'maxTouchPoints', 'standalone']) {
    if (name in options) Object.defineProperty(view.navigator, name, { value: options[name], configurable: true });
  }
  const media = { matches: Boolean(options.display), addEventListener: vi.fn() };
  view.matchMedia = vi.fn(() => media);
  const callbacks = []; let language = options.language ?? 'en';
  view.__okwLocale = { text: (zh, en) => language === 'zh' ? zh : en, observe: (callback) => callbacks.push(callback) };
  const search = vi.fn(); view.__okwNavigationCreateSearch = () => ({ open: search, close: vi.fn() });
  view.__okwNavigationCreateWorkspace = () => ({ open: vi.fn(), close: vi.fn() });
  const Native = view.MutationObserver; const state = { callbacks: 0, storm: false };
  view.MutationObserver = class {
    constructor(callback) {
      const observer = new Native((records) => {
        if (++state.callbacks > 100) { state.storm = true; observer.disconnect(); return; }
        callback(records);
      }); observers.push(observer); return observer;
    }
  };
  const nativeKey = vi.fn(); doc.addEventListener('keydown', nativeKey, true);
  view.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
  const storage = vi.spyOn(view.Storage.prototype, 'setItem');
  sources.forEach((source) => view.eval(source));
  const query = (selector) => doc.querySelector(selector);
  return { view, doc, media, state, search, nativeKey, storage, query,
    entry: () => query('[data-okw-navigation-action="install"]'),
    open() { this.entry().focus(); this.entry().click(); },
    submit: () => query('.okw-pwa-install-actions button'),
    close: () => query('.okw-pwa-install-panel header button').click(),
    status: () => query('.okw-pwa-install-status').textContent,
    locale(next) { language = next; callbacks.forEach((callback) => callback()); },
    display(next) { media.matches = next; media.addEventListener.mock.calls[0][1](); },
  };
}
function offer(test, prompt = vi.fn(() => Promise.resolve({ outcome: 'dismissed' })), choice) {
  const event = new test.view.Event('beforeinstallprompt', { cancelable: true });
  event.prompt = prompt; if (choice) event.userChoice = choice;
  test.view.dispatchEvent(event); return { event, prompt };
}
function key(test, name, extra = {}, target = test.doc.activeElement) {
  const event = new test.view.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...extra });
  target.dispatchEvent(event); return event;
}
async function settled(test) {
  await tick(); const count = test.state.callbacks; await tick();
  expect(test.state.callbacks).toBe(count); expect(test.state.storm).toBe(false);
}
afterEach(() => {
  observers.splice(0).forEach((observer) => observer.disconnect()); frames.splice(0).forEach((frame) => frame.remove());
  vi.restoreAllMocks();
});
describe('PWA install interaction', () => {
  it('never prompts automatically, calls synchronously on explicit install and prevents duplicate clicks', async () => {
    const test = setup(); expect(test.query('.okw-pwa-install-backdrop')).toBeNull();
    const choice = pending(); const prompt = vi.fn(() => choice.promise);
    const offered = offer(test, prompt); expect(offered.event.defaultPrevented).toBe(true);
    expect(prompt).not.toHaveBeenCalled(); test.open(); expect(prompt).not.toHaveBeenCalled();
    test.submit().click(); expect(prompt).toHaveBeenCalledOnce(); test.submit().click();
    expect(prompt).toHaveBeenCalledOnce(); expect(test.status()).toContain('browser prompt');
    choice.resolve({ outcome: 'dismissed' }); await tick();
    expect(test.status()).toContain('dismissed'); expect(test.submit().hidden).toBe(true);
    test.close(); test.open(); expect(test.status()).toContain('browser menu');
    expect(test.doc.querySelector('textarea').value).toBe('Unsaved draft');
    expect(test.view.fetch).toHaveBeenCalledTimes(2); expect(test.storage).not.toHaveBeenCalled(); await settled(test);
  });
  it.each(['throw', 'reject'])('provides a retry guide after prompt %s and accepts a fresh event', async (failure) => {
    const test = setup(); const prompt = vi.fn(() => {
      if (failure === 'throw') throw new Error('private detail');
      return Promise.reject(new Error('private detail'));
    });
    offer(test, prompt); test.open(); test.submit().click(); await tick();
    expect(test.status()).toContain('Could not open'); expect(test.status()).not.toContain('private detail');
    expect(test.submit().hidden).toBe(true); const next = offer(test); expect(test.submit().hidden).toBe(false);
    expect(test.status()).toContain('ready'); test.submit().click(); expect(next.prompt).toHaveBeenCalledOnce();
    await settled(test);
  });
  it('retains a fresh event during an older prompt, including closing and reopening', async () => {
    const test = setup(); const first = pending(); offer(test, vi.fn(() => first.promise));
    test.open(); test.submit().click(); const next = offer(test);
    expect(test.submit().disabled).toBe(true); test.close(); test.open(); expect(test.submit().disabled).toBe(true);
    first.resolve({ outcome: 'dismissed' }); await tick();
    expect(test.status()).toContain('ready'); expect(test.submit().disabled).toBe(false);
    test.submit().click(); expect(next.prompt).toHaveBeenCalledOnce(); await settled(test);
  });
  it('shows accepted as waiting, then hides entries only when appinstalled arrives late', async () => {
    const test = setup(); const choice = pending();
    offer(test, vi.fn(() => Promise.resolve()), choice.promise); test.open(); test.submit().click();
    choice.resolve({ outcome: 'accepted' }); await tick();
    expect(test.status()).toContain('Waiting for the browser'); expect(test.status()).not.toContain('complete');
    expect(test.entry().hidden).toBe(false); test.close(); test.open();
    expect(test.status()).toContain('Waiting'); test.view.dispatchEvent(new test.view.Event('appinstalled'));
    expect(test.status()).toContain('installation is complete');
    expect([...test.doc.querySelectorAll('[data-okw-navigation-action="install"]')].every((node) => node.hidden)).toBe(true);
    expect(offer(test).event.defaultPrevented).toBe(false); test.close(); await settled(test);
  });
  it('invalidates old promises and queued prompts after appinstalled', async () => {
    const test = setup(); const first = pending(); offer(test, vi.fn(() => first.promise));
    test.open(); test.submit().click(); const next = offer(test);
    test.view.dispatchEvent(new test.view.Event('appinstalled')); first.resolve({ outcome: 'dismissed' }); await tick();
    test.submit().click(); expect(next.prompt).not.toHaveBeenCalled(); expect(test.status()).toContain('complete');
    await settled(test);
  });
});
describe('installation capability and guidance', () => {
  it.each([{ display: true }, { standalone: true, platform: 'iPhone' }])('hides standalone entries at startup: %o', (opts) => {
    const test = setup(opts); expect(test.entry().hidden).toBe(true);
    expect(offer(test).event.defaultPrevented).toBe(false); test.open();
    expect(test.query('.okw-pwa-install-backdrop')).toBeNull();
  });
  it('invalidates deferred events on display changes without reusing an old prompt', async () => {
    const test = setup(); const old = offer(test); test.open(); test.display(true);
    expect(test.entry().hidden).toBe(true); expect(test.status()).toContain('app window');
    test.display(false); expect(test.entry().hidden).toBe(false); test.submit().click();
    expect(old.prompt).not.toHaveBeenCalled(); expect(test.submit().hidden).toBe(true); await settled(test);
  });
  it.each([{ userAgent: 'iPhone' }, { userAgent: 'iPad' }, { platform: 'MacIntel', maxTouchPoints: 5 }])(
    'shows Safari instructions for iOS and desktop-mode iPad: %o', (options) => {
      const test = setup(options); test.open();
      expect(test.query('.okw-pwa-install-panel').textContent).toContain('Share → Add to Home Screen');
      expect(test.query('.okw-pwa-install-panel').textContent).toContain('Open as Web App');
      expect(test.submit().hidden).toBe(true);
    });
  it('uses secure-context capability rather than URL protocol and ignores malformed install events', () => {
    const test = setup({ secure: false }); const offered = offer(test);
    expect(offered.event.defaultPrevented).toBe(false); test.open();
    expect(test.status()).toContain('not a trusted secure context');
    expect(test.query('.okw-pwa-install-security').textContent).toContain('LAN HTTP or untrusted HTTPS');
    expect(test.query('.okw-pwa-install-security').textContent).toContain('trusted by your phone');
    expect(test.submit().hidden).toBe(true); expect(offered.prompt).not.toHaveBeenCalled();
  });
  it('offers browser-menu and certificate guidance without an install event', () => {
    const test = setup(); const event = new test.view.Event('beforeinstallprompt', { cancelable: true });
    test.view.dispatchEvent(event); expect(event.defaultPrevented).toBe(false); test.open();
    expect(test.status()).toContain('has not provided');
    expect(test.query('.okw-pwa-install-panel').textContent).toContain('browser menu');
    expect(test.query('.okw-pwa-install-security').textContent).toContain('trusts the HTTPS certificate');
  });
  it('dynamically localizes navigation, instructions and pending states without mixed-language labels', async () => {
    const test = setup(); const choice = pending(); offer(test, vi.fn(() => choice.promise)); test.open();
    test.locale('zh'); expect(test.entry().textContent).toContain('安装到桌面');
    expect(test.entry().getAttribute('aria-label')).toBe('安装到桌面'); expect(test.status()).toContain('浏览器已准备好');
    expect(test.query('.okw-pwa-install-panel').textContent.replaceAll('HTTPS', '')).not.toMatch(/[A-Za-z]/);
    test.submit().click(); test.locale('en'); expect(test.status()).toContain('browser prompt');
    expect(test.query('.okw-pwa-install-panel').textContent).not.toMatch(/[\u4e00-\u9fff]/);
    choice.resolve({ outcome: 'dismissed' }); await tick(); test.locale('zh');
    expect(test.status()).toContain('已取消'); await settled(test);
  });
});
describe('install dialog focus and keyboard isolation', () => {
  it('isolates native capture shortcuts, traps Tab, restores inert and focus, and leaves the draft untouched', async () => {
    const test = setup(); offer(test); test.query('.sheet-root').inert = true; test.open();
    const close = test.query('.okw-pwa-install-panel header button'); const entry = test.entry();
    expect(test.doc.activeElement).toBe(close); expect(test.query('#app').inert).toBe(true);
    expect(key(test, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(test.doc.activeElement).toBe(test.submit()); key(test, 'Tab'); expect(test.doc.activeElement).toBe(close);
    for (const name of ['1', 'ArrowDown', 'Enter', ' ']) {
      expect(key(test, name).defaultPrevented).toBe(false);
    }
    key(test, 'k', { ctrlKey: true }); expect(test.search).not.toHaveBeenCalled();
    expect(test.nativeKey).not.toHaveBeenCalled(); key(test, 'Escape');
    expect(test.query('.okw-pwa-install-backdrop').hidden).toBe(true); expect(test.doc.activeElement).toBe(entry);
    expect(test.query('#app').inert).toBeUndefined(); expect(test.query('.sheet-root').inert).toBe(true);
    key(test, '1'); expect(test.nativeKey).toHaveBeenCalledOnce();
    expect(test.query('textarea').value).toBe('Unsaved draft'); await settled(test);
  });
  it('protects remounted backgrounds while open and restores their original inert state', async () => {
    const test = setup(); test.open(); test.query('#app').outerHTML = '<main id="app"><textarea>Draft</textarea></main>';
    await tick(); expect(test.query('#app').inert).toBe(true); test.close();
    expect(test.query('#app').inert).toBeUndefined(); expect(test.query('textarea').value).toBe('Draft'); await settled(test);
  });
  it('does not hijack Escape or Tab inside another dialog outside the install panel', async () => {
    const test = setup(); test.open();
    test.doc.body.insertAdjacentHTML('beforeend', '<section role="dialog"><button id="other">Other</button></section>');
    const other = test.query('#other'); other.focus();
    expect(key(test, 'Escape').defaultPrevented).toBe(false); expect(key(test, 'Tab').defaultPrevented).toBe(false);
    expect(test.query('.okw-pwa-install-backdrop').hidden).toBe(false); expect(test.doc.activeElement).toBe(other);
    test.close(); await settled(test);
  });
  it('returns focus to a visible control when an install action disappears', async () => {
    const test = setup(); const choice = pending(); offer(test, vi.fn(() => choice.promise)); test.open();
    test.submit().focus(); test.submit().click();
    expect(test.doc.activeElement).toBe(test.query('.okw-pwa-install-panel header button'));
    choice.resolve({ outcome: 'dismissed' }); await tick();
    key(test, 'Tab'); expect(test.doc.activeElement).toBe(test.query('.okw-pwa-install-panel header button'));
    expect(test.submit().hidden).toBe(true); await settled(test);
  });
  it('does not open over an existing inert app and keeps backdrop closing local', async () => {
    const test = setup(); test.query('#app').inert = true; test.open();
    expect(test.query('.okw-pwa-install-backdrop')).toBeNull();
    test.query('#app').inert = false; test.open(); test.query('.okw-pwa-install-panel').click();
    expect(test.query('.okw-pwa-install-backdrop').hidden).toBe(false);
    test.query('.okw-pwa-install-backdrop').click(); expect(test.query('.okw-pwa-install-backdrop').hidden).toBe(true);
    await settled(test);
  });
});
describe('local CA install guidance requests', () => {
  it('does no network or storage work until opened and refreshes only on each new opening', async () => {
    const test = setup(); offer(test); test.locale('zh'); test.display(false);
    test.view.dispatchEvent(new test.view.Event('pageshow'));
    expect(test.view.fetch).not.toHaveBeenCalled(); expect(test.storage).not.toHaveBeenCalled();
    test.view.fetch.mockResolvedValue(caResponse()); test.open();
    const [url, options] = test.view.fetch.mock.calls[0];
    expect(url).toBe('/__open-kimi-mobile/tls/status');
    expect(options).toEqual({ credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.anything() });
    expect(options.headers).toBeUndefined(); expect(options.signal.aborted).toBe(false);
    await tick(); expect(test.query('.okw-pwa-install-ca').hidden).toBe(false);
    test.open(); test.locale('en'); test.view.dispatchEvent(new test.view.Event('pageshow'));
    expect(test.view.fetch).toHaveBeenCalledOnce(); test.close();
    test.view.fetch.mockResolvedValue(caResponse(certificate({ fingerprint: Array(32).fill('CD').join(':') })));
    test.open(); expect(test.query('.okw-pwa-install-ca').hidden).toBe(true);
    expect(test.view.fetch).toHaveBeenCalledTimes(2); await settled(test);
    expect(test.query('.okw-pwa-install-fingerprint').textContent).toBe(Array(32).fill('CD').join(':'));
    test.close(); test.view.fetch.mockResolvedValue({ ok: false }); test.open(); await tick();
    expect(test.query('.okw-pwa-install-ca').hidden).toBe(true); expect(test.storage).not.toHaveBeenCalled();
  });
  it.each(['404', '500', 'network', 'json'])('keeps install usable after optional status failure: %s', async (failure) => {
    const test = setup(); const log = vi.spyOn(test.view.console, 'error'); const offered = offer(test);
    if (failure === 'network') test.view.fetch.mockRejectedValue(new Error('private certificate detail'));
    else if (failure === 'json') test.view.fetch.mockResolvedValue({ ok: true,
      json: () => Promise.reject(new Error('private certificate detail')) });
    else test.view.fetch.mockResolvedValue({ ok: false, status: Number(failure) });
    test.open(); await tick(); expect(test.query('.okw-pwa-install-ca').hidden).toBe(true);
    expect(test.query('.okw-pwa-install-ca a').hidden).toBe(true);
    expect(test.query('.okw-pwa-install-panel').textContent).not.toContain('private certificate detail');
    expect(log).not.toHaveBeenCalled(); test.submit().click(); expect(offered.prompt).toHaveBeenCalledOnce();
    await settled(test);
  });
  it.each([
    null, {}, certificate({ source: 'custom' }), certificate({ fingerprint: 'AB:CD' }),
    certificate({ fingerprint: Array(32).fill('ab').join(':') }),
    certificate({ fingerprint: `${Array(32).fill('AB').join(':')}\n` }),
    certificate({ fingerprint: '<img src=x onerror=alert(1)>' }), certificate({ fingerprint: 42 }),
    certificate({ expiresAt: null }), certificate({ expiresAt: 'not-a-date' }),
    certificate({ expiresAt: '2000-01-01T00:00:00.000Z' }), certificate({ expiresAt: '2099-02-31T00:00:00.000Z' }),
  ])('does not show unvalidated certificate data: %j', async (data) => {
    const test = setup(); test.view.fetch.mockResolvedValue(caResponse(data)); test.open(); await tick();
    expect(test.query('.okw-pwa-install-ca').hidden).toBe(true);
    expect(test.query('.okw-pwa-install-fingerprint').textContent).toBe('');
    expect(test.query('.okw-pwa-install-ca img')).toBeNull(); await settled(test);
  });
  it('uses only the fixed public certificate link and localizes all visible CA guidance without new requests', async () => {
    const test = setup(); test.view.fetch.mockResolvedValue(caResponse(certificate({ url: 'https://evil.example/private' })));
    test.open(); await tick(); const section = test.query('.okw-pwa-install-ca'); const link = section.querySelector('a');
    expect(link.getAttribute('href')).toBe('/__open-kimi-mobile/tls/ca.cer');
    expect(link.download).toBe('open-kimi-web-ca.cer'); expect(section.textContent).not.toContain('evil.example');
    expect(section.textContent).toContain('public only'); expect(section.textContent).toContain('not just this page');
    expect(section.textContent).toContain('changes your phone’s trust');
    expect(section.querySelectorAll('li')).toHaveLength(3);
    expect(test.query('.okw-pwa-install-fingerprint').textContent).toBe(certificate().fingerprint);
    test.locale('zh'); expect(link.textContent).toContain('仅公钥'); expect(section.textContent).toContain('电脑终端');
    expect(section.textContent).toContain('完全关闭并重开 Chrome'); test.locale('en');
    expect(test.query('.okw-pwa-install-panel').textContent).not.toMatch(/[\u4e00-\u9fff]/);
    expect(test.view.fetch).toHaveBeenCalledOnce(); expect(test.query('textarea').value).toBe('Unsaved draft');
    await settled(test);
  });
});
describe('local CA request lifecycle', () => {
  it('aborts on closing, ignores a late response, and keeps the reopened request current', async () => {
    const test = setup(); const old = pending(); const fresh = pending();
    test.view.fetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise); test.open();
    const signal = test.view.fetch.mock.calls[0][1].signal; test.close(); expect(signal.aborted).toBe(true);
    test.open(); old.resolve(caResponse(certificate({ fingerprint: Array(32).fill('CD').join(':') })));
    await tick(); expect(test.query('.okw-pwa-install-ca').hidden).toBe(true);
    fresh.resolve(caResponse()); await tick();
    expect(test.query('.okw-pwa-install-fingerprint').textContent).toBe(certificate().fingerprint);
    test.close(); const count = test.view.fetch.mock.calls.length; await tick();
    expect(test.view.fetch).toHaveBeenCalledTimes(count);
    await settled(test);
  });
  it('aborts a pending JSON body on close and does not render it later', async () => {
    const test = setup(); const json = pending(); const response = { ok: true, json: vi.fn(() => json.promise) };
    test.view.fetch.mockResolvedValue(response); test.open(); await tick(); expect(response.json).toHaveBeenCalledOnce();
    test.close(); expect(test.view.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    json.resolve(certificate()); await tick(); expect(test.query('.okw-pwa-install-ca').hidden).toBe(true);
    await settled(test);
  });
  it.each(['headers', 'body'])('times out a stalled %s and ignores its late completion', async (stage) => {
    const test = setup(); const wait = pending();
    const timer = vi.spyOn(test.view, 'setTimeout'); const clear = vi.spyOn(test.view, 'clearTimeout');
    if (stage === 'headers') test.view.fetch.mockReturnValue(wait.promise);
    else test.view.fetch.mockResolvedValue({ ok: true, json: () => wait.promise });
    test.open(); await tick(); const [timeout, delay] = timer.mock.calls.find(([, delay]) => delay === 5000);
    expect(delay).toBe(5000); timeout(); expect(test.view.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    wait.resolve(stage === 'headers' ? caResponse() : certificate()); await tick();
    expect(test.query('.okw-pwa-install-ca').hidden).toBe(true); expect(clear).toHaveBeenCalled();
    const next = pending(); test.view.fetch.mockReturnValue(next.promise); test.close(); test.open();
    timeout(); expect(test.view.fetch.mock.calls[1][1].signal.aborted).toBe(false);
    next.resolve(caResponse()); await tick();
    expect(test.query('.okw-pwa-install-ca').hidden).toBe(false); await settled(test);
  });
  it('keeps native prompting synchronous while certificate status is pending', async () => {
    const test = setup(); const wait = pending(); test.view.fetch.mockReturnValue(wait.promise);
    let clicking = false; const prompt = vi.fn(() => {
      expect(clicking).toBe(true); return Promise.resolve({ outcome: 'dismissed' });
    });
    offer(test, prompt); test.open(); clicking = true; test.submit().click(); clicking = false;
    expect(prompt).toHaveBeenCalledOnce(); test.close(); wait.resolve(caResponse()); await settled(test);
  });
});
describe('local CA guidance accessibility', () => {
  it.each([false, true])('includes the download in the keyboard focus trap with native install: %s', async (native) => {
    const test = setup(); test.view.fetch.mockResolvedValue(caResponse()); if (native) offer(test);
    test.open(); await tick(); const link = test.query('.okw-pwa-install-ca a');
    const close = test.query('.okw-pwa-install-panel header button');
    expect(link.hidden).toBe(false); expect(link.tabIndex).toBe(0); link.focus(); expect(test.doc.activeElement).toBe(link);
    expect(key(test, 'Enter').defaultPrevented).toBe(false); expect(test.nativeKey).not.toHaveBeenCalled();
    close.focus(); key(test, 'Tab', { shiftKey: true }); expect(test.doc.activeElement).toBe(native ? test.submit() : link);
    key(test, 'Tab'); expect(test.doc.activeElement).toBe(close);
    expect(test.query('#app').inert).toBe(true); key(test, 'Escape'); expect(test.doc.activeElement).toBe(test.entry());
    expect(test.query('#app').inert).toBeUndefined(); await settled(test);
  });
  it.each([{ userAgent: 'iPhone' }, { platform: 'MacIntel', maxTouchPoints: 5 }])(
    'does not give Android settings steps on iOS: %o', async (options) => {
      const test = setup(options); test.view.fetch.mockResolvedValue(caResponse()); test.open(); await tick();
      const section = test.query('.okw-pwa-install-ca'); expect(section.querySelector('ol').hidden).toBe(true);
      expect(section.lastElementChild.hidden).toBe(false);
      expect(section.lastElementChild.textContent).toContain('separate confirmation');
      expect(test.query('.okw-pwa-install-panel').textContent).toContain('Share → Add to Home Screen');
      await settled(test);
    });
});
