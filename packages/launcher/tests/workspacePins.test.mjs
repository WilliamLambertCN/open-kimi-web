/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve('packages/launcher/src/mobile/workspacePins.js'), 'utf8');
const styles = readFileSync(resolve('packages/launcher/src/mobile/workspacePins.css'), 'utf8');
const STORAGE_KEY = 'open-kimi-web.pinned-workspaces';
const frames = [];

const group = (id, name = id) => `
  <div class="ws-drop-target" data-ws-id="${id}">
    <div class="group">
      <div class="gh">
        <span class="gh-name">${name}</span>
        <div class="gh-actions"><button class="gh-more" type="button" aria-label="选项"></button></div>
      </div>
      <div class="group-sessions"><div data-session-id="session-${id}">${id} session</div></div>
    </div>
  </div>`;

const directory = (name, root) => `
  <div class="ws-dir">
    <div class="ws-dir-row">
      <span class="ws-dir-name">${name}</span>
      <span class="ws-dir-act"><button class="gh-more" type="button" aria-label="选项"></button></span>
    </div>
    <div class="ws-dir-sub">${root}</div>
  </div>`;

const menuHtml = `
  <div class="workspace-menu" role="menu">
    <button class="ui-menu-item ui-menu-item--md" type="button">复制路径</button>
    <button class="ui-menu-item ui-menu-item--md workspace-rename-item" type="button">重命名</button>
    <button class="ui-menu-item ui-menu-item--md danger" type="button">移除工作区</button>
  </div>`;

function install({ body, storedPins, workspaces = [] } = {}) {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const view = frame.contentWindow;
  view.document.documentElement.lang = 'zh-CN';
  view.document.body.innerHTML = body ?? `<div class="sessions">${group('workspace-a')}${group('workspace-b')}${group('workspace-c')}</div>`;
  const style = view.document.createElement('style');
  style.textContent = styles;
  view.document.head.append(style);
  view.localStorage.clear();
  if (storedPins !== undefined) view.localStorage.setItem(STORAGE_KEY, JSON.stringify(storedPins));
  const mutationCallbacks = [];
  view.MutationObserver = class MutationObserver {
    constructor(callback) { mutationCallbacks.push(callback); }
    observe() {}
  };
  view.fetch = vi.fn(async () => ({
    ok: true,
    clone: () => ({ json: async () => ({ data: { items: workspaces } }) }),
  }));
  view.eval(`(() => { ${source}\n})()`);
  return {
    mutate: () => mutationCallbacks.forEach((callback) => callback()),
    view,
  };
}

function workspaceOrder(view, selector = '.ws-drop-target') {
  return Array.from(view.document.querySelectorAll(selector)).map((node) =>
    node.dataset.wsId ?? node.dataset.okwWorkspaceId);
}

function openMenu(view, mutate, workspaceSelector) {
  view.document.querySelector(`${workspaceSelector} .gh-more`).click();
  view.document.body.insertAdjacentHTML('beforeend', menuHtml);
  mutate();
  return view.document.querySelector('.workspace-menu');
}

afterEach(() => {
  frames.splice(0).forEach((frame) => frame.remove());
});

