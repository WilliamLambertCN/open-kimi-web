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
      const nearBottom = () => body.scrollHeight - body.clientHeight - scrollTop.get.call(body) <= bottomTolerance;

      try {
        Object.defineProperty(body, 'scrollTop', {
          configurable: true,
          get() {
            return scrollTop.get.call(this);
          },
          set(value) {
            const target = Number(value);
            const bottom = this.scrollHeight - this.clientHeight;
            if (!follow && Number.isFinite(target) && target >= bottom - bottomTolerance) return;
            scrollTop.set.call(this, value);
          },
        });
      } catch {
        // Keep the official scroll behavior if this browser disallows an instance override.
        return;
      }

      guarded.add(body);
      body.addEventListener('scroll', () => {
        follow = nearBottom();
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
