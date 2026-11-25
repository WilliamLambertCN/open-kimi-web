import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { patchOfficialSessionMedia } from '../src/officialSessionMedia.mjs';
import { sessionMediaFixture as source } from './testkit/officialSessionMedia.mjs';

function setup(text = source) {
  const result = patchOfficialSessionMedia(text, '2.7.2');
  expect(result.patched).toBe(true);
  const Router = runInNewContext(result.text + '\nRouter');
  const local = {
    getSessionMediaUrl: vi.fn((id, file) => `local/${id}/${file}`),
    getFileDownloadUrl: vi.fn((id, file) => `local/${id}/${file}`),
    getSessionMediaBlob: vi.fn(() => Promise.resolve('local blob')),
    findSession: vi.fn(),
  };
  const remote = {
    getSessionMediaUrl: vi.fn((id, file) => `remote/${id}/${file}`),
    getFileDownloadUrl: vi.fn((id, file) => `remote/${id}/${file}`),
    getSessionMediaBlob: vi.fn(() => Promise.resolve('remote blob')),
  };
  return { router: new Router(local, remote), local, remote };
}

describe('official session media routing', () => {
  it.each(['getSessionMediaUrl', 'getFileDownloadUrl'])('%s is synchronous for known local and remote sessions', (method) => {
    const { router, local, remote } = setup();
    router.sessionHost.set('local-session', null);
    router.sessionHost.set('remote-session', 'remote');
    expect(router.call(method, 'local-session', 'file')).toBe('local/local-session/file');
    expect(router.call(method, 'remote-session', 'file')).toBe('remote/remote-session/file');
    expect(local.findSession).not.toHaveBeenCalled();
    expect(remote[method]).toHaveBeenCalledOnce();
  });

  it.each(['getSessionMediaUrl', 'getFileDownloadUrl'])(
    '%s falls back immediately and resolves an unknown remote owner', async (method) => {
    const { router, local } = setup();
    let resolve;
    local.findSession.mockReturnValue(new Promise((done) => { resolve = done; }));
    expect(router.call(method, 'new-session', 'file')).toBe('local/new-session/file');
    await vi.waitFor(() => expect(local.findSession).toHaveBeenCalledOnce());
    resolve({ id: 'new-session', hostId: 'remote' });
    await vi.waitFor(() => expect(router.sessionHost.get('new-session')).toBe('remote'));
    expect(router.call(method, 'new-session', 'file')).toBe('remote/new-session/file');
  });

  it('does not turn a failed background lookup into an unhandled rejection', async () => {
    const { router, local } = setup();
    local.findSession.mockRejectedValue(new Error('fictional lookup failure'));
    expect(router.call('getSessionMediaUrl', 'missing', 'file')).toBe('local/missing/file');
    await vi.waitFor(() => expect(local.findSession).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(router.lookups.size).toBe(0));
    expect(router.sessionHost.has('missing')).toBe(false);
  });

  it('keeps the original asynchronous routing for media blob requests', async () => {
    const { router, local, remote } = setup();
    local.findSession.mockResolvedValue({ id: 'remote-session', hostId: 'remote' });
    expect(await router.call('getSessionMediaBlob', 'remote-session', 'file')).toBe('remote blob');
    expect(remote.getSessionMediaBlob).toHaveBeenCalledOnce();
    expect(local.getSessionMediaBlob).not.toHaveBeenCalled();
  });

  it.each([
    [source, '2.7.3'],
    [source.replace('getFileDownloadUrl:"session"', 'getFileDownloadUrl:"local"'), '2.7.2'],
    [source.replace('getSessionMediaUrl:"session"', 'getSessionMediaUrl:"local"'), '2.7.2'],
    [source + source, '2.7.2'],
    [source.replace('this.dispatchUnknownSession(t,n,o)', 'this.otherDispatch(t,n,o)'), '2.7.2'],
    [source.replace('async ownerOf(t)', 'async differentOwner(t)'), '2.7.2'],
    [source + ';const existing="sessionSync";', '2.7.2'],
  ])('leaves unknown or ambiguous upstream structures entirely unchanged %#', (text, version) => {
    expect(patchOfficialSessionMedia(text, version)).toEqual({ text, patched: false });
  });
});
