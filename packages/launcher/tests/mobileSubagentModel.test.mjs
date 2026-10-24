/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, deferred, fixtureConfig, install, response, tick } from './testkit/mobileSubagentModel.mjs';

const open = async (ui) => { ui.query('trigger').click(); await ui.settled(); };
const current = (ui) => ui.rows().find((row) => row.classList.contains('is-current'))?.dataset.model;
const efforts = (ui) => [...ui.query('effort').children].map((node) => node.dataset.effort);
const effortValue = (ui) => ui.query('effort').querySelector('.is-on')?.dataset.effort;
afterEach(cleanup);

describe('mobile subagent official-style picker scope and draft', () => {
  it('mounts one compact srow and opens a separate sheet without select or duplicate heading', async () => {
    const ui = await install();
    expect(ui.query('trigger').getAttribute('aria-expanded')).toBe('false');
    expect(ui.query('overlay')).toBeNull();
    expect(ui.query('section').querySelector('.group-title')).toBeNull();
    await open(ui);
    const root = ui.query('overlay');
    expect(root.parentElement).toBe(ui.doc.body);
    expect(root.querySelector(':scope > .sheet-scrim + .sheet-panel[role="dialog"]')).not.toBeNull();
    expect(root.querySelector('.sheet-body > .mp.mp--sheet > .search-wrap input.ui-input--md')).not.toBeNull();
    expect(root.querySelector('select, .model-star')).toBeNull();
    expect(current(ui)).toBe('');
    expect(ui.query('effort').querySelector('button').disabled).toBe(true);
    expect(ui.nativeFetch.mock.calls.map(([path]) => path)).toEqual(['/api/v1/meta', '/api/v1/config', '/api/v1/models']);
    expect(ui.storage.getItem.mock.calls.every(([key]) => key === 'kimi-locale')).toBe(true);
    expect(ui.storage.setItem).not.toHaveBeenCalled();
  });
  it.each([
    [{ mobile: false }, 'desktop'], [{ title: 'Providers' }, 'providers'], [{ scoped: false }, 'other sheet'],
  ])('does not modify %s (%s)', async (options) => {
    const ui = await install(options);
    expect(ui.query('trigger')).toBeNull();
    expect(ui.posts).toEqual([]);
  });
  it('loads saved effort, changes only the draft and cancels without a write', async () => {
    const ui = await install({ section: { defaultModel: 'fixture/fast', defaultEffort: 'medium' } });
    await open(ui);
    expect(current(ui)).toBe('fixture/fast');
    expect(effortValue(ui)).toBe('medium');
    ui.effort('high');
    expect(ui.query('save').disabled).toBe(false);
    expect(ui.query('summary').textContent).toContain('Medium');
    ui.query('cancel').click();
    expect(ui.query('overlay')).toBeNull();
    expect(ui.posts).toEqual([]);
    await open(ui);
    expect(effortValue(ui)).toBe('medium');
    expect(ui.query('save').disabled).toBe(true);
  });
  it('saves one precise patch, prevents repeats and retains main model/thinking and unrelated config', async () => {
    const ui = await install();
    await open(ui);
    ui.select('fixture/fast');
    ui.effort('medium');
    ui.query('save').click();
    ui.query('save').click();
    expect(ui.query('save').disabled).toBe(true);
    expect(ui.query('status').textContent).toBe('Saving…');
    await ui.settled();
    expect(ui.posts).toEqual([{ secondary_model: { defaultModel: 'fixture/fast', defaultEffort: 'medium' } }]);
    expect(ui.getConfig()).toMatchObject({ default_model: 'fixture/main', thinking: true, hooks: ['fixture'] });
    expect(ui.query('overlay')).toBeNull();
    expect(ui.query('summary').textContent).toContain('Fast');
    expect(ui.query('summary').textContent).toContain('Medium');
    expect(ui.doc.activeElement).toBe(ui.query('trigger'));
  });
});

