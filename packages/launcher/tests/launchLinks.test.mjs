import { describe, expect, it } from 'vitest';

import { launchLinkLines, launchLinkWarnings } from '../src/launchLinks.mjs';

const urls = [
  { type: 'local', url: 'https://127.0.0.1:4173' },
  { type: 'network', url: 'https://[2001:db8::20]:4173' },
];

describe('launchLinkLines', () => {
  it('prints authenticated Local and Network links with encoded fragments', () => {
    expect(launchLinkLines(urls, 'a b&c')).toEqual([
      '  Local:   https://127.0.0.1:4173#token=a%20b%26c',
      '  Network:   https://[2001:db8::20]:4173#token=a%20b%26c',
    ]);
  });

  it('preserves bare links when no token is available', () => {
    expect(launchLinkLines(urls, null)[0]).toBe('  Local:   https://127.0.0.1:4173');
  });
});

describe('launchLinkWarnings', () => {
  it('warns that token links are credentials and doubles down for plaintext HTTP', () => {
    const warnings = launchLinkWarnings({ token: 'never-print-this', attempted: true }, true);
    expect(warnings.join('\n')).toMatch(/full coding-agent access/i);
    expect(warnings.join('\n')).toMatch(/plaintext HTTP/i);
    expect(warnings.join('\n')).not.toContain('never-print-this');
  });

  it('uses a path-free note for failed reads and stays silent when no read was intended', () => {
    expect(launchLinkWarnings({ token: null, attempted: true }, false)).toEqual([
      'note: authenticated launch link unavailable; use the bare URL.',
    ]);
    expect(launchLinkWarnings({ token: null, attempted: false }, false)).toEqual([]);
  });
});
