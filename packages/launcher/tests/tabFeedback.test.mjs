/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve('packages/launcher/src/mobile/tabFeedback.js'), 'utf8');
const frames = [];
const observers = [];
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

function install(fetch = vi.fn(async () => new Response('fixture'))) {
  vi.useFakeTimers();
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const view = frame.contentWindow;
  const doc = view.document;
  window.history.replaceState(null, '', '/sessions/A');
  doc.body.innerHTML = `<div class="side"><div class="sessions">
    <div class="se on" data-session-id="A">A</div><div class="se" data-session-id="B">B</div>
    <div class="se" data-session-id="C">C</div></div><div class="status-tabs"><div class="status-seg">
    <button class="ui-seg__item" role="tab" aria-selected="false">Done</button>
    <button class="ui-seg__item" role="tab" aria-selected="true">Open</button></div></div></div>
    <div class="panes chat-scroll"><div class="chat"></div></div><div class="pt-body"></div>
    <div class="panel-tab-bar"><div class="ptb-tabs">
    ${['A', 'B', 'C'].map((id) => `<div class="ptb-tab ${id === 'A' ? 'on' : ''}" data-panel-tab-id="${id}">
      <button class="ptb-tab-main" role="tab" aria-selected="${id === 'A'}">${id}.txt</button>
      <button class="ptb-x">Close</button></div>`).join('')}</div></div><button class="unrelated">Other</button>`;
  view.fetch = fetch;
  view.requestAnimationFrame = (callback) => view.setTimeout(callback, 16);
  view.cancelAnimationFrame = (id) => view.clearTimeout(id);
  view.Element.prototype.getBoundingClientRect = () => ({ left: 10, top: 10, width: 300, height: 500 });
  const Native = view.MutationObserver;
  let count = 0;
  view.MutationObserver = class {
    constructor(callback) {
      this.observer = new Native((records) => {
        if (++count > 100) { observers.forEach((o) => o.disconnect()); throw new Error('Observer did not settle'); }
        callback(records);
      });
      observers.push(this.observer);
    }
    observe(...args) { this.observer.observe(...args); }
  };
  view.eval(`(() => { const location = { origin: '${window.location.origin}',
    get href() { return window.parent.location.href; }, get pathname() { return window.parent.location.pathname; } };
    ${source}\n })()`);
  const selectPanel = (id) => {
    for (const node of doc.querySelectorAll('.ptb-tab')) {
      node.classList.toggle('on', node.dataset.panelTabId === id);
      node.querySelector('.ptb-tab-main').setAttribute('aria-selected', String(node.dataset.panelTabId === id));
    }
  };
  const panelClick = (id) => { doc.querySelector(`[data-panel-tab-id="${id}"] .ptb-tab-main`).click(); selectPanel(id); };
  const sessionClick = (id) => {
    doc.querySelector(`.se[data-session-id="${id}"]`).click();
    window.history.pushState(null, '', `/sessions/${id}`);
  };
  return { view, doc, fetch, panelClick, sessionClick, selectPanel };
}

async function paint() {
  await vi.advanceTimersByTimeAsync(20);
  await settle();
}

afterEach(() => {
  observers.splice(0).forEach((o) => o.disconnect());
  frames.splice(0).forEach((f) => f.remove());
  vi.useRealTimers();
});