describe('workspace pins', () => {
  it('pins in user order without moving sessions out of their workspace container', () => {
    const { mutate, view } = install();
    let menu = openMenu(view, mutate, '[data-ws-id="workspace-b"]');
    expect(menu.querySelector('[data-okw-workspace-pin-action]').textContent).toBe('置顶工作区');
    menu.querySelector('[data-okw-workspace-pin-action]').click();

    expect(workspaceOrder(view)).toEqual(['workspace-b', 'workspace-a', 'workspace-c']);
    expect(view.document.querySelector('[data-ws-id="workspace-b"] [data-session-id="session-workspace-b"]')).not.toBeNull();
    expect(JSON.parse(view.localStorage.getItem(STORAGE_KEY))).toEqual(['workspace-b']);
    expect(view.document.querySelectorAll('.okw-workspace-pin-mark')).toHaveLength(1);

    menu.remove();
    menu = openMenu(view, mutate, '[data-ws-id="workspace-a"]');
    menu.querySelector('[data-okw-workspace-pin-action]').click();
    expect(workspaceOrder(view)).toEqual(['workspace-b', 'workspace-a', 'workspace-c']);
    expect(JSON.parse(view.localStorage.getItem(STORAGE_KEY))).toEqual(['workspace-b', 'workspace-a']);
  });

  it('offers cancel pinning and removes only that workspace from storage', () => {
    const { mutate, view } = install({ storedPins: ['workspace-b', 'workspace-a'] });
    const menu = openMenu(view, mutate, '[data-ws-id="workspace-b"]');
    const action = menu.querySelector('[data-okw-workspace-pin-action]');

    expect(action.textContent).toBe('取消置顶');
    action.click();

    expect(JSON.parse(view.localStorage.getItem(STORAGE_KEY))).toEqual(['workspace-a']);
    expect(view.document.querySelector('[data-ws-id="workspace-b"] .okw-workspace-pin-mark')).toBeNull();
    expect(workspaceOrder(view)[0]).toBe('workspace-a');
  });

  it('restores pins on refresh and prunes IDs missing from the workspace response', async () => {
    const workspaces = [
      { id: 'workspace-a', name: 'Alpha', root: 'C:\\projects\\alpha' },
      { id: 'workspace-b', name: 'Beta', root: 'C:\\projects\\beta' },
    ];
    const { view } = install({
      body: `<div class="sessions">${group('workspace-a')}${group('workspace-b')}</div>`,
      storedPins: ['workspace-missing', 'workspace-b'],
      workspaces,
    });

    expect(workspaceOrder(view)).toEqual(['workspace-b', 'workspace-a']);
    await view.fetch('/api/v1/workspaces');
    await new Promise((resolveWait) => setTimeout(resolveWait, 0));

    expect(JSON.parse(view.localStorage.getItem(STORAGE_KEY))).toEqual(['workspace-b']);
    expect(workspaceOrder(view)).toEqual(['workspace-b', 'workspace-a']);
  });

  it('places a dynamically added pinned workspace before unpinned workspaces', () => {
    const { mutate, view } = install({
      body: `<div class="sessions">${group('workspace-a')}${group('workspace-b')}</div>`,
      storedPins: ['workspace-c'],
    });
    view.document.querySelector('.sessions').insertAdjacentHTML('beforeend', group('workspace-c'));
    mutate();

    expect(workspaceOrder(view)).toEqual(['workspace-c', 'workspace-a', 'workspace-b']);
    expect(view.document.querySelector('[data-ws-id="workspace-c"] .okw-workspace-pin-mark')).not.toBeNull();
  });

  it('distinguishes same-name workspace rows by ID while never storing their paths', async () => {
    const firstRoot = 'C:\\team-one\\shared';
    const secondRoot = 'D:\\team-two\\shared';
    const { mutate, view } = install({
      body: `<div class="sessions">${directory('shared', firstRoot)}${directory('shared', secondRoot)}</div>`,
      workspaces: [
        { id: 'workspace-one', name: 'shared', root: firstRoot },
        { id: 'workspace-two', name: 'shared', root: secondRoot },
      ],
    });
    await view.fetch('/api/v1/workspaces');
    await new Promise((resolveWait) => setTimeout(resolveWait, 0));

    expect(workspaceOrder(view, '.ws-dir')).toEqual(['workspace-one', 'workspace-two']);
    const menu = openMenu(view, mutate, '[data-okw-workspace-id="workspace-two"]');
    menu.querySelector('[data-okw-workspace-pin-action]').click();

    const stored = view.localStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(stored)).toEqual(['workspace-two']);
    expect(stored).not.toContain(firstRoot);
    expect(stored).not.toContain(secondRoot);
    expect(workspaceOrder(view, '.ws-dir')).toEqual(['workspace-two', 'workspace-one']);
  });
});