describe('mobile subagent providers, search and exact identities', () => {
  const configFor = () => ({ ...fixtureConfig(undefined), models: {
    alpha: { provider: 'Provider-A', model: 'upstream-a', displayName: 'Same display name' },
    beta: { provider: 'Provider-B', model: 'upstream-b', displayName: 'Same display name' },
  } });
  it('uses actual provider chips, name/provider/alias search and full exact aliases', async () => {
    const ui = await install({ config: configFor() });
    await open(ui);
    const chips = [...ui.query('overlay').querySelectorAll('.chip')];
    expect(chips.map((chip) => chip.textContent)).toEqual(['All', 'Provider-A', 'Provider-B']);
    expect(chips[0].getAttribute('aria-pressed')).toBe('true');
    ui.search('  SaMe DISPlay  ');
    expect(ui.rows().map((row) => row.dataset.model)).toEqual(['alpha', 'beta']);
    ui.search('provider-b');
    expect(ui.rows().map((row) => row.dataset.model)).toEqual(['beta']);
    ui.search(' ALPHA ');
    expect(ui.rows().map((row) => row.dataset.model)).toEqual(['alpha']);
    chips[2].click();
    expect(ui.rows()).toHaveLength(0);
    expect(ui.query('overlay').querySelector('.empty').textContent).toBe('No matching models');
    ui.query('overlay').querySelector('.search-clear').click();
    expect(ui.rows().map((row) => row.dataset.model)).toEqual(['beta']);
    expect(chips[2].getAttribute('aria-pressed')).toBe('true');
    ui.select('beta');
    expect(ui.rows()[0].querySelector('.model-meta').textContent).toBe('Provider-B · beta');
    expect(ui.rows()[0].getAttribute('title')).toContain('upstream-b');
    expect(ui.query('model-details').open).toBe(false);
    ui.query('model-details').open = true;
    expect(ui.query('model-details').textContent).toContain('Model ID: upstream-b');
    ui.query('save').click();
    await ui.settled();
    expect(ui.posts).toEqual([{ secondary_model: { defaultModel: 'beta', defaultEffort: '' } }]);
  });
  it('shows the alias difference before a long provider while preserving complete saved identity', async () => {
    const aliases = ['alpha', 'bravo'].map((part) => `${'shared-long-prefix-'.repeat(5)}${part}${'-same-tail'.repeat(5)}`);
    const provider = 'very-long-provider-'.repeat(5);
    const label = '同名 Long display name '.repeat(10);
    const config = { ...fixtureConfig(undefined), models: Object.fromEntries(aliases.map((id) =>
      [id, { provider, model: `upstream/${id}`, displayName: label }])) };
    const ui = await install({ config });
    await open(ui);
    const rows = ui.rows().filter((row) => row.dataset.model);
    expect(rows.map((row) => row.querySelector('.model-name').textContent)).toEqual([label, label]);
    expect(rows.map((row) => row.querySelector('.model-meta').textContent)).toEqual([`…a… · ${provider}`, `…b… · ${provider}`]);
    expect(rows[1].getAttribute('aria-label')).toContain(aliases[1]);
    expect(rows[1].getAttribute('title')).toContain(aliases[1]);
    expect(ui.query('model-details').open).toBe(false);
    ui.select(aliases[1]);
    expect(ui.query('model-details').textContent).toContain(aliases[1]);
    ui.query('save').click();
    await ui.settled();
    expect(ui.posts[0].secondary_model.defaultModel).toBe(aliases[1]);
  });
});

describe('mobile subagent collision fragments', () => {
  const prefix = 'same-long-prefix-'.repeat(12);
  const suffix = '-same-long-suffix'.repeat(12);
  it.each([
    ['end', [`${prefix}A`, `${prefix}B`]],
    ['middle', [`${prefix}A${suffix}`, `${prefix}B${suffix}`]],
    ['prefix relation', [`${prefix}A`, `${prefix}AB`]],
    ['suffix relation', [`A${suffix}`, `BA${suffix}`]],
    ['multiple peers', [`${prefix}A0${suffix}`, `${prefix}A1${suffix}`, `${prefix}B0${suffix}`]],
    ['unicode emoji', [`${'用户共同前缀🚀'.repeat(15)}👩🏽‍💻`, `${'用户共同前缀🚀'.repeat(15)}👨🏽‍💻`]],
    ['unicode combining', [`${prefix}e\u0301${suffix}`, `${prefix}e\u0300${suffix}`]],
    ['invisible whitespace', [`${prefix} ${suffix}`, `${prefix}\u00a0${suffix}`]],
    ['controls', [`${prefix}\u200b${suffix}`, `${prefix}\u200c${suffix}`]],
    ['literal escape', [`${prefix}\u0001${suffix}`, `${prefix}\\u{1}${suffix}`]],
  ])('makes %s aliases visibly distinct before selection and stable when filtering', async (_name, aliases) => {
    const config = { ...fixtureConfig(undefined), models: Object.fromEntries(aliases.map((id) =>
      [id, { provider: 'Same provider', displayName: 'Same name' }])) };
    const ui = await install({ config });
    await open(ui);
    const rows = ui.rows().filter((row) => row.dataset.model);
    const labels = rows.map((row) => row.querySelector('.model-meta').textContent);
    const fragments = labels.map((label) => label.split(' · ')[0]);
    expect(new Set(fragments).size).toBe(aliases.length);
    expect(new Set(fragments.map((fragment) => Array.from(fragment).slice(0, 16).join(''))).size).toBe(aliases.length);
    expect(fragments.every((fragment) => !/[\u0000-\u001f\u200b\u200c]/u.test(fragment))).toBe(true);
    if (_name === 'unicode emoji') {
      expect(fragments).toEqual(['…👩🏽‍💻', '…👨🏽‍💻']);
    }
    expect(ui.query('model-details').open).toBe(false);
    rows.forEach((row) => expect(row.getAttribute('aria-label')).toContain(row.dataset.model));
    ui.search(aliases[1]);
    const filtered = ui.rows().find((row) => row.dataset.model === aliases[1]);
    expect(filtered.querySelector('.model-meta').textContent).toBe(labels[1]);
    expect(ui.doc.querySelectorAll('.okw-subagent-section')).toHaveLength(1);
    await ui.settled();
  });
});

