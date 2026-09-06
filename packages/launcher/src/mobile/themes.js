const OKW_THEME_STORAGE_KEY = 'open-kimi-web.atmospheric-theme';
const OKW_THEMES = [
  { id: 'original', label: '原始 · Original' },
  { id: 'aurora', label: '极光 · Aurora' },
  { id: 'twilight', label: '暮色 · Twilight' },
  { id: 'ember', label: '余烬 · Ember' },
  { id: 'mineral', label: '矿物青绿 · Mineral' },
  { id: 'nocturne', label: '夜幕 · Nocturne' },
];
const OKW_THEME_IDS = new Set(OKW_THEMES.map(({ id }) => id));

{
  let currentTheme = 'original';
  let openPicker = null;

  const readStoredTheme = () => {
    try {
      const stored = localStorage.getItem(OKW_THEME_STORAGE_KEY);
      return OKW_THEME_IDS.has(stored) ? stored : 'original';
    } catch {
      return 'original';
    }
  };

  const storeTheme = (theme) => {
    try {
      if (theme === 'original') localStorage.removeItem(OKW_THEME_STORAGE_KEY);
      else localStorage.setItem(OKW_THEME_STORAGE_KEY, theme);
    } catch {
      // The active page still updates when storage is unavailable.
    }
  };

  const themeLabel = (theme) => OKW_THEMES.find(({ id }) => id === theme)?.label ?? OKW_THEMES[0].label;

  const syncControls = () => {
    document.querySelectorAll('.okw-theme-picker').forEach((picker) => {
      const current = picker.querySelector('.okw-theme-current');
      if (current) current.textContent = themeLabel(currentTheme);
      picker.querySelectorAll('.okw-theme-option').forEach((option) => {
        const selected = option.dataset.theme === currentTheme;
        option.setAttribute('aria-pressed', String(selected));
        option.classList.toggle('selected', selected);
      });
    });
  };

  const applyTheme = (theme, persist = true) => {
    currentTheme = OKW_THEME_IDS.has(theme) ? theme : 'original';
    if (currentTheme === 'original') document.documentElement.removeAttribute('data-okw-theme');
    else document.documentElement.dataset.okwTheme = currentTheme;
    if (persist) storeTheme(currentTheme);
    syncControls();
  };

  const closeThemePicker = ({ restoreFocus = false } = {}) => {
    if (!openPicker) return;
    const trigger = openPicker.querySelector('.okw-theme-trigger');
    const dialog = openPicker.querySelector('.okw-theme-dialog');
    if (dialog) dialog.hidden = true;
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus) trigger.focus();
    }
    openPicker = null;
  };

  const openThemePicker = (picker) => {
    if (openPicker && openPicker !== picker) closeThemePicker();
    const trigger = picker.querySelector('.okw-theme-trigger');
    const dialog = picker.querySelector('.okw-theme-dialog');
    if (!trigger || !dialog) return;
    openPicker = picker;
    dialog.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => {
      const selected = dialog.querySelector('.okw-theme-option.selected');
      (selected ?? dialog.querySelector('.okw-theme-option'))?.focus();
    });
  };

  const makeElement = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  };

  const makeHexMarker = (className) => {
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    marker.setAttribute('class', `okw-hex-mark ${className}`);
    marker.setAttribute('viewBox', '0 0 28 32');
    marker.setAttribute('aria-hidden', 'true');
    marker.setAttribute('focusable', 'false');
    const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    outline.setAttribute('d', 'M14 1.5 25.7 8.25v15.5L14 30.5 2.3 23.75V8.25Z');
    outline.setAttribute('fill', 'none');
    outline.setAttribute('stroke', 'currentColor');
    outline.setAttribute('stroke-width', '1.7');
    const core = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    core.setAttribute('d', 'm14 8 6.8 4v8L14 24l-6.8-4v-8Z');
    core.setAttribute('fill', 'currentColor');
    core.setAttribute('opacity', '.82');
    marker.append(outline, core);
    return marker;
  };

  const enhanceVisualAnchors = () => {
    const brand = document.querySelector('.side .ch-brand');
    if (brand && !brand.querySelector('.okw-brand-mark')) {
      brand.prepend(makeHexMarker('okw-brand-mark'));
    }
    document.querySelectorAll('.a-msg').forEach((message) => {
      if (!message.querySelector(':scope > .okw-assistant-mark')) {
        message.prepend(makeHexMarker('okw-assistant-mark'));
      }
    });
  };

  const buildThemePicker = () => {
    const section = makeElement('section', 'okw-theme-section');
    section.dataset.okwThemePicker = '';

    const heading = makeElement('div', 'group-title okw-theme-heading', '氛围主题 · Atmospheric theme');
    const picker = makeElement('div', 'okw-theme-picker');
    const trigger = makeElement('button', 'okw-theme-trigger');
    trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', '选择氛围主题 · Choose atmospheric theme');
    const swatch = makeElement('span', 'okw-theme-trigger-swatch');
    swatch.setAttribute('aria-hidden', 'true');
    const triggerText = makeElement('span', 'okw-theme-trigger-text');
    triggerText.append(
      makeElement('span', 'okw-theme-trigger-label', '当前主题 · Current theme'),
      makeElement('span', 'okw-theme-current', themeLabel(currentTheme)),
    );
    const chevron = makeElement('span', 'okw-theme-chevron', '⌄');
    chevron.setAttribute('aria-hidden', 'true');
    trigger.append(swatch, triggerText, chevron);

    const dialog = makeElement('div', 'okw-theme-dialog');
    dialog.hidden = true;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', '氛围主题 · Atmospheric themes');
    const intro = makeElement('p', 'okw-theme-intro', '选择后立即应用；Original 恢复官方外观。');
    const options = makeElement('div', 'okw-theme-options');
    options.setAttribute('role', 'group');
    options.setAttribute('aria-label', '主题选项 · Theme options');

    for (const theme of OKW_THEMES) {
      const option = makeElement('button', 'okw-theme-option');
      option.type = 'button';
      option.dataset.theme = theme.id;
      option.setAttribute('aria-pressed', String(theme.id === currentTheme));
      option.append(
        makeElement('span', 'okw-theme-swatch'),
        makeElement('span', 'okw-theme-option-label', theme.label),
        makeElement('span', 'okw-theme-check', '✓'),
      );
      option.addEventListener('click', () => {
        applyTheme(theme.id);
        closeThemePicker({ restoreFocus: true });
      });
      options.append(option);
    }
    dialog.append(intro, options);
    trigger.addEventListener('click', () => {
      if (openPicker === picker) closeThemePicker({ restoreFocus: true });
      else openThemePicker(picker);
    });
    picker.append(trigger, dialog);
    section.append(heading, picker);
    return section;
  };

  const isSettingsPanel = (panel) => {
    const label = panel.getAttribute('aria-label')?.trim();
    const title = panel.querySelector('.sheet-title')?.textContent?.trim();
    return ['设置', '会话设置', 'Settings', 'Session settings'].includes(label) ||
      ['设置', '会话设置', 'Settings', 'Session settings'].includes(title);
  };

  const enhanceSettings = () => {
    document.querySelectorAll('.sheet-panel, .ui-dialog[aria-label="设置"], .ui-dialog[aria-label="Settings"]').forEach((panel) => {
      if (!isSettingsPanel(panel)) return;
      const body = panel.querySelector('.sheet-body, .settings-region .body');
      if (!body || body.querySelector('[data-okw-theme-picker]')) return;
      const picker = buildThemePicker();
      const firstCard = body.querySelector('.card');
      if (firstCard) firstCard.after(picker);
      else body.prepend(picker);
      syncControls();
    });
  };

  currentTheme = readStoredTheme();
  applyTheme(currentTheme, false);

  const enhance = () => {
    enhanceSettings();
    enhanceVisualAnchors();
  };

  new MutationObserver(enhance).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('pointerdown', (event) => {
    if (openPicker && !openPicker.contains(event.target)) closeThemePicker();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && openPicker) {
      event.stopPropagation();
      closeThemePicker({ restoreFocus: true });
    }
  }, true);
  enhance();
}
