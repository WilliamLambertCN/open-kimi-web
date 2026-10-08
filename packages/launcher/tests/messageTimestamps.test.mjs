/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve('packages/launcher/src/mobile/messageTimestamps.js'), 'utf8');
const frames = [];
const observers = [];
const submitted = '2026-10-08T06:00:00.000Z';
const started = '2026-10-08T06:00:02.000Z';
const ended = '2026-10-08T06:01:00.000Z';
const full = (value) => {
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const turn = (overrides = {}) => ({
  kind: 'turn', turnId: 't0', triggerPromptId: 'p0', ordinal: 0, state: 'completed', origin: { kind: 'user' },
  prompt: 'A fictional question', startedAt: started, endedAt: ended,
  steps: [{ kind: 'step', stepId: 's0', turnId: 't0', ordinal: 0, state: 'completed', startedAt: started, endedAt: ended,
    frames: [{ kind: 'text', frameId: 'f0', role: 'assistant', text: 'A fictional reply' }] }],
  ...overrides,
});
const envelope = (items = [turn()], overrides = {}) => ({ data: {
  agent_id: 'main', items, has_more: false, prompts: [{ promptId: 'p0', status: 'completed', createdAt: submitted }],
  tasks: [], interactions: [], attachments: [], todos: [], agents: [], pending_interactions: [], meta: { activity: 'idle' },
  ...overrides,
} });
const user = (id = 't0:input', native = '') => `<div class="u-turn"><div class="u-bub" data-turn-id="${id}">Question</div>`
  + (native ? `<div class="u-meta"><span class="msg-time">${native}</span><button>Undo</button></div>` : '') + '</div>';
const assistant = (id = 'f0', native = '', footer = true) => `<div class="a-msg" data-turn-id="${id}">`
  + '<div class="msg">Reply</div>'
  + (footer ? `<div class="a-msg-ft">${native ? `<span class="a-time">${native}</span>` : ''}<button>Copy</button></div>` : '')
  + '</div>';
const responseFor = (body, options = {}) => {
  const response = new Response(JSON.stringify(body), options);
  return { response, json: vi.spyOn(response, 'json'), clone: vi.spyOn(response, 'clone') };
};
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { resolve, promise };
};
const settle = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
const flush = async () => {
  for (let i = 0; i < 5; i += 1) { await settle(); await vi.advanceTimersByTimeAsync(2); }
};

function install(fetch = vi.fn(async () => responseFor(envelope()).response), html = user() + assistant()) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-08T08:00:00.000Z'));
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const view = frame.contentWindow;
  const doc = view.document;
  const location = { origin: window.location.origin, href: `${window.location.origin}/sessions/A`, pathname: '/sessions/A' };
  for (const method of ['pushState', 'replaceState']) {
    view.history[method] = (state, title, path) => {
      const url = new URL(path, location.href);
      location.href = url.href;
      location.pathname = url.pathname;
    };
  }
  view.__fixtureLocation = location;
  doc.body.innerHTML = '<div class="panes chat-scroll"><div class="chat">' + html + '</div></div>';
  view.fetch = fetch;
  view.Request = Request;
  view.Response = Response;
  let count = 0;
  const Native = view.MutationObserver;
  view.MutationObserver = class {
    constructor(callback) {
      this.observer = new Native((records) => {
        count += 1;
        if (count > 120) { observers.forEach((observer) => observer.disconnect()); throw new Error('Observer did not settle'); }
        callback(records);
      });
      observers.push(this.observer);
    }
    observe(...args) { this.observer.observe(...args); }
    disconnect() { this.observer.disconnect(); }
  };
  view.eval(`(() => { const location = window.__fixtureLocation; ${source}\n })()`);
  const load = async (path = '/api/v1/sessions/A/transcript?agent_id=main', options) => {
    const response = await view.fetch(path, options);
    const body = JSON.parse(await response.text());
    await flush();
    return { response, body };
  };
  return { view, doc, fetch, load, count: () => count, main: doc.querySelector('.chat') };
}

