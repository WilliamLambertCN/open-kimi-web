/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ReadableStream } from 'node:stream/web';
import { TextEncoder } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addMobilePresentation } from '../src/officialPresentation.mjs';

const sources = Object.fromEntries(['presentation', 'mobileWorkspaceSort'].map((name) => [
  name, readFileSync(resolve(`packages/launcher/src/mobile/${name}.js`), 'utf8'),
]));
const injectedHtml = addMobilePresentation('<html><head><script type="module" src="/boot.js"></script></head></html>', {
  officialWebVersion: '2.7.2',
});
const injectedOrder = [...injectedHtml.matchAll(/<script src="\/__open-kimi-mobile\/(\w+)\.js"><\/script>/g)]
  .map((match) => match[1]).filter((name) => name in sources);
const listPath = '/api/v1/sessions?view=by_workspace&group_page_size=5&archived=false&has_prompt=true';
const states = [];
const streams = new Set();
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const row = (id) => `<div class="mgroup"><div class="mgh"><span class="mgh-name">Project ${id}</span>
  <span class="mgh-path">/fictional/${id}</span></div></div>`;
const group = (id, total = 3, root = `/fictional/${id}`) => ({
  workspace_id: `workspace_${id}`, total,
  sessions: [{ id: `session_${id}`, workspace_id: `workspace_${id}`, cwd: root, git: { branch: `branch-${total}` } }],
});
const envelope = (groups) => ({ code: 0, data: { groups, total: groups.length, has_more: false } });
const bodyOf = (data) => Array.isArray(data) ? envelope(data) : { code: 0, data };

function install(component, { instrument = false } = {}) {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const view = frame.contentWindow;
  const doc = view.document;
  const state = { frame, observers: [], calls: 0, stopped: false };
  states.push(state);
  doc.documentElement.lang = 'en';
  const storage = { getItem: vi.fn((key) => ({
    'kimi-web.workspace-order': '["workspace_c","workspace_b","workspace_a"]',
    'open-kimi-web.mobile-workspace-sort': 'desktop',
  })[key] ?? null), setItem: vi.fn() };
  Object.defineProperty(view, 'localStorage', { value: storage });
  view.matchMedia = () => ({ matches: true, addEventListener() {} });
  Object.assign(view, { Request, Response, Headers });
  const nativeFetch = vi.fn(async () => new Response('{}'));
  view.fetch = nativeFetch;
  doc.body.innerHTML = '<div class="app mobile"><div class="topbar"><div class="tb-main">' +
    '<span class="dir">Fictional project</span></div><span class="st">Idle</span></div></div>' +
    '<div class="sheet-root"><div class="sheet-body"><div class="actions"><button class="newrow">New chat</button>' +
    '</div><div class="view-tabs">Grouped</div><div class="mlist"></div></div></div>';
  const NativeObserver = view.MutationObserver;
  view.MutationObserver = class extends NativeObserver {
    constructor(callback) {
      super((records, observer) => {
        state.calls += 1;
        if (state.calls > 100) {
          state.stopped = true;
          state.observers.forEach((item) => item.disconnect());
          return;
        }
        callback(records, observer);
      });
      state.observers.push(this);
    }
  };
  const location = { href: 'http://localhost/', origin: 'http://localhost', pathname: '/sessions/session_a' };
  view.__listingLocation = location;
  const components = component === 'combined' ? injectedOrder : [component];
  if (instrument) {
    view.eval(`
      window.__listingWork = { visits: 0 };
      for (const name of ['map', 'filter', 'forEach', 'some', 'every', 'find', 'flatMap']) {
        const native = Array.prototype[name];
        Array.prototype[name] = function(callback, receiver) {
          return native.call(this, function(...args) {
            window.__listingWork.visits += 1;
            return callback.apply(this, args);
          }, receiver);
        };
      }
      const includes = Array.prototype.includes;
      Array.prototype.includes = function(...args) {
        window.__listingWork.visits += this.length;
        return includes.apply(this, args);
      };
    `);
  }
  components.forEach((name) => view.eval(`((location) => { ${sources[name]}\n})(window.__listingLocation)`));
  const show = (ids) => { doc.querySelector('.mlist').innerHTML = ids.map(row).join(''); };
  const navigate = (id) => {
    location.pathname = `/sessions/session_${id}`;
    view.dispatchEvent(new view.PopStateEvent('popstate'));
  };
  return { view, doc, state, storage, nativeFetch, components, show, navigate };
}

