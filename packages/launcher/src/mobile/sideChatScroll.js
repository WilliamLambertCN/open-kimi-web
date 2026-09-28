{
  const guardKey = Symbol.for('open-kimi-web.side-chat-scroll');
  const scrollTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');

  if (!window[guardKey] && scrollTop?.get && scrollTop?.set && typeof MutationObserver !== 'undefined') {
    window[guardKey] = true;
    const guarded = new WeakSet();
    const bottomTolerance = 2;

    function guard(body) {
      if (guarded.has(body) || Object.hasOwn(body, 'scrollTop')) return;
      let follow = true;
      let lastTouchY = null;
      let pendingBottomTop = null;
      let lastObservedTop = null;
      let lastObservedBottom = -Infinity;
      const matchesTop = (top, expected) => expected !== null && Math.abs(top - expected) <= bottomTolerance;

      try {
        Object.defineProperty(body, 'scrollTop', {
          configurable: true,
          get() {
            return scrollTop.get.call(this);
          },
          set(value) {
            if (follow) {
              scrollTop.set.call(this, value);
              const target = Number(value);
              const actual = scrollTop.get.call(this);
              pendingBottomTop = Number.isFinite(target) && target > actual + bottomTolerance ? actual : null;
              return;
            }
            const target = Number(value);
            const bottom = this.scrollHeight - this.clientHeight;
            if (Number.isFinite(target) && target >= bottom - bottomTolerance) return;
            pendingBottomTop = null;
            scrollTop.set.call(this, value);
          },
        });
      } catch {
        // Keep the official scroll behavior if this browser disallows an instance override.
        return;
      }

      guarded.add(body);
      body.addEventListener('scroll', () => {
        const top = scrollTop.get.call(body);
        const bottom = body.scrollHeight - body.clientHeight;
        const delayedProgrammatic = matchesTop(top, pendingBottomTop);
        const delayedGrowth = follow && matchesTop(top, lastObservedTop) && bottom > lastObservedBottom;
        pendingBottomTop = null;
        lastObservedTop = top;
        lastObservedBottom = bottom;
        if (!delayedProgrammatic && !delayedGrowth) follow = bottom - top <= bottomTolerance;
      }, { passive: true });
      body.addEventListener('wheel', (event) => {
        if (event.deltaY < 0 && body.scrollHeight > body.clientHeight) follow = false;
      }, { passive: true });
      body.addEventListener('keydown', (event) => {
        if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) follow = false;
      });
      body.addEventListener('touchstart', (event) => {
        lastTouchY = event.touches[0]?.clientY ?? null;
      }, { passive: true });
      body.addEventListener('touchmove', (event) => {
        const touchY = event.touches[0]?.clientY;
        if (touchY !== undefined && lastTouchY !== null && touchY > lastTouchY) follow = false;
        lastTouchY = touchY ?? null;
      }, { passive: true });
      body.addEventListener('touchend', () => {
        lastTouchY = null;
      }, { passive: true });
    }

    function guardWithin(node) {
      if (!(node instanceof Element)) return;
      if (node.matches('.sc-body')) guard(node);
      node.querySelectorAll('.sc-body').forEach(guard);
    }

    guardWithin(document.documentElement);
    new MutationObserver((changes) => {
      for (const change of changes) {
        change.addedNodes.forEach(guardWithin);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
}