describe('official tab interaction feedback', () => {
  it('does not change selection or consume clicks and ignores unrelated controls', async () => {
    const { doc } = install();
    const button = doc.querySelector('[data-panel-tab-id="B"] .ptb-tab-main');
    let clicked = false;
    button.addEventListener('click', (event) => { clicked = !event.defaultPrevented; });
    button.click();
    expect(clicked).toBe(true);
    expect(button.getAttribute('aria-selected')).toBe('false');
    expect(doc.querySelector('.ptb-tab.on').dataset.panelTabId).toBe('A');
    expect(doc.querySelectorAll('.okw-tab-feedback')).toHaveLength(1);
    await paint();
    expect(doc.querySelector('.okw-tab-feedback')).toBeNull();
    doc.querySelector('.unrelated').click();
    expect(doc.querySelector('.okw-tab-feedback')).toBeNull();
  });

  it('keeps C feedback when old B finishes and clears only the current request', async () => {
    const b = deferred();
    const c = deferred();
    const { view, doc, panelClick } = install(vi.fn().mockReturnValueOnce(b.promise).mockReturnValueOnce(c.promise));
    panelClick('B');
    const readB = view.fetch('/api/v1/sessions/A/fs:read', { method: 'POST', body: '{"path":"B.txt"}' });
    await paint();
    panelClick('C');
    const readC = view.fetch('/api/v1/sessions/A/fs:read', { method: 'POST', body: '{"path":"C.txt"}' });
    await paint();
    b.resolve(new Response('B'));
    await readB;
    await vi.advanceTimersByTimeAsync(1);
    expect(doc.querySelectorAll('.okw-tab-feedback')).toHaveLength(1);
    c.resolve(new Response('C'));
    await readC;
    await vi.advanceTimersByTimeAsync(1);
    expect(doc.querySelector('.okw-tab-feedback')).toBeNull();
  });

  it('lets a selected session paint before an immediate response without changing Response or request arguments', async () => {
    const response = new Response('C');
    const native = vi.fn(async () => response);
    const { view, doc, sessionClick } = install(native);
    sessionClick('C');
    const signal = new AbortController().signal;
    const init = { signal, credentials: 'same-origin' };
    const receiver = {};
    let delivered = false;
    const request = view.fetch.call(receiver, '/api/v1/sessions/C/transcript', init).then((result) => {
      delivered = true;
      return result;
    });
    await settle();
    expect(delivered).toBe(false);
    expect(doc.querySelector('.okw-tab-feedback')).not.toBeNull();
    await paint();
    expect(await request).toBe(response);
    expect(native.mock.contexts[0]).toBe(receiver);
    expect(native).toHaveBeenCalledWith('/api/v1/sessions/C/transcript', init);
  });
});

describe('tab feedback request binding', () => {
  it('binds a mobile row without a session ID to the native transcript request, not its title', async () => {
    const slow = deferred();
    const { view, doc } = install(vi.fn(() => slow.promise));
    doc.body.insertAdjacentHTML('beforeend', '<div class="sheet-root"><div class="mlist">'
      + '<div class="srow"><span class="srow-main">A duplicate title</span></div></div></div>');
    doc.querySelector('.srow-main').click();
    window.history.pushState(null, '', '/sessions/B');
    const request = view.fetch('/api/v1/sessions/B/transcript');
    await paint();
    expect(doc.querySelector('.okw-tab-feedback')).not.toBeNull();
    slow.resolve(new Response('B'));
    await request;
    await vi.advanceTimersByTimeAsync(1);
    expect(doc.querySelector('.okw-tab-feedback')).toBeNull();
  });

  it('handles classification races and failures without changing the official tab selection', async () => {
    const old = deferred();
    const current = deferred();
    const { view, doc } = install(vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise));
    const [done, open] = doc.querySelectorAll('.status-seg button');
    done.click();
    expect(done.getAttribute('aria-selected')).toBe('false');
    done.setAttribute('aria-selected', 'true');
    open.setAttribute('aria-selected', 'false');
    const oldRead = view.fetch('/api/v2/sessions?meta.archived=true');
    await paint();
    open.click();
    open.setAttribute('aria-selected', 'true');
    done.setAttribute('aria-selected', 'false');
    const newRead = view.fetch('/api/v2/sessions?meta.archived=false');
    const rejected = expect(newRead).rejects.toThrow('classification failure');
    await paint();
    old.resolve(new Response('Done'));
    await oldRead;
    await vi.advanceTimersByTimeAsync(1);
    expect(doc.querySelectorAll('.okw-tab-feedback')).toHaveLength(1);
    current.reject(new Error('classification failure'));
    await rejected;
    await vi.advanceTimersByTimeAsync(1);
    expect(doc.querySelector('.okw-tab-feedback')).toBeNull();
  });

  it('respects Request method overrides and does not delay wrong-method or unrelated session reads', async () => {
    const response = new Response('fixture');
    const native = vi.fn(async () => response);
    const { view, doc, sessionClick } = install(native);
    sessionClick('B');
    const input = new Request(`${window.location.origin}/api/v1/sessions/B/transcript`, { method: 'POST' });
    const init = { method: 'GET', signal: new AbortController().signal };
    let delivered = false;
    const request = view.fetch(input, init).then((value) => { delivered = true; return value; });
    await settle();
    expect(delivered).toBe(false);
    await paint();
    expect(await request).toBe(response);
    expect(native).toHaveBeenCalledWith(input, init);
    sessionClick('C');
    for (const url of ['/api/v1/sessions/B/transcript', '/api/v1/sessions/C/transcript']) {
      expect(await view.fetch(url, { method: 'POST' })).toBe(response);
    }
    await paint();
    expect(doc.querySelector('.okw-tab-feedback')).toBeNull();
  });
});