describe('mobile subagent thinking style contract', () => {
  it('matches Settings typography and keeps the effort strip bounded and horizontally scrollable', async () => {
    const css = readFileSync('packages/launcher/src/mobile/mobileSubagentModel.css', 'utf8');
    const ui = await install();
    const style = ui.doc.createElement('style');
    style.textContent = css.slice(css.indexOf('{') + 1, css.lastIndexOf('}'));
    ui.doc.head.append(style);
    ui.doc.documentElement.style.setProperty('--space-1', '4px');
    await open(ui);
    ui.select('fixture/fast');
    const item = ui.query('effort').firstElementChild;
    const computed = ui.view.getComputedStyle(item);
    expect(computed.fontSize).toBe('12.5px');
    expect(computed.fontWeight).toBe('400');
    expect(computed.fontFamily).toBe('Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif');
    expect(computed.lineHeight).toBe('1');
    expect(computed.height).toBe('24px');
    const rule = [...style.sheet.cssRules].find((entry) => entry.selectorText === '.okw-subagent-overlay .ui-seg__item');
    expect(rule.style.padding).toBe('0 var(--space-1)');
    expect(computed.gap).toBe('var(--space-1)');
    const strip = ui.view.getComputedStyle(ui.query('effort'));
    expect(strip.maxWidth).toBe('100%');
    expect(strip.overflowX).toBe('auto');
    expect(item.getAttribute('role')).toBe('tab');
  });
});

describe('mobile subagent keyboard and input composition', () => {
  it('distinguishes current draft from active keyboard row and applies Enter only to the picker', async () => {
    const ui = await install({ section: { defaultModel: 'fixture/fast', defaultEffort: 'medium' } });
    await open(ui);
    ui.key('ArrowDown');
    expect(ui.rows().filter((row) => row.classList.contains('is-selected'))).toHaveLength(1);
    expect(current(ui)).toBe('fixture/fast');
    ui.key('ArrowUp');
    ui.key('Enter');
    expect(current(ui)).toBe('');
    expect(ui.query('save').disabled).toBe(true);
    ui.key('ArrowDown');
    ui.key('ArrowDown');
    ui.key('Enter');
    expect(current(ui)).toBe('fixture/always');
    ui.key('Enter', ui.query('cancel'));
    expect(current(ui)).toBe('fixture/always');
  });
  it('does not select or close during IME composition or the keyCode 229 boundary', async () => {
    const ui = await install();
    await open(ui);
    ui.search('Fast');
    ui.query('search').dispatchEvent(new ui.view.CompositionEvent('compositionstart', { bubbles: true }));
    ui.key('Enter');
    ui.key('Escape');
    expect(ui.query('overlay')).not.toBeNull();
    expect(ui.query('save').disabled).toBe(true);
    ui.query('search').dispatchEvent(new ui.view.CompositionEvent('compositionend', { bubbles: true }));
    ui.key('Enter', undefined, { keyCode: 229 });
    expect(ui.query('save').disabled).toBe(true);
    ui.key('Enter');
    expect(current(ui)).toBe('fixture/fast');
  });
  it('avoids focusing search on touch and supports horizontal segmented effort keys', async () => {
    const ui = await install();
    await open(ui);
    expect(ui.doc.activeElement).toBe(ui.query('editor'));
    ui.select('fixture/fast');
    const auto = ui.query('effort').querySelector('.is-on');
    ui.key('ArrowRight', auto);
    expect(effortValue(ui)).toBe('off');
    ui.key('End', ui.doc.activeElement);
    expect(effortValue(ui)).toBe('high');
    expect(ui.doc.activeElement.getAttribute('role')).toBe('tab');
    const pointer = await install({ touch: false });
    await open(pointer);
    expect(pointer.doc.activeElement).toBe(pointer.query('search'));
  });
});