async function settled(ui) {
  await tick();
  const calls = ui.state.calls;
  await tick();
  expect(ui.state.stopped).toBe(false);
  expect(ui.state.calls).toBe(calls);
}

async function expectGroups(ui, groups) {
  ui.show(groups.map(([id]) => id));
  await settled(ui);
  if (ui.components.includes('presentation')) {
    for (const [id, total] of groups) {
      ui.navigate(id);
      expect(ui.doc.querySelector('.okw-workspace-summary').textContent)
        .toBe(`Idle · branch-${total} · ${total} sessions`);
    }
  }
  if (ui.components.includes('mobileWorkspaceSort')) {
    const select = ui.doc.querySelector('.okw-mobile-workspace-sort select');
    expect(select.options[2].disabled).toBe(false);
    expect(select.value).toBe('desktop');
  }
  expect(ui.storage.setItem).not.toHaveBeenCalled();
}

async function respond(ui, path, groups) {
  const response = Response.json(bodyOf(groups));
  ui.nativeFetch.mockResolvedValueOnce(response);
  expect(await ui.view.fetch(path)).toBe(response);
  await settled(ui);
  return response;
}

function pending(ui, path) {
  const network = Promise.withResolvers();
  ui.nativeFetch.mockReturnValueOnce(network.promise);
  const result = ui.view.fetch(path);
  const finish = async (groups) => {
    const response = Response.json(bodyOf(groups));
    const clone = vi.spyOn(response, 'clone');
    network.resolve(response);
    expect(await result).toBe(response);
    await settled(ui);
    return { response, clone };
  };
  return { result, finish, reject: network.reject };
}

async function delayedJson(ui, path) {
  const channel = Promise.withResolvers();
  const response = new Response(new ReadableStream({ start: channel.resolve }));
  const controller = await channel.promise;
  streams.add(controller);
  const clone = vi.spyOn(response, 'clone');
  ui.nativeFetch.mockResolvedValueOnce(response);
  expect(await ui.view.fetch(path)).toBe(response);
  await settled(ui);
  expect(clone).toHaveBeenCalledTimes(ui.components.length);
  return async (groups) => {
    controller.enqueue(new TextEncoder().encode(JSON.stringify(bodyOf(groups))));
    controller.close();
    streams.delete(controller);
    await settled(ui);
    return response;
  };
}

afterEach(() => {
  streams.forEach((controller) => controller.close());
  streams.clear();
  states.splice(0).forEach(({ frame, observers }) => {
    observers.forEach((observer) => observer.disconnect());
    frame.remove();
  });
});

describe.each(['presentation', 'mobileWorkspaceSort', 'combined'])('%s listing concurrency', (component) => {
  it('invalidates an older first page when refresh starts, before the new response arrives', async () => {
    const ui = install(component);
    await respond(ui, listPath, [group('a')]);
    const old = pending(ui, listPath);
    const current = pending(ui, listPath);
    const { clone } = await old.finish([group('a', 999, '/outdated/a')]);
    expect(clone).not.toHaveBeenCalled();
    await expectGroups(ui, [['a', 3]]);
    const { response } = await current.finish([group('a', 7)]);
    expect(await response.json()).toEqual(envelope([group('a', 7)]));
    await expectGroups(ui, [['a', 7]]);
    expect(ui.nativeFetch).toHaveBeenCalledTimes(3);
  });

  it('rejects an older query response even if it arrives after the current filtered response', async () => {
    const ui = install(component);
    const old = pending(ui, `${listPath}&query=older`);
    await respond(ui, `${listPath}&query=current`, [group('a', 7)]);
    const { clone } = await old.finish([]);
    expect(clone).not.toHaveBeenCalled();
    await expectGroups(ui, [['a', 7]]);
    expect(ui.nativeFetch).toHaveBeenCalledTimes(2);
  });

  it('ignores JSON from an older refresh after the current first page has been applied', async () => {
    const ui = install(component);
    const finish = await delayedJson(ui, listPath);
    await respond(ui, listPath, [group('a', 7)]);
    const response = await finish([]);
    expect(await response.json()).toEqual(envelope([]));
    await expectGroups(ui, [['a', 7]]);
    expect(ui.nativeFetch).toHaveBeenCalledTimes(2);
  });

  it('keeps every same-generation page when both continuation pages arrive before the first page', async () => {
    const ui = install(component);
    const first = pending(ui, listPath);
    const second = pending(ui, `${listPath}&page_token=second%3D%3D`);
    const third = pending(ui, `${listPath}&page_token=third%2Btoken`);
    await third.finish([group('c', 11)]);
    await second.finish([group('b', 7)]);
    await first.finish([group('a')]);
    await expectGroups(ui, [['a', 3], ['b', 7], ['c', 11]]);
    if (component !== 'presentation') {
      expect([...ui.doc.querySelectorAll('.mgroup')].map((node) => node.style.order)).toEqual(['2', '1', '0']);
    }
    expect(ui.nativeFetch).toHaveBeenCalledTimes(3);
  });

});

