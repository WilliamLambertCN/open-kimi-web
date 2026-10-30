import { CronClientError } from './errors.mjs';

export const CRON_READ_VERSIONS = Object.freeze(['2.1.1', '2.2.0', '2.3.1', '2.4.1']);
export const CRON_WRITE_VERSIONS = Object.freeze(['2.1.1', '2.2.0']);

export function assertCronReadVersion(meta) {
  if (!CRON_READ_VERSIONS.includes(meta?.server_version) || meta?.backend !== 'v2') {
    throw new CronClientError('unsupported-version');
  }
  if (meta.dangerous_bypass_auth !== false) throw new CronClientError('unsafe-auth');
  return meta.server_version;
}

export function assertCronWriteVersion(version) {
  if (CRON_WRITE_VERSIONS.includes(version)) return;
  if (CRON_READ_VERSIONS.includes(version)) throw new CronClientError('read-only-version');
  throw new CronClientError('unsupported-version');
}
