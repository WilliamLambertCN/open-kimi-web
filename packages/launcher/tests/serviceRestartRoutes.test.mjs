import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { serveRestart } from '../src/restart/routes.mjs';

function response() {
  const res = Object.assign(new EventEmitter(), { destroyed: false, writableFinished: false });
  res.end = vi.fn(() => res);
  res.writeHead = vi.fn(() => res);
  return res;
}

function request() {
  return { url: '/__open-kimi-mobile/service/restart', method: 'POST',
    headers: {}, socket: {} };
}

describe('restart response delivery failures', () => {
  it('cancels or completes the accepted operation when response headers cannot be written', async () => {
    const res = response(); const req = request();
    const control = { reserve: vi.fn(async () => ({ instance: 'fixture', phase: 'restarting' })),
      cancel: vi.fn(), commit: vi.fn(async () => {}) };
    res.writeHead.mockImplementationOnce(() => { throw new Error('fictional socket failed'); });
    expect(await serveRestart(req, res, control)).toBe(true);
    expect(control.cancel).toHaveBeenCalledOnce(); expect(control.commit).not.toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenLastCalledWith(503, expect.any(Object));
  });

  it('notifies the controller of a response socket closing before it finished', async () => {
    const res = response(); const req = request();
    const control = { reserve: vi.fn(async () => ({ instance: 'fixture', phase: 'restarting' })),
      cancel: vi.fn(), commit: vi.fn(async () => {}) };
    res.end.mockImplementationOnce(() => { res.destroyed = true; res.emit('close'); return res; });
    expect(await serveRestart(req, res, control)).toBe(true);
    expect(control.cancel).toHaveBeenCalledOnce(); expect(control.commit).not.toHaveBeenCalled();
  });
});
