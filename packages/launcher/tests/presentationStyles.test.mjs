import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const themeCss = readFileSync(new URL('../src/mobile/themes.css', import.meta.url), 'utf8');

describe('presentation theme layout boundaries', () => {
  it('leaves the official dock geometry and compact mode intact', () => {
    expect(themeCss).not.toMatch(
      /\.dock-workbar\s*\{[^}]*(?:width|margin(?:-bottom)?)\s*:/s,
    );
    expect(themeCss).not.toMatch(
      /\.dock-workbar\s*>\s*\.ui-pill\s*\{[^}]*(?:justify-content|width|min-height|padding)\s*:/s,
    );
    expect(themeCss).not.toMatch(
      /\.chat-dock\.pills-compact\s+\.dock-workbar\s*>\s*\.ui-pill\s*>\s*span/,
    );
  });
});
