{
  const installed = Symbol.for('open-kimi-web.touch-tooltip');
  if (!window[installed]) {
    window[installed] = true;
    const selector = '.ui-tip, .ui-icon-button, .ui-number-input__step';
    let sources = new Set();
    let touch = false;
    let pending = false;
    const hide = (source) => {
      source.dispatchEvent(new MouseEvent('mouseout', { relatedTarget: null }));
      source.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: null }));
    };
    const dismiss = () => {
      const previous = sources;
      sources = new Set();
      previous.forEach(hide);
    };
    const track = (target) => {
      const next = new Set();
      let node = target instanceof Element ? target : null;
      while (node) {
        if (node.matches(selector)) next.add(node);
        node = node.parentElement;
      }
      for (const source of sources) if (!next.has(source)) hide(source);
      sources = next;
    };
    const dismissAfterDispatch = () => {
      if (pending || !sources.size) return;
      pending = true;
      window.setTimeout(() => { pending = false; if (touch) dismiss(); }, 0);
    };
    const fromTouch = (event) => event.pointerType === 'touch' || event.sourceCapabilities?.firesTouchEvents === true;
    const pointerMove = (event) => {
      touch = fromTouch(event);
      track(event.target);
      if (touch) dismissAfterDispatch();
    };
    const pointerDown = (event) => {
      dismiss();
      touch = fromTouch(event);
      track(event.target);
      if (touch) dismissAfterDispatch();
    };
    const pointerEnd = (event) => {
      if (!fromTouch(event)) return;
      touch = true;
      track(event.target);
      dismissAfterDispatch();
    };
    const focus = (event) => {
      track(event.target);
      if (touch) dismissAfterDispatch();
    };
    const key = (event) => {
      if (['Alt', 'Control', 'Meta', 'Shift'].includes(event.key)) return;
      touch = false;
      if (event.key === 'Escape') dismiss();
    };
    const passive = { capture: true, passive: true };
    document.addEventListener('pointerdown', pointerDown, passive);
    document.addEventListener('pointermove', pointerMove, passive);
    document.addEventListener('pointerup', pointerEnd, passive);
    document.addEventListener('pointercancel', pointerEnd, passive);
    document.addEventListener('focusin', focus, true);
    document.addEventListener('keydown', key, true);
    document.addEventListener('click', dismiss, true);
    window.addEventListener('scroll', dismiss, passive);
    window.addEventListener('blur', dismiss);
    window.addEventListener('pagehide', dismiss);
    document.addEventListener('visibilitychange', () => { if (document.hidden) dismiss(); });
  }
}
