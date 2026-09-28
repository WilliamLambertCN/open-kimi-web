(() => {
  const installKey = Symbol.for('open-kimi-web.question-card-layout');
  if (window[installKey]) return;
  window[installKey] = true;

  const ACTIVE_CLASS = 'okw-question-title-in-body';
  const MIRROR_CLASS = 'okw-question-title-body';
  const HANDLE_CLASS = 'okw-question-height-handle';
  const FIXED_CLASS = 'okw-question-height-fixed';
  const DRAGGING_CLASS = 'okw-question-height-dragging';
  const STORAGE_KEY = 'open-kimi-web.question-card-height';
  const HEIGHT_STEPS = [35, 50, 70, 85];
  const MIN_CHOICE_HEIGHT = 44;
  const EPSILON = 1;
  const mobile = window.matchMedia('(max-width: 640px)');
  const cards = new Set();
  const states = new WeakMap();
  const scheduled = new Set();
  let frame = null;

  const readHeightStep = () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return HEIGHT_STEPS.find((step) => String(step) === stored) ?? null;
    } catch {
      return null;
    }
  };
  let savedHeightStep = readHeightStep();

  const number = (value) => Number.parseFloat(value) || 0;
  const rectHeight = (node) => node?.getBoundingClientRect().height ?? 0;
  const outerHeight = (node) => {
    const style = window.getComputedStyle(node);
    return rectHeight(node) + number(style.marginTop) + number(style.marginBottom);
  };

  const partsOf = (card) => {
    const header = card.querySelector(':scope > .qh');
    const pane = card.querySelector(':scope > .qpane');
    const inner = pane?.querySelector(':scope > .qpane-inner');
    return {
      header,
      title: header?.querySelector(':scope > .qtitle'),
      body: inner?.querySelector(':scope > .qbody'),
      footer: inner?.querySelector(':scope > .qfoot'),
      handle: card.querySelector(`:scope > .${HANDLE_CLASS}`),
    };
  };

  const sameParts = (left, right) => Object.keys(left).every((key) => left[key] === right[key]);

  const titleWidth = ({ header, title }) => {
    if (!header || !title) return 0;
    const current = title.getBoundingClientRect().width;
    if (!title.closest(`.${ACTIVE_CLASS}`) && current > 0) return current;
    const style = window.getComputedStyle(header);
    const children = Array.from(header.children).filter((node) => node !== title);
    const siblings = children.reduce((total, node) => {
      const nodeStyle = window.getComputedStyle(node);
      return total + node.getBoundingClientRect().width +
        number(nodeStyle.marginLeft) + number(nodeStyle.marginRight);
    }, 0);
    const gap = number(style.columnGap || style.gap);
    return Math.max(0, header.clientWidth - number(style.paddingLeft) -
      number(style.paddingRight) - siblings - gap * children.length);
  };

  const naturalHeaderHeight = ({ header, title }) => {
    const style = window.getComputedStyle(header);
    const siblingHeight = Array.from(header.children)
      .filter((node) => node !== title)
      .reduce((height, node) => Math.max(height, outerHeight(node)), 0);
    return number(style.paddingTop) + number(style.paddingBottom) +
      Math.max(rectHeight(title), siblingHeight);
  };

  const compactHeaderHeight = ({ header, title }) => {
    const style = window.getComputedStyle(header);
    const siblingHeight = Array.from(header.children)
      .filter((node) => node !== title)
      .reduce((height, node) => Math.max(height, outerHeight(node)), 0);
    return number(style.paddingTop) + number(style.paddingBottom) + siblingHeight;
  };

  const bodyChromeHeight = ({ body }) => {
    const style = window.getComputedStyle(body);
    const inner = body.parentElement;
    const innerStyle = window.getComputedStyle(inner);
    return number(style.paddingTop) + number(style.paddingBottom) +
      number(innerStyle.rowGap || innerStyle.gap);
  };

  const minimumCardHeight = (card, parts) => {
    const cardStyle = window.getComputedStyle(card);
    const borders = number(cardStyle.borderTopWidth) + number(cardStyle.borderBottomWidth);
    const handleHeight = parts.handle ? outerHeight(parts.handle) : 0;
    return borders + handleHeight + compactHeaderHeight(parts) +
      bodyChromeHeight(parts) + outerHeight(parts.footer) + MIN_CHOICE_HEIGHT;
  };

  const needsMirror = (card, parts) => {
    const titleHeight = rectHeight(parts.title);
    const cardHeight = rectHeight(card);
    const titleExtra = naturalHeaderHeight(parts) - compactHeaderHeight(parts);
    const requiredHeight = minimumCardHeight(card, parts) + titleExtra;
    return titleHeight > 0 && requiredHeight > cardHeight + EPSILON;
  };

  const setTitleWidth = (card, parts) => {
    const width = titleWidth(parts);
    if (width <= 0) return;
    const value = `${width}px`;
    if (card.style.getPropertyValue('--okw-question-title-width') !== value) {
      card.style.setProperty('--okw-question-title-width', value);
    }
  };

  const removeMirror = (card, state) => {
    if (card.classList.contains(ACTIVE_CLASS)) card.classList.remove(ACTIVE_CLASS);
    if (card.style.getPropertyValue('--okw-question-title-width')) {
      card.style.removeProperty('--okw-question-title-width');
    }
    state.mirror?.remove();
    state.mirror = null;
    state.active = false;
  };

  const activate = (card, state, parts, text, resetScroll) => {
    setTitleWidth(card, parts);
    let mirror = state.mirror;
    if (!mirror?.isConnected) {
      mirror = document.createElement('div');
      mirror.className = MIRROR_CLASS;
      parts.body.prepend(mirror);
      state.mirror = mirror;
    }
    if (mirror.textContent !== text) mirror.textContent = text;
    if (!card.classList.contains(ACTIVE_CLASS)) card.classList.add(ACTIVE_CLASS);
    state.active = true;
    if (resetScroll) parts.body.scrollTop = 0;
  };

  const setMinimumHeight = (card, parts) => {
    const value = `${minimumCardHeight(card, parts)}px`;
    if (card.style.getPropertyValue('--okw-question-card-min-height') !== value) {
      card.style.setProperty('--okw-question-card-min-height', value);
    }
  };

  const heightLimits = (card) => {
    const style = window.getComputedStyle(card);
    const viewport = number(style.getPropertyValue('--app-height')) ||
      window.visualViewport?.height || window.innerHeight;
    const clearance = number(style.getPropertyValue('--dock-card-top-clearance'));
    const maximum = Math.max(0, Math.min(viewport * .85, viewport - clearance));
    const minimum = Math.min(
      Math.max(viewport * .35, minimumCardHeight(card, partsOf(card))),
      maximum,
    );
    return { maximum, minimum, viewport };
  };

  const setHandleValue = (handle, value) => {
    const rounded = Math.round(value);
    handle.setAttribute('aria-valuenow', String(rounded));
    handle.setAttribute('aria-valuetext', `${rounded}%`);
  };

  const applySavedHeight = (card, state) => {
    if (savedHeightStep === null) {
      if (card.classList.contains(FIXED_CLASS)) card.classList.remove(FIXED_CLASS);
      card.style.removeProperty('--okw-question-card-height-tier');
    } else {
      const value = String(savedHeightStep / 100);
      if (card.style.getPropertyValue('--okw-question-card-height-tier') !== value) {
        card.style.setProperty('--okw-question-card-height-tier', value);
      }
      if (!card.classList.contains(FIXED_CLASS)) card.classList.add(FIXED_CLASS);
    }
    if (state.handle) setHandleValue(state.handle, savedHeightStep ?? 50);
  };

  const saveHeightStep = (step) => {
    if (!HEIGHT_STEPS.includes(step)) return;
    savedHeightStep = step;
    try {
      localStorage.setItem(STORAGE_KEY, String(step));
    } catch {
      // Keep the selected height for this page when storage is unavailable.
    }
    cards.forEach(schedule);
  };

  const stepHeight = (step, limits) => Math.min(
    limits.maximum,
    Math.max(limits.minimum, limits.viewport * step / 100),
  );

  const nearestStep = (height, limits) => HEIGHT_STEPS.reduce((best, step) => {
    const distance = Math.abs(stepHeight(step, limits) - height);
    const bestDistance = Math.abs(stepHeight(best, limits) - height);
    return distance <= bestDistance ? step : best;
  });

  const clearDrag = (card, state) => {
    if (card.classList.contains(DRAGGING_CLASS)) card.classList.remove(DRAGGING_CLASS);
    card.style.removeProperty('--okw-question-card-preview-height');
    state.drag = null;
    applySavedHeight(card, state);
    schedule(card);
  };

  const finishDrag = (event, card, state, commit) => {
    const drag = state.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    state.drag = null;
    if (state.handle?.hasPointerCapture?.(event.pointerId)) state.handle.releasePointerCapture(event.pointerId);
    if (commit && drag.moved) saveHeightStep(nearestStep(drag.height, drag.limits));
    clearDrag(card, state);
  };

  const moveDrag = (event, card, state) => {
    const drag = state.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = drag.startY - event.clientY;
    if (Math.abs(delta) >= 2) drag.moved = true;
    drag.height = Math.min(drag.limits.maximum, Math.max(drag.limits.minimum, drag.startHeight + delta));
    card.style.setProperty('--okw-question-card-preview-height', `${drag.height}px`);
    setHandleValue(state.handle, drag.height / drag.limits.viewport * 100);
    if (!state.active) {
      const parts = partsOf(card);
      if (needsMirror(card, parts)) activate(card, state, parts, state.titleText, false);
    }
  };

  const startDrag = (event, card, state) => {
    if (event.button !== 0 || state.drag) return;
    event.preventDefault();
    const limits = heightLimits(card);
    state.drag = {
      height: card.getBoundingClientRect().height,
      limits,
      moved: false,
      pointerId: event.pointerId,
      startHeight: card.getBoundingClientRect().height,
      startY: event.clientY,
    };
    card.classList.add(DRAGGING_CLASS);
    card.style.setProperty('--okw-question-card-preview-height', `${state.drag.height}px`);
    state.handle.setPointerCapture?.(event.pointerId);
  };

  const handleKey = (event, card) => {
    const current = savedHeightStep ?? 50;
    const index = HEIGHT_STEPS.indexOf(current);
    let next = null;
    if (event.key === 'ArrowUp') next = HEIGHT_STEPS[Math.min(HEIGHT_STEPS.length - 1, index + 1)];
    else if (event.key === 'ArrowDown') next = HEIGHT_STEPS[Math.max(0, index - 1)];
    else if (event.key === 'Home') [next] = HEIGHT_STEPS;
    else if (event.key === 'End') next = HEIGHT_STEPS.at(-1);
    if (next === null) return;
    event.preventDefault();
    saveHeightStep(next);
    schedule(card);
  };

  const createHandle = (card, state) => {
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = HANDLE_CLASS;
    handle.setAttribute('role', 'slider');
    handle.setAttribute('aria-label', '调整提问卡片高度');
    handle.setAttribute('aria-valuemin', '35');
    handle.setAttribute('aria-valuemax', '85');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.addEventListener('pointerdown', (event) => startDrag(event, card, state));
    handle.addEventListener('pointermove', (event) => moveDrag(event, card, state));
    handle.addEventListener('pointerup', (event) => finishDrag(event, card, state, true));
    handle.addEventListener('pointercancel', (event) => finishDrag(event, card, state, false));
    handle.addEventListener('lostpointercapture', (event) => finishDrag(event, card, state, false));
    handle.addEventListener('keydown', (event) => handleKey(event, card));
    card.prepend(handle);
    state.handle = handle;
    applySavedHeight(card, state);
  };

  const removeHandle = (card, state) => {
    if (state.drag) clearDrag(card, state);
    state.handle?.remove();
    state.handle = null;
    if (card.classList.contains(FIXED_CLASS)) card.classList.remove(FIXED_CLASS);
    if (card.classList.contains(DRAGGING_CLASS)) card.classList.remove(DRAGGING_CLASS);
    card.style.removeProperty('--okw-question-card-height-tier');
    card.style.removeProperty('--okw-question-card-preview-height');
    card.style.removeProperty('--okw-question-card-min-height');
  };

  const canEnhance = (card, parts) => mobile.matches && card.closest('.app.mobile') &&
    !card.classList.contains('minimized') && parts.header && parts.title && parts.body && parts.footer;

  const observeParts = (state, parts) => {
    if (!resizeObserver || sameParts(state.parts, parts)) return;
    Object.values(state.parts).forEach((node) => node && resizeObserver.unobserve(node));
    Object.values(parts).forEach((node) => node && resizeObserver.observe(node));
  };

  const syncTitleText = (state, parts) => {
    const text = parts.title?.textContent ?? '';
    if (text === state.titleText) return text;
    state.titleText = text;
    state.resetScroll = true;
    return text;
  };

  const ensureHandle = (card, state, parts) => {
    if (state.handle?.isConnected) return;
    createHandle(card, state);
    parts.handle = state.handle;
    resizeObserver?.observe(state.handle);
  };

  const syncMirror = (card, state, parts, text) => {
    if (state.active) setTitleWidth(card, parts);
    if (!needsMirror(card, parts)) {
      removeMirror(card, state);
      return;
    }
    activate(card, state, parts, text, state.resetScroll);
    state.resetScroll = false;
  };

  const evaluate = (card) => {
    const state = states.get(card);
    if (!state) return;
    if (!card.isConnected) {
      untrack(card);
      return;
    }
    const parts = partsOf(card);
    observeParts(state, parts);
    state.parts = parts;
    const text = syncTitleText(state, parts);
    if (!canEnhance(card, parts)) {
      removeHandle(card, state);
      removeMirror(card, state);
      return;
    }
    ensureHandle(card, state, parts);
    setMinimumHeight(card, parts);
    applySavedHeight(card, state);
    if (state.drag) {
      if (state.active && state.mirror?.textContent !== text) state.mirror.textContent = text;
      return;
    }
    syncMirror(card, state, parts, text);
  };

  const flush = () => {
    frame = null;
    const pending = Array.from(scheduled);
    scheduled.clear();
    pending.forEach(evaluate);
  };

  const schedule = (card) => {
    if (!states.has(card)) return;
    scheduled.add(card);
    if (frame !== null) return;
    frame = window.requestAnimationFrame(flush);
  };

  const track = (card) => {
    if (states.has(card)) {
      const state = states.get(card);
      cards.add(card);
      resizeObserver?.observe(card);
      Object.values(state.parts).forEach((node) => node && resizeObserver?.observe(node));
      schedule(card);
      return;
    }
    const parts = partsOf(card);
    const state = {
      active: false,
      drag: null,
      handle: parts.handle,
      mirror: null,
      parts,
      resetScroll: true,
      titleText: parts.title?.textContent ?? '',
    };
    states.set(card, state);
    cards.add(card);
    resizeObserver?.observe(card);
    Object.values(parts).forEach((node) => node && resizeObserver?.observe(node));
    schedule(card);
  };

  const cardOf = (node) => {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return element?.matches('.qcard') ? element : element?.closest('.qcard');
  };

  const trackTree = (node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.matches('.qcard')) track(node);
    node.querySelectorAll('.qcard').forEach(track);
  };

  const untrack = (card) => {
    const state = states.get(card);
    if (!state) return;
    scheduled.delete(card);
    cards.delete(card);
    resizeObserver?.unobserve(card);
    Object.values(state.parts).forEach((node) => node && resizeObserver?.unobserve(node));
  };

  const untrackTree = (node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.matches('.qcard')) untrack(node);
    node.querySelectorAll('.qcard').forEach(untrack);
  };

  const scheduleTree = (node) => {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element) return;
    const card = cardOf(element);
    if (card) schedule(card);
    if (element.matches('.app, .qcard')) element.querySelectorAll('.qcard').forEach(schedule);
  };

  const mutationObserver = new MutationObserver((records) => {
    for (const record of records) {
      const targetElement = record.target.nodeType === Node.ELEMENT_NODE
        ? record.target
        : record.target.parentElement;
      if (targetElement?.closest(`.${MIRROR_CLASS}`)) continue;
      scheduleTree(record.target);
      if (record.type !== 'childList') continue;
      record.addedNodes.forEach(trackTree);
      record.addedNodes.forEach(scheduleTree);
      record.removedNodes.forEach(untrackTree);
    }
  });

  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver((entries) => entries.forEach(({ target }) => schedule(cardOf(target) ?? target)))
    : null;

  const scan = () => document.querySelectorAll('.qcard').forEach(track);
  mutationObserver.observe(document.documentElement, {
    attributeFilter: ['class'],
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan, { once: true });
  else scan();
  const scheduleAll = () => cards.forEach(schedule);
  mobile.addEventListener?.('change', scheduleAll);
  mobile.addListener?.(scheduleAll);
  window.addEventListener('resize', scheduleAll, { passive: true });
})();
