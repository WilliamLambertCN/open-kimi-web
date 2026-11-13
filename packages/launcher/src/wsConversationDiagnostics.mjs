const CONTROL_BYTES = 16 * 1024;
const HEADER_BYTES = 4096;
const LIMIT = 64;
const ID = /^[A-Za-z0-9_-]{1,200}(?![\s\S])/;
const TURNS = /^\{"type":"turns","session_id":"([A-Za-z0-9_-]{1,200})","agent_id":"([A-Za-z0-9_-]{1,200})",/;

function text(data, limit) {
  if (typeof data === 'string') return data.slice(0, limit);
  if (Buffer.isBuffer(data)) return data.subarray(0, limit).toString('utf8');
  return '';
}

function control(data, bytes) {
  if (bytes > CONTROL_BYTES) return null;
  try { return JSON.parse(text(data, CONTROL_BYTES)); } catch { return null; }
}

function boundedSet(map, key, value) {
  map.set(key, value);
  while (map.size > LIMIT) map.delete(map.keys().next().value);
}

const validId = (value) => typeof value === 'string' && ID.test(value);
const validAgents = (agents) => Array.isArray(agents) && agents.length > 0 && agents.length <= LIMIT && agents.every(validId);

function subscription(frame) {
  if (frame?.type !== 'subscribe' || !validId(frame.session_id)) return null;
  if (typeof frame.request_id !== 'string' || frame.request_id.length > 256) return null;
  const agents = frame.agent_ids ?? ['main'];
  if (!validAgents(agents)) return null;
  return { session: frame.session_id, agents: [...new Set(agents)] };
}

export function createConversationTrace(log, emit, elapsedMs) {
  if (typeof log?.tag !== 'function') return null;
  const pending = new Map();
  const pages = new Map();
  const keyFor = (session, agent) => JSON.stringify([session, agent]);
  const fields = (entry) => ({ sessionTag: log.tag('session', entry.session), main: entry.agents.includes('main'),
    elapsedMs: elapsedMs(), subscribeMs: elapsedMs() - entry.started });
  const toUpstream = (data, bytes) => {
    const frame = control(data, bytes);
    const value = subscription(frame);
    if (!value) return;
    const entry = { ...value, started: elapsedMs() };
    boundedSet(pending, frame.request_id, entry);
    for (const agent of entry.agents) boundedSet(pages, keyFor(entry.session, agent), entry);
    emit('ws_subscribe', { ...fields(entry), frameBytes: bytes });
  };
  const response = (frame) => {
    const entry = pending.get(frame?.request_id);
    if (frame?.type !== 'response' || !entry || !Number.isSafeInteger(frame.code) || frame.code < 0) return;
    pending.delete(frame.request_id);
    if (frame.code !== 0) for (const agent of entry.agents) {
      const key = keyFor(entry.session, agent);
      if (pages.get(key) === entry) pages.delete(key);
    }
    emit('ws_subscribed', { ...fields(entry), resultCode: frame.code });
  };
  const toClient = (data, bytes) => {
    const header = TURNS.exec(text(data, HEADER_BYTES));
    if (!header) { response(control(data, bytes)); return; }
    const [, session, agent] = header;
    const key = keyFor(session, agent);
    const entry = pages.get(key);
    if (!entry) return;
    pages.delete(key);
    emit('ws_turns', { ...fields(entry), main: agent === 'main', frameBytes: bytes });
  };
  return { toUpstream, toClient, clear() { pending.clear(); pages.clear(); } };
}
