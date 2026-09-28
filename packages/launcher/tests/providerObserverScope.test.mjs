/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = (name) => readFileSync(resolve(`packages/launcher/src/mobile/${name}`), 'utf8');
const frames = [];
const observers = [];
const tick = () => new Promise((resolveWait) => setTimeout(resolveWait, 0));
const formMarkup = `
  <div class="pf">
    <div class="pf-field"><label>Name *</label><input value="provider-fixture"></div>
    <div class="pf-field"><label>Base URL *</label><input value="https://example.invalid/v1"></div>
    <div class="pf-field"><label>Models *</label>
      <div class="pmt"><div class="pmt-grid pmt-head"></div>
        <div class="pmt-grid"><input value="model-a"><input value="131072"></div>
      </div>
    </div>
    <button>Add model</button>
  </div>`;
const config = () => Response.json({
  data: { models: { fixture: {
    provider: 'provider-fixture', model: 'model-a', capabilities: [], supportEfforts: [], adaptiveThinking: false,
  } } },
});

function install() {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const view = frame.contentWindow;
  const history = Array.from({ length: 500 }, (_, index) => `<div class="a-msg">Message ${index}</div>`).join('');
  view.document.body.innerHTML = `<div id="app">${history}</div>${formMarkup}`;
  view.Request = Request;
  view.Response = Response;
  view.Headers = Headers;
  const NativeMutationObserver = view.MutationObserver;
  const state = { callbacks: 0, exceededLimit: false };
  view.MutationObserver = class MutationObserver extends NativeMutationObserver {
    constructor(callback) {
      super((records, observer) => {
        state.callbacks += 1;
        if (state.callbacks > 80) {
          state.exceededLimit = true;
          observer.disconnect();
          return;
        }
        callback(records, observer);
      });
      observers.push(this);
    }
  };
  const nativeFetch = vi.fn(async (url) => String(url).includes('/api/v1/config') ? config() : Response.json({}));
  view.fetch = nativeFetch;
  const location = { href: 'http://localhost/settings', origin: 'http://localhost' };
  const scripts = `${source('providerSorting.js')}\n${source('providerEnhancements.js')}`;
  view.eval(`((location) => { ${scripts}\n})(${JSON.stringify(location)})`);
  return { view, nativeFetch, state };
}

afterEach(() => {
  observers.splice(0).forEach((observer) => observer.disconnect());
  frames.splice(0).forEach((frame) => frame.remove());
});

describe('provider observer scope', () => {
  it('skips chat streaming and enhances replaced forms and new model rows', async () => {
    const fixture = install();
    const { view, nativeFetch } = fixture;
    await view.fetch('/api/v1/config');
    await tick();
    const app = view.document.querySelector('#app');
    const sideChat = view.document.createElement('div');
    sideChat.className = 'side-chat';
    const queries = vi.spyOn(view.document, 'querySelectorAll');

    app.append(sideChat);
    for (let batch = 0; batch < 20; batch += 1) {
      const mainMessage = view.document.createElement('div');
      mainMessage.textContent = `History batch ${batch}`;
      app.append(mainMessage);
      const sideMessage = view.document.createElement('div');
      sideMessage.textContent = `Side Chat batch ${batch}`;
      sideChat.append(sideMessage);
      await tick();
    }
    expect(queries).not.toHaveBeenCalled();

    const oldForm = view.document.querySelector('.pf');
    oldForm.outerHTML = formMarkup;
    await tick();
    const form = view.document.querySelector('.pf');
    expect(form.querySelector('.okw-model-discovery')).not.toBeNull();
    expect(form.querySelector('.okw-model-options')).not.toBeNull();

    const row = view.document.createElement('div');
    row.className = 'pmt-grid';
    row.innerHTML = '<input value="model-b"><input value="131072">';
    form.querySelector('.pmt').append(row);
    await tick();
    expect(row.querySelector('.okw-model-options')).not.toBeNull();
    expect(row.querySelector('.okw-model-drag-handle')).not.toBeNull();

    await view.fetch('/api/v1/providers', {
      method: 'POST',
      body: JSON.stringify({ models: [{ model: 'model-a' }, { model: 'model-b' }] }),
    });
    const saved = JSON.parse(nativeFetch.mock.calls.at(-1)[1].body);
    expect(saved.models.map((model) => model.model)).toEqual(['model-a', 'model-b']);
    expect(saved.models[0]).toMatchObject({ capabilities: [], support_efforts: [], adaptive_thinking: false });
    expect(saved.models[1].capabilities).toContain('image_in');
    const scanCount = queries.mock.calls.length;
    const callbackCount = fixture.state.callbacks;
    await tick();
    expect(queries.mock.calls).toHaveLength(scanCount);
    expect(fixture.state.callbacks).toBe(callbackCount);
    expect(fixture.state.exceededLimit).toBe(false);
  });
});
