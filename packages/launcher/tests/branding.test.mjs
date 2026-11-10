/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const source = readFileSync(resolve('packages/launcher/src/mobile/branding.js'), 'utf8');
const frames = [];
const observers = [];
const brand = '<aside class="side"><div class="ch-brand"><svg class="ch-logo"></svg>' +
  '<span class="ch-name">Kimi Code</span></div></aside>';
const header = (name) => '<main class="con"><header class="chat-header"><div class="ch-id">' +
  `<span class="ch-ws">Workspace</span><span class="ch-ses">${name}</span></div></header></main>`;
const settle = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

function install(body, version = '2.4.1-r3') {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const view = frame.contentWindow;
  const doc = view.document;
  doc.head.innerHTML = '<title>Workspace | Kimi Code</title>' +
    (version ? `<meta name="open-kimi-web-version" content="${version}">` : '');
  doc.body.innerHTML = body;
  const state = { callbacks: 0, storm: false };
  const Native = view.MutationObserver;
  view.MutationObserver = class extends Native {
    constructor(callback) {
      super((records) => {
        state.callbacks += 1;
        if (state.callbacks > 120) {
          state.storm = true;
          observers.forEach((observer) => observer.disconnect());
          return;
        }
        callback(records);
      });
      observers.push(this);
    }
  };
  const evaluate = () => view.eval(`(() => { ${source}\n})()`);
  evaluate();
  return { doc, view, state, evaluate };
}

afterEach(() => {
  observers.splice(0).forEach((observer) => observer.disconnect());
  frames.splice(0).forEach((frame) => frame.remove());
});

describe('app branding and topic-only tab title', () => {
  it('uses the packaged icon and actual version without duplicating brand nodes or observers', async () => {
    const ui = install(`<div class="app">${brand}${header('Short topic')}</div>`);
    ui.evaluate();
    await settle();
    expect(ui.doc.querySelector('.ch-name').textContent).toBe('OPEN-KIMI-WEB');
    expect(ui.doc.querySelector('.okw-app-icon').getAttribute('src')).toBe('/__open-kimi-mobile/icons/app-192.png');
    expect(ui.doc.querySelector('.okw-app-version').textContent).toBe('v2.4.1-r3');
    expect(ui.doc.querySelectorAll('.okw-app-icon')).toHaveLength(1);
    expect(observers).toHaveLength(1);
    expect(ui.doc.title).toBe('Short topic');
    expect(ui.state.storm).toBe(false);
    const callbacks = ui.state.callbacks;
    await settle();
    expect(ui.state.callbacks).toBe(callbacks);
  });

  it('keeps literal separators, long titles and text-node renames instead of splitting the topic', async () => {
    const ui = install(`<div class="app">${brand}${header('Planning | Stage / One')}</div>`);
    expect(ui.doc.title).toBe('Planning | Stage / One');
    const long = 'A long topic with a specific name '.repeat(20);
    ui.doc.querySelector('.ch-ses').firstChild.data = long;
    await settle();
    expect(ui.doc.title).toBe(long.trim());
    ui.doc.querySelector('.ch-ses').textContent = 'Renamed';
    await settle();
    expect(ui.doc.title).toBe('Renamed');
  });

  it('preserves the title while native inline rename is open and follows confirm or cancel', async () => {
    const ui = install(`<div class="app">${brand}${header('Original')}</div>`);
    ui.doc.querySelector('.ch-ses').outerHTML = '<input class="ch-rename" value="Editing">';
    await settle();
    expect(ui.doc.title).toBe('Original');
    ui.doc.querySelector('.ch-rename').outerHTML = '<span class="ch-ses">Confirmed</span>';
    await settle();
    expect(ui.doc.title).toBe('Confirmed');
  });

  it('follows topic switching, history navigation and automatic renames without using workspace text', async () => {
    const ui = install(`<div class="app">${brand}${header('First')}</div>`);
    ui.doc.querySelector('.ch-id').innerHTML = '<span class="ch-ws">Another workspace</span>' +
      '<span class="ch-ses">Second</span>';
    await settle();
    expect(ui.doc.title).toBe('Second');
    ui.doc.querySelector('.ch-ses').textContent = 'First';
    ui.view.dispatchEvent(new ui.view.PopStateEvent('popstate'));
    await settle();
    expect(ui.doc.title).toBe('First');
    ui.doc.querySelector('.ch-ses').textContent = 'Automatic title';
    await settle();
    expect(ui.doc.title).toBe('Automatic title');
  });

});

describe('branding lifecycle and observer scope', () => {
  it('corrects the native running spinner title and settles without rescanning the sidebar', async () => {
    const ui = install(`<div class="app">${brand}${header('Current topic')}</div>`);
    await settle();
    const queryAll = ui.doc.querySelectorAll.bind(ui.doc);
    let brandScans = 0;
    ui.doc.querySelectorAll = (selector) => {
      if (selector === '.side .ch-brand') brandScans += 1;
      return queryAll(selector);
    };
    ui.doc.title = '⠋ Workspace | Kimi Code';
    await settle();
    expect(ui.doc.title).toBe('Current topic');
    expect(brandScans).toBe(0);
    expect(ui.state.storm).toBe(false);
  });

  it('uses mobile native topic titles and keeps branding after sidebar recreation', async () => {
    const ui = install('<div class="app mobile"><header class="topbar"><div class="tb-line">' +
      '<span class="dir">Workspace</span><span class="tt">Mobile topic</span></div></header></div>');
    expect(ui.doc.title).toBe('Mobile topic');
    ui.doc.querySelector('.tt').textContent = 'Mobile renamed';
    ui.doc.querySelector('.app').insertAdjacentHTML('beforeend', brand);
    await settle();
    expect(ui.doc.title).toBe('Mobile renamed');
    expect(ui.doc.querySelectorAll('.okw-app-version')).toHaveLength(1);
    ui.doc.querySelector('.side').outerHTML = brand;
    await settle();
    expect(ui.doc.querySelectorAll('.okw-app-version')).toHaveLength(1);
    expect(ui.doc.querySelectorAll('.okw-app-icon')).toHaveLength(1);
    ui.doc.querySelector('.ch-name').firstChild.data = 'Kimi Code';
    await settle();
    expect(ui.doc.querySelector('.ch-name').textContent).toBe('OPEN-KIMI-WEB');
  });

  it('uses an app fallback on empty or non-session pages and does not fabricate a missing version', async () => {
    const ui = install(`<div class="app">${brand}${header('')}</div>`, '');
    expect(ui.doc.title).toBe('Open Kimi Web');
    expect(ui.doc.querySelector('.okw-app-version')).toBeNull();
    ui.doc.querySelector('.con').remove();
    await settle();
    expect(ui.doc.title).toBe('Open Kimi Web');
  });

  it('does not query the document for streaming message content', async () => {
    const ui = install(`<div class="app">${brand}${header('Topic')}<div class="history"><span>Message</span></div></div>`);
    await settle();
    const node = ui.doc.querySelector('.history span');
    const original = ui.doc.querySelector.bind(ui.doc);
    let queries = 0;
    ui.doc.querySelector = (selector) => { queries += 1; return original(selector); };
    for (let batch = 0; batch < 10; batch += 1) {
      node.firstChild.data += ' increment';
      await settle();
    }
    expect(queries).toBe(0);
    expect(ui.state.storm).toBe(false);
  });
});