describe.each(['presentation', 'combined'])('%s independent presentation sources', (component) => {
  it.each(['network', 'json'])('keeps newer detail git when an old list finishes its %s later', async (phase) => {
    const ui = install(component);
    const old = phase === 'network' ? pending(ui, listPath).finish : await delayedJson(ui, listPath);
    await respond(ui, '/api/v1/sessions/session_a/fs:git_status', { branch: 'detail-branch' });
    await old([group('a')]);
    expect(ui.doc.querySelector('.okw-workspace-summary').textContent).toBe('Idle · detail-branch · 3 sessions');
    await respond(ui, listPath, [group('a', 7)]);
    expect(ui.doc.querySelector('.okw-workspace-summary').textContent).toBe('Idle · branch-7 · 7 sessions');
    expect(ui.nativeFetch).toHaveBeenCalledTimes(3);
    expect(ui.storage.setItem).not.toHaveBeenCalled();
  });

  it.each([false, true])('retains parallel ongoing and completed flat data, completed finishes first=%s', async (reverse) => {
    const ui = install(component);
    const active = pending(ui, '/api/v1/sessions?archived=false&has_prompt=true');
    const completed = pending(ui, '/api/v1/sessions?archived=true&has_prompt=true');
    const finishes = [() => active.finish({ items: group('a').sessions }),
      () => completed.finish({ items: group('b', 7).sessions })];
    if (reverse) finishes.reverse();
    for (const finish of finishes) await finish();
    ui.navigate('a');
    expect(ui.doc.querySelector('.okw-workspace-summary').textContent).toBe('Idle · branch-3');
    ui.navigate('b');
    expect(ui.doc.querySelector('.okw-workspace-summary').textContent).toBe('Idle · branch-7');
    expect(ui.nativeFetch).toHaveBeenCalledTimes(2);
    expect(ui.storage.setItem).not.toHaveBeenCalled();
  });

  it('keeps a newer list branch when an older detail response arrives last', async () => {
    const ui = install(component);
    const old = pending(ui, '/api/v1/sessions/session_a/fs:git_status');
    await respond(ui, listPath, [group('a', 7)]);
    await old.finish({ branch: 'outdated-detail' });
    expect(ui.doc.querySelector('.okw-workspace-summary').textContent).toBe('Idle · branch-7 · 7 sessions');
    expect(ui.nativeFetch).toHaveBeenCalledTimes(2);
  });

  it('identifies workspace headers by route ID instead of a duplicate display name', async () => {
    const ui = install(component);
    await respond(ui, '/api/v1/workspaces', { items: [
      { id: 'workspace_a', name: 'Same display name', root: '/fictional/a' },
      { id: 'workspace_b', name: 'Same display name', root: '/fictional/b' },
    ] });
    await respond(ui, listPath, [group('a'), group('b', 7)]);
    ui.doc.querySelector('.dir').textContent = 'Same display name';
    ui.view.__listingLocation.pathname = '/workspaces/workspace_b';
    ui.view.dispatchEvent(new ui.view.PopStateEvent('popstate'));
    await settled(ui);
    expect(ui.doc.querySelector('.okw-workspace-summary').textContent).toBe('Idle · 7 sessions');
    expect(ui.nativeFetch).toHaveBeenCalledTimes(2);
    expect(ui.storage.setItem).not.toHaveBeenCalled();
  });

  it('keeps workspace-scoped lists independent of each other', async () => {
    const ui = install(component);
    const first = pending(ui, '/api/v1/sessions?workspace_id=workspace_a&archived=false');
    const second = pending(ui, '/api/v1/sessions?workspace_id=workspace_b&archived=false');
    await second.finish({ items: group('b', 7).sessions });
    await first.finish({ items: group('a').sessions });
    ui.navigate('a');
    expect(ui.doc.querySelector('.okw-workspace-summary').textContent).toBe('Idle · branch-3');
    expect(ui.nativeFetch).toHaveBeenCalledTimes(2);
  });
});