afterEach(() => {
  observers.splice(0).forEach((observer) => observer.disconnect());
  frames.splice(0).forEach((frame) => frame.remove());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('precise transcript timestamp enhancement', () => {
  it('preserves native compact times, title and click/keyboard expansion without touching message content', async () => {
    const { doc, view, load, count } = install(undefined, user('t0:input', '14:00') + assistant('f0', '14:01'));
    await load();
    const userTime = doc.querySelector('.msg-time');
    const assistantTime = doc.querySelector('.a-time');
    expect(userTime.textContent).toBe('14:00');
    expect(userTime.title).toBe(full(submitted));
    expect(assistantTime.textContent).toBe('14:01');
    expect(assistantTime.title).toBe(full(ended));
    userTime.click();
    await flush();
    expect(userTime.textContent).toBe(full(submitted));
    expect(userTime.getAttribute('aria-pressed')).toBe('true');
    userTime.dispatchEvent(new view.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    await flush();
    expect(userTime.textContent).toBe('14:00');
    assistantTime.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(assistantTime.textContent).toBe(full(ended));
    expect(doc.querySelector('.u-bub').textContent).toBe('Question');
    expect(doc.querySelector('.msg').textContent).toBe('Reply');
    expect(doc.querySelectorAll('.msg-time')).toHaveLength(1);
    await flush();
    const before = count();
    await flush();
    expect(count()).toBe(before);
  });

  it('inserts only in official metadata, waits for a completed assistant footer and never uses the current date', async () => {
    const { doc, main, load } = install(undefined, user() + assistant('f0', '', false));
    await load();
    expect(doc.querySelector('.u-bub .msg-time')).toBeNull();
    expect(doc.querySelector('.u-meta .msg-time').title).toBe(full(submitted));
    expect(doc.querySelector('.a-time')).toBeNull();
    main.querySelector('.a-msg').insertAdjacentHTML('beforeend', '<div class="a-msg-ft"><button>Copy</button></div>');
    await flush();
    expect(doc.querySelector('.a-msg-ft .a-time').title).toBe(full(ended));
  });

  it('uses upstream frame-derived assistant IDs, tool call IDs and exact steered prompt IDs', async () => {
    const item = turn({ steps: [{ kind: 'step', stepId: 's0', startedAt: started, endedAt: ended, frames: [
      { kind: 'thinking', frameId: 'think', text: 'Thinking' },
      { kind: 'text', frameId: 'first', role: 'assistant', text: 'First' },
      { kind: 'text', frameId: 'steer', role: 'user', text: 'Another question', promptIds: ['p1'] },
      { kind: 'tool', frameId: 'tool', state: 'completed', toolCallId: 'call', name: 'Read' },
      { kind: 'text', frameId: 'last', role: 'assistant', text: 'Last' },
    ] }] });
    const body = envelope([item], { prompts: [{ promptId: 'p1', status: 'completed', createdAt: submitted }] });
    const { doc, load } = install(vi.fn(async () => responseFor(body).response),
      assistant('think') + user('steer') + assistant('tool:call') + assistant('last'));
    await load();
    expect(doc.querySelector('[data-turn-id="think"] .a-time')).toBeNull();
    expect(doc.querySelector('[data-turn-id="steer"]').nextElementSibling.querySelector('.msg-time').title).toBe(full(submitted));
    expect(doc.querySelector('[data-turn-id="tool:call"] .a-time').title).toBe(full(ended));
    expect(doc.querySelector('[data-turn-id="last"] .a-time')).toBeNull();
  });

});

describe('timestamp reliability boundaries', () => {
  it('does not show an assistant completion time for a running turn even if its footer is stale', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(responseFor(envelope()).response)
      .mockResolvedValueOnce(responseFor(envelope([turn({ state: 'running', endedAt: undefined })])).response);
    const { doc, load } = install(fetch);
    await load();
    expect(doc.querySelector('.a-time')).not.toBeNull();
    await load();
    expect(doc.querySelector('.a-time')).toBeNull();
    expect(doc.querySelector('.msg-time')).not.toBeNull();
  });

  it('refuses missing dates, session/agent creation fallbacks and text/order matching', async () => {
    const item = turn({ startedAt: 'invalid', endedAt: '', steps: [{ frames: [
      { kind: 'text', frameId: 'f0', role: 'assistant', text: 'A fictional reply' },
    ] }] });
    const body = envelope([item], { prompts: [], agents: [{ agentId: 'main', createdAt: submitted }] });
    body.data.created_at = submitted;
    body.data.has_more = true;
    const { doc, load, fetch } = install(vi.fn(async () => responseFor(body).response),
      user('t0:input', '14:00') + user('wrong:input') + assistant('f0', '14:01') + assistant('wrong'));
    await load();
    expect(doc.querySelectorAll('.okw-message-time')).toHaveLength(0);
    expect(doc.querySelector('.msg-time').textContent).toBe('14:00');
    expect(doc.querySelector('.msg-time').hasAttribute('title')).toBe(false);
    expect(doc.querySelector('.a-time').textContent).toBe('14:01');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.some(([path]) => String(path).includes('/messages'))).toBe(false);
  });
});

describe('available transcript pages', () => {
  it('observes native older pages without requesting or walking more pages and keeps exact IDs isolated', async () => {
    const older = turn({ turnId: 'old', triggerPromptId: undefined, endedAt: '2026-10-07T06:01:00.000Z',
      startedAt: '2026-10-07T06:00:00.000Z', steps: [{ stepId: 'old-step', frames: [
        { kind: 'text', frameId: 'old-frame', role: 'assistant', text: 'Older reply' },
      ] }] });
    const fetch = vi.fn().mockResolvedValueOnce(responseFor(envelope()).response)
      .mockResolvedValueOnce(responseFor(envelope([older], { prompts: [], has_more: true })).response);
    const { doc, load } = install(fetch, user() + assistant() + user('old:input') + assistant('old-frame'));
    await load();
    expect(doc.querySelectorAll('.okw-message-time')).toHaveLength(2);
    await load('/api/v1/sessions/A/transcript?agent_id=main&before_turn=t0&page_size=100');
    expect(doc.querySelectorAll('.okw-message-time')).toHaveLength(4);
    expect(doc.querySelector('[data-turn-id="old-frame"] .a-time').title).toBe(full(older.endedAt));
    expect(doc.querySelector('[data-turn-id="f0"] .a-time').title).toBe(full(ended));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('drops removed or invalid metadata on a replacement snapshot and never invents completion from duration', async () => {
    const incomplete = turn({ startedAt: undefined, endedAt: undefined, durationMs: 1000,
      steps: [{ frames: [{ kind: 'text', frameId: 'f0', role: 'assistant', text: 'Reply' }] }] });
    const fetch = vi.fn().mockResolvedValueOnce(responseFor(envelope()).response)
      .mockResolvedValueOnce(responseFor(envelope([incomplete], { prompts: [] })).response);
    const { doc, load } = install(fetch);
    await load();
    expect(doc.querySelectorAll('.okw-message-time')).toHaveLength(2);
    await load();
    expect(doc.querySelector('.okw-message-time')).toBeNull();
  });
});

describe('request identity and isolation', () => {
  it('returns the original Response and parsed object promptly with one JSON parse and no clone for large payloads', async () => {
    const body = envelope([turn()]);
    body.data.items[0].steps[0].frames[0].text = 'x'.repeat(2 * 1024 * 1024);
    const response = new Response('unused', { status: 200 });
    const json = vi.spyOn(response, 'json').mockResolvedValue(body);
    const clone = vi.spyOn(response, 'clone');
    const native = vi.fn(async () => response);
    const { view, doc } = install(native);
    const parse = vi.spyOn(view.JSON, 'parse');
    const receiver = {};
    const options = { signal: new AbortController().signal, credentials: 'same-origin' };
    const returned = await view.fetch.call(receiver, '/api/v1/sessions/A/transcript?agent_id=main', options);
    expect(returned).toBe(response);
    expect(native.mock.contexts[0]).toBe(receiver);
    expect(native).toHaveBeenCalledWith('/api/v1/sessions/A/transcript?agent_id=main', options);
    expect(await returned.json()).toBe(body);
    expect(json).toHaveBeenCalledTimes(1);
    expect(clone).not.toHaveBeenCalled();
    expect(doc.querySelector('.okw-message-time')).toBeNull();
    await flush();
    expect(doc.querySelectorAll('.okw-message-time')).toHaveLength(2);
    expect(body.data.items[0].steps[0].frames[0].text).toHaveLength(2 * 1024 * 1024);
    expect(parse).not.toHaveBeenCalled();
  });

  it('ignores cross-origin, non-GET, unknown agent and unrelated responses without changing their json methods', async () => {
    const response = responseFor(envelope()).response;
    const original = response.json;
    const { view, doc } = install(vi.fn(async () => response));
    for (const [path, options] of [
      ['https://example.org/api/v1/sessions/A/transcript?agent_id=main'],
      ['/api/v1/sessions/A/transcript?agent_id=main', { method: 'POST' }],
      ['/api/v1/sessions/A/transcript'], ['/api/v1/sessions/A/messages?page_size=100'],
    ]) {
      expect(await view.fetch(path, options)).toBe(response);
      expect(response.json).toBe(original);
    }
    await flush();
    expect(doc.querySelector('.okw-message-time')).toBeNull();
  });

  it('leaves failed fetches, HTTP failures, rejected JSON and frozen Responses on their official failure paths', async () => {
    const failed = responseFor(envelope(), { status: 403 }).response;
    const frozen = Object.freeze(responseFor(envelope()).response);
    const malformed = new Response('{');
    const native = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(frozen).mockResolvedValueOnce(malformed);
    const { view, doc } = install(native);
    const path = '/api/v1/sessions/A/transcript?agent_id=main';
    await expect(view.fetch(path)).rejects.toThrow('offline');
    expect(await view.fetch(path)).toBe(failed);
    expect(await failed.json()).toEqual(envelope());
    expect(await view.fetch(path)).toBe(frozen);
    await expect((await view.fetch(path)).json()).rejects.toThrow();
    await flush();
    expect(doc.querySelector('.okw-message-time')).toBeNull();
  });
});

describe('official text consumption', () => {
  it('delivers the original text promise before deferred bounded parsing with unchanged text and no clone', async () => {
    const raw = JSON.stringify(envelope());
    const response = new Response(raw);
    const original = response.text.bind(response);
    let nativePromise;
    const text = vi.spyOn(response, 'text').mockImplementation(() => { nativePromise = original(); return nativePromise; });
    const json = vi.spyOn(response, 'json');
    const clone = vi.spyOn(response, 'clone');
    const { view, doc, fetch } = install(vi.fn(async () => response));
    const parse = vi.spyOn(view.JSON, 'parse');
    expect(await view.fetch('/api/v1/sessions/A/transcript?agent_id=main')).toBe(response);
    const delivered = response.text();
    expect(delivered).toBe(nativePromise);
    expect(await delivered).toBe(raw);
    expect(response.bodyUsed).toBe(true);
    expect(text).toHaveBeenCalledTimes(1);
    expect(json).not.toHaveBeenCalled();
    expect(clone).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
    expect(doc.querySelector('.okw-message-time')).toBeNull();
    await flush();
    expect(parse).toHaveBeenCalledExactlyOnceWith(raw);
    expect(doc.querySelector('.msg-time').title).toBe(full(submitted));
    expect(doc.querySelector('.a-time').title).toBe(full(ended));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('skips oversized inline text in constant-time gating and never delays official text delivery', async () => {
    const body = envelope();
    body.data.items[0].steps[0].frames[0].text = 'x'.repeat(2 * 1024 * 1024);
    const raw = JSON.stringify(body);
    const response = new Response(raw);
    const clone = vi.spyOn(response, 'clone');
    const { view, doc, fetch } = install(vi.fn(async () => response), user('t0:input', '14:00') + assistant('f0', '14:01'));
    const parse = vi.spyOn(view.JSON, 'parse');
    const returned = await view.fetch('/api/v1/sessions/A/transcript?agent_id=main');
    expect(await returned.text()).toBe(raw);
    expect(parse).not.toHaveBeenCalled();
    await flush();
    expect(parse).not.toHaveBeenCalled();
    expect(clone).not.toHaveBeenCalled();
    expect(doc.querySelectorAll('.okw-message-time')).toHaveLength(0);
    expect(doc.querySelector('.msg-time').textContent).toBe('14:00');
    expect(doc.querySelector('.a-time').textContent).toBe('14:01');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('deferred text failure boundaries', () => {
  it('does not schedule work for rejected readers and preserves malformed text for official parsing', async () => {
    const failure = new Error('reader failed');
    const rejected = new Response('unused');
    const rejectedText = vi.spyOn(rejected, 'text').mockRejectedValue(failure);
    const malformed = new Response('{');
    const failed = new Response(JSON.stringify(envelope()), { status: 403 });
    const native = vi.fn().mockResolvedValueOnce(rejected).mockResolvedValueOnce(malformed).mockResolvedValueOnce(failed);
    const { view, doc } = install(native);
    const parse = vi.spyOn(view.JSON, 'parse');
    const path = '/api/v1/sessions/A/transcript?agent_id=main';
    await expect((await view.fetch(path)).text()).rejects.toBe(failure);
    expect(rejectedText).toHaveBeenCalledTimes(1);
    expect(await (await view.fetch(path)).text()).toBe('{');
    const failureText = failed.text;
    expect(await view.fetch(path)).toBe(failed);
    expect(failed.text).toBe(failureText);
    await failed.text();
    expect(parse).not.toHaveBeenCalled();
    await flush();
    expect(parse).toHaveBeenCalledExactlyOnceWith('{');
    expect(doc.querySelector('.okw-message-time')).toBeNull();
  });

  it('discards stale sessions before deferred parsing and does not parse unsupported Side Chat text', async () => {
    const native = vi.fn(async (path) => responseFor(envelope([turn()], {
      agent_id: new URL(path, 'http://localhost').searchParams.get('agent_id'),
    })).response);
    const { view, doc } = install(native);
    const parse = vi.spyOn(view.JSON, 'parse');
    await (await view.fetch('/api/v1/sessions/A/transcript?agent_id=main')).text();
    view.history.pushState(null, '', '/sessions/B');
    view.history.pushState(null, '', '/sessions/A');
    await (await view.fetch('/api/v1/sessions/A/transcript?agent_id=side')).text();
    await flush();
    expect(parse).not.toHaveBeenCalled();
    expect(doc.querySelector('.okw-message-time')).toBeNull();
  });
});

describe('official prefetch before navigation', () => {
  it.each([['pushState', false], ['replaceState', false], ['pushState', true]])(
    '%s accepts only the immediate target visit, reentry=%s', async (method, reentry) => {
      const slow = deferred();
      const { view, doc, main } = install(vi.fn(() => slow.promise));
      const pending = view.fetch('/api/v1/sessions/B/transcript?agent_id=main&page_size=10');
      expect(view.__fixtureLocation.pathname).toBe('/sessions/A');
      view.history[method](null, '', '/sessions/B');
      if (reentry) {
        view.history.pushState(null, '', '/sessions/A');
        view.history.pushState(null, '', '/sessions/B');
      }
      view.setTimeout(() => slow.resolve(responseFor(envelope()).response), 500);
      await vi.advanceTimersByTimeAsync(500);
      await (await pending).text();
      main.innerHTML = user('t0:input', '14:00') + assistant('f0', '14:01');
      await flush();
      expect(doc.querySelectorAll('.okw-message-time')).toHaveLength(reentry ? 0 : 2);
      expect(doc.querySelector('.a-time').title).toBe(reentry ? '' : full(ended));
    },
  );
});

describe('route and agent races', () => {
  it('rejects slow old sessions and old responses after A to B to A navigation, restoring native attributes', async () => {
    const slow = deferred();
    const native = vi.fn().mockResolvedValueOnce(responseFor(envelope()).response).mockReturnValueOnce(slow.promise);
    const { view, doc, load } = install(native, user('t0:input', '14:00') + assistant('f0', '14:01'));
    await load();
    const time = doc.querySelector('.msg-time');
    time.click();
    const pending = view.fetch('/api/v1/sessions/A/transcript?agent_id=main');
    view.history.pushState(null, '', '/sessions/B');
    view.history.pushState(null, '', '/sessions/A');
    expect(time.textContent).toBe('14:00');
    expect(time.hasAttribute('title')).toBe(false);
    slow.resolve(responseFor(envelope()).response);
    await (await pending).text();
    await flush();
    expect(doc.querySelector('.okw-message-time')).toBeNull();
  });

  it('keeps newer same-agent metadata when a slower old request arrives last', async () => {
    const slow = deferred();
    const freshEnd = '2026-10-08T06:08:00.000Z';
    const native = vi.fn().mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(responseFor(envelope([turn({ endedAt: freshEnd })])).response);
    const { view, doc, load } = install(native);
    const old = view.fetch('/api/v1/sessions/A/transcript?agent_id=main');
    await load();
    slow.resolve(responseFor(envelope()).response);
    await (await old).text();
    await flush();
    expect(doc.querySelector('.a-time').title).toBe(full(freshEnd));
  });

  it('never assigns main-only times to Side Chat or ambiguous agents with identical turn/frame IDs', async () => {
    const fetch = vi.fn(async (path) => responseFor(envelope([turn()], {
      agent_id: new URL(path, 'http://localhost').searchParams.get('agent_id'),
    })).response);
    const { doc, load } = install(fetch);
    doc.body.insertAdjacentHTML('beforeend', '<div class="pt-body"><div class="sc"><div class="sc-body">'
      + '<div class="chat">' + user() + assistant() + '</div></div></div></div>');
    await load();
    const side = doc.querySelector('.sc-body');
    expect(doc.querySelectorAll('.panes .okw-message-time')).toHaveLength(2);
    expect(side.querySelector('.okw-message-time')).toBeNull();
    await load('/api/v1/sessions/A/transcript?agent_id=side1');
    await load('/api/v1/sessions/A/transcript?agent_id=side2');
    expect(side.querySelector('.okw-message-time')).toBeNull();
    expect(doc.querySelector('.panes .a-time').title).toBe(full(ended));
  });

  it('reuses the Symbol installation and restores on back/forward navigation without duplicates', async () => {
    const { view, doc, load } = install();
    const fetch = view.fetch;
    const history = view.history.pushState;
    view.eval(`(() => { const location = window.__fixtureLocation; ${source}\n })()`);
    expect(view.fetch).toBe(fetch);
    expect(view.history.pushState).toBe(history);
    await load();
    doc.querySelector('.msg-time').click();
    expect(doc.querySelector('.msg-time').textContent).toBe(full(submitted));
    view.history.replaceState(null, '', '/sessions/B');
    view.dispatchEvent(new view.PopStateEvent('popstate'));
    await flush();
    expect(doc.querySelector('.okw-message-time')).toBeNull();
    expect(doc.querySelector('.okw-message-meta')).toBeNull();
  });
});

describe('scoped mutation processing', () => {
  it('enhances anchors appended after parsing, native metadata replacement and recycled exact IDs', async () => {
    const { doc, main, load } = install(undefined, '');
    await load();
    main.innerHTML = user() + assistant();
    await flush();
    expect(doc.querySelectorAll('.okw-message-time')).toHaveLength(2);
    doc.querySelector('.u-meta').innerHTML = '<span class="msg-time">Native replacement</span>';
    await flush();
    expect(doc.querySelector('.msg-time').textContent).toBe('Native replacement');
    expect(doc.querySelector('.msg-time').title).toBe(full(submitted));
    doc.querySelector('.u-bub').dataset.turnId = 'unknown';
    await flush();
    expect(doc.querySelector('.msg-time').classList.contains('okw-message-time')).toBe(false);
    expect(doc.querySelector('.msg-time').hasAttribute('title')).toBe(false);
  });

  it('does not rescan anchors or message bodies for streaming text mutations and converges with real observers', async () => {
    const { view, doc, main, load, count } = install();
    await load();
    const query = vi.spyOn(view.Element.prototype, 'querySelectorAll');
    main.querySelector('.msg').firstChild.data = 'a characterData-only update';
    for (let i = 0; i < 100; i += 1) {
      const block = doc.createElement('span');
      block.textContent = 'stream';
      main.querySelector('.msg').append(block);
    }
    await flush();
    expect(query).not.toHaveBeenCalled();
    expect(count()).toBeLessThan(20);
    const settled = count();
    await flush();
    expect(count()).toBe(settled);
    expect(doc.querySelectorAll('.okw-message-time')).toHaveLength(2);
  });
});
