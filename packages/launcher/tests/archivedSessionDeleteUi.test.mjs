import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../src/mobile/archivedSessionDelete.js', import.meta.url), 'utf8');

class FakeElement {
  constructor(className = '') {
    this.className = className;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.hidden = false;
    this.disabled = false;
    this.removed = false;
    this.textContent = '';
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { this.className = this.className.split(' ').filter((name) => !names.includes(name)).join(' '); },
    };
  }

  addEventListener(type, listener) { this.listeners.set(type, listener); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  focus() {}
  append(...nodes) { this.children.push(...nodes); }
  contains(target) { return target === this || this.children.some((child) => child.contains?.(target)); }
  closest() { return null; }
  remove() { this.removed = true; }
  dispatch(type, values = {}) {
    this.listeners.get(type)?.({ target: this, stopPropagation() {}, preventDefault() {}, ...values });
  }

  querySelector(selector) {
    const className = selector.startsWith('.') ? selector.slice(1) : '';
    for (const child of this.children) {
      if (child.className?.split(' ').includes(className)) return child;
      const nested = child.querySelector?.(selector);
      if (nested) return nested;
    }
    return null;
  }
}

class FakeRow extends FakeElement {
  constructor(card, title, time) {
    super('archive-row');
    this.card = card;
    this.title = new FakeElement('archive-name');
    this.title.textContent = title;
    this.time = new FakeElement('archive-time');
    this.time.textContent = `Archived ${time}`;
  }

  closest(selector) { return selector === '.archive-card' ? this.card : null; }
  querySelector(selector) {
    if (selector === '.archive-name') return this.title;
    if (selector === '.archive-time') return this.time;
    return super.querySelector(selector);
  }
}

class FakeCard extends FakeElement {
  constructor(cwd, title = 'Archived title', time = displayMinute(ARCHIVED_AT)) {
    super('archive-card');
    this.path = new FakeElement('path');
    this.path.textContent = cwd;
    this.count = new FakeElement('count');
    this.count.textContent = '1 session';
    this.row = new FakeRow(this, title, time);
  }

  querySelector(selector) {
    if (selector === '.archive-workspace .path') return this.path;
    if (selector === '.archive-workspace .count') return this.count;
    return super.querySelector(selector);
  }

  querySelectorAll(selector) {
    return selector === '.archive-row' && !this.row.removed ? [this.row] : [];
  }
}

const ARCHIVED_AT = '2026-09-08T12:34:00';

function displayMinute(value) {
  const date = new Date(value);
  const two = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

function archivedResponse(archived = true) {
  return new Response(JSON.stringify({
    code: 0,
    data: {
      items: [{
        id: 'session_archived',
        title: 'Archived title',
        archived,
        archived_at: ARCHIVED_AT,
        metadata: { cwd: 'C:\\work' },
      }],
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function install({ archived = true, deleteResponse, confirm = true } = {}) {
  const card = new FakeCard('C:\\work');
  const documentListeners = new Map();
  const document = {
    documentElement: {},
    addEventListener: (type, listener) => documentListeners.set(type, listener),
    createElement: () => new FakeElement(),
    querySelectorAll(selector) {
      if (selector === '.archive-list .archive-card') return [card];
      if (selector === '.archive-list .archive-row') return card.querySelectorAll('.archive-row');
      return [];
    },
  };
  let observerCallback;
  class MutationObserver {
    constructor(callback) { observerCallback = callback; }
    observe() {}
  }

  const nativeFetch = vi.fn(async (input) => {
    const url = String(input);
    if (url.includes('archived_only=true')) return archivedResponse(archived);
    return deleteResponse?.() ?? new Response(JSON.stringify({ deleted: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  const window = { fetch: nativeFetch, confirm: vi.fn(() => confirm) };
  runInNewContext(source, {
    Date,
    Error,
    Headers,
    Map,
    MutationObserver,
    Number,
    Request,
    Response,
    String,
    URL,
    WeakMap,
    document,
    location: { href: 'http://localhost/settings', origin: 'http://localhost' },
    navigator: { language: 'en' },
    queueMicrotask,
    window,
  });

  await window.fetch('http://localhost/api/v1/sessions?archived_only=true', {
    headers: { authorization: 'Bearer page-token' },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  observerCallback();
  const actions = card.row.querySelector('.okw-archive-actions');
  const trigger = actions?.children[0];
  const menu = actions?.children[1];
  const remove = menu?.children[0];
  return { card, nativeFetch, remove, trigger, window };
}

describe('archived session delete UI', () => {
  it('adds the action only to records confirmed archived by the official list', async () => {
    expect((await install()).trigger).toBeDefined();
    expect((await install({ archived: false })).trigger).toBeUndefined();
  });

  it('cancels without a request and deletes only after explicit title confirmation', async () => {
    const cancelled = await install({ confirm: false });
    cancelled.trigger.dispatch('click');
    cancelled.remove.dispatch('click');
    await Promise.resolve();
    expect(cancelled.window.confirm).toHaveBeenCalledWith(expect.stringContaining('Archived title'));
    expect(cancelled.nativeFetch).toHaveBeenCalledTimes(1);
    expect(cancelled.card.row.removed).toBe(false);

    const confirmed = await install();
    confirmed.trigger.dispatch('click');
    confirmed.remove.dispatch('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(confirmed.nativeFetch).toHaveBeenCalledTimes(2);
    expect(confirmed.card.row.removed).toBe(true);
  });

  it('prevents duplicate requests while deletion is pending', async () => {
    let resolveDelete;
    const pending = new Promise((resolve) => { resolveDelete = resolve; });
    const ui = await install({ deleteResponse: () => pending });
    ui.trigger.dispatch('click');
    ui.remove.dispatch('click');
    ui.remove.dispatch('click');
    expect(ui.nativeFetch).toHaveBeenCalledTimes(2);
    resolveDelete(new Response(JSON.stringify({ deleted: true }), { status: 200 }));
    await Promise.resolve();
    await Promise.resolve();
  });

  it('keeps the row and shows a readable error when deletion fails', async () => {
    const ui = await install({
      deleteResponse: () => new Response(JSON.stringify({ error: 'Backend unavailable' }), { status: 501 }),
    });
    ui.trigger.dispatch('click');
    ui.remove.dispatch('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ui.card.row.removed).toBe(false);
    expect(ui.card.row.querySelector('.okw-archive-delete-error')?.textContent).toBe('Backend unavailable');
    expect(ui.trigger.disabled).toBe(false);
  });
});
