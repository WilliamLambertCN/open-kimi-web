import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_LINE_BYTES = 1024 * 1024;
const MAX_FILES = 50_000;
const MAX_RECORDS_PER_FILE = 1_000_000;
const TOKEN_FIELDS = ['inputOther', 'inputCacheRead', 'inputCacheCreation', 'output'];
const QUALITY_LABELS = {
  badLines: '部分记录格式无效', oversizedLines: '部分记录过大',
  truncatedTail: '部分文件尾行未写完', unreadableFiles: '部分用量文件暂时不可读',
  limitedFiles: '达到扫描上限', inheritedRecords: '已排除 fork 继承的重复记录',
  missingForkSources: '部分 fork 来源会话已不存在',
  unknownForkSources: '部分 fork 来源信息不可确认',
  unresolvedModels: '部分调用的模型 ID 无法确认',
};

function safeId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 &&
    value !== '.' && value !== '..' && !/[\\/\0]/.test(value);
}

function safeModel(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\0\r\n]/.test(value);
}

async function directories(path) {
  try {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && safeId(entry.name));
  } catch {
    return null;
  }
}

function validUsageHeader(record, agentId) {
  return record?.type === 'usage.record' && record.agentId === agentId &&
    safeModel(record.model) && Number.isSafeInteger(record.time) && record.time >= 0;
}

function usageScopeOf(record) {
  return record.usageScope === 'turn' || record.usageScope === 'session' ? record.usageScope : null;
}

function parseUsage(record, agentId) {
  if (!validUsageHeader(record, agentId)) return null;
  const usage = record.usage;
  if (usage === null || typeof usage !== 'object') return null;
  const values = TOKEN_FIELDS.map((field) => usage[field]);
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) return null;
  return {
    time: record.time, alias: record.model,
    usageScope: usageScopeOf(record),
    inputOther: values[0], inputCacheRead: values[1],
    inputCacheCreation: values[2], output: values[3],
  };
}

function resetIdentity(state) {
  state.pending = { turn: new Map(), session: new Map() };
  state.tainted = { turn: false, session: false };
  state.taintedAliases = { turn: new Set(), session: new Set() };
}

function taintIdentity(state, scope) {
  for (const lane of scope ? [scope] : ['turn', 'session']) {
    state.pending[lane].clear();
    state.tainted[lane] = true;
  }
}

function validRequestIdentity(record, agentId) {
  return record.agentId === agentId && safeModel(record.modelAlias) &&
    safeModel(record.model) && safeModel(record.provider) &&
    Number.isSafeInteger(record.time) && record.time >= 0 &&
    (record.kind === 'loop' || record.kind === 'compaction');
}

function recordRequest(state, record, agentId) {
  if (!validRequestIdentity(record, agentId)) {
    taintIdentity(state);
    return;
  }
  const lane = record.kind === 'loop' ? 'turn' : 'session';
  if (state.tainted[lane] || state.taintedAliases[lane].has(record.modelAlias)) return;
  const current = state.pending[lane].get(record.modelAlias);
  if (current !== undefined && current.modelId !== record.model) {
    state.pending[lane].delete(record.modelAlias);
    state.taintedAliases[lane].add(record.modelAlias);
    return;
  }
  state.pending[lane].set(record.modelAlias, {
    modelId: record.model, count: (current?.count ?? 0) + 1,
  });
}

function identityForUsage(state, usage) {
  const lane = usage.usageScope;
  if (lane === null) return null;
  const pending = state.pending[lane];
  const current = pending.get(usage.alias);
  if (state.tainted[lane] || state.taintedAliases[lane].has(usage.alias) || current === undefined) return null;
  pending.delete(usage.alias);
  if (current.count > 1) state.taintedAliases[lane].add(usage.alias);
  return current.modelId;
}

