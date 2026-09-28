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
      new RegExp(
        String.raw`@media\s*\(max-width:\s*640px\)[\s\S]*\.app\.mobile\s+\.composer-card\s+` +
          String.raw`\.okw-steer-button\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px`,
        's',
      ),
    );
  });

  it('limits model drag gestures to the handle and shows both drop directions', () => {
    expect(presentationCss).toMatch(
      /\.okw-model-drag-handle\s*\{[^}]*cursor:\s*grab[^}]*touch-action:\s*none/s,
    );
    for (const rowClass of ['pf-model-grid', 'pmt-grid']) {
      expect(presentationCss).toMatch(new RegExp(`\\.${rowClass}\\.okw-model-dragging[^{}]*\\{`));
      expect(presentationCss).toMatch(
        new RegExp(`\\.${rowClass}\\.okw-model-drop-before[^{}]*\\{[^}]*var\\(--color-accent`, 's'),
      );
      expect(presentationCss).toMatch(
        new RegExp(`\\.${rowClass}\\.okw-model-drop-after[^{}]*\\{[^}]*var\\(--color-accent`, 's'),
      );
    }
  });

  it('caps the mobile settings sheet below full height so the scrim stays tappable', () => {
    expect(presentationCss).toMatch(
      /\.sheet-root\.okw-settings\s+\.sheet-panel\s*\{[^}]*max-height:\s*85dvh/s,
    );
    // A forced viewport-height panel leaves no scrim to tap to dismiss.
    expect(presentationCss).not.toMatch(
      /\.sheet-root\.okw-settings\s+\.sheet-panel\s*\{[^}]*[^-\w]height:\s*calc\(100dvh/s,
    );
  });

  it('caps the mobile question card so the content behind stays visible', () => {
    expect(presentationCss).toMatch(
      /\.app\.mobile\s+\.qcard:not\(\.minimized\)\s*\{[^}]*max-height:\s*calc\(var\(--app-height[^)]*\)\s*\*\s*0\.5\)/s,
    );
  });

  it('lays the question footer buttons out in one row on mobile', () => {
    expect(presentationCss).toMatch(
      /@media\s*\(max-width:\s*640px\)[\s\S]*\.app\.mobile\s+\.qfoot\s+\.qbtns\s*\{[^}]*flex-direction:\s*row/s,
    );
    expect(presentationCss).toMatch(
      /\.app\.mobile\s+\.qfoot\s+\.qbtns\s+\.ui-button\s*\{[^}]*flex:\s*1\s+1\s+0/s,
    );
  });

  it('keeps the question stem out of the scrolling options list on mobile', () => {
    expect(presentationCss).toMatch(
      /\.app\.mobile\s+\.qcard\s+\.qbody\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/s,
    );
    expect(presentationCss).toMatch(
      /\.app\.mobile\s+\.qcard\s+\.qbody\s*>\s*\.qmdbody\s*\{[^}]*flex:\s*none/s,
    );
    expect(presentationCss).toMatch(
      /\.app\.mobile\s+\.qcard\s+\.qbody\s*>\s*\.qopts\s*\{[^}]*overflow-y:\s*auto/s,
    );
  });
});

describe('mobile question choices and actions', () => {
  it('orders back, danger-colored dismiss, and next in the footer', () => {
    expect(presentationCss).toMatch(/\.qbtns\s+\.ui-button:nth-child\(2\)\s*\{[^}]*order:\s*-1/s);
    expect(presentationCss).toMatch(/\.qbtns\s+\.ui-button:last-child:not\(\.qmain\)\s*\{[^}]*order:\s*0/s);
    expect(presentationCss).toMatch(/\.qbtns\s+\.ui-button:last-child:not\(\.qmain\)\s*\{[^}]*var\(--color-danger\)/s);
    expect(presentationCss).toMatch(/\.qbtns\s+\.qmain\s*\{[^}]*order:\s*1/s);
  });

  it('emphasizes a chosen option without changing the others', () => {
    expect(presentationCss).toMatch(/\.qopt\.selected\s*\{[^}]*var\(--color-accent-soft\)/s);
    expect(presentationCss).toMatch(/\.qopt\.selected\s+\.qopt-label\s*\{[^}]*font-size:\s*var\(--text-lg\)/s);
    expect(presentationCss).toMatch(/\.qopt\.selected\s+\.qopt-label\s*\{[^}]*font-weight:\s*var\(--weight-semibold\)/s);
    expect(presentationCss).toMatch(/\.qopts\s*>\s*\.qopt\s*\{[^}]*flex-shrink:\s*0/s);
  });
});
