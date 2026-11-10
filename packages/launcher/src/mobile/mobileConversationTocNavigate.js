{
  if (!window.__okwMobileTocNavigate) {
    const codes = new Set(['aborted', 'stale', 'identity', 'unavailable', 'boundary', 'stalled', 'timeout', 'limit', 'failed']);
    const failure = (code) => Object.assign(new Error(code), { code });
    const check = (context) => {
      if (context.signal.aborted || context.interrupted) throw failure('aborted');
      if (!context.isCurrent() || !context.root.isConnected || context.chat.parentElement !== context.parent) {
        throw failure('stale');
      }
      if (!context.root.contains(context.chat)) throw failure('stale');
      if (performance.now() >= context.deadline) throw failure('timeout');
    };
    const positionsOf = (items, id) => {
      if (!Array.isArray(items) || typeof id !== 'string' || !id) throw failure('identity');
      const positions = new Map();
      for (const item of items) {
        if (typeof item?.id !== 'string' || !item.id || positions.has(item.id)) throw failure('identity');
        positions.set(item.id, positions.size);
      }
      if (!positions.has(id)) throw failure('unavailable');
      return positions;
    };
    const prepare = ({ root, id, items, signal, isCurrent }) => {
      const positions = positionsOf(items, id);
      if (!root?.matches('.chat-scroll') || !root.isConnected || typeof isCurrent !== 'function') {
        throw failure('unavailable');
      }
      if (!signal || typeof signal.addEventListener !== 'function') throw failure('unavailable');
      const chats = root.querySelectorAll(':scope > .chat, :scope > .content-wrap > .chat');
      if (chats.length !== 1) throw failure('unavailable');
      const chat = chats[0];
      const windows = chat.querySelectorAll(':scope > .history-window[data-virtual-scroll-root]');
      if (windows.length > 1) throw failure('identity');
      return { root, chat, id, positions, signal, isCurrent, history: windows[0], parent: chat.parentElement,
        deadline: performance.now() + 4000 };
    };
    const positive = (value) => /^[1-9]\d*$/.test(value ?? '') && Number.isSafeInteger(Number(value));
    const rowOf = (row) => {
      const key = row.getAttribute('data-history-key');
      const pos = row.getAttribute('aria-posinset'); const size = row.getAttribute('aria-setsize');
      if (!key || !positive(pos) || !positive(size) || Number(pos) > Number(size)) throw failure('identity');
      return { row, key, pos: Number(pos), size: Number(size) };
    };
    const rowsOf = (context) => {
      if (!context.history) return [];
      if (context.history.parentElement !== context.chat) throw failure('stale');
      const rows = [...context.history.querySelectorAll(':scope > .history-row')].map(rowOf);
      const keys = new Set(); const positions = new Set(); const size = rows[0]?.size;
      for (const entry of rows) {
        if (keys.has(entry.key) || positions.has(entry.pos) || entry.size !== size) throw failure('identity');
        if (context.size !== undefined && entry.size !== context.size) throw failure('stale');
        keys.add(entry.key); positions.add(entry.pos);
      }
      return rows;
    };
    const bubblesOf = (parent) => [...parent.querySelectorAll(':scope > .u-turn > .u-bub.turn-anchor[data-turn-id]')];
    const targetOf = (context, rows) => {
      const matches = bubblesOf(context.chat).filter((node) => node.getAttribute('data-turn-id') === context.id);
      for (const entry of rows) {
        const bubbles = bubblesOf(entry.row).filter((node) => node.getAttribute('data-turn-id') === context.id);
        if (bubbles.length && entry.key !== context.id) throw failure('identity');
        matches.push(...bubbles);
      }
      if (matches.length > 1) throw failure('identity');
      return matches[0];
    };
    const startOf = (context, rows) => {
      let nearest; let distance = Infinity;
      for (const entry of rows) {
        if (!context.positions.has(entry.key)) continue;
        const bubbles = bubblesOf(entry.row);
        if (bubbles.length !== 1 || bubbles[0].getAttribute('data-turn-id') !== entry.key) throw failure('identity');
        const next = Math.abs(context.positions.get(entry.key) - context.positions.get(context.id));
        if (next < distance) { nearest = entry; distance = next; }
      }
      if (!nearest) throw failure('unavailable');
      return nearest;
    };
    const waitForRow = (context, expected, click) => new Promise((resolve, reject) => {
      let settled = false; let observer; let timer;
      const finish = (error, row) => {
        if (settled) return;
        settled = true; observer?.disconnect(); clearTimeout(timer);
        context.history.removeEventListener('focusin', probe);
        context.signal.removeEventListener('abort', aborted);
        if (error) reject(error); else resolve(row);
      };
      const probe = () => {
        if (settled) return;
        try {
          check(context);
          const next = rowsOf(context).find((entry) => entry.pos === expected);
          if (!next) return;
          if (next.key === context.current.key) throw failure('identity');
          if (context.chat.ownerDocument.activeElement === next.row) finish(null, next);
        } catch (error) { finish(error); }
      };
      const aborted = () => finish(failure('aborted'));
      const stalled = () => {
        try { check(context); finish(failure('stalled')); } catch (error) { finish(error); }
      };
      observer = new MutationObserver(probe); observer.observe(context.history, { childList: true });
      context.history.addEventListener('focusin', probe);
      context.signal.addEventListener('abort', aborted, { once: true });
      timer = setTimeout(stalled, Math.min(400, context.deadline - performance.now()));
      try { check(context); click(); probe(); } catch (error) { finish(error); }
    });
    const advance = (context, direction) => {
      check(context);
      const current = rowsOf(context).find((entry) => entry.row === context.current.row);
      if (!current || current.key !== context.current.key || current.pos !== context.current.pos) throw failure('stale');
      const expected = current.pos + direction;
      if (expected < 1 || expected > current.size) throw failure('boundary');
      const name = direction < 0 ? 'history-previous' : 'history-next';
      const buttons = current.row.querySelectorAll(`:scope > button.${name}`);
      if (buttons.length !== 1 || buttons[0].disabled || buttons[0].hidden) throw failure('boundary');
      return waitForRow(context, expected, () => buttons[0].click());
    };
    const pause = (context) => new Promise((resolve, reject) => {
      const aborted = () => finish(failure('aborted'));
      const finish = (error) => {
        clearTimeout(timer); context.signal.removeEventListener('abort', aborted);
        if (error) reject(error); else resolve();
      };
      const timer = setTimeout(() => {
        try { check(context); finish(); } catch (error) { finish(error); }
      }, 120);
      context.signal.addEventListener('abort', aborted, { once: true });
      try { check(context); } catch (error) { finish(error); }
    });
    const visibleArea = (context) => {
      const rect = context.root.getBoundingClientRect();
      const parent = context.root.parentElement;
      const dock = parent.querySelector(':scope > .chat-dock')?.getBoundingClientRect();
      const header = context.root.closest('.app')?.querySelector(':scope > .topbar')?.getBoundingClientRect();
      const bottom = Math.min(rect.bottom, window.innerHeight, dock?.top ?? Infinity);
      const top = Math.max(rect.top, 0, header?.bottom ?? 0);
      if (bottom <= top || rect.width <= 0) throw failure('unavailable');
      return { top, bottom };
    };
    const locationOf = (context, node) => {
      const rect = node.getBoundingClientRect(); const area = visibleArea(context);
      if (rect.width <= 0 || rect.height <= 0) throw failure('unavailable');
      const height = Math.min(rect.height, area.bottom - area.top);
      const desired = area.top + (area.bottom - area.top - height) / 2;
      const max = Math.max(0, context.root.scrollHeight - context.root.clientHeight);
      const scroll = Math.max(0, Math.min(max, context.root.scrollTop + rect.top - desired));
      const visible = rect.top >= area.top - 1 && rect.top + height <= area.bottom + 1;
      return { top: rect.top, height: rect.height, scroll, visible, documentTop: rect.top + context.root.scrollTop };
    };
    const sameLocation = (left, right) => left && Math.abs(left.top - right.top) < 1 &&
      Math.abs(left.height - right.height) < 1 && Math.abs(left.documentTop - right.documentTop) < 1;
    const beginAlignment = (context, node) => {
      check(context);
      if (!node?.isConnected || typeof node.scrollIntoView !== 'function') throw failure('unavailable');
      const row = node.parentElement.parentElement;
      if (row.parentElement === context.history && row.getAttribute('data-history-key') === context.id) {
        row.focus({ preventScroll: true });
      }
      context.size = undefined; check(context);
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      context.aligning = true;
      node.scrollIntoView({ block: 'center', behavior: reduced ? 'instant' : 'smooth' });
    };
    const correct = (context, location, elapsed) => {
      if (elapsed < 480 || Math.abs(location.scroll - context.root.scrollTop) <= 2) return false;
      context.root.scrollTo({ top: location.scroll, behavior: 'instant' }); return true;
    };
    const align = async (context, node) => {
      beginAlignment(context, node);
      const started = performance.now(); let previous; let stable = 0;
      for (let sample = 0; sample < 24; sample += 1) {
        await pause(context); check(context);
        if (targetOf(context, rowsOf(context)) !== node) throw failure('stale');
        const location = locationOf(context, node);
        const elapsed = performance.now() - started;
        if (correct(context, location, elapsed)) stable = 0;
        else stable = location.visible && sameLocation(previous, location) ? stable + 1 : 0;
        if (elapsed >= 2000 && stable >= 3) return true;
        previous = location;
      }
      throw failure('stalled');
    };
    const reveal = async (context) => {
      const initial = rowsOf(context); const direct = targetOf(context, initial);
      if (!direct) {
        context.current = startOf(context, initial); context.size = context.current.size;
      }
      context.root.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }));
      check(context);
      const direction = context.positions.get(context.current?.key) < context.positions.get(context.id) ? 1 : -1;
      for (let step = 0; step <= 512; step += 1) {
        check(context);
        const target = targetOf(context, rowsOf(context));
        if (target) return align(context, target);
        if (direct) throw failure('stale');
        if (step === 512) throw failure('limit');
        context.current = await advance(context, direction);
      }
    };
    const navigate = async (options) => {
      const context = prepare(options); check(context);
      const stopMotion = () => {
        if (!context.aligning || !context.isCurrent() || !context.root.isConnected ||
          context.chat.parentElement !== context.parent || !context.root.contains(context.chat)) return;
        context.aligning = false;
        context.root.scrollTo({ top: context.root.scrollTop, behavior: 'instant' });
      };
      const interrupt = () => { context.interrupted = true; stopMotion(); };
      const wheel = (event) => { if (event.isTrusted) interrupt(); };
      const key = (event) => {
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Escape', 'Tab'].includes(event.key)) interrupt();
      };
      const bindings = [[context.root, 'wheel', wheel], [context.root, 'pointerdown', interrupt],
        [context.root, 'touchstart', interrupt], [context.chat.ownerDocument, 'keydown', key],
        [context.signal, 'abort', stopMotion]];
      for (const [target, type, callback] of bindings) target.addEventListener(type, callback, { capture: true, passive: true });
      try { return await reveal(context); }
      finally {
        context.aligning = false;
        for (const [target, type, callback] of bindings) target.removeEventListener(type, callback, true);
      }
    };
    window.__okwMobileTocNavigate = async (options) => {
      try { return await navigate(options); }
      catch (error) { throw failure(codes.has(error?.code) ? error.code : 'failed'); }
    };
  }
}