function recordUsage(state, record, agentId) {
  const usage = parseUsage(record, agentId);
  if (usage === null) {
    state.badLines += 1;
    taintIdentity(state);
    return;
  }
  const modelId = identityForUsage(state, usage);
  if (usage.usageScope === null) taintIdentity(state);
  state.records.push({
    time: usage.time, alias: usage.alias, modelId,
    inputOther: usage.inputOther, inputCacheRead: usage.inputCacheRead,
    inputCacheCreation: usage.inputCacheCreation, output: usage.output,
  });
}

function isStepEnd(record, agentId) {
  return record?.type === 'context.append_loop_event' && record.agentId === agentId &&
    record.event?.type === 'step.end';
}

function consumeRecord(state, record, agentId) {
  if (record?.type === 'forked' && record.agentId === agentId) {
    state.forkAt = state.records.length;
    state.forked = true;
    resetIdentity(state);
    return;
  }
  if (record?.type === 'llm.request') recordRequest(state, record, agentId);
  if (record?.type === 'usage.record') recordUsage(state, record, agentId);
  if (isStepEnd(record, agentId)) {
    state.pending.turn.clear();
    state.tainted.turn = false;
    state.taintedAliases.turn.clear();
  }
}

function consumeLine(state, bytes, agentId) {
  if (bytes.length > MAX_LINE_BYTES) {
    state.oversizedLines += 1;
    taintIdentity(state);
    return;
  }
  if (bytes.length === 0) return;
  try {
    consumeRecord(state, JSON.parse(bytes.toString('utf8')), agentId);
  } catch {
    state.badLines += 1;
    taintIdentity(state);
  }
}

function appendFragment(state, fragment) {
  if (state.skipping || fragment.length === 0) return;
  if (state.line.length + fragment.length > MAX_LINE_BYTES) {
    state.oversizedLines += 1;
    taintIdentity(state);
    state.line = Buffer.alloc(0);
    state.skipping = true;
    return;
  }
  state.line = state.line.length === 0 ? Buffer.from(fragment) : Buffer.concat([state.line, fragment]);
}

function processChunk(state, chunk, agentId) {
  let start = 0;
  for (let index = 0; index < chunk.length; index += 1) {
    if (chunk[index] !== 10) continue;
    appendFragment(state, chunk.subarray(start, index));
    if (!state.skipping) consumeLine(state, state.line, agentId);
    state.line = Buffer.alloc(0);
    state.skipping = false;
    start = index + 1;
    if (state.records.length >= MAX_RECORDS_PER_FILE) {
      state.limitedFiles = 1;
      return;
    }
  }
  appendFragment(state, chunk.subarray(start));
}

export async function readUsageWire(path, agentId) {
  const state = {
    records: [], forkAt: 0, forked: false, line: Buffer.alloc(0), skipping: false,
    badLines: 0, oversizedLines: 0, truncatedTail: 0, limitedFiles: 0,
  };
  resetIdentity(state);
  for await (const chunk of createReadStream(path, { highWaterMark: 64 * 1024 })) {
    processChunk(state, chunk, agentId);
    if (state.limitedFiles > 0) break;
  }
  if (state.line.length > 0 || state.skipping) state.truncatedTail = 1;
  return {
    records: state.records.slice(state.forkAt),
    inheritedRecords: state.forkAt,
    forked: state.forked,
    badLines: state.badLines,
    oversizedLines: state.oversizedLines,
    truncatedTail: state.truncatedTail,
    limitedFiles: state.limitedFiles,
    unresolvedModels: state.records.slice(state.forkAt).filter((record) => record.modelId === null).length,
  };
}

function displayName(cwd, fallback) {
  if (typeof cwd !== 'string') return fallback;
  const name = cwd.split(/[\\/]/).filter(Boolean).at(-1);
  return safeModel(name) ? name : fallback;
}

async function sessionMeta(sessionDir, fallback) {
  try {
    const path = join(sessionDir, 'state.json');
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024) return {};
    const meta = JSON.parse(await readFile(path, 'utf8'));
    return {
      source: safeId(meta?.forkedFrom) ? meta.forkedFrom : null,
      label: displayName(meta?.cwd, fallback),
    };
  } catch {
    return {};
  }
}

