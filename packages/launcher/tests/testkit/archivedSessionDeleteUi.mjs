import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { vi } from 'vitest';

const source = readFileSync(new URL('../../src/mobile/archivedSessionDelete.js', import.meta.url), 'utf8');

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
  append(...nodes) {
    nodes.forEach((node) => { node.parentElement = this; });
    this.children.push(...nodes);
  }
  contains(target) { return target === this || this.children.some((child) => child.contains?.(target)); }
  closest() { return null; }
  remove() {
    this.removed = true;
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
    }
  }
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
  constructor(cwd, title = 'Archived title', time = displayMinute(ARCHIVED_AT), rowCount = 1) {
    super('archive-card');
    this.path = new FakeElement('path');
    this.path.textContent = cwd;
    this.count = new FakeElement('count');
    this.count.textContent = '1 session';
    this.rows = Array.from({ length: rowCount }, () => new FakeRow(this, title, time));
    [this.row] = this.rows;
  }

  querySelector(selector) {
    if (selector === '.archive-workspace .path') return this.path;
    if (selector === '.archive-workspace .count') return this.count;
    return super.querySelector(selector);
  }

  querySelectorAll(selector) {
    return selector === '.archive-row' ? this.rows.filter((row) => !row.removed) : [];
  }
}

export class FakeSidebarRow extends FakeElement {
  constructor(title = 'Archived title', { completed = true } = {}) {
    super('se');
    this.title = new FakeElement('t');
    this.title.textContent = title;
    this.actions = new FakeElement('ha');
    if (completed) {
      this.reopen = new FakeElement('reopen-btn');
      this.actions.append(this.reopen);
    }
    this.append(this.title, this.actions);
  }
}

const ARCHIVED_AT = '2026-09-08T12:34:00';

function displayMinute(value) {
  const date = new Date(value);
  const two = (part) => String(part).padStart(2, '0');
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  return `${day} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

export const archivedItemV2 = (id, { archived = true, title = 'Archived title' } = {}) => ({
  id,
  workspace: { id: 'workspace_test', cwd: 'C:\\work' },
  meta: {
    title,
    archived,
    archived_at: new Date(ARCHIVED_AT).getTime(),
    updated_at: new Date(ARCHIVED_AT).getTime(),
  },
});

function archivedResponseV1(archived = true, items) {
  return new Response(JSON.stringify({
    code: 0,
    data: {
      items: items ?? [{
        id: 'session_archived',
        title: 'Archived title',
        archived,
        archived_at: ARCHIVED_AT,
        metadata: { cwd: 'C:\\work' },
      }],
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

export function archivedResponseV2(archived = true, items) {
  return new Response(JSON.stringify({
    data: {
      items: items ?? [{
        id: 'session_archived',
        workspace: { id: 'workspace_test', cwd: 'C:\\work' },
        meta: {
          title: 'Archived title',
          archived,
          archived_at: new Date(ARCHIVED_AT).getTime(),
          updated_at: new Date(ARCHIVED_AT).getTime(),
        },
      }],
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function listResponse(input, archived, apiItems) {
  const url = String(input);
  const items = typeof apiItems === 'function' ? apiItems(url) : apiItems;
  if (url.includes('archived_only=true')) return archivedResponseV1(archived, items);
  if (url.includes('meta.archived=true')) return archivedResponseV2(archived, items);
  return null;
}

const listUrl = (apiVersion) => apiVersion === 'v1'
  ? 'http://localhost/api/v1/sessions?archived_only=true'
  : 'http://localhost/api/v2/sessions?sort=meta.updated_at_desc&meta.archived=true';

const listHeaders = (authorization) => authorization === ''
  ? {}
  : { authorization: authorization ?? 'Bearer page-token' };

export async function install({
  archived = true,
  apiItems,
  apiVersion,
  authorization,
  deleteResponse,
  confirm = true,
  locale,
  navigatorLanguage,
  rowCount = 1,
  sidebarRows = [new FakeSidebarRow()],
} = {}) {
  const card = new FakeCard('C:\\work', 'Archived title', displayMinute(ARCHIVED_AT), rowCount);
  const documentListeners = new Map();
  const document = {
    documentElement: {},
    addEventListener: (type, listener) => documentListeners.set(type, listener),
    createElement: () => new FakeElement(),
    querySelectorAll(selector) {
      if (selector === '.archive-list .archive-card') return [card];
      if (selector === '.archive-list .archive-row') return card.querySelectorAll('.archive-row');
      if (selector === '.sessions .se') return sidebarRows.filter((row) => !row.removed);
      return [];
    },
  };
  let observerCallback;
  class MutationObserver {
    constructor(callback) { observerCallback = callback; }
    observe() {}
  }

  const nativeFetch = vi.fn(async (input) => {
    const response = listResponse(input, archived, apiItems);
    if (response) return response;
    return deleteResponse?.() ?? new Response(JSON.stringify({ code: 0, data: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  let currentLocale = locale;
  const window = {
    fetch: nativeFetch,
    confirm: vi.fn(() => confirm),
    localStorage: { getItem: vi.fn((key) => key === 'kimi-locale' ? currentLocale : null) },
    location: { reload: vi.fn() },
  };
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
    navigator: { language: navigatorLanguage },
    queueMicrotask,
    window,
  });

  const archivedUrl = listUrl(apiVersion);
  await window.fetch(archivedUrl, {
    headers: listHeaders(authorization),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  observerCallback();
  const actions = card.row.querySelector('.okw-archive-actions');
  const remove = actions?.querySelector('.okw-archive-delete');
  const sidebarRemove = sidebarRows[0]?.querySelector('.okw-sidebar-archive-delete');
  return {
    archivedUrl, card, mutate: observerCallback, nativeFetch, remove,
    setLocale: (value) => { currentLocale = value; },
    sidebarRemove, sidebarRows, window,
  };
}

export const settleObservation = () => new Promise((resolve) => setTimeout(resolve, 0));

export const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
};
