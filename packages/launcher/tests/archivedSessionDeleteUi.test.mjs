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

class FakeSidebarRow extends FakeElement {
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
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

const archivedItemV2 = (id, { archived = true, title = 'Archived title' } = {}) => ({
  id,
  workspace: { id: 'workspace_test', cwd: 'C:\\work' },
  meta: {
    title,
    archived,
    archived_at: new Date(ARCHIVED_AT).getTime(),
    updated_at: new Date(ARCHIVED_AT).getTime(),
  },
});

function archivedResponse(archived = true, items) {
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

function archivedResponseV2(archived = true, items) {
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

async function install({
  archived = true,
  apiItems,
  apiVersion = 'v1',
  deleteResponse,
  confirm = true,
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
    const url = String(input);
    const items = typeof apiItems === 'function' ? apiItems(url) : apiItems;
    if (url.includes('archived_only=true')) return archivedResponse(archived, items);
    if (url.includes('meta.archived=true')) return archivedResponseV2(archived, items);
    return deleteResponse?.() ?? new Response(JSON.stringify({ deleted: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  const window = {
    fetch: nativeFetch,
    confirm: vi.fn(() => confirm),
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
    navigator: { language: 'en' },
    queueMicrotask,
    window,
  });

  const archivedUrl = apiVersion === 'v2'
    ? 'http://localhost/api/v2/sessions?sort=meta.updated_at_desc&meta.archived=true'
    : 'http://localhost/api/v1/sessions?archived_only=true';
  await window.fetch(archivedUrl, {
    headers: { authorization: 'Bearer page-token' },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  observerCallback();
  const actions = card.row.querySelector('.okw-archive-actions');
  const remove = actions?.querySelector('.okw-archive-delete');
  const sidebarRemove = sidebarRows[0]?.querySelector('.okw-sidebar-archive-delete');
  return { archivedUrl, card, mutate: observerCallback, nativeFetch, remove, sidebarRemove, sidebarRows, window };
}

const settleObservation = () => new Promise((resolve) => setTimeout(resolve, 0));

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
};

describe('archived session delete UI', () => {
  it('adds direct delete buttons in settings and the completed sidebar list', async () => {
    const v1 = await install();
    expect(v1.remove).toBeDefined();
    expect(v1.sidebarRemove).toBeDefined();
    expect(v1.card.row.querySelector('.okw-archive-more')).toBeNull();
    expect(v1.card.row.querySelector('.okw-archive-menu')).toBeNull();

    const v2 = await install({ apiVersion: 'v2' });
    expect(v2.remove).toBeDefined();
    expect(v2.sidebarRemove).toBeDefined();
  });

  it('adds no delete button to ordinary or API-unconfirmed sessions', async () => {
    const ordinary = new FakeSidebarRow('Archived title', { completed: false });
    const unarchived = await install({ archived: false, sidebarRows: [ordinary] });
    expect(unarchived.remove).toBeUndefined();
    expect(unarchived.sidebarRemove).toBeNull();

    const unarchivedV2 = await install({ apiVersion: 'v2', archived: false });
    expect(unarchivedV2.remove).toBeUndefined();
    expect(unarchivedV2.sidebarRemove).toBeNull();
  });

  it('adds the sidebar button when a completed row appears after the API response', async () => {
    const ui = await install({ sidebarRows: [] });
    const lateRow = new FakeSidebarRow();
    ui.sidebarRows.push(lateRow);
    ui.mutate();

    expect(lateRow.querySelector('.okw-sidebar-archive-delete')).not.toBeNull();
  });
});

describe('archived session matching safety', () => {
  it('does not bind one DOM row when the API has two sessions with the same visible key', async () => {
    const ui = await install({
      apiVersion: 'v2',
      apiItems: [archivedItemV2('session_one'), archivedItemV2('session_two')],
    });
    expect(ui.card.row.querySelector('.okw-archive-actions')).toBeNull();
    expect(ui.sidebarRows[0].querySelector('.okw-sidebar-archive-delete')).toBeNull();
  });

  it('does not bind two DOM rows to one API session with the same visible key', async () => {
    const ui = await install({ rowCount: 2 });
    expect(ui.card.rows.every((row) => row.querySelector('.okw-archive-actions') === null)).toBe(true);
  });

  it('removes an old action when the official DOM reuses a row for different content', async () => {
    const ui = await install();
    expect(ui.card.row.querySelector('.okw-archive-actions')).not.toBeNull();

    ui.card.row.title.textContent = 'Different archived title';
    ui.mutate();

    expect(ui.card.row.querySelector('.okw-archive-actions')).toBeNull();
  });

  it('replaces one v2 page snapshot and drops sessions no longer archived there', async () => {
    let requestCount = 0;
    const ui = await install({
      apiVersion: 'v2',
      apiItems: () => requestCount++ === 0
        ? [archivedItemV2('session_archived')]
        : [archivedItemV2('session_archived', { archived: false })],
    });
    expect(ui.card.row.querySelector('.okw-archive-actions')).not.toBeNull();

    const refresh = ui.window.fetch(ui.archivedUrl, { headers: { authorization: 'Bearer page-token' } });
    expect(ui.card.row.querySelector('.okw-archive-actions')).toBeNull();
    await refresh;
    await new Promise((resolve) => setTimeout(resolve, 0));
    ui.mutate();

    expect(ui.card.row.querySelector('.okw-archive-actions')).toBeNull();
  });

  it('retains a session referenced by another v2 page snapshot', async () => {
    const ui = await install({
      apiVersion: 'v2',
      apiItems: (url) => url.includes('cursor=next')
        ? [archivedItemV2('session_next', { title: 'Another title' })]
        : [archivedItemV2('session_archived')],
    });
    const nextPage = `${ui.archivedUrl}&cursor=next`;
    await ui.window.fetch(nextPage, { headers: { authorization: 'Bearer page-token' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    ui.mutate();

    expect(ui.card.row.querySelector('.okw-archive-actions')).not.toBeNull();
  });

  it('does not bind a replacement session that has the same visible key as a stale row', async () => {
    let requestCount = 0;
    const ui = await install({
      apiVersion: 'v2',
      apiItems: () => [archivedItemV2(requestCount++ === 0 ? 'session_old' : 'session_new')],
    });

    await ui.window.fetch(ui.archivedUrl, { headers: { authorization: 'Bearer page-token' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    ui.mutate();

    expect(ui.card.row.querySelector('.okw-archive-actions')).toBeNull();
  });
});

describe('archived session list cache failures', () => {
  it('does not restore an old action after a refresh network failure', async () => {
    const ui = await install({ apiVersion: 'v2' });
    ui.nativeFetch.mockRejectedValueOnce(new Error('offline'));

    await expect(ui.window.fetch(ui.archivedUrl, {
      headers: { authorization: 'Bearer page-token' },
    })).rejects.toThrow('offline');
    ui.mutate();

    expect(ui.card.row.querySelector('.okw-archive-actions')).toBeNull();
  });

  it('does not restore an old action after a refresh HTTP failure', async () => {
    const ui = await install({ apiVersion: 'v2' });
    ui.nativeFetch.mockResolvedValueOnce(new Response('Unavailable', { status: 503 }));

    await ui.window.fetch(ui.archivedUrl, { headers: { authorization: 'Bearer page-token' } });
    await settleObservation();
    ui.mutate();

    expect(ui.card.row.querySelector('.okw-archive-actions')).toBeNull();
  });

  it('ignores an older response that arrives after a newer request for the same page', async () => {
    const ui = await install({ apiVersion: 'v2' });
    const older = deferred();
    const newer = deferred();
    ui.nativeFetch.mockImplementationOnce(() => older.promise);
    ui.nativeFetch.mockImplementationOnce(() => newer.promise);

    const olderRequest = ui.window.fetch(ui.archivedUrl, { headers: { authorization: 'Bearer page-token' } });
    const newerRequest = ui.window.fetch(ui.archivedUrl, { headers: { authorization: 'Bearer page-token' } });
    newer.resolve(archivedResponseV2(true, [archivedItemV2('session_archived')]));
    await newerRequest;
    await settleObservation();
    older.resolve(archivedResponseV2(true, [archivedItemV2('session_older', { title: 'Older title' })]));
    await olderRequest;
    await settleObservation();
    ui.mutate();

    expect(ui.card.row.querySelector('.okw-archive-actions')).not.toBeNull();
  });
});

describe('archived session delete interactions', () => {
  it('cancels without a request and deletes only after explicit title confirmation', async () => {
    const cancelled = await install({ confirm: false });
    cancelled.remove.dispatch('click');
    await Promise.resolve();
    expect(cancelled.window.confirm).toHaveBeenCalledWith(expect.stringContaining('Archived title'));
    expect(cancelled.nativeFetch).toHaveBeenCalledTimes(1);
    expect(cancelled.card.row.removed).toBe(false);
    expect(cancelled.window.location.reload).not.toHaveBeenCalled();

    const confirmed = await install();
    confirmed.remove.dispatch('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(confirmed.nativeFetch).toHaveBeenCalledTimes(2);
    expect(confirmed.card.row.removed).toBe(true);
    expect(confirmed.sidebarRows[0].removed).toBe(true);
    expect(confirmed.window.location.reload).toHaveBeenCalledTimes(1);
  });

  it('prevents duplicate requests across both direct buttons while deletion is pending', async () => {
    let resolveDelete;
    const pending = new Promise((resolve) => { resolveDelete = resolve; });
    const ui = await install({ deleteResponse: () => pending });
    ui.remove.dispatch('click');
    ui.remove.dispatch('click');
    ui.sidebarRemove.dispatch('click');
    expect(ui.nativeFetch).toHaveBeenCalledTimes(2);
    resolveDelete(new Response(JSON.stringify({ deleted: true }), { status: 200 }));
    await settleObservation();
    expect(ui.window.location.reload).toHaveBeenCalledTimes(1);
  });

  it('keeps the row and shows a readable error when deletion fails', async () => {
    const ui = await install({
      deleteResponse: () => new Response(JSON.stringify({ error: 'Backend unavailable' }), { status: 501 }),
    });
    ui.remove.dispatch('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ui.card.row.removed).toBe(false);
    expect(ui.card.row.querySelector('.okw-archive-delete-error')?.textContent).toBe('Backend unavailable');
    expect(ui.remove.disabled).toBe(false);
    expect(ui.window.location.reload).not.toHaveBeenCalled();
  });

  it('keeps the completed sidebar row and restores its direct button after failure', async () => {
    const ui = await install({
      deleteResponse: () => new Response(JSON.stringify({ error: 'Backend unavailable' }), { status: 501 }),
    });
    ui.sidebarRemove.dispatch('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ui.sidebarRows[0].removed).toBe(false);
    expect(ui.sidebarRows[0].querySelector('.okw-archive-delete-error')?.textContent).toBe('Backend unavailable');
    expect(ui.sidebarRemove.disabled).toBe(false);
    expect(ui.sidebarRemove.textContent).toBe('Delete');
    expect(ui.window.location.reload).not.toHaveBeenCalled();
  });
});
