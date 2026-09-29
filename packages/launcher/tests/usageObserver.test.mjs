/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sources = [
  'usageApi.js', 'usageView.js', 'usageTrend.js', 'usageControllers.js', 'usage.js',
].map((name) =>
  readFileSync(resolve(`packages/launcher/src/mobile/${name}`), 'utf8'));
const frames = [];
const observers = [];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const sidebar = '<aside class="side"><footer class="side-footer">Account</footer></aside>';
const sheet = '<section class="sheet-panel"><div class="sheet-body">' +
  '<div class="actions"><button class="newrow">New</button></div><div class="view-tabs">Tabs</div></div></section>';

function install(body) {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const view = frame.contentWindow;
  view.document.body.innerHTML = body;
  view.Request = Request;
  view.Headers = Headers;
  view.fetch = vi.fn(async () => new Response('{}'));
  const NativeMutationObserver = view.MutationObserver;
  const state = { callbacks: 0, exceeded: false };
  view.MutationObserver = class MutationObserver {
    constructor(callback) {
      const observer = new NativeMutationObserver((records) => {
        state.callbacks += 1;
        if (state.callbacks > 80) {
          state.exceeded = true;
          observer.disconnect();
          return;
        }
        callback(records);
      });
      observers.push(observer);
      return observer;
    }
  };
  sources.forEach((source) => view.eval(source));
  return { doc: view.document, state };
}

async function expectSettled(state) {
  await tick();
  const callbacks = state.callbacks;
  await tick();
  expect(state.callbacks).toBe(callbacks);
  expect(state.exceeded).toBe(false);
}

afterEach(() => {
  observers.splice(0).forEach((observer) => observer.disconnect());
  frames.splice(0).forEach((frame) => frame.remove());
});

describe('usage entry mutation scope', () => {
  it('does not rescan entry anchors during main and Side Chat streaming', async () => {
    const { doc, state } = install(sidebar + sheet +
      '<main>' + '<div class="a-msg">Earlier</div>'.repeat(500) + '</main>' +
      '<aside class="sc-body">' + '<div class="sc-msg">Earlier side message</div>'.repeat(50) + '</aside>');
    await expectSettled(state);
    const main = doc.querySelector('main .a-msg:last-child');
    const side = doc.querySelector('.sc-body .sc-msg:last-child');
    const query = vi.spyOn(doc, 'querySelector');
    for (let batch = 0; batch < 20; batch += 1) {
      main.append(doc.createElement('span'));
      side.append(doc.createElement('span'));
      await tick();
    }
    expect(query.mock.calls.filter(([selector]) =>
      selector === '.side .side-footer' || selector === '.sheet-panel .sheet-body > .actions')).toHaveLength(0);
    query.mockRestore();
    expect(doc.querySelectorAll('.okw-usage-entry')).toHaveLength(1);
    expect(doc.querySelectorAll('.okw-usage-mobile-entry')).toHaveLength(1);
    await expectSettled(state);
  });

  it('mounts late desktop and mobile entries and restores removed controls', async () => {
    const { doc, state } = install('<main>Conversation</main>');
    doc.body.insertAdjacentHTML('beforeend', sidebar + sheet);
    await expectSettled(state);
    const footer = doc.querySelector('.side-footer');
    expect(footer.previousElementSibling.matches('.okw-usage-entry')).toBe(true);
    expect(doc.querySelectorAll('.okw-usage-mobile-entry')).toHaveLength(1);
    doc.querySelector('.okw-usage-entry').remove();
    doc.querySelector('.okw-usage-mobile-entry').remove();
    await expectSettled(state);
    expect(footer.previousElementSibling.matches('.okw-usage-entry')).toBe(true);
    expect(doc.querySelectorAll('.okw-usage-mobile-entry')).toHaveLength(1);
    doc.querySelector('.side').outerHTML = sidebar;
    doc.querySelector('.sheet-panel').outerHTML = sheet;
    await expectSettled(state);
    expect(doc.querySelectorAll('.okw-usage-entry')).toHaveLength(1);
    expect(doc.querySelectorAll('.okw-usage-mobile-entry')).toHaveLength(1);
  });
});
