import { disableLocalCa, localCaStatus, setupLocalCa } from './localCaStore.mjs';

export const TLS_USAGE = `Usage: open-kimi-web tls <setup|status|disable>

Commands:
  setup    Enable a stable local CA and a server certificate for current network addresses
  status   Show whether Local CA is enabled, its SHA-256 fingerprint and expiry
  disable  Stop selecting Local CA; keep the CA, server certificates and device trust unchanged

Setup does not start a server or change system trust. Restart the launcher yourself afterwards.
On your phone, compare the CA SHA-256 fingerprint with this terminal before installing the CA certificate.
Windows file mode bits are not equivalent to Windows ACL protection; protect your OKW home and account.
`;

async function dispatch(command, options, log) {
  if (command === 'disable') {
    await disableLocalCa(options);
    log('Local CA disabled. Stored certificates and device trust were not changed. Restart the launcher yourself.');
    return;
  }
  if (command === 'status') {
    const status = await localCaStatus(options);
    log(status.enabled ? `Local CA: enabled\nCA SHA-256: ${status.fingerprint}\nCA expires: ${status.expiresAt}` :
      'Local CA: disabled');
    return;
  }
  const tls = await setupLocalCa({ ...options, host: options.host ?? '0.0.0.0' });
  log(`Local CA enabled.\nCA SHA-256: ${tls.publicCa.fingerprint}\nCA expires: ${tls.publicCa.expiresAt}`);
  log('Restart the launcher yourself, then open its HTTPS network link on your phone.');
  log('Before installing the downloaded CA certificate, compare its SHA-256 fingerprint with this terminal.');
  log('Install it as a CA certificate in phone settings, reopen Chrome, then try Install app again.');
  log('No system trust was changed and no service was started. Keep this CA private key and your OKW home protected.');
  log('Windows mode bits do not replace Windows ACLs. Android/WebAPK installation still depends on the browser and device.');
}

function errorDetail(failure) {
  return failure instanceof Error && /^Local CA [^\n]*$/.test(failure.message) ? failure.message :
    'Local CA operation failed. Check the original CA files, validity and operation lock; no fallback CA was enabled.';
}

export async function tlsMain(argv, options = {}) {
  const log = options.log ?? console.log;
  const error = options.error ?? console.error;
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    log(TLS_USAGE);
    return 0;
  }
  if (argv.length !== 1 || !['setup', 'status', 'disable'].includes(argv[0])) {
    error(`open-kimi-web tls: invalid arguments\n\n${TLS_USAGE}`);
    return 2;
  }
  try {
    await dispatch(argv[0], options, log);
    return 0;
  } catch (failure) {
    error(errorDetail(failure));
    return 1;
  }
}
