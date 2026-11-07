import { describe, expect, it } from 'vitest';

import { transcriptProxyPath } from '../src/transcriptPaging.mjs';

const path = '/api/v1/sessions/qa-session_1/transcript';
const query = '?agent_id=main&page_size=10';
const context = { officialPresentation: true, officialWebVersion: '2.4.1' };
const request = (url = path + query, extra = {}) => ({ method: 'GET', headers: {}, url, ...extra });

describe('initial main transcript page budget', () => {
  it.each(['2.3.1', '2.4.1'])('uses one complete turn for enhanced exact %s', (officialWebVersion) => {
    const req = request();
    expect(transcriptProxyPath(req, { ...context, officialWebVersion })).toBe(path + '?agent_id=main&page_size=1');
    expect(req.url).toBe(path + query);
  });

  it('accepts the two unambiguous raw parameter orders without rewriting the order', () => {
    const req = request(path + '?page_size=10&agent_id=main');
    expect(transcriptProxyPath(req, context)).toBe(path + '?page_size=1&agent_id=main');
  });

  it.each(['2.1.1', '2.3.0', '2.3.2', '2.4.0', '2.4.2', '2.4.1-r1', '', undefined])(
    'leaves unverified version %s transparent', (officialWebVersion) => {
      const req = request();
      expect(transcriptProxyPath(req, { ...context, officialWebVersion })).toBe(req.url);
    },
  );

  it.each([false, undefined, 'true'])('requires an explicitly enhanced official UI (%s)', (officialPresentation) => {
    const req = request();
    expect(transcriptProxyPath(req, { ...context, officialPresentation })).toBe(req.url);
  });

  it.each(['POST', 'HEAD', 'PUT', 'DELETE', undefined])('preserves method %s', (method) => {
    const req = request(undefined, { method });
    expect(transcriptProxyPath(req, context)).toBe(req.url);
  });

  it.each(['bytes=0-100', ''])('preserves Range %s', (range) => {
    const req = request(undefined, { headers: { range } });
    expect(transcriptProxyPath(req, context)).toBe(req.url);
  });

  it.each([
    '', '?page_size=10', '?agent_id=main', '?agent_id=child&page_size=10', '?agent_id=main&page_size=1',
    '?agent_id=main&page_size=100', '?agent_id=main&page_size=010', '?agent_id=main&page_size=10&before_turn=2',
    '?agent_id=main&page_size=10&after_turn=2', '?agent_id=main&page_size=10&before_turn=',
    '?agent_id=main&page_size=10&unknown=1', '?agent_id=main&agent_id=main&page_size=10',
    '?agent_id=main&page_size=10&page_size=10', '?agent_id=%6dain&page_size=10', '?agent_id=main&page_size=%31%30',
    '?%61gent_id=main&page_size=10', '?agent_id=main&page_size=10&', '?agent_id=main&&page_size=10',
    '?agent_id=main&page_size=10#fragment', '?agent_id=main;page_size=10', '?agent_id=main&page_size=10?',
    '?agent_id=main&page_size=10\n', '?agent_id=main&page_size=10\r',
  ])('preserves non-exact raw query %s', (search) => {
    const req = request(path + search);
    expect(transcriptProxyPath(req, context)).toBe(req.url);
  });

  it.each([
    '/api/v1/sessions/qa%2Dsession/transcript', '/api/v1/sessions/../transcript',
    '/api/v1/sessions/qa.session/transcript', '/api/v1/sessions//transcript',
    '/api/v1/sessions/qa/session/transcript', '/api/v1/sessions/qa/transcript/',
    '/api/v1/sessions/qa/transcript/plan', '/api/v2/sessions/qa/transcript',
    '/api/v1//sessions/qa/transcript', '/api/v1/sessions/qa/./transcript',
  ])('preserves non-canonical pathname %s', (pathname) => {
    const req = request(pathname + query);
    expect(transcriptProxyPath(req, context)).toBe(req.url);
  });

  it('preserves a missing request URL', () => {
    expect(transcriptProxyPath(request(undefined, { url: undefined }), context)).toBeUndefined();
  });
});
