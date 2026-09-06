import { describe, expect, it } from 'vitest';

import { relayCloseCode } from '../src/wsProxy.mjs';

describe('relayCloseCode', () => {
  it('maps RFC 6455 reserved codes (unsendable) to 1000', () => {
    expect(relayCloseCode(1005)).toBe(1000);
    expect(relayCloseCode(1006)).toBe(1000);
    expect(relayCloseCode(1015)).toBe(1000);
  });

  it('passes normal and application codes through', () => {
    for (const code of [1000, 1001, 1011, 3000, 4000, 4999]) {
      expect(relayCloseCode(code)).toBe(code);
    }
  });
});