describe('tab feedback cleanup', () => {
  it('clears cached or cancelled interactions, current fetch failures, close and page exit', async () => {
    const fail = deferred();
    const { view, doc, panelClick } = install(vi.fn(() => fail.promise));
    panelClick('B');
    await paint();
    expect(doc.querySelector('.okw-tab-feedback')).toBeNull();
    panelClick('C');
    const request = view.fetch('/api/v1/sessions/A/fs:read', { method: 'POST' });
    const failure = expect(request).rejects.toThrow('fixture failure');
    await paint();
    fail.reject(new Error('fixture failure'));
    await failure;
    await vi.advanceTimersByTimeAsync(1);
    expect(doc.querySelector('.okw-tab-feedback')).toBeNull();
    panelClick('B');
    doc.querySelector('[data-panel-tab-id="B"] .ptb-x').click();
    expect(doc.querySelector('.okw-tab-feedback')).toBeNull();
    panelClick('C');
    view.dispatchEvent(new Event('pagehide'));
    expect(doc.querySelector('.okw-tab-feedback')).toBeNull();
  });

  it('hands loading to the native spinner and preserves nonmatching or cross-origin responses', async () => {
    const slow = deferred();
    const { view, doc, sessionClick } = install(vi.fn(() => slow.promise));
    sessionClick('B');
    const request = view.fetch('/api/v1/sessions/B/transcript');
    await paint();
    expect(doc.querySelector('.okw-tab-feedback')).not.toBeNull();
    doc.querySelector('.chat').innerHTML = '<div class="chat-loading">Loading</div>';
    await settle();
    await paint();
    expect(doc.querySelector('.okw-tab-feedback')).toBeNull();
    const response = new Response('fixture');
    slow.resolve(response);
    expect(await request).toBe(response);
    for (const url of ['https://other.invalid/api/v1/sessions/B/transcript', '/api/v1/models']) {
      expect(await view.fetch(url)).toBe(response);
    }
  });

  it('is installed once, supports keyboard and has a bounded hidden-frame fallback', async () => {
    const { view, doc } = install();
    const original = view.fetch;
    view.eval(`(() => { ${source}\n })()`);
    expect(view.fetch).toBe(original);
    const button = doc.querySelector('[data-panel-tab-id="B"] .ptb-tab-main');
    button.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(doc.querySelector('.okw-tab-feedback')).not.toBeNull();
    view.requestAnimationFrame = () => 0;
    await vi.advanceTimersByTimeAsync(16000);
    expect(doc.querySelector('.okw-tab-feedback')).toBeNull();
  });
});
