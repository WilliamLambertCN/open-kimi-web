/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { deferred } from './testkit/mobileSubagentModel.mjs';
import { cleanup, install, requestLog, switchLocale } from './testkit/subagentPool.mjs';

afterEach(cleanup);
const desktop = { mobile: false };
const openDesktop = (ui) => ui.open(ui.doc.querySelector('.ui-dialog .okw-pool-trigger'));
const panels = (ui) => [...ui.doc.querySelectorAll('.ui-dialog .panel')];
const errorEnvelope = () => new Response(JSON.stringify({ code: 1, msg: 'boom', data: {}, request_id: 'fixture' }));
const saving = { defaultModel: 'fixture/fast', models: { 'fixture/fast': 'A' } };
const gatePosts = (ui, gate, onPost) => {
  const original = ui.nativeFetch.getMockImplementation();
  ui.nativeFetch.mockImplementation((path, options) => (options?.method === 'POST'
    ? gate.promise.then(() => (onPost ? onPost() : original(path, options))) : original(path, options)));
};

describe('subagent pool real settings layout', () => {
  it('mounts inside the third Agent panel and not in General or Account', async () => {
    const ui = await install({ ...desktop, section: { defaultModel: 'fixture/fast', models: { 'fixture/fast': 'A' } } });
    const tabs = [...ui.doc.querySelectorAll('.settings-tabs [role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(['General', 'Account', 'Agent & Sessions']);
    const [general, account, agent] = panels(ui);
    const entry = ui.entries()[0];
    expect(entry.closest('.panel')).toBe(agent);
    expect(entry.closest('.sec').querySelector('.sec-title').textContent).toBe('Subagents');
    expect(general.querySelector('.okw-pool-entry')).toBeNull();
    expect(account.querySelector('.okw-pool-entry')).toBeNull();
    expect(await openDesktop(ui)).not.toBeNull();
  });
  it('never mounts into a visible General panel because it carries no Subagents section', async () => {
    const ui = await install({ ...desktop, desktopSection: false });
    const [general] = panels(ui);
    general.style.display = '';
    await ui.settled();
    expect(ui.entries()).toHaveLength(0);
    expect(ui.posts).toEqual([]);
  });
  it('drops and remounts when the Subagents panel hides and shows again through style display', async () => {
    const ui = await install({ ...desktop, section: { defaultModel: 'fixture/fast', models: { 'fixture/fast': 'A' } } });
    const [general, account, agent] = panels(ui);
    const before = ui.entries()[0];
    agent.style.display = 'none';
    await ui.settled();
    expect(ui.entries()).toHaveLength(0);
    expect(before.isConnected).toBe(false);
    agent.style.display = '';
    await ui.settled();
    const after = ui.entries()[0];
    expect(after).not.toBe(before);
    expect(after.closest('.panel')).toBe(agent);
    expect(general.style.display).toBe('none');
    expect(account.style.display).toBe('none');
  });
  it('keeps the same mount when the official tab and section switch to Chinese labels', async () => {
    const ui = await install({ ...desktop, section: { defaultModel: 'fixture/fast', models: { 'fixture/fast': 'A' } } });
    const mounted = ui.entries()[0];
    ui.doc.querySelectorAll('.settings-tabs [role="tab"]')[2].textContent = '智能体与会话';
    mounted.closest('.sec').querySelector('.sec-title').textContent = '子智能体';
    await ui.settled();
    expect(ui.entries()).toEqual([mounted]);
    expect(mounted.closest('.panel')).toBe(panels(ui)[2]);
    expect(await openDesktop(ui)).not.toBeNull();
  });
});

describe('subagent pool open failure recovery', () => {
  const dialogProto = (ui) => ui.doc.createElement('dialog').constructor.prototype;
  const mobileOpen = async (ui) => {
    ui.doc.querySelector('.sheet-body .okw-pool-trigger').click();
    await ui.settled();
    return ui.dialog();
  };

  it('reports an entry error and stays retryable when the native modal cannot open', async () => {
    const ui = await install({ desktop: false, section: saving });
    const proto = dialogProto(ui);
    const healthy = proto.showModal;
    proto.showModal = () => { throw new Error('fixture modal blocked'); };
    expect(await mobileOpen(ui)).toBeNull();
    expect(ui.entryError()?.hidden).toBe(false);
    expect(ui.entryError().textContent).toContain('could not open');
    delete proto.showModal;
    expect(await mobileOpen(ui)).toBeNull();
    expect(ui.entryError().hidden).toBe(false);
    proto.showModal = healthy;
    expect((await mobileOpen(ui))?.hasAttribute('open')).toBe(true);
    expect(ui.entryError().hidden).toBe(true);
    expect(ui.posts).toEqual([]);
  });

  it('releases the editor when something else closes the native dialog', async () => {
    const ui = await install({ ...desktop, section: saving });
    const opened = await openDesktop(ui);
    opened.close();
    await ui.settled();
    expect(ui.dialog()).toBeNull();
    expect(ui.entryError().hidden).toBe(true);
    expect((await openDesktop(ui))?.hasAttribute('open')).toBe(true);
    expect(ui.doc.querySelectorAll('.okw-pool-dialog')).toHaveLength(1);
  });
});

describe('subagent pool saving lifecycle', () => {
  const saveWithRemovedRoot = async (onPost) => {
    const ui = await install({ ...desktop, section: saving });
    await openDesktop(ui);
    ui.write('fixture/fast', 'server note');
    const gate = deferred();
    gatePosts(ui, gate, onPost);
    ui.click('save');
    expect(ui.status()).toContain('Saving');
    ui.doc.querySelector('.ui-dialog').remove();
    await ui.settled();
    expect(ui.dialog().hasAttribute('open')).toBe(true);
    expect(ui.posts).toEqual([]);
    gate.resolve();
    await ui.settled();
    expect(ui.dialog()).toBeNull();
    return ui;
  };
  it('finishes the in-flight write after the settings root vanishes, then closes the dialog', async () => {
    const ui = await saveWithRemovedRoot();
    expect(ui.posts).toHaveLength(1);
    expect(ui.getConfig().secondary_model.models['fixture/fast']).toBe('server note');
  });
  it('leaves no orphan dialog when the in-flight write fails after the root vanishes', async () => {
    const ui = await saveWithRemovedRoot(errorEnvelope);
    expect(ui.posts).toEqual([]);
  });
});

describe('subagent pool locale and retry edges', () => {
  it('keeps chooser query, provider filter, focus and draft across a locale switch without refetching', async () => {
    const ui = await install({ ...desktop, section: { defaultModel: 'fixture/always', models: { 'fixture/always': 'keep' } } });
    await openDesktop(ui);
    ui.write('fixture/always', 'draft note');
    ui.click('add');
    ui.typeSearch('fixture');
    const chip = ui.chips().find((node) => node.textContent === 'Provider-B');
    chip.click();
    await ui.settled();
    expect(ui.pickerRows().map((row) => row.dataset.model)).toEqual(['fixture/under_score']);
    ui.searchInput().focus();
    const calls = requestLog(ui).length;
    await switchLocale(ui, 'zh');
    expect(ui.searchInput().value).toBe('fixture');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(ui.pickerRows().map((row) => row.dataset.model)).toEqual(['fixture/under_score']);
    expect(ui.doc.activeElement).toBe(ui.searchInput());
    expect(requestLog(ui)).toHaveLength(calls);
    expect(ui.description('fixture/always').value).toBe('draft note');
  });
  it('keeps the draft after a failed read-back and retries with a read-only confirmation POST-free', async () => {
    const ui = await install({ ...desktop, section: saving });
    await openDesktop(ui);
    const original = ui.nativeFetch.getMockImplementation();
    let posted = false;
    let failed = false;
    ui.nativeFetch.mockImplementation((path, options) => {
      if (options?.method === 'POST') posted = true;
      else if (posted && !failed && !options?.method && path === '/api/v1/config') {
        failed = true;
        return Promise.resolve(errorEnvelope());
      }
      return original(path, options);
    });
    ui.write('fixture/fast', 'server note');
    ui.click('save');
    await ui.settled();
    expect(ui.posts).toHaveLength(1);
    expect(ui.status()).toContain('Request failed');
    expect(ui.button('retry').hidden).toBe(false);
    expect(ui.description('fixture/fast').value).toBe('server note');
    ui.click('retry');
    await ui.settled();
    expect(ui.posts).toHaveLength(1);
    expect(ui.status()).toContain('Saved and verified');
    expect(ui.button('save').disabled).toBe(true);
  });
  it('cancels a loading open without ever posting', async () => {
    const ui = await install({ ...desktop, section: saving });
    const gate = deferred();
    const original = ui.nativeFetch.getMockImplementation();
    ui.nativeFetch.mockImplementation((path, options) => (path === '/api/v1/config' && !options?.method
      ? gate.promise.then(() => original(path, options)) : original(path, options)));
    await ui.open(ui.doc.querySelector('.ui-dialog .okw-pool-trigger'));
    expect(ui.status()).toContain('Loading');
    expect(ui.button('cancel').disabled).toBe(false);
    ui.click('cancel');
    expect(ui.dialog()).toBeNull();
    gate.resolve();
    await ui.settled();
    expect(requestLog(ui).filter((line) => line.startsWith('POST'))).toEqual([]);
  });
});
