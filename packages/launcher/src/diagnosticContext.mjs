const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const EXACT_ROUTES = new Map([
  ['/', 'index'], ['/index.html', 'index'], ['/api/v1/ws', 'ws'],
  ['/api/v1/meta', 'meta'], ['/api/v1/healthz', 'health'],
  ['/api/v1/config', 'config'], ['/api/v1/models', 'models'], ['/api/v1/search', 'search'],
  ['/api/v1/sessions', 'sessions'], ['/api/v2/sessions', 'sessions'],
  ['/api/v1/workspaces', 'workspaces'],
  ['/__open-kimi-mobile/usage', 'usage'], ['/__open-kimi-mobile/cron', 'cron'],
]);
const PREFIX_ROUTES = [
  ['/api/v1/fs/', 'files'], ['/api/v1/workspaces/', 'workspaces'],
  ['/__open-kimi-mobile/usage/', 'usage'], ['/__open-kimi-mobile/cron/', 'cron'],
  ['/__open-kimi-mobile/', 'extension'], ['/assets/', 'static'],
];
const SESSION_ROUTE = /^\/api\/v1\/sessions\/([A-Za-z0-9_-]{1,200})(?:\/([^?#]*))?$/;

function routeFields(log, pathname) {
  const exact = EXACT_ROUTES.get(pathname);
  if (exact) return { route: exact };
  const session = SESSION_ROUTE.exec(pathname);
  if (session) return {
    route: session[2] === 'transcript' ? 'transcript' : /^agents\/[A-Za-z0-9_-]{1,200}\/turns$/.test(session[2])
      ? 'turns' : 'session',
    sessionTag: log.tag('session', session[1]),
  };
  const prefix = PREFIX_ROUTES.find(([start]) => pathname.startsWith(start));
  return { route: prefix?.[1] ?? 'other' };
}

function pageSize(params) {
  const values = params.getAll('page_size');
  if (values.length !== 1 || !/^\d{1,6}$/.test(values[0])) return undefined;
  return Number(values[0]);
}

function transcriptFields(query, upstreamPath, originalPath, turns = false) {
  const params = new URLSearchParams(query);
  const upstream = new URLSearchParams(upstreamPath.split('?')[1]);
  return {
    main: turns ? originalPath.split('?')[0].endsWith('/agents/main/turns')
      : params.getAll('agent_id').length === 1 && params.get('agent_id') === 'main',
    before: params.has(turns ? 'before_ordinal' : 'before_turn'), after: !turns && params.has('after_turn'),
    pageSize: pageSize(params), upstreamPageSize: pageSize(upstream), pagingApplied: upstreamPath !== originalPath,
  };
}

export function requestFields(log, id, req, upstreamPath = req.url ?? '') {
  const url = req.url ?? '';
  const [pathname, query] = url.split('?');
  const fields = {
    id, clientTag: log.tag('client', req.socket?.remoteAddress ?? ''),
    method: METHODS.has(req.method) ? req.method : 'other',
    ...routeFields(log, pathname),
  };
  if (fields.route === 'transcript' || fields.route === 'turns') {
    Object.assign(fields, transcriptFields(query, upstreamPath, url, fields.route === 'turns'));
  }
  return fields;
}