describe.each(['presentation', 'mobileWorkspaceSort', 'combined'])('%s continuation freshness', (component) => {
  it.each(['archived=true', 'workspace_id=workspace_b', 'fields=id,archived', 'hosts=include'])(
    'preserves pending grouped pages in an independent request domain: %s', async (projection) => {
      const ui = install(component);
      const first = pending(ui, listPath);
      const second = pending(ui, `${listPath}&page_token=second`);
      const independent = new URL(listPath, 'http://localhost');
      const [key, value] = projection.split('=');
      independent.searchParams.set(key, value);
      await respond(ui, independent.pathname + independent.search, []);
      await second.finish([group('b', 7)]);
      await first.finish([group('a')]);
      await expectGroups(ui, [['a', 3], ['b', 7]]);
      expect(ui.nativeFetch).toHaveBeenCalledTimes(3);
    },
  );

  it('ignores an orphan continuation without preventing a later first page', async () => {
    const ui = install(component);
    const orphan = pending(ui, `${listPath}&page_token=orphan`);
    const { clone } = await orphan.finish([group('a', 999, '/outdated/a')]);
    expect(clone).not.toHaveBeenCalled();
    await respond(ui, listPath, [group('a', 7)]);
    await expectGroups(ui, [['a', 7]]);
    expect(ui.nativeFetch).toHaveBeenCalledTimes(2);
  });

  it.each(['page_token=late%3D%3D', 'page=2', 'before_id=late', 'after_id=late', 'cursor=late'])(
    'does not let an old filter continuation dispatched late replace the active generation: %s', async (cursor) => {
      const ui = install(component);
      await respond(ui, `${listPath}&query=older`, [group('a')]);
      const current = pending(ui, `${listPath}&query=current`);
      const late = pending(ui, `${listPath}&query=older&${cursor}`);
      const { clone } = await late.finish([group('a', 999, '/outdated/a')]);
      expect(clone).not.toHaveBeenCalled();
      await current.finish([group('a', 7)]);
      await respond(ui, `${listPath}&query=current&page_token=valid`, [group('b', 11)]);
      await expectGroups(ui, [['a', 7], ['b', 11]]);
      expect(ui.nativeFetch).toHaveBeenCalledTimes(4);
    },
  );

});

