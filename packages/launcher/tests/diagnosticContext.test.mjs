import { describe, expect, it, vi } from 'vitest';
import { requestFields } from '../src/diagnosticContext.mjs';

function fields(url, method = 'GET', upstream = url) {
  const log = { tag: vi.fn(() => '1234567890abcdef') };
  const req = { url, method, socket: { remoteAddress: 'fictional-client-marker' } };
  return { result: requestFields(log, 17, req, upstream), log };
}

const transcript = '/api/v1/sessions/fictional-session-marker/transcript';

describe('diagnostic request identity', () => {
  it.each([
    ['/', 'index'], ['/index.html', 'index'], ['/assets/secret-file-name.js', 'static'],
    ['/api/v1/meta', 'meta'], ['/api/v1/healthz', 'health'], ['/api/v1/config', 'config'],
    ['/api/v1/models', 'models'], ['/api/v1/workspaces', 'workspaces'],
    ['/api/v1/workspaces/private-workspace', 'workspaces'], ['/api/v1/search?query=secret', 'search'],
    ['/api/v1/sessions', 'sessions'], ['/api/v2/sessions', 'sessions'],
    ['/api/v1/sessions/private-session', 'session'], [transcript, 'transcript'],
    ['/api/v1/fs/private/path:download', 'files'], ['/api/v1/ws?client_id=private', 'ws'],
    ['/__open-kimi-mobile/usage', 'usage'], ['/__open-kimi-mobile/usage/report', 'usage'],
    ['/__open-kimi-mobile/cron', 'cron'], ['/__open-kimi-mobile/cron/sessions/private', 'cron'],
    ['/__open-kimi-mobile/session-size?id=private', 'extension'],
    ['/private/path', 'other'], ['/api/v1/%73essions/private/transcript', 'other'],
  ])('classifies %s without exposing its path', (url, route) => {
    expect(fields(url).result.route).toBe(route);
    expect(JSON.stringify(fields(url).result)).not.toContain(url);
  });

  it('preserves only bounded paging facts', () => {
    const { result, log } = fields(`${transcript}?page_size=10&agent_id=main`, 'GET',
      `${transcript}?page_size=1&agent_id=main`);
    expect(result).toEqual({ id: 17, clientTag: '1234567890abcdef', sessionTag: '1234567890abcdef',
      method: 'GET', route: 'transcript', main: true, before: false, after: false,
      pageSize: 10, upstreamPageSize: 1, pagingApplied: true });
    expect(log.tag).toHaveBeenCalledWith('session', 'fictional-session-marker');
    expect(log.tag).toHaveBeenCalledWith('client', 'fictional-client-marker');
    expect(JSON.stringify(result)).not.toContain('fictional');
  });

  it.each(['page_size=10&page_size=12', 'page_size=private', 'page_size=-10', 'page_size=9999999', ''])
  ('does not serialize ambiguous or invalid page sizes: %s', (query) => {
    const { result } = fields(`${transcript}?${query}&before_turn=private&after_turn=private`);
    expect(result).toMatchObject({ before: true, after: true, main: false, pagingApplied: false });
    expect(result.pageSize).toBeUndefined();
    expect(result.upstreamPageSize).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('does not treat duplicate main agents as unambiguous', () => {
    expect(fields(`${transcript}?agent_id=main&agent_id=main`).result.main).toBe(false);
  });

  it('tolerates missing request metadata and does not emit arbitrary methods', () => {
    expect(requestFields({ tag: () => '1234567890abcdef' }, 1, {})).toMatchObject({ route: 'other', method: 'other' });
    expect(fields('/', 'SECRET_METHOD').result.method).toBe('other');
    expect(fields('/', 'POST').result.method).toBe('POST');
  });
});
