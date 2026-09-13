import { describe, expect, it } from 'vitest';

import {
  archivedItemV2,
  archivedResponseV2,
  deferred,
  FakeSidebarRow,
  install,
  settleObservation,
} from './testkit/archivedSessionDeleteUi.mjs';

describe('archived session delete UI', () => {
  it('adds direct delete buttons in settings and the completed sidebar list', async () => {
    const ui = await install();
    expect(ui.remove).toBeDefined();
    expect(ui.sidebarRemove).toBeDefined();
    expect(ui.card.row.querySelector('.okw-archive-more')).toBeNull();
    expect(ui.card.row.querySelector('.okw-archive-menu')).toBeNull();

    const legacyList = await install({ apiVersion: 'v1' });
    expect(legacyList.remove).toBeDefined();
  });

  it('adds no delete button to ordinary or API-unconfirmed sessions', async () => {
    const ordinary = new FakeSidebarRow('Archived title', { completed: false });
    const unarchived = await install({ archived: false, sidebarRows: [ordinary] });
    expect(unarchived.remove).toBeUndefined();
    expect(unarchived.sidebarRemove).toBeNull();
  });

  it('adds the sidebar button when a completed row appears after the API response', async () => {
    const ui = await install({ sidebarRows: [] });
    const lateRow = new FakeSidebarRow();
    ui.sidebarRows.push(lateRow);
    ui.mutate();

    expect(lateRow.querySelector('.okw-sidebar-archive-delete')).not.toBeNull();
  });

  it('uses the official persisted locale before the browser language', async () => {
    const chinese = await install({ locale: 'zh', navigatorLanguage: 'en-US' });
    expect(chinese.remove.textContent).toBe('永久删除');
    expect(chinese.sidebarRemove.textContent).toBe('删除');

    const english = await install({ locale: 'en', navigatorLanguage: 'zh-CN' });
    expect(english.remove.textContent).toBe('Delete permanently');
  });

  it('refreshes existing button copy after the official locale changes', async () => {
    const ui = await install({ locale: 'en' });
    ui.setLocale('zh');
    ui.mutate();

    expect(ui.remove.textContent).toBe('永久删除');
    expect(ui.sidebarRemove.textContent).toBe('删除');
    expect(ui.remove.attributes.get('aria-label')).toBe('永久删除');
  });
});
describe('archived session matching safety', () => {
  it('does not bind one DOM row when the API has two sessions with the same visible key', async () => {
    const ui = await install({
      apiItems: [archivedItemV2('session_one'), archivedItemV2('session_two')],
    });
    expect(ui.card.row.querySelector('.okw-archive-actions')).toBeNull();
    expect(ui.sidebarRows[0].querySelector('.okw-sidebar-archive-delete')).toBeNull();
  });

  it('does not bind two DOM rows to one API session with the same visible key', async () => {
    const ui = await install({ rowCount: 2 });
    expect(ui.card.rows.every((row) => row.querySelector('.okw-archive-actions') === null)).toBe(true);
  });

  it('removes an old action when the official DOM reuses a row for different content', async () => {
    const ui = await install();
    expect(ui.card.row.querySelector('.okw-archive-actions')).not.toBeNull();

    ui.card.row.title.textContent = 'Different archived title';
    ui.mutate();

    expect(ui.card.row.querySelector('.okw-archive-actions')).toBeNull();
  });

  it('replaces one v2 page snapshot and drops sessions no longer archived there', async () => {
    let requestCount = 0;
    const ui = await install({
      apiItems: () => requestCount++ === 0
        ? [archivedItemV2('session_archived')]
        : [archivedItemV2('session_archived', { archived: false })],
    });
    expect(ui.card.row.querySelector('.okw-archive-actions')).not.toBeNull();

    const refresh = ui.window.fetch(ui.archivedUrl, { headers: { authorization: 'Bearer page-token' } });
    expect(ui.card.row.querySelector('.okw-archive-actions')).toBeNull();
    await refresh;
    await new Promise((resolve) => setTimeout(resolve, 0));
    ui.mutate();

    expect(ui.card.row.querySelector('.okw-archive-actions')).toBeNull();
  });

  it('retains a session referenced by another v2 page snapshot', async () => {
    const ui = await install({
      apiItems: (url) => url.includes('cursor=next')
        ? [archivedItemV2('session_next', { title: 'Another title' })]
        : [archivedItemV2('session_archived')],
    });
    const nextPage = `${ui.archivedUrl}&cursor=next`;
    await ui.window.fetch(nextPage, { headers: { authorization: 'Bearer page-token' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    ui.mutate();

    expect(ui.card.row.querySelector('.okw-archive-actions')).not.toBeNull();
  });

  it('does not bind a replacement session that has the same visible key as a stale row', async () => {
    let requestCount = 0;
    const ui = await install({
      apiItems: () => [archivedItemV2(requestCount++ === 0 ? 'session_old' : 'session_new')],
    });

    await ui.window.fetch(ui.archivedUrl, { headers: { authorization: 'Bearer page-token' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    ui.mutate();

    expect(ui.card.row.querySelector('.okw-archive-actions')).toBeNull();
  });
});

describe('archived session list cache failures', () => {
  it('does not restore an old action after a refresh network failure', async () => {
    const ui = await install();
    ui.nativeFetch.mockRejectedValueOnce(new Error('offline'));

    await expect(ui.window.fetch(ui.archivedUrl, {
      headers: { authorization: 'Bearer page-token' },
    })).rejects.toThrow('offline');
    ui.mutate();

    expect(ui.card.row.querySelector('.okw-archive-actions')).toBeNull();
  });

  it('does not restore an old action after a refresh HTTP failure', async () => {
    const ui = await install();
    ui.nativeFetch.mockResolvedValueOnce(new Response('Unavailable', { status: 503 }));

    await ui.window.fetch(ui.archivedUrl, { headers: { authorization: 'Bearer page-token' } });
    await settleObservation();
    ui.mutate();

    expect(ui.card.row.querySelector('.okw-archive-actions')).toBeNull();
  });

  it('ignores an older response that arrives after a newer request for the same page', async () => {
    const ui = await install();
    const older = deferred();
    const newer = deferred();
    ui.nativeFetch.mockImplementationOnce(() => older.promise);
    ui.nativeFetch.mockImplementationOnce(() => newer.promise);

    const olderRequest = ui.window.fetch(ui.archivedUrl, { headers: { authorization: 'Bearer page-token' } });
    const newerRequest = ui.window.fetch(ui.archivedUrl, { headers: { authorization: 'Bearer page-token' } });
    newer.resolve(archivedResponseV2(true, [archivedItemV2('session_archived')]));
    await newerRequest;
    await settleObservation();
    older.resolve(archivedResponseV2(true, [archivedItemV2('session_older', { title: 'Older title' })]));
    await olderRequest;
    await settleObservation();
    ui.mutate();

    expect(ui.card.row.querySelector('.okw-archive-actions')).not.toBeNull();
  });
});

describe('archived session delete interactions', () => {
  it('cancels without a request and deletes only after explicit title confirmation', async () => {
    const cancelled = await install({ confirm: false });
    cancelled.remove.dispatch('click');
    await Promise.resolve();
    expect(cancelled.window.confirm).toHaveBeenCalledWith(expect.stringContaining('Archived title'));
    expect(cancelled.nativeFetch).toHaveBeenCalledTimes(1);
    expect(cancelled.card.row.removed).toBe(false);
    expect(cancelled.window.location.reload).not.toHaveBeenCalled();

    const confirmed = await install();
    confirmed.remove.dispatch('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(confirmed.nativeFetch).toHaveBeenCalledTimes(2);
    expect(confirmed.card.row.removed).toBe(true);
    expect(confirmed.sidebarRows[0].removed).toBe(true);
    expect(confirmed.window.location.reload).toHaveBeenCalledTimes(1);
    expect(confirmed.nativeFetch).toHaveBeenLastCalledWith(
      '/api/v1/sessions/session_archived:delete',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
  });

  it('prevents duplicate requests across both direct buttons while deletion is pending', async () => {
    let resolveDelete;
    const pending = new Promise((resolve) => { resolveDelete = resolve; });
    const ui = await install({ deleteResponse: () => pending });
    ui.remove.dispatch('click');
    ui.remove.dispatch('click');
    ui.sidebarRemove.dispatch('click');
    expect(ui.nativeFetch).toHaveBeenCalledTimes(2);
    resolveDelete(new Response(JSON.stringify({ code: 0, data: null }), { status: 200 }));
    await settleObservation();
    expect(ui.window.location.reload).toHaveBeenCalledTimes(1);
  });

  it('accepts the official empty 204 success response', async () => {
    const ui = await install({ deleteResponse: () => new Response(null, { status: 204 }) });
    ui.remove.dispatch('click');
    await settleObservation();

    expect(ui.card.row.removed).toBe(true);
    expect(ui.window.location.reload).toHaveBeenCalledTimes(1);
  });
});

describe('archived session delete failures', () => {
  it('does not send deletion before page authorization is available', async () => {
    const ui = await install({ authorization: '' });
    ui.remove.dispatch('click');
    await settleObservation();

    expect(ui.nativeFetch).toHaveBeenCalledTimes(1);
    expect(ui.card.row.querySelector('.okw-archive-delete-error')?.textContent).toBe(
      'Page authorization is not ready. Refresh and try again.',
    );
  });

  it('shows authorization and official API messages without removing the row', async () => {
    const unauthorized = await install({
      deleteResponse: () => new Response(JSON.stringify({ code: 40100 }), { status: 401 }),
    });
    unauthorized.remove.dispatch('click');
    await settleObservation();
    expect(unauthorized.card.row.querySelector('.okw-archive-delete-error')?.textContent).toBe(
      'Page authorization is not ready. Refresh and try again.',
    );

    const rejected = await install({
      deleteResponse: () => new Response(JSON.stringify({ code: 40900, msg: 'Session is busy' }), {
        status: 409,
      }),
    });
    rejected.remove.dispatch('click');
    await settleObservation();
    expect(rejected.card.row.querySelector('.okw-archive-delete-error')?.textContent).toBe('Session is busy');
  });

  it('keeps the row and shows a readable error when deletion fails', async () => {
    const ui = await install({
      deleteResponse: () => new Response(JSON.stringify({ code: 50000 }), { status: 500 }),
    });
    ui.remove.dispatch('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ui.card.row.removed).toBe(false);
    expect(ui.card.row.querySelector('.okw-archive-delete-error')?.textContent).toBe(
      'Deletion failed. Refresh and try again.',
    );
    expect(ui.remove.disabled).toBe(false);
    expect(ui.window.location.reload).not.toHaveBeenCalled();
  });

  it('keeps the completed sidebar row and restores its direct button after failure', async () => {
    const ui = await install({
      deleteResponse: () => new Response(JSON.stringify({ code: 50000 }), { status: 500 }),
    });
    ui.sidebarRemove.dispatch('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ui.sidebarRows[0].removed).toBe(false);
    expect(ui.sidebarRows[0].querySelector('.okw-archive-delete-error')?.textContent).toBe(
      'Deletion failed. Refresh and try again.',
    );
    expect(ui.sidebarRemove.disabled).toBe(false);
    expect(ui.sidebarRemove.textContent).toBe('Delete');
    expect(ui.window.location.reload).not.toHaveBeenCalled();
  });
});
