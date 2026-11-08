export function tlsStatusLines(tls) {
  const lines = [`  SHA-256 fingerprint: ${tls.fingerprint}`];
  if (tls.source === 'local-ca') {
    lines.push(`  Local CA SHA-256 fingerprint: ${tls.publicCa.fingerprint}`);
    lines.push('  On your phone, open Install app to download the CA public certificate.');
    lines.push('  Compare its fingerprint with this terminal before installing it as a CA certificate.');
    lines.push('  Trust only your own computer. Restart Chrome, then try installing the app again.');
    return lines;
  }
  if (tls.source !== 'managed') return lines;
  if (tls.rotated) {
    lines.push(`  warning: certificate fingerprint changed (${tls.reason})`);
  } else if (tls.created) {
    lines.push('  warning: this self-signed certificate is not trusted on first use.');
  }
  lines.push('  Verify this fingerprint before accepting the browser warning.');
  return lines;
}
