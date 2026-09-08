import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { discoverModels, parseModelIds, serveModelDiscovery } from '../src/modelDiscovery.mjs';

function request(body, authorization = 'Bearer page-token') {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = 'POST';
  req.url = '/__open-kimi-mobile/models:discover';
  req.headers = authorization ? { authorization } : {};
  return req;
}

function response() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
      return this;
    },
    end(body = '') {
      this.body = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
    },
  };
}

describe('model discovery payloads', () => {
  it('accepts the common model-list response shapes and removes duplicates', () => {
    expect(parseModelIds({ data: [{ id: 'alpha' }, { id: 'alpha' }, { id: 'beta' }] })).toEqual(['alpha', 'beta']);
    expect(parseModelIds({ models: [{ name: 'gamma' }, 'delta'] })).toEqual(['gamma', 'delta']);
    expect(parseModelIds(['epsilon', { id: 'zeta' }])).toEqual(['epsilon', 'zeta']);
  });

  it('uses the protocol-specific credential header without following redirects', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: [{ id: 'alpha' }] }));
    await expect(discoverModels({
      baseUrl: 'https://example.invalid/v1/',
      apiKey: 'provider-key',
      type: 'anthropic',
      fetchImpl,
    })).resolves.toEqual(['alpha']);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url.href).toBe('https://example.invalid/v1/models');
    expect(init.redirect).toBe('manual');
    expect(init.headers).toMatchObject({
      'x-api-key': 'provider-key',
      'anthropic-version': '2023-06-01',
    });
    expect(init.headers.authorization).toBeUndefined();
  });

  it('allows anonymous model endpoints without sending a provider credential', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: [{ id: 'anonymous-model' }] }));
    await expect(discoverModels({
      baseUrl: 'http://127.0.0.1:8080/v1',
      apiKey: '',
      fetchImpl,
    })).resolves.toEqual(['anonymous-model']);

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers).toEqual({ accept: 'application/json' });
  });

  it('rejects a declared model response larger than the configured limit', async () => {
    const fetchImpl = vi.fn(async () => Response.json([], {
      headers: { 'content-length': String(1024 * 1024 + 1) },
    }));
    await expect(discoverModels({
      baseUrl: 'https://example.invalid/v1',
      fetchImpl,
    })).rejects.toThrow('响应过大');
  });
});

describe('model discovery route', () => {
  it('requires a valid page authorization before contacting a provider endpoint', async () => {
    const fetchImpl = vi.fn();
    const res = response();
    await expect(serveModelDiscovery(
      request({ base_url: 'https://example.invalid/v1', api_key: 'provider-key' }, ''),
      res,
      'http://127.0.0.1:1',
      fetchImpl,
    )).resolves.toBe(true);
    expect(res.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(res.body).not.toContain('provider-key');
  });

  it('validates the page token, then returns only normalized model ids', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: 'alpha' }, { id: 'beta' }] }));
    const res = response();
    await serveModelDiscovery(
      request({
        base_url: 'https://example.invalid/v1',
        api_key: 'provider-key',
        type: 'openai_responses',
      }),
      res,
      'http://127.0.0.1:1',
      fetchImpl,
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ models: ['alpha', 'beta'] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0].pathname).toBe('/api/v1/meta');
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe('Bearer page-token');
    expect(fetchImpl.mock.calls[1][0].href).toBe('https://example.invalid/v1/models');
    expect(fetchImpl.mock.calls[1][1].headers.authorization).toBe('Bearer provider-key');
    expect(res.body).not.toContain('provider-key');
    expect(res.body).not.toContain('page-token');
  });

  it('rejects redirects instead of forwarding credentials to another origin', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: 'https://other.invalid/models' },
      }));
    const res = response();
    await serveModelDiscovery(
      request({ base_url: 'https://example.invalid/v1', api_key: 'provider-key' }),
      res,
      'http://127.0.0.1:1',
      fetchImpl,
    );

    expect(res.status).toBe(502);
    expect(JSON.parse(res.body).error).toContain('重定向');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