describe('mobile subagent inheritance and automatic effort', () => {
  it.each([
    ['en', 'The official config API cannot clear a configured subagent model; restore inheritance via CLI config.'],
    ['zh', '官方配置接口无法清除已配置的子智能体模型；请通过官方 CLI 配置恢复跟随主模型。'],
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
  it('restores Auto with an empty effort and reloads it from backend', async () => {
    const ui = await install({ section: { defaultModel: 'fixture/fast', defaultEffort: 'medium' } });
    await open(ui);
    expect(ui.query('effort').firstElementChild.textContent).toBe('Auto');
    expect(ui.query('overlay').textContent).toContain('global thinking settings / model default');
    ui.effort('');
    expect(ui.query('save').disabled).toBe(false);
    ui.query('save').click();
    await ui.settled();
    expect(ui.posts).toEqual([{ secondary_model: { defaultModel: 'fixture/fast', defaultEffort: '' } }]);
    await open(ui);
    expect(effortValue(ui)).toBe('');
    expect(ui.query('save').disabled).toBe(true);
  });
  it('keeps full-pool intersection semantics for disjoint low/high always-thinking models', async () => {
    const section = { defaultModel: 'fixture/fast', models: { 'fixture/fast': 'Low only', 'fixture/always': 'High only' } };
    const config = fixtureConfig(section);
    config.models['fixture/fast'].supportEfforts = ['low'];
    config.models['fixture/always'].supportEfforts = ['high'];
    const ui = await install({ config });
    await open(ui);
    expect(efforts(ui)).toEqual(['', 'on']);
    ui.effort('on');
    ui.query('save').click();
    await ui.settled();
    expect(ui.posts).toEqual([{ secondary_model: { defaultModel: 'fixture/fast', defaultEffort: 'on' } }]);
    expect(ui.getConfig().secondary_model.models).toEqual(section.models);
  });
  it('explains empty catalogs while keeping inherited state without a write', async () => {
    const ui = await install({ noModels: true });
    await open(ui);
    expect(ui.rows()).toHaveLength(1);
    expect(ui.query('overlay').textContent).toContain('No configured models');
    expect(ui.query('save').disabled).toBe(true);
    expect(ui.query('summary').textContent).toBe('Follow main model');
  });
});

describe('mobile subagent errors and asynchronous lifetime', () => {
  it('retains failed draft, shows retry and reloads saved values on retry', async () => {
    const ui = await install();
    await open(ui);
    ui.select('fixture/fast');
    ui.nativeFetch.mockRejectedValueOnce(new Error('fixture failure'));
    ui.query('save').click();
    await ui.settled();
    expect(current(ui)).toBe('fixture/fast');
    expect(ui.query('status').textContent).toBe('Request failed; please retry.');
    expect(ui.query('retry').hidden).toBe(false);
    expect(ui.posts).toEqual([]);
    ui.query('retry').click();
    await ui.settled();
    expect(ui.query('status').textContent).toBe('');
    expect(current(ui)).toBe('');
  });
  it('isolates closed and reopened picker from stale load', async () => {
    const ui = await install();
    const slow = deferred();
    ui.nativeFetch.mockReturnValueOnce(slow.promise);
    ui.query('trigger').click();
    expect(ui.query('status').textContent).toBe('Loading…');
    ui.query('cancel').click();
    await open(ui);
    slow.resolve(response(fixtureConfig({ defaultModel: 'fixture/always', defaultEffort: 'high' })));
    await ui.settled();
    expect(current(ui)).toBe('');
    expect(ui.query('summary').textContent).toBe('Follow main model');
  });
});

describe('mobile subagent save validation and cancellation', () => {
  it('does not apply a late POST response after cancel/reopen or imply server rollback', async () => {
    const ui = await install();
    await open(ui);
    const original = ui.nativeFetch.getMockImplementation();
    const slow = deferred();
    ui.nativeFetch.mockImplementation((path, options) => options?.method === 'POST' ? slow.promise : original(path, options));
    ui.select('fixture/fast');
    ui.effort('medium');
    ui.query('save').click();
    await tick();
    expect(ui.nativeFetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true);
    ui.query('cancel').click();
    ui.setConfig(fixtureConfig({ defaultModel: 'fixture/fast', defaultEffort: 'medium' }));
    await open(ui);
    slow.resolve(response(fixtureConfig({ defaultModel: 'fixture/always', defaultEffort: 'high' })));
    await ui.settled();
    expect(current(ui)).toBe('fixture/fast');
    expect(ui.query('overlay')).not.toBeNull();
  });
  it('cancels before POST when pre-save read ignores abort', async () => {
    const ui = await install();
    await open(ui);
    ui.select('fixture/fast');
    const slow = deferred();
    ui.nativeFetch.mockReturnValueOnce(slow.promise);
    ui.query('save').click();
    ui.query('cancel').click();
    slow.resolve(response(fixtureConfig(undefined)));
    await ui.settled();
    expect(ui.posts).toEqual([]);
    expect(ui.query('overlay')).toBeNull();
  });
  it('revalidates the latest pool and reports save-response mismatch', async () => {
    const ui = await install();
    await open(ui);
    ui.select('fixture/fast');
    ui.effort('off');
    ui.setConfig(fixtureConfig({ defaultModel: 'fixture/always', models: { 'fixture/always': 'New choice' } }));
    ui.query('save').click();
    await ui.settled();
    expect(ui.posts).toEqual([]);
    expect(ui.query('status').textContent).toContain('incompatible with the latest model pool');
    ui.effort('medium');
    const original = ui.nativeFetch.getMockImplementation();
    ui.nativeFetch.mockImplementation((path, options) => options?.method === 'POST'
      ? response(fixtureConfig(undefined)) : original(path, options));
    ui.query('save').click();
    await ui.settled();
    expect(ui.query('status').textContent).toContain('Saving is not confirmed');
    expect(ui.query('overlay')).not.toBeNull();
  });
});

describe('mobile subagent overlay isolation and cleanup', () => {
  it('isolates lower sheet and restores exact previous inert/aria values after scrim cancel', async () => {
    const ui = await install();
    const app = ui.doc.querySelector('.app');
    app.setAttribute('inert', 'existing');
    app.setAttribute('aria-hidden', 'false');
    ui.root.setAttribute('aria-hidden', 'false');
    ui.query('trigger').focus();
    await open(ui);
    expect(ui.root.getAttribute('inert')).toBe('');
    expect(ui.root.getAttribute('aria-hidden')).toBe('true');
    ui.query('overlay').querySelector('.sheet-scrim').click();
    expect(ui.root.hasAttribute('inert')).toBe(false);
    expect(ui.root.getAttribute('aria-hidden')).toBe('false');
    expect(app.getAttribute('inert')).toBe('existing');
    expect(app.getAttribute('aria-hidden')).toBe('false');
    expect(ui.doc.activeElement).toBe(ui.query('trigger'));
    expect(ui.posts).toEqual([]);
  });
  it('traps focus and isolates keydown so Escape only closes the upper sheet', async () => {
    const ui = await install();
    const lowerEscape = vi.fn();
    ui.doc.addEventListener('keydown', lowerEscape);
    await open(ui);
    const grab = ui.query('overlay').querySelector('.sheet-grab');
    ui.key('Tab', ui.query('editor'), { shiftKey: true });
    expect(ui.doc.activeElement).toBe(ui.query('cancel'));
    ui.key('Tab', ui.query('cancel'));
    expect(ui.doc.activeElement).toBe(grab);
    ui.key('Tab', grab, { shiftKey: true });
    expect(ui.doc.activeElement).toBe(ui.query('cancel'));
    ui.root.querySelector('.srow').focus();
    expect(ui.doc.activeElement).toBe(ui.query('editor'));
    const event = ui.key('Escape', ui.query('editor'));
    expect(event.defaultPrevented).toBe(true);
    expect(lowerEscape).not.toHaveBeenCalled();
    expect(ui.query('overlay')).toBeNull();
    expect(ui.root.isConnected).toBe(true);
  });
  it.each(['remove', 'hidden', 'providers', 'breakpoint'])('cleans upper sheet on parent %s', async (mode) => {
    const ui = await install();
    await open(ui);
    if (mode === 'remove') ui.root.remove();
    if (mode === 'hidden') ui.panel.hidden = true;
    if (mode === 'providers') {
      ui.panel.setAttribute('aria-label', 'Providers');
      ui.panel.querySelector('.sheet-title').textContent = 'Providers';
    }
    if (mode === 'breakpoint') { ui.media.matches = false; ui.media.change(); }
    await ui.settled();
    expect(ui.query('overlay')).toBeNull();
    expect(ui.query('trigger')).toBeNull();
    expect(ui.doc.querySelector('.app').hasAttribute('inert')).toBe(false);
    expect(ui.posts).toEqual([]);
  });
});
