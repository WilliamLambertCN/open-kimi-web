import { withTokenFragment } from './accessUrls.mjs';

export function launchLinkLines(accessUrls, token) {
  return accessUrls.map((access) => {
    const label = access.type === 'local' ? 'Local' : 'Network';
    const url = token === null ? access.url : withTokenFragment(access.url, token);
    return `  ${label}:   ${url}`;
  });
}

export function launchLinkWarnings(tokenResult, insecureHttp) {
  if (tokenResult.token === null) {
    return tokenResult.attempted
      ? ['note: authenticated launch link unavailable; use the bare URL.']
      : [];
  }
  const warnings = [
    'WARNING: authenticated launch links grant full coding-agent access. Do not share them.',
  ];
  if (insecureHttp) {
    warnings.push('WARNING: this authenticated link uses plaintext HTTP on the network.');
  }
  return warnings;
}
