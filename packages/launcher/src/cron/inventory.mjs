import { assertCronReadVersion } from './compatibility.mjs';
import { CronClientError } from './errors.mjs';
import { createScanBudget, readCronServerJournal, readCronWire, safeCronPathId } from './journal.mjs';
import { readLoadedSessions } from './loadedSessions.mjs';
import { createCronProjection } from './projection.mjs';
import { loopbackOrigin, requestJson } from './transport.mjs';
import { strictRecord, validateOperation } from './validation.mjs';

const PAGE_SIZE = 20;
const MAX_CURSOR_BYTES = 4096;
const META_PATH = '/api/v1/meta';
const recordOf = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const displayText = (value, max) => typeof value === 'string' && value.length <= max &&
  value.isWellFormed() && !value.includes('\0');
const safeText = (value, max = 1024) => displayText(value, max) && !/[\r\n]/.test(value);
const safeCursor = (value) => safeText(value, MAX_CURSOR_BYTES) && value.length > 0 &&
  Buffer.byteLength(value, 'utf8') <= MAX_CURSOR_BYTES;

function validateArgs(input, history = false) {
  if (history) {
    const args = validateOperation(input);
    if (!safeCronPathId(args.sessionId)) throw new CronClientError('invalid-input');
    return args;
  }
  const args = strictRecord(input, ['authorization', 'cursor'], ['authorization']);
  validateOperation({ sessionId: 'cron-inventory', authorization: args.authorization });
  if (args.cursor !== undefined && !safeCursor(args.cursor)) {
    throw new CronClientError('invalid-input');
  }
  return args;
}

async function runtimeVersion(context, authorization) {
  return assertCronReadVersion(await requestJson(context.fetchImpl, context.origin + META_PATH, authorization));
}

function directoryUrl(origin, cursor, version) {
  const unified = version === '2.7.2';
  const url = new URL(unified ? '/api/v1/sessions' : '/api/v2/sessions', origin);
  url.searchParams.set(unified ? 'archived' : 'meta.archived', 'all');
  url.searchParams.set('page_size', String(PAGE_SIZE));
  if (unified) url.searchParams.set('sort', 'created_at_desc');
  if (cursor !== undefined) url.searchParams.set('page_token', cursor);
  return url;
}

function validDomains(item) {
  if (!recordOf(item.meta) || !recordOf(item.activity)) return false;
  const { title, archived } = item.meta;
  const { model } = item.activity;
  return typeof archived === 'boolean' && (title === null || displayText(title, 16 * 1024)) &&
    (model === null || safeText(model));
}

function validateDirectoryItem(item) {
  if (!recordOf(item) || !safeCronPathId(item.id) || !safeCronPathId(item.workspace?.id) || !validDomains(item)) {
    throw new CronClientError('invalid-response');
  }
  return item;
}

function unifiedDirectoryItem(item) {
  if (!recordOf(item) || !safeCronPathId(item.id) || !safeCronPathId(item.workspace_id) ||
      !displayText(item.cwd, 16 * 1024) || !displayText(item.title, 16 * 1024) || typeof item.archived !== 'boolean') {
    throw new CronClientError('invalid-response');
  }
  return { id: item.id, workspace: { id: item.workspace_id, cwd: item.cwd },
    meta: { title: item.title, archived: item.archived }, activity: { model: null } };
}

function validateUnifiedPage(data, cursor) {
  if (!Number.isSafeInteger(data.total) || data.total < data.items.length) throw new CronClientError('invalid-response');
  if (data.has_more && (!data.items.length || data.next_page_token === cursor)) {
    throw new CronClientError('invalid-response');
  }
}

function directoryItems(data) {
  if (!recordOf(data) || !Array.isArray(data.items) || data.items.length > PAGE_SIZE ||
      typeof data.has_more !== 'boolean') throw new CronClientError('invalid-response');
  return data.items;
}

function validateDirectory(data, version, cursor) {
  const rows = directoryItems(data);
  if (data.has_more && !safeCursor(data.next_page_token)) {
    throw new CronClientError('invalid-response');
  }
  if (version === '2.7.2') validateUnifiedPage(data, cursor);
  const items = rows.map(version === '2.7.2' ? unifiedDirectoryItem : validateDirectoryItem);
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new CronClientError('invalid-response');
  return { items, hasMore: data.has_more, cursor: data.has_more ? data.next_page_token : null,
    ...(version === '2.7.2' ? { total: data.total } : {}) };
}