function addQuality(quality, data) {
  for (const key of ['badLines', 'oversizedLines', 'truncatedTail', 'limitedFiles',
    'inheritedRecords', 'unresolvedModels']) {
    quality[key] += data[key];
  }
}

async function cachedWire(cache, path, agentId, stat) {
  const cached = cache.get(path);
  if (cached?.size === stat.size && cached?.mtimeMs === stat.mtimeMs) return cached;
  const data = { ...await readUsageWire(path, agentId), size: stat.size, mtimeMs: stat.mtimeMs };
  cache.set(path, data);
  return data;
}

async function collectAgent(context, sessionDir, workspace, agent) {
  const { cache, currentFiles, facts, quality } = context;
  if (currentFiles.size >= MAX_FILES) {
    quality.limitedFiles += 1;
    return null;
  }
  const path = join(sessionDir, 'agents', agent.name, 'wire.jsonl');
  let stat;
  try {
    stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
  } catch {
    return null;
  }
  currentFiles.add(path);
  let data;
  try {
    data = await cachedWire(cache, path, agent.name, stat);
  } catch {
    quality.unreadableFiles += 1;
    cache.delete(path);
    return null;
  }
  addQuality(quality, data);
  for (const record of data.records) facts.push({ ...record, workspace });
  return { hasRecords: data.records.length > 0, forked: data.forked };
}

function recordWorkspaceLabel(options, workspace, label) {
  const current = options.get(workspace);
  if (current === undefined || current === workspace) options.set(workspace, label ?? workspace);
}

function recordForkQuality(quality, source, sessionIds, forked) {
  if (source && !sessionIds.has(source)) quality.missingForkSources += 1;
  if (forked && !source) quality.unknownForkSources += 1;
}

async function collectSession(context, workspaceDir, workspace, session, sessionIds) {
  const sessionDir = join(workspaceDir, session.name);
  const agents = await directories(join(sessionDir, 'agents'));
  if (agents === null) return;
  const meta = await sessionMeta(sessionDir, workspace);
  let forked = false;
  for (const agent of agents) {
    const collected = await collectAgent(context, sessionDir, workspace, agent);
    if (collected?.forked) forked = true;
    if (collected?.hasRecords) recordWorkspaceLabel(context.workspaceOptions, workspace, meta.label);
  }
  recordForkQuality(context.quality, meta.source, sessionIds, forked);
}

async function scanUsageHome(homeDir, cache) {
  const quality = Object.fromEntries(Object.keys(QUALITY_LABELS).map((key) => [key, 0]));
  quality.notes = [];
  const context = { cache, currentFiles: new Set(), facts: [], quality, workspaceOptions: new Map() };
  const workspaces = await directories(join(homeDir, 'sessions'));
  if (workspaces === null) {
    quality.notes = [{ code: 'unavailable_root', message: '会话目录不可安全读取' }];
    return { facts: [], quality, workspaces: [] };
  }
  for (const workspace of workspaces) {
    const workspaceDir = join(homeDir, 'sessions', workspace.name);
    const sessions = await directories(workspaceDir);
    if (sessions === null) continue;
    const sessionIds = new Set(sessions.map((session) => session.name));
    for (const session of sessions) {
      await collectSession(context, workspaceDir, workspace.name, session, sessionIds);
    }
  }
  for (const path of cache.keys()) if (!context.currentFiles.has(path)) cache.delete(path);
  quality.notes = Object.entries(QUALITY_LABELS).filter(([key]) => quality[key] > 0)
    .map(([code, message]) => ({ code, message, count: quality[code] }));
  return {
    facts: context.facts,
    quality,
    workspaces: [...context.workspaceOptions].map(([id, label]) => ({ id, label })),
  };
}

export function createUsageScanner(homeDir) {
  const cache = new Map();
  return { scan: () => scanUsageHome(homeDir, cache) };
}
