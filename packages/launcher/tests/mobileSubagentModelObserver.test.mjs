/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, deferred, fixtureConfig, install, markup, response, tick } from './testkit/mobileSubagentModel.mjs';

afterEach(cleanup);
const open = async (ui) => { ui.query('trigger').click(); await ui.settled(); };
const switchLocale = async (ui, locale) => {
  ui.storage.setItem('kimi-locale', locale);
  ui.doc.querySelector('.app').append(ui.doc.createTextNode(locale === 'zh' ? '官方中文界面' : 'Official English UI'));
  await ui.settled();
};
const languageConfig = () => ({
  ...fixtureConfig({ defaultModel: '中文别名二', defaultEffort: 'medium' }),
  models: {
    '中文别名': { displayName: '用户中文名称', model: '中文模型ID', capabilities: ['thinking'],
      supportEfforts: ['low', 'medium', 'high'] },
    '中文别名二': { provider: '中文供应商', displayName: '用户中文名称二', capabilities: ['thinking'],
      supportEfforts: ['low', 'medium', 'high'] },
  },
});
const localeSnapshot = (ui) => ({
  title: ui.query('trigger').querySelector('.srow-label').textContent,
  description: ui.query('model-details').querySelector('.okw-subagent-note').textContent,
  effortLabel: ui.query('effort-label').textContent,
  follow: ui.query('overlay').querySelector('.model-row[data-model=""] .model-name')?.textContent,
  efforts: [...ui.query('effort').children].map((node) => node.textContent),
  chips: [...ui.query('overlay').querySelectorAll('.chip')].map((node) => node.textContent),
  details: ui.query('model-details').querySelector('p').textContent,
  summary: ui.query('summary').textContent,
  hint: ui.query('controls').querySelector('.okw-subagent-note').textContent,
  status: ui.query('status').textContent,
  buttons: ['cancel', 'retry', 'save'].map((name) => ui.query(name).textContent),
  aria: ui.query('editor').getAttribute('aria-label'),
  search: ui.query('search').getAttribute('placeholder'),
});

describe('mobile subagent real DOM observer', () => {
  it('converges after mounting/loading/draft/filter changes and remounts disconnected entry', async () => {
    const ui = await install();
    await open(ui);
    ui.select('fixture/fast');
    await ui.settled();
    ui.search('Fast');
    await ui.settled();
    expect(ui.doc.querySelectorAll('.okw-subagent-section')).toHaveLength(1);
    expect(ui.doc.querySelectorAll('.okw-subagent-overlay')).toHaveLength(1);
    ui.query('section').remove();
    await ui.settled();
    expect(ui.doc.querySelectorAll('.okw-subagent-section')).toHaveLength(1);
    expect(ui.query('overlay')).toBeNull();
    ui.root.remove();
    ui.doc.body.insertAdjacentHTML('beforeend', markup());
    await ui.settled();
    expect(ui.doc.querySelectorAll('.okw-subagent-section')).toHaveLength(1);
    const root = ui.doc.querySelector('.sheet-root');
    root.querySelector('.sheet-panel').setAttribute('aria-label', 'Providers');
    root.querySelector('.sheet-title').textContent = 'Providers';
    root.querySelector('.sheet-body').innerHTML = '<div class="pf">Provider form</div>';
    await ui.settled();
    expect(ui.query('section')).toBeNull();
  });
  it('does not scan document or settings during main and side-chat text streams, including an open picker', async () => {
    const ui = await install();
    await open(ui);
    const globalQueries = vi.spyOn(ui.doc, 'querySelectorAll');
    const sheetQueries = vi.spyOn(ui.root, 'querySelector');
    const chat = ui.doc.querySelector('.chat-scroll');
    const side = ui.doc.querySelector('.sc-body');
    const chatQueries = vi.spyOn(chat, 'querySelectorAll');
    for (let index = 0; index < 10; index += 1) {
      chat.insertAdjacentHTML('beforeend', '<div class="a-msg">Fixture text</div>');
      chat.lastElementChild.insertAdjacentHTML('beforeend', '<span><b>Stream delta</b></span>');
      chat.insertAdjacentHTML('beforeend', '<span>Other chat delta</span>');
      side.textContent = `Fixture ${index}`;
      await tick();
    }
    expect(globalQueries).not.toHaveBeenCalled();
    expect(sheetQueries).not.toHaveBeenCalled();
    expect(chatQueries).not.toHaveBeenCalled();
    await ui.settled();
  });
  it('handles nested mounting while leaving providers-only sheets untouched', async () => {
    const ui = await install();
    ui.root.remove();
    const wrapper = ui.doc.createElement('div');
    wrapper.innerHTML = markup('Providers');
    ui.doc.body.append(wrapper);
    await ui.settled();
    expect(ui.query('section')).toBeNull();
    wrapper.innerHTML = markup('会话设置');
    await ui.settled();
    expect(ui.doc.querySelectorAll('.okw-subagent-section')).toHaveLength(1);
  });
  it('converges on lower-sheet removal during a pending request and rejects its late result', async () => {
    const ui = await install();
    const slow = deferred();
    ui.nativeFetch.mockReturnValueOnce(slow.promise);
    ui.query('trigger').click();
    ui.root.remove();
    await ui.settled();
    expect(ui.query('overlay')).toBeNull();
    expect(ui.doc.querySelector('.app').hasAttribute('aria-hidden')).toBe(false);
    slow.resolve(response(fixtureConfig({ defaultModel: 'fixture/fast' })));
    await ui.settled();
    expect(ui.query('overlay')).toBeNull();
  });
});

