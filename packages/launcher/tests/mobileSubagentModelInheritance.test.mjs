/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, current, fixtureConfig, install, open, response } from './testkit/mobileSubagentModel.mjs';

afterEach(cleanup);

describe('mobile subagent inheritance', () => {
  it.each([
    ['en', 'This Kimi version cannot restore inheritance on the web; use the official CLI config.'],
    ['zh', '当前 Kimi 版本不支持在网页恢复跟随主模型；请通过官方 CLI 配置调整。'],
  ])('explains unsupported clearing in %s without an obsolete version or an invalid merge', async (locale, message) => {
    const ui = await install({ locale, section: { defaultModel: 'fixture/fast', defaultEffort: 'medium' } });
    await open(ui);
    ui.select('');
    expect(ui.query('status').textContent).toBe(message);
    expect(ui.query('overlay').textContent).not.toContain('2.1.1');
    expect(ui.query('save').disabled).toBe(true);
    ui.query('save').click();
    await ui.settled();
    expect(ui.posts).toEqual([]);
    expect(ui.getConfig().secondary_model.defaultModel).toBe('fixture/fast');
  });
  it.each([['en', '2.5.2'], ['zh', '2.5.2'], ['en', '2.8.0'], ['zh', '2.8.0']])(
    'restores inheritance through native null in %s on %s', async (locale, version) => {
      const section = { defaultModel: 'fixture/fast', defaultEffort: 'medium', models: { 'fixture/fast': 'Pool' } };
      const ui = await install({ locale, version, section });
      await open(ui);
      ui.select('');
      expect(ui.query('save').disabled).toBe(false);
      expect(ui.query('status').textContent).toBe('');
      expect(ui.query('save').textContent).toBe(locale === 'zh' ? '清空候选池并跟随' : 'Clear pool and follow');
      const warning = locale === 'zh' ? '清除独立候选及说明' : 'candidates and their descriptions';
      expect(ui.query('note').textContent).toContain(warning);
      ui.query('cancel').click();
      await ui.settled();
      expect(ui.posts).toEqual([]);
      expect(ui.getConfig().secondary_model).toEqual(section);
      await open(ui);
      ui.select('');
      ui.query('save').click();
      ui.query('save').click();
      await ui.settled();
      expect(ui.posts).toEqual([{ secondary_model: null }]);
      expect(ui.getConfig().secondary_model).toBeUndefined();
      expect(ui.getConfig().default_model).toBe('fixture/main');
      expect(ui.query('summary').textContent).toBe(locale === 'zh' ? '跟随主模型' : 'Follow main model');
      await open(ui);
      expect(current(ui)).toBe('');
      expect(ui.query('save').disabled).toBe(true);
    });
  it('keeps a changed pool and requires a fresh choice after reloading', async () => {
    const config = fixtureConfig({ defaultModel: 'fixture/fast', models: { 'fixture/fast': 'Original' } });
    const ui = await install({ version: '2.8.0', config });
    await open(ui);
    ui.select('');
    const changed = { ...config.secondary_model, models: { 'fixture/fast': 'Updated in another window' } };
    ui.setConfig({ ...config, secondary_model: changed });
    ui.query('save').click();
    await ui.settled();
    expect(ui.posts).toEqual([]);
    expect(ui.getConfig().secondary_model).toEqual(changed);
    expect(ui.query('status').textContent).toBe('Subagent settings have changed. Retry to load the latest settings.');
    expect(ui.query('save').disabled).toBe(true);
    ui.query('retry').click();
    await ui.settled();
    expect(current(ui)).toBe('fixture/fast');
    expect(ui.query('save').disabled).toBe(true);
  });
  it('keeps the pool and shows a retry when the confirmed clear fails', async () => {
    const section = { defaultModel: 'fixture/fast', models: { 'fixture/fast': 'Retain on error' } };
    const ui = await install({ version: '2.8.0', section });
    await open(ui);
    ui.select('');
    ui.nativeFetch.mockResolvedValueOnce(response(fixtureConfig(section))).mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }));
    ui.query('save').click();
    await ui.settled();
    expect(ui.nativeFetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
    expect(ui.getConfig().secondary_model).toEqual(section);
    expect(ui.query('status').textContent).toBe('Request failed; please retry.');
    expect(ui.query('retry').hidden).toBe(false);
  });
});
