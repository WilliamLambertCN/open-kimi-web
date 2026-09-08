import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../src/mobile/providerEnhancements.js', import.meta.url), 'utf8');

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.className = '';
    this.textContent = '';
    this.dataset = {};
    this.disabled = false;
    this.listeners = new Map();
    this.attributes = new Map();
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
  }

  before(node) {
    const index = this.parentElement.children.indexOf(this);
    node.parentElement = this.parentElement;
    this.parentElement.children.splice(index, 0, node);
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  setAttribute(name, value) { this.attributes.set(name, value); }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    event.target ??= this;
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    return true;
  }

  click() { this.dispatchEvent({ type: 'click', target: this }); }
}

class FakeInput extends FakeElement {
  constructor(value = '') {
    super('input');
    this._value = value;
    this.type = 'text';
    this.checked = false;
  }

  get value() { return this._value; }
  set value(value) { this._value = String(value); }
}

class FakeRow extends FakeElement {
  constructor(model) {
    super();
    this.className = 'pf-model-grid';
    this.inputs = [new FakeInput(model), new FakeInput('131072'), new FakeInput('')];
    this.append(...this.inputs);
  }

  querySelector(selector) {
    if (selector === '.okw-model-options') return this.children.find((child) => child.className === 'okw-model-options') ?? null;
    return null;
  }

  querySelectorAll(selector) {
    if (selector === 'input:not([type="checkbox"])') return this.inputs;
    return [];
  }
}

class FakeField extends FakeElement {
  constructor(label, control = null) {
    super();
    this.className = 'pf-field';
    this.label = new FakeElement('label');
    this.label.textContent = label;
    this.control = control;
    this.append(this.label);
    if (control) this.append(control);
  }

  querySelector(selector) {
    if (selector === 'label') return this.label;
    if (selector === 'input') return this.control instanceof FakeInput ? this.control : null;
    if (selector === 'select') return this.control?.tagName === 'SELECT' ? this.control : null;
    if (selector === '[role="combobox"], button') return this.control?.tagName === 'BUTTON' ? this.control : null;
    return null;
  }
}

class FakeForm extends FakeElement {
  constructor(rows) {
    super();
    this.className = 'pf-form';
    this.rows = rows;
    const protocol = new FakeElement('button');
    protocol.textContent = 'OpenAI';
    this.fields = [
      new FakeField('Name *', new FakeInput('provider-fixture')),
      new FakeField('API Protocol *', protocol),
      new FakeField('API Key *', new FakeInput('provider-key')),
      new FakeField('Base URL *', new FakeInput('https://example.invalid/v1')),
      new FakeField('Models *'),
    ];
    this.models = new FakeElement();
    this.models.className = 'pf-models';
    this.officialAdd = new FakeElement('button');
    this.officialAdd.textContent = 'Add model';
    this.append(...this.fields, this.models, this.officialAdd);
  }

  querySelector(selector) {
    if (selector === '.okw-model-discovery') {
      return this.children.find((child) => child.className === 'okw-model-discovery') ?? null;
    }
    return null;
  }

  querySelectorAll(selector) {
    if (selector === '.pf-field') return this.fields;
    if (selector === '.pf-models > .pf-model-grid:not(.pf-model-head)') return this.rows;
    if (selector === 'button') return [this.officialAdd];
    return [];
  }
}

const descendants = (root) => root.children.flatMap((child) => [child, ...descendants(child)]);