describe.each(['presentation', 'mobileWorkspaceSort', 'combined'])('%s continuation refreshes', (component) => {
  it.each(['page_token=next%3D%3D', 'page=2', 'before_id=next', 'after_id=next', 'cursor=next'])(
    'rejects an obsolete continuation response with %s after a new first page starts', async (cursor) => {
      const ui = install(component);
      await respond(ui, listPath, [group('a')]);
      const oldPage = pending(ui, `${listPath}&${cursor}`);
      const current = pending(ui, listPath);
      const { clone } = await oldPage.finish([group('a', 999, '/outdated/a')]);
      expect(clone).not.toHaveBeenCalled();
      await current.finish([group('a', 7)]);
      await expectGroups(ui, [['a', 7]]);
      expect(ui.nativeFetch).toHaveBeenCalledTimes(3);
    },
  );

  it('ignores continuation JSON that finishes after refresh and does not contaminate the new generation', async () => {
    const ui = install(component);
    await respond(ui, listPath, [group('a')]);
    const finish = await delayedJson(ui, `${listPath}&page_token=old`);
    await respond(ui, listPath, [group('a', 7)]);
    await finish([group('a', 999, '/outdated/a')]);
    await respond(ui, `${listPath}&page_token=new`, [group('b', 11)]);
    await expectGroups(ui, [['a', 7], ['b', 11]]);
    expect(ui.nativeFetch).toHaveBeenCalledTimes(4);
  });

  it('versions retries per canonical page without discarding a different concurrent page', async () => {
    const ui = install(component);
    await respond(ui, listPath, [group('a')]);
    const finish = await delayedJson(ui, `${listPath}&page_token=second%3D%3D`);
    const url = new URL(`${listPath}&page_token=second%3D%3D`, 'http://localhost');
    const reordered = `${url.pathname}?${[...url.searchParams].reverse()
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`;
    const second = pending(ui, reordered);
    const third = pending(ui, `${listPath}&page_token=third`);
    await second.finish([group('b', 7)]);
    await third.finish([group('c', 11)]);
    await finish([group('b', 999, '/outdated/b')]);
    await expectGroups(ui, [['a', 3], ['b', 7], ['c', 11]]);
    expect(ui.nativeFetch).toHaveBeenCalledTimes(4);
  });

  it('retains pages when a continuation query differs only in parameter ordering', async () => {
    const ui = install(component);
    const first = pending(ui, listPath);
    const second = pending(ui, '/api/v1/sessions?page_token=next&has_prompt=true&archived=false' +
      '&group_page_size=5&view=by_workspace');
    await second.finish([group('b', 7)]);
    await first.finish([group('a')]);
    await expectGroups(ui, [['a', 3], ['b', 7]]);
    expect(ui.nativeFetch).toHaveBeenCalledTimes(2);
  });

  it('does not revive an obsolete generation when the latest refresh fails', async () => {
    const ui = install(component);
    await respond(ui, listPath, [group('a')]);
    const old = pending(ui, `${listPath}&page_token=old`);
    const current = pending(ui, listPath);
    const error = new TypeError('Fictional network failure');
    const rejection = expect(current.result).rejects.toBe(error);
    current.reject(error);
    await rejection;
    const { clone } = await old.finish([group('a', 999, '/outdated/a')]);
    expect(clone).not.toHaveBeenCalled();
    await expectGroups(ui, [['a', 3]]);
    expect(ui.nativeFetch).toHaveBeenCalledTimes(3);
  });
});


describe('loaded mobile sorting work', () => {
  it('loads the two observers in official injection order before boot', () => {
    expect(injectedOrder).toEqual(['mobileWorkspaceSort', 'presentation']);
    expect(injectedHtml.indexOf('/presentation.js')).toBeLessThan(injectedHtml.indexOf('type="module"'));
  });

  it('keeps 600 half-remote groups linear and rejects ambiguous identities without title matching', async () => {
    const ui = install('combined', { instrument: true });
    const groups = Array.from({ length: 600 }, (_, index) => {
      const item = group(String(index));
      return index >= 300 ? { ...item, host_id: 'fictional-remote' } : item;
    });
    await respond(ui, listPath, groups);
    const ids = groups.map((_, index) => String(index));
    ui.show(ids);
    await settled(ui);
    const nodes = [...ui.doc.querySelectorAll('.mgroup')];
    nodes.forEach((node) => { node.querySelector('.mgh-name').textContent = 'Same display name'; });
    await settled(ui);
    ui.view.__listingWork.visits = 0;
    ui.view.dispatchEvent(new ui.view.StorageEvent('storage', { key: 'kimi-web.workspace-order' }));
    expect(ui.view.__listingWork.visits).toBeLessThan(600 * 40);
    const select = ui.doc.querySelector('.okw-mobile-workspace-sort select');
    expect(select.options[2].disabled).toBe(true);
    expect(nodes.map((node) => node.style.order)).toEqual(Array(600).fill(''));
    ui.show(ids.slice(0, 300));
    await settled(ui);
    expect(select.options[2].disabled).toBe(false);
    ui.doc.querySelector('.mlist').insertAdjacentHTML('beforeend', row('0'));
    await settled(ui);
    expect(select.options[2].disabled).toBe(true);
    expect(ui.nativeFetch).toHaveBeenCalledTimes(1);
    expect(ui.storage.setItem).not.toHaveBeenCalled();
  });
});
