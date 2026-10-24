import { describe, expect, it, vi } from 'vitest';
import { assertCronBackend } from '../src/cron/guard.mjs';

const target = 'http://127.0.0.1:23456';
const authorization = 'Bearer fictional-guard-token';
const meta = { server_version: '2.2.0', backend: 'v2', dangerous_bypass_auth: false };

function fixture(state = { enabled: false, state: 'off' }) {
  const fetchImpl = vi.fn(async (url) => Response.json({
    code: 0, data: url.pathname === '/api/v1/meta' ? meta : state,
  }));
  return { fetchImpl, options: { target, authorization, fetchImpl } };
}

describe('fixed Cron backend guard', () => {
  it('returns exact read-only 2.3.1 after the same authenticated RC-off check', async () => {
    const { options, fetchImpl } = fixture();
    fetchImpl.mockImplementation(async (url) => Response.json({ code: 0,
      data: url.pathname === '/api/v1/meta' ? { ...meta, server_version: '2.3.1' } : { enabled: false, state: 'off' },
    }));
    await expect(assertCronBackend(options)).resolves.toBe('2.3.1');
    expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/v1/meta', '/api/v1/remote-control']);
    expect(fetchImpl.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
  });

  it('retains same-instance RC refusal on read-only 2.3.1', async () => {
    const { options, fetchImpl } = fixture();
    fetchImpl.mockImplementation(async (url) => Response.json({ code: 0,
      data: url.pathname === '/api/v1/meta' ? { ...meta, server_version: '2.3.1' } : { enabled: true, state: 'on' },
    }));
    await expect(assertCronBackend(options)).rejects.toMatchObject({ code: 'unsafe-backend' });
    expect(fetchImpl.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
  });

  it('checks authenticated metadata then only the fixed RC GET, without debug or state mutations', async () => {
    const { options, fetchImpl } = fixture();
    await expect(assertCronBackend(options)).resolves.toBe('2.2.0');
    expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/v1/meta', '/api/v1/remote-control']);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init.method).toBe('GET');
      expect(init.headers.authorization).toBe(authorization);
      expect(init.redirect).toBe('manual');
      expect(init.body).toBeUndefined();
    }
  });

  it.each([
    { enabled: true, state: 'on' }, { enabled: false, state: 'starting' },
    { enabled: false, state: 'stopping' }, { enabled: false, state: 'conflict' },
    { enabled: false, state: 'off', conflict: { device_id: 'fictional-conflict' } },
    { enabled: false, state: 'off', url: 'https://example.test/private' },
    { enabled: false, state: 'off', device_id: 'fictional-device' },
  ])('refuses active/conflicting/residual RC state %# and notifies only once', async (state) => {
    const { options } = fixture(state);
    const onUnsafeBackend = vi.fn(() => { throw new Error('PRIVATE callback details'); });
    for (let i = 0; i < 2; i += 1) {
      await expect(assertCronBackend({ ...options, onUnsafeBackend })).rejects.toMatchObject({ code: 'unsafe-backend' });
    }
    expect(onUnsafeBackend).toHaveBeenCalledOnce();
  });

  it.each([
    null, [], {}, { enabled: 'false', state: 'off' }, { enabled: false, state: 'unknown' },
    { enabled: false, state: 'off', url: null }, { enabled: false, state: 'off', device_id: 1 },
  ])('fails closed on unknown RC shapes %#', async (state) => {
    const { options } = fixture(state);
    await expect(assertCronBackend(options)).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('permits empty native optional identifiers and old diagnostic error without returning them', async () => {
    const { options } = fixture({ enabled: false, state: 'off', url: '', device_id: '', error: 'PRIVATE previous error' });
    await expect(assertCronBackend(options)).resolves.toBe('2.2.0');
  });

  it('validates current authorization and version before querying RC', async () => {
    const { options, fetchImpl } = fixture();
    await expect(assertCronBackend({ ...options, authorization: '' })).rejects.toMatchObject({ code: 'unauthorized' });
    expect(fetchImpl).not.toHaveBeenCalled();
    fetchImpl.mockImplementation(async () => Response.json({ code: 0, data: { ...meta, server_version: '2.2.1' } }));
    await expect(assertCronBackend(options)).rejects.toMatchObject({ code: 'unsupported-version' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('never returns upstream error/token/data when the RC operation fails', async () => {
    const { options, fetchImpl } = fixture();
    fetchImpl.mockImplementation(async (url) => Response.json(url.pathname === '/api/v1/meta'
      ? { code: 0, data: meta } : { code: 50001, msg: 'PRIVATE secret', data: { error: authorization } }));
    const error = await assertCronBackend(options).catch((value) => value);
    expect(error.code).toBe('upstream-business');
    expect(error.message).not.toContain('PRIVATE');
    expect(error.message).not.toContain(authorization);
    expect(error.cause).toBeUndefined();
  });
});
