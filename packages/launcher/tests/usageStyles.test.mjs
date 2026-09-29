import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/mobile/usage.css', import.meta.url), 'utf8');

describe('usage statistics scroll boundaries', () => {
  it('keeps one vertical panel scroller and lets touch gestures stay on it', () => {
    expect(css).toMatch(
      /\.okw-usage-panel\s*\{[^}]*overflow:\s*auto[^}]*touch-action:\s*pan-y/su,
    );
    expect(css).toMatch(/\.okw-usage-bars\s*\{[^}]*display:\s*grid[^}]*\}/su);
    expect(css).not.toMatch(/\.okw-usage-bars\s*\{[^}]*(?:max-height|overflow-y|overflow:\s*auto)/su);
    expect(css).not.toMatch(/\.okw-usage-trend-data ol\s*\{[^}]*(?:max-height|overflow:\s*auto)/su);
    expect(css).not.toMatch(/\.okw-usage-table-scroll\s*\{[^}]*max-height/su);
  });

  it('defers layout and paint for sections below the viewport', () => {
    expect(css).toMatch(
      /\.okw-usage-content\s*>\s*\.okw-usage-section[^{}]*\{[^}]*content-visibility:\s*auto/su,
    );
    expect(css).toMatch(/contain-intrinsic-size:\s*auto\s+360px/u);
  });
});
