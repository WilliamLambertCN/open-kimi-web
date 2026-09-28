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
});

describe('mobile question card layout', () => {
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
      new RegExp(
        String.raw`\.app\.mobile\s+\.qfoot\s+\.qbtns\s+\.ui-button\s*,\s*` +
          String.raw`\.app\.mobile\s+\.qfoot\s+\.qbtns\s+\.cbtn\s*\{[^}]*flex:\s*1\s+1\s+0`,
        's',
      ),
    );
  });

  it('restores themed mobile question cards to the established panel tokens', () => {
    expect(presentationCss).toMatch(
      /html\[data-okw-theme\]\s+\.app\.mobile\s+\.qcard\s*\{[^}]*background:\s*var\(--color-surface-raised\)/s,
    );
    expect(presentationCss).toMatch(
      /html\[data-okw-theme\]\s+\.app\.mobile\s+\.qcard\s*\{[^}]*border-color:\s*var\(--color-line\)/s,
    );
    expect(presentationCss).not.toMatch(
      /(?:^|\})\s*\.app\.mobile\s+\.qcard\s*\{[^}]*background:\s*var\(--color-surface-raised\)/s,
    );
  });

  it('keeps the stem and options in the same scroll area when height is limited', () => {
    expect(presentationCss).toMatch(
      /\.app\.mobile\s+\.qcard:not\(\.minimized\)\s+\.qbody\s*\{[^}]*min-height:\s*0/s,
    );
    expect(presentationCss).not.toMatch(
      /\.app\.mobile\s+\.qcard\s+\.qbody\s*\{[^}]*display:\s*flex/s,
    );
    expect(presentationCss).not.toMatch(
      /\.app\.mobile\s+\.qcard\s+\.qbody\s*>\s*\.qopts\s*\{[^}]*overflow-y:\s*auto/s,
    );
  });
});

describe('mobile question choices and actions', () => {
  it('keeps the legacy footer order and danger-colored dismiss action', () => {
    expect(presentationCss).toMatch(/\.qbtns\s+\.ui-button:nth-child\(2\)\s*\{[^}]*order:\s*-1/s);
    expect(presentationCss).toMatch(/\.qbtns\s+\.ui-button:last-child:not\(\.qmain\)\s*\{[^}]*order:\s*0/s);
    expect(presentationCss).toMatch(/\.qbtns\s+\.ui-button:last-child:not\(\.qmain\)\s*\{[^}]*var\(--color-danger\)/s);
    expect(presentationCss).toMatch(/\.qbtns\s+\.qmain\s*\{[^}]*order:\s*1/s);
  });

  it('uses the official 2.1.1 card-button order and styles its dismiss action', () => {
    expect(presentationCss).toMatch(
      /\.qbtns\s+\.cbtn:nth-last-child\(2\):not\(\.qmain\)\s*\{[^}]*var\(--color-danger\)/s,
    );
    expect(presentationCss).not.toMatch(/\.qbtns\s+\.cbtn:nth-child\(2\)\s*\{[^}]*order:\s*-1/s);
  });

  it('emphasizes a chosen option without changing the others', () => {
    expect(presentationCss).toMatch(/\.qopt\.selected\s*\{[^}]*var\(--color-accent-soft\)/s);
    expect(presentationCss).toMatch(/\.qopt\.selected\s+\.qopt-label\s*\{[^}]*font-size:\s*var\(--text-lg\)/s);
    expect(presentationCss).toMatch(/\.qopt\.selected\s+\.qopt-label\s*\{[^}]*font-weight:\s*var\(--weight-semibold\)/s);
    expect(presentationCss).toMatch(/\.qopts\s*>\s*\.qopt\s*\{[^}]*flex-shrink:\s*0/s);
  });
});
