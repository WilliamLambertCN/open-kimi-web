import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const themeCss = readFileSync(new URL('../src/mobile/themes.css', import.meta.url), 'utf8');
const presentationCss = readFileSync(new URL('../src/mobile/presentation.css', import.meta.url), 'utf8');

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

  it('releases the themed sidebar width when the desktop shell collapses it', () => {
    expect(themeCss).toMatch(
      /@media\s*\(min-width:\s*641px\)[\s\S]*\.sidebar-collapsed\s*>\s*\.side\.collapsed\s*\{[^}]*width:\s*0\s*!important/s,
    );
  });

  it('keeps provider tabs scrollable and the steer control responsive', () => {
    expect(presentationCss).toMatch(
      /\.mp\s*>\s*\.chip-strip\.okw-provider-strip\s*\{[^}]*overflow-x:\s*auto/s,
    );
    expect(presentationCss).toMatch(
      /\.composer-card\s+\.okw-steer-button\s*\{[^}]*height:\s*var\(--composer-control-size\)/s,
    );
    expect(presentationCss).toMatch(
      /@media\s*\(max-width:\s*640px\)[\s\S]*\.app\.mobile\s+\.composer-card\s+\.okw-steer-button\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s,
    );
  });

  it('limits model drag gestures to the handle and shows both drop directions', () => {
    expect(presentationCss).toMatch(
      /\.okw-model-drag-handle\s*\{[^}]*cursor:\s*grab[^}]*touch-action:\s*none/s,
    );
    expect(presentationCss).toMatch(/\.pf-model-grid\.okw-model-dragging\s*\{/);
    expect(presentationCss).toMatch(
      /\.pf-model-grid\.okw-model-drop-before\s*\{[^}]*var\(--color-accent/s,
    );
    expect(presentationCss).toMatch(
      /\.pf-model-grid\.okw-model-drop-after\s*\{[^}]*var\(--color-accent/s,
    );
  });
});