describe('mobile subagent collision locale and observer', () => {
  it('keeps collision cues stable across filtering and locale without losing nodes or requests', async () => {
    const aliases = ['A', 'B'].map((part) => `${'共同长前缀'.repeat(20)}${part}`);
    const config = { ...fixtureConfig(undefined), models: Object.fromEntries(aliases.map((id) =>
      [id, { displayName: '同名', provider: '' }])) };
    const ui = await install({ config, locale: 'zh' });
    await open(ui);
    const rows = ui.rows().filter((row) => row.dataset.model);
    expect(rows.map((row) => row.querySelector('.model-meta').textContent)).toEqual(['…A · 未提供供应商', '…B · 未提供供应商']);
    ui.search(aliases[1]);
    const requests = ui.nativeFetch.mock.calls.length;
    const search = ui.query('search');
    search.focus();
    await switchLocale(ui, 'en');
    expect(ui.rows()).toHaveLength(1);
    expect(ui.rows()[0]).toBe(rows[1]);
    expect(ui.rows()[0].querySelector('.model-meta').textContent).toBe('…B · Provider unavailable');
    expect(search.value).toBe(aliases[1]);
    expect(ui.doc.activeElement).toBe(search);
    expect(ui.nativeFetch).toHaveBeenCalledTimes(requests);
    ui.search('');
    await ui.settled();
    expect(ui.rows().filter((row) => row.dataset.model)).toEqual(rows);
    expect(ui.posts).toEqual([]);
  });
});