function install() {
  const existing = new FakeRow('existing-model');
  const added = new FakeRow('');
  const form = new FakeForm([existing, added]);
  let observerCallback;
  class MutationObserver {
    constructor(callback) { observerCallback = callback; }
    observe() {}
  }
  class Event {
    constructor(type, values) { this.type = type; Object.assign(this, values); }
  }
  const document = {
    documentElement: { lang: 'en' },
    createElement(tag) {
      if (tag === 'input') return new FakeInput();
      return new FakeElement(tag);
    },
    querySelectorAll(selector) { return selector === '.pf-form' ? [form] : []; },
  };
  const calls = [];
  const nativeFetch = vi.fn(async (input, init) => {
    calls.push([input, init]);
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost');
    if (url.pathname === '/api/v1/config') {
      return Response.json({
        data: {
          models: {
            fixture: {
              provider: 'provider-fixture',
              model: 'existing-model',
              capabilities: [],
              supportEfforts: [],
              adaptiveThinking: false,
            },
          },
        },
      });
    }
    if (url.pathname === '/api/v1/models') {
      return Response.json({
        data: {
          items: [{
            provider: 'provider-fixture',
            model: 'existing-model',
            capabilities: [],
            support_efforts: [],
          }],
        },
      });
    }
    if (url.pathname === '/__open-kimi-mobile/models:discover') {
      return Response.json({ models: ['remote-model'] });
    }
    return Response.json({});
  });
  const window = { fetch: nativeFetch, addEventListener() {} };
  runInNewContext(source, {
    Array,
    Error,
    Event,
    Headers,
    HTMLInputElement: FakeInput,
    Map,
    MutationObserver,
    Request,
    Response,
    Set,
    URL,
    WeakMap,
    WeakSet,
    document,
    location: { href: 'http://localhost/settings', origin: 'http://localhost' },
    navigator: { language: 'en' },
    queueMicrotask,
    window,
  });
  return { added, calls, existing, form, observerCallback, window };
}

const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('provider model enhancements', () => {
  it('preserves explicit empty settings and defaults a new row to every option in PUT/POST bodies', async () => {
    const app = install();
    await app.window.fetch('/api/v1/config', { headers: { authorization: 'Bearer page-token' } });
    await app.window.fetch('/api/v1/models', { headers: { authorization: 'Bearer page-token' } });
    await tick();
    app.observerCallback();

    const existingChecks = descendants(app.existing).filter((item) => item.tagName === 'INPUT' && item.type === 'checkbox');
    const addedChecks = descendants(app.added).filter((item) => item.tagName === 'INPUT' && item.type === 'checkbox');
    expect(existingChecks).toHaveLength(13);
    expect(existingChecks.every((input) => input.checked === false)).toBe(true);
    expect(addedChecks).toHaveLength(13);
    expect(addedChecks.every((input) => input.checked === true)).toBe(true);

    const models = [
      { model: 'existing-model', max_context_size: 131072 },
      { model: 'new-model', max_context_size: 131072 },
    ];
    for (const [url, method] of [['/api/v1/providers/provider-fixture', 'PUT'], ['/api/v1/providers', 'POST']]) {
      await app.window.fetch(url, {
        method,
        headers: { authorization: 'Bearer page-token', 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'openai', models }),
      });
      const body = JSON.parse(app.calls.at(-1)[1].body);
      expect(body.models[0]).toMatchObject({ capabilities: [], support_efforts: [], adaptive_thinking: false });
      expect(body.models[1].capabilities).toEqual([
        'image_in', 'image_out', 'video_in', 'tool_use', 'thinking', 'always_thinking',
      ]);
      expect(body.models[1].support_efforts).toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'max']);
      expect(body.models[1].adaptive_thinking).toBe(true);
    }
  });

  it('fetches model ids and fills the selected id into an empty row', async () => {
    const app = install();
    await app.window.fetch('/api/v1/config', { headers: { authorization: 'Bearer page-token' } });
    await tick();
    app.observerCallback();
    const panel = app.form.querySelector('.okw-model-discovery');
    const [fetchButton, select, addButton] = panel.children;

    fetchButton.click();
    await tick();
    expect(select.children.map((option) => option.value)).toEqual(['', 'remote-model']);
    select.value = 'remote-model';
    select.dispatchEvent({ type: 'change', target: select });
    addButton.click();
    await tick();
    expect(app.added.inputs[0].value).toBe('remote-model');
  });
});
