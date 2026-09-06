export function tlsStatusLines(tls) {
  const lines = [`  SHA-256 fingerprint: ${tls.fingerprint}`];
  if (tls.source !== 'managed') return lines;
  if (tls.rotated) {
    lines.push(`  warning: certificate fingerprint changed (${tls.reason})`);
  } else if (tls.created) {
    lines.push('  warning: this self-signed certificate is not trusted on first use.');
  }
  lines.push('  Verify this fingerprint before accepting the browser warning.');
  return lines;
}