describe('mobile subagent shared same-tab locale', () => {
  it('retranslates open failed draft without losing search/provider/keyboard/focus nodes or making requests', async () => {
    const ui = await install({ config: languageConfig(), locale: 'zh' });
    const storageEvent = vi.fn();
    ui.view.addEventListener('storage', storageEvent);
    await open(ui);
    ui.select('中文别名');
    ui.effort('high');
    ui.nativeFetch.mockRejectedValueOnce(new Error('fictional error'));
    ui.query('save').click();
    await ui.settled();
    expect(ui.query('status').textContent).toBe('请求失败，请重试。');
    const unknownChip = [...ui.query('overlay').querySelectorAll('.chip')].find((chip) => chip.textContent === '未提供供应商');
    unknownChip.click();
    ui.search(' 中文别名 ');
    const search = ui.query('search');
    search.focus();
    const row = ui.rows()[0];
    const effort = ui.query('effort').querySelector('.is-on');
    const body = ui.query('overlay').querySelector('.sheet-body');
    body.scrollTop = 23;
    ui.body.scrollTop = 137;
    const chinese = localeSnapshot(ui);
    const requests = ui.nativeFetch.mock.calls.length;
    await switchLocale(ui, 'en');
    const english = localeSnapshot(ui);
    expect(english).toMatchObject({ title: 'Subagent default model', effortLabel: 'Thinking effort',
      description: 'Global setting; leaves the current main model unchanged.',
      efforts: ['Auto', 'Off', 'On', 'Low', 'Medium', 'High'],
      status: 'Request failed; please retry.', buttons: ['Cancel', 'Retry', 'Save'],
      aria: 'Subagent default model', search: 'Search models or providers…' });
    expect(english.chips).toEqual(['All', 'Provider unavailable', '中文供应商']);
    expect(english.details).toContain('Provider: Provider unavailable\nAlias: 中文别名\nModel ID: 中文模型ID');
    expect(english.summary).toContain('用户中文名称二');
    expect(english.summary).toContain('Medium');
    expect(english.hint).toBe('Auto uses global thinking settings / model default.');
    expect(ui.query('search')).toBe(search);
    expect(search.value).toBe(' 中文别名 ');
    expect(ui.doc.activeElement).toBe(search);
    expect(ui.rows()[0]).toBe(row);
    expect(row.dataset.model).toBe('中文别名');
    expect(row.classList.contains('is-current')).toBe(true);
    expect(row.classList.contains('is-selected')).toBe(true);
    expect(ui.query('effort').querySelector('.is-on')).toBe(effort);
    expect(effort.dataset.effort).toBe('high');
    expect(unknownChip.classList.contains('is-active')).toBe(true);
    expect(body.scrollTop).toBe(23);
    expect(ui.body.scrollTop).toBe(137);
    await switchLocale(ui, 'zh');
    expect(localeSnapshot(ui)).toEqual(chinese);
    expect(ui.doc.documentElement.lang).toBe('en');
    expect(storageEvent).not.toHaveBeenCalled();
    expect(ui.nativeFetch).toHaveBeenCalledTimes(requests);
    expect(ui.posts).toEqual([]);
  });
});

describe('mobile subagent locale during initial requests', () => {
  it('retranslates pending load/error/empty catalog without closing or extra requests', async () => {
    const ui = await install({ noModels: true, locale: 'zh' });
    const slow = deferred();
    ui.nativeFetch.mockReturnValueOnce(slow.promise);
    ui.query('trigger').click();
    expect(ui.query('status').textContent).toBe('正在加载…');
    const requests = ui.nativeFetch.mock.calls.length;
    await switchLocale(ui, 'en');
    expect(ui.query('status').textContent).toBe('Loading…');
    expect(ui.nativeFetch).toHaveBeenCalledTimes(requests);
    slow.resolve(new Response('{}', { status: 500 }));
    await ui.settled();
    expect(ui.query('status').textContent).toBe('Request failed; please retry.');
    await switchLocale(ui, 'zh');
    expect(ui.query('status').textContent).toBe('请求失败，请重试。');
    expect(ui.nativeFetch).toHaveBeenCalledTimes(requests);
    ui.query('retry').click();
    await ui.settled();
    const loadedRequests = ui.nativeFetch.mock.calls.length;
    expect(localeSnapshot(ui).hint).toContain('没有已配置模型');
    await switchLocale(ui, 'en');
    expect(localeSnapshot(ui)).toMatchObject({ follow: 'Follow main model', efforts: ['Auto'],
      hint: 'No configured models. Keep following the main model, or add a model in provider settings first.' });
    expect(ui.query('overlay')).not.toBeNull();
    expect(ui.nativeFetch).toHaveBeenCalledTimes(loadedRequests);
  });
});
