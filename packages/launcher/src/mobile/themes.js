const OKW_THEME_STORAGE_KEY = 'open-kimi-web.atmospheric-theme';
const OKW_DEFAULT_THEME = 'nocturne';
const OKW_THEMES = [
  { id: 'original', label: '原始 · Original', shortLabel: '原始' },
  { id: 'aurora', label: '极光 · Aurora', shortLabel: '极光' },
  { id: 'twilight', label: '暮色 · Twilight', shortLabel: '暮色' },
  { id: 'ember', label: '余烬 · Ember', shortLabel: '余烬' },
  { id: 'mineral', label: '矿物青绿 · Mineral', shortLabel: '矿物青绿' },
  { id: 'nocturne', label: '夜幕 · Nocturne', shortLabel: '夜幕' },
];
const OKW_THEME_IDS = new Set(OKW_THEMES.map(({ id }) => id));

{
  const mobile = window.matchMedia('(max-width: 640px)');
  let currentTheme = OKW_DEFAULT_THEME;
  let openPicker = null;
  let desktopDialog = null;

  const readStoredTheme = () => {
    try {
      const stored = localStorage.getItem(OKW_THEME_STORAGE_KEY);
      return OKW_THEME_IDS.has(stored) ? stored : OKW_DEFAULT_THEME;
    } catch {
      return OKW_DEFAULT_THEME;
    }
  };

  const storeTheme = (theme) => {
    try {
      localStorage.setItem(OKW_THEME_STORAGE_KEY, theme);
    } catch {
      // The active page still updates when storage is unavailable.
    }
  };

  const themeLabel = (theme) => OKW_THEMES.find(({ id }) => id === theme)?.label ?? OKW_THEMES[0].label;
  const shortThemeLabel = (theme) => OKW_THEMES.find(({ id }) => id === theme)?.shortLabel ?? OKW_THEMES[0].shortLabel;

  const syncControls = () => {
    document.querySelectorAll('.okw-theme-current').forEach((current) => {
      current.textContent = current.closest('.okw-theme-menu-trigger')
        ? shortThemeLabel(currentTheme)
        : themeLabel(currentTheme);
    });
    document.querySelectorAll('.okw-theme-option').forEach((option) => {
      const selected = option.dataset.theme === currentTheme;
      option.setAttribute('aria-pressed', String(selected));
      option.classList.toggle('selected', selected);
    });
  };

  const applyTheme = (theme, persist = true) => {
    currentTheme = OKW_THEME_IDS.has(theme) ? theme : OKW_DEFAULT_THEME;
    if (currentTheme === 'original') document.documentElement.removeAttribute('data-okw-theme');
    else document.documentElement.dataset.okwTheme = currentTheme;
    if (persist) storeTheme(currentTheme);
    syncControls();
  };

  const closeThemePicker = ({ restoreFocus = false } = {}) => {
    if (!openPicker) return;
    const { trigger, dialog } = openPicker;
    if (dialog) dialog.hidden = true;
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus) trigger.focus();
    }
    openPicker = null;
  };

  const positionMenuDialog = (trigger, dialog) => {
    if (!dialog.classList.contains('okw-theme-menu-dialog')) return;
    const margin = 8;
    const gap = 6;
    const anchor = trigger.getBoundingClientRect();
    const bounds = dialog.getBoundingClientRect();
    const rightSide = anchor.right + gap;
    const leftSide = anchor.left - bounds.width - gap;
    let left = Math.min(
      Math.max(margin, anchor.left),
      Math.max(margin, window.innerWidth - bounds.width - margin),
    );
    if (rightSide + bounds.width <= window.innerWidth - margin) left = rightSide;
    else if (leftSide >= margin) left = leftSide;
    const top = Math.min(
      Math.max(margin, anchor.top),
      Math.max(margin, window.innerHeight - bounds.height - margin),
    );
    dialog.style.left = `${Math.floor(left)}px`;
    dialog.style.top = `${Math.floor(top)}px`;
  };

  const openThemePicker = (trigger, dialog) => {
    if (openPicker && openPicker.trigger !== trigger) closeThemePicker();
    openPicker = { trigger, dialog };
    dialog.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => {
      positionMenuDialog(trigger, dialog);
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

  const buildThemeDialog = (className = '') => {
    const dialog = makeElement('div', 'okw-theme-dialog');
    if (className) dialog.classList.add(className);
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
      const selected = theme.id === currentTheme;
      option.setAttribute('aria-pressed', String(selected));
      option.classList.toggle('selected', selected);
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
    return dialog;
  };

  const getDesktopDialog = () => {
    if (desktopDialog) return desktopDialog;
    desktopDialog = buildThemeDialog('okw-theme-menu-dialog');
    desktopDialog.addEventListener('mousedown', (event) => event.stopPropagation());
    document.body.append(desktopDialog);
    return desktopDialog;
  };

  const connectThemeTrigger = (trigger, dialog) => {
    trigger.addEventListener('click', () => {
      if (openPicker?.trigger === trigger) closeThemePicker({ restoreFocus: true });
      else openThemePicker(trigger, dialog);
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
    const dialog = buildThemeDialog();
    connectThemeTrigger(trigger, dialog);
    picker.append(trigger, dialog);
    section.append(heading, picker);
    return section;
  };

  const itemLabel = (item) => item.querySelector('.user-menu-item-label')?.textContent?.trim() ?? '';

  const enhanceUserMenus = () => {
    if (mobile.matches) {
      if (openPicker?.trigger.matches('[data-okw-theme-menu-trigger]')) closeThemePicker();
      desktopDialog?.remove();
      desktopDialog = null;
      document.querySelectorAll('.user-menu').forEach((menu) => {
        menu.querySelector(':scope > [data-okw-theme-menu-trigger]')?.remove();
      });
      return;
    }
    document.querySelectorAll('.user-menu[role="menu"], .user-menu').forEach((menu) => {
      if (menu.querySelector(':scope > [data-okw-theme-menu-trigger]')) return;
      const appearance = Array.from(menu.querySelectorAll(':scope > button.ui-menu-item'))
        .find((item) => ['外观', 'Appearance'].includes(itemLabel(item)));
      if (!appearance) return;
      const trigger = appearance.cloneNode(true);
      trigger.dataset.okwThemeMenuTrigger = '';
      trigger.classList.add('okw-theme-menu-trigger');
      trigger.setAttribute('aria-haspopup', 'dialog');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-label', '氛围主题');
      const label = trigger.querySelector('.user-menu-item-label');
      const value = trigger.querySelector('.user-menu-row-value');
      if (label) label.textContent = '氛围主题';
      if (value) {
        value.classList.add('okw-theme-current');
        value.textContent = shortThemeLabel(currentTheme);
      }
      const dialog = getDesktopDialog();
      connectThemeTrigger(trigger, dialog);
      appearance.before(trigger);
      syncControls();
    });
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
      if (!body) return;
      if (!mobile.matches) {
        body.querySelector('[data-okw-theme-picker]')?.remove();
        return;
      }
      if (body.querySelector('[data-okw-theme-picker]')) return;
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
    if (openPicker && !openPicker.trigger.isConnected) closeThemePicker();
    enhanceUserMenus();
    enhanceSettings();
    enhanceVisualAnchors();
  };

  new MutationObserver(enhance).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('pointerdown', (event) => {
    if (openPicker && !openPicker.trigger.contains(event.target) && !openPicker.dialog.contains(event.target)) {
      closeThemePicker();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && openPicker) {
      event.stopPropagation();
      closeThemePicker({ restoreFocus: true });
    }
  }, true);
  window.addEventListener('resize', () => {
    if (openPicker) positionMenuDialog(openPicker.trigger, openPicker.dialog);
  });
  mobile.addEventListener('change', enhance);
  enhance();
}
