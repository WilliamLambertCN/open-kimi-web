const MESSAGES = {
  'invalid-input': 'Invalid scheduled-task input.',
  'unsafe-target': 'Cron operations require a literal loopback HTTP(S) origin.',
  unauthorized: 'Current authorization was rejected.',
  'unsupported-version': 'Cron reads require the verified official 2.1.1, 2.2.0 or 2.3.1 backend.',
  'read-only-version': 'Official 2.3.1 debug cron writes do not honor session locks or freshness checks. ' +
    'Only read-only access is supported; no write was sent.',
  'unsafe-auth': 'Cron operations require upstream authentication to be enabled.',
  'not-loaded': 'The session is not loaded. No session recovery was requested.',
  disabled: 'Cron scheduling is disabled.',
  'task-limit': 'The session already has 50 or more scheduled tasks.',
  'no-future-fire': 'The expression has no future occurrence within five years.',
  'one-shot-too-far': 'The first one-shot occurrence is more than 350 days away.',
  'request-too-large': 'The upstream request exceeds the size limit.',
  'response-too-large': 'The upstream response exceeds the size limit.',
  'invalid-response': 'The upstream response does not match the expected protocol.',
  'upstream-http': 'The upstream request failed.',
  'upstream-business': 'The upstream operation was rejected.',
  'upstream-unavailable': 'The upstream service could not be reached.',
  redirect: 'Upstream redirects are not permitted.',
  timeout: 'The upstream request timed out.',
  'unsafe-backend': 'Cron management requires Remote Control to be fully off.',
  'not-enabled': 'Cron management is not enabled for this launcher.',
  'inventory-unavailable': 'Cron inventory is not available for this launcher.',
  'invalid-path': 'Invalid Cron management path.',
  'method-not-allowed': 'This HTTP method is not permitted.',
  'cross-origin': 'Cross-origin Cron requests are not permitted.',
  'unsupported-media-type': 'Cron writes require application/json.',
  'body-too-large': 'The request body exceeds 16 KiB.',
  'body-timeout': 'The request body timed out.',
  busy: 'Cron management is busy. Try again after the current operations finish.',
};

export class CronClientError extends Error {
  constructor(code) {
    super(MESSAGES[code] ?? MESSAGES['upstream-unavailable']);
    this.name = 'CronClientError';
    this.code = Object.hasOwn(MESSAGES, code) ? code : 'upstream-unavailable';
  }
}
