/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
const source = readFileSync(resolve('packages/launcher/src/mobile/navigationFolder.js'), 'utf8');
const frames = [];
const tick = () => new Promise((done) => setTimeout(done, 0));
const entry = (name, path) => ({ name, path, is_dir: true });
const folders = {
  '/home/fixture': { path: '/home/fixture', parent: '/home', entries: [entry('Project', '/home/fixture/Project')] },
  '/home/fixture/Project': { path: '/home/fixture/Project', parent: '/home/fixture', entries: [] },
  '/home': { path: '/home', parent: '/', entries: [entry('fixture', '/home/fixture')] } };
function install() {
  const frame = document.createElement('iframe'); document.body.append(frame); frames.push(frame);
  const view = frame.contentWindow; const doc = view.document;
  doc.body.innerHTML = '<section><input value="Original draft"></section>';
  let language = 'en'; const locales = [];
  view.__okwLocale = { text: (zh, en) => language === 'zh' ? zh : en, observe: (fn) => locales.push(fn) };
  view.__okwNavigationBrowseFolder = vi.fn(async (path) => folders[path ?? '/home/fixture']);
  view.eval(source);
  const selected = vi.fn(); const api = view.__okwNavigationCreateFolderPicker(doc.querySelector('section'), selected);
  const root = doc.querySelector('.okw-folder-browser');
  const button = (name) => root.querySelector('.okw-folder-' + name);
  const locale = (value) => { language = value; locales.forEach((fn) => fn()); };
  return { view, doc, api, root, button, selected, locale, browse: view.__okwNavigationBrowseFolder };
}
afterEach(() => frames.splice(0).forEach((frame) => frame.remove()));
describe('server folder picker', () => {
  it('loads only when opened, browses child/parent/home and selects without writing anything', async () => {
    const ui = install(); expect(ui.browse).not.toHaveBeenCalled(); expect(ui.root.hidden).toBe(true);
    ui.api.open(); expect(ui.button('choose').disabled).toBe(true); await tick();
    expect(ui.browse.mock.calls[0][0]).toBeUndefined();
    expect(ui.root.querySelector('.okw-folder-path').textContent).toBe('/home/fixture');
    ui.button('entry').click(); await tick();
    expect(ui.root.querySelector('.okw-folder-path').textContent).toBe('/home/fixture/Project');
    expect(ui.root.querySelector('[role="status"]').textContent).toContain('no subfolders');
    ui.button('up').click(); await tick();
    expect(ui.root.querySelector('.okw-folder-path').textContent).toBe('/home/fixture');
    ui.button('home').click(); await tick(); ui.button('choose').click();
    expect(ui.selected).toHaveBeenCalledExactlyOnceWith('/home/fixture'); expect(ui.root.hidden).toBe(true);
    expect(ui.doc.querySelector('input').value).toBe('Original draft');
  });
  it('cancels loading and ignores late data after reopening', async () => {
    const ui = install(); let complete;
    ui.browse.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    ui.api.open('/pending'); const signal = ui.browse.mock.calls[0][1]; ui.button('cancel').click();
    expect(signal.aborted).toBe(true); expect(ui.selected).not.toHaveBeenCalled(); expect(ui.root.hidden).toBe(true);
    ui.api.open('/home/fixture/Project'); await tick(); complete(folders['/home']); await tick();
    expect(ui.root.querySelector('.okw-folder-path').textContent).toBe('/home/fixture/Project');
    expect(ui.browse).toHaveBeenCalledTimes(2); ui.api.close();
    expect(ui.root.querySelectorAll('li')).toHaveLength(0);
    expect(ui.root.querySelector('.okw-folder-path').textContent).toBe('');
  });
  it('reports errors, keeps selection disabled and retries the same requested directory', async () => {
    const ui = install(); ui.browse.mockRejectedValueOnce(new Error('Fictional permission error'));
    ui.api.open('/home/fixture'); await tick();
    expect(ui.root.querySelector('[role="status"]').textContent).toBe('Fictional permission error');
    expect(ui.root.querySelector('[role="status"]').dataset.error).toBe('true');
    expect(ui.button('choose').disabled).toBe(true); expect(ui.button('retry').hidden).toBe(false);
    ui.button('retry').click(); await tick();
    expect(ui.browse.mock.calls.map(([path]) => path)).toEqual(['/home/fixture', '/home/fixture']);
    expect(ui.button('choose').disabled).toBe(false); expect(ui.button('retry').hidden).toBe(true);
  });
  it('does not choose a stale folder after a failed navigation', async () => {
    const ui = install(); ui.api.open('/home/fixture'); await tick();
    ui.browse.mockRejectedValueOnce(new Error('Directory unavailable')); ui.button('entry').click(); await tick();
    expect(ui.button('choose').disabled).toBe(true); ui.button('choose').click();
    expect(ui.selected).not.toHaveBeenCalled();
    ui.button('home').click(); await tick(); expect(ui.button('choose').disabled).toBe(false);
  });
  it('uses plain text for folder names, handles roots and retranslates visible controls', async () => {
    const ui = install(); ui.browse.mockResolvedValue({ path: '/', parent: null,
      entries: [entry('<img src=x onerror=alert(1)>', '/literal')] });
    ui.api.open('/'); await tick(); expect(ui.button('up').disabled).toBe(true);
    expect(ui.button('entry').textContent).toBe('<img src=x onerror=alert(1)>'); expect(ui.root.querySelector('img')).toBeNull();
    ui.locale('zh'); expect(ui.button('choose').textContent).toBe('选择此文件夹');
    expect(ui.root.querySelector('h3').textContent).toBe('浏览运行端文件夹');
    expect(ui.browse).toHaveBeenCalledOnce();
    ui.api.close(); ui.locale('en'); expect(ui.root.hidden).toBe(true);
    ui.api.open('/'); await tick(); expect(ui.button('choose').textContent).toBe('Choose this folder');
  });
});