function workspaceName(workspace) {
  if (typeof workspace.cwd !== 'string') return workspace.id;
  const name = workspace.cwd.split(/[\\/]/).filter(Boolean).at(-1);
  return safeText(name, 256) && name.length > 0 && !name.includes(':') ? name : workspace.id;
}

function qualityOf(...qualities) {
  const reasons = [...new Set(qualities.flatMap((quality) => quality.reasons))];
  return { complete: reasons.length === 0, reasons };
}

async function projectWire(context, item, version, budget, withHistory = false) {
  const projection = createCronProjection({ version, budget, withHistory });
  const wire = await readCronWire({
    home: context.home, workspaceId: item.workspace.id, sessionId: item.id, budget, consume: projection.consume,
  });
  return { projection, wire };
}

async function inventoryItem(context, item, version, loaded, budget) {
  const { projection, wire } = await projectWire(context, item, version, budget);
  const data = projection.result();
  const liveModel = loaded?.has(item.id) === true && safeText(item.activity.model) && item.activity.model.length > 0;
  const model = liveModel ? item.activity.model : data.model;
  const quality = qualityOf(wire.quality, data.quality,
    { reasons: loaded === null ? ['live-list-invalid-shape'] : [] });
  return {
    id: item.id, title: item.meta.title ?? '', workspace: { id: item.workspace.id, name: workspaceName(item.workspace) },
    archived: item.meta.archived, loaded: loaded === null ? null : loaded.has(item.id),
    model, modelSource: liveModel ? 'live' : model === null ? 'unknown' : 'saved', tasks: data.tasks, quality,
  };
}

async function listSessions(context, args) {
  const version = await runtimeVersion(context, args.authorization);
  const directory = validateDirectory(await requestJson(context.fetchImpl,
    directoryUrl(context.origin, args.cursor, version), args.authorization), version, args.cursor);
  const loaded = await readLoadedSessions(context.fetchImpl, context.origin, args.authorization);
  const budget = createScanBudget();
  const items = [];
  for (const item of directory.items) items.push(await inventoryItem(context, item, version, loaded, budget));
  return { ...directory, items };
}

function unavailable(reason) {
  return { available: false, items: [], hasMore: false, quality: { complete: false, reasons: [reason] } };
}

async function readHistory(context, args) {
  const version = await runtimeVersion(context, args.authorization);
  const suffix = version === '2.7.2' ? '' : '/profile';
  const session = await requestJson(context.fetchImpl,
    `${context.origin}/api/v1/sessions/${encodeURIComponent(args.sessionId)}${suffix}`, args.authorization);
  if (!recordOf(session) || session.id !== args.sessionId || !safeCronPathId(session.workspace_id)) {
    throw new CronClientError('invalid-response');
  }
  const budget = createScanBudget();
  const item = { id: session.id, workspace: { id: session.workspace_id } };
  const { projection, wire } = await projectWire(context, item, version, budget, true);
  const server = await readCronServerJournal({
    home: context.home, sessionId: item.id, budget,
    consume: (record) => projection.consumeServer(record, item.id),
  });
  const data = projection.result();
  return {
    available: wire.available || server.available, items: data.items, hasMore: data.hasMore,
    quality: qualityOf(wire.quality, server.quality, data.quality),
  };
}

export function createCronInventory(options) {
  strictRecord(options, ['home', 'target', 'fetchImpl'], ['target']);
  const origin = loopbackOrigin(options.target);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new CronClientError('invalid-input');
  if (options.home !== undefined && options.home !== null && typeof options.home !== 'string') {
    throw new CronClientError('invalid-input');
  }
  const context = { origin, fetchImpl, home: options.home };
  return Object.freeze({
    async sessions(input) {
      const args = validateArgs(input);
      return context.home ? listSessions(context, args) : Promise.resolve(unavailable('home-unavailable'));
    },
    async history(input) {
      const args = validateArgs(input, true);
      return context.home ? readHistory(context, args) : Promise.resolve(unavailable('home-unavailable'));
    },
  });
}
