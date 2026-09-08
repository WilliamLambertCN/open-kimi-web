{
  const states = new WeakMap();
  const rowsOf = (form) => Array.from(form.querySelectorAll('.pf-models > .pf-model-grid:not(.pf-model-head)'));
  const sameRows = (left, right) => left.length === right.length && left.every((row, index) => row === right[index]);

  const stateFor = (form) => {
    const current = rowsOf(form);
    let state = states.get(form);
    if (!state) {
      state = { officialRows: [...current], visualRows: [...current] };
      states.set(form, state);
      return state;
    }
    const present = new Set(current);
    state.officialRows = state.officialRows.filter((row) => present.has(row));
    state.visualRows = state.visualRows.filter((row) => present.has(row));
    const known = new Set(state.officialRows);
    for (const row of current) {
      if (known.has(row)) continue;
      state.officialRows.push(row);
      state.visualRows.push(row);
    }
    return state;
  };

  const applyVisualOrder = (form, state) => {
    const current = rowsOf(form);
    if (sameRows(current, state.visualRows) || state.visualRows.length === 0) return;
    const container = state.visualRows[0].parentElement;
    const afterRows = current.at(-1)?.nextSibling ?? null;
    for (const row of state.visualRows) container.insertBefore(row, afterRows);
  };

  const reconcile = (form) => {
    const state = stateFor(form);
    applyVisualOrder(form, state);
    return state;
  };

  const clearIndicators = (form) => {
    for (const row of rowsOf(form)) {
      row.classList.remove('okw-model-drop-before', 'okw-model-drop-after');
    }
  };

  const dropIndexAt = (form, source, clientY) => {
    const candidates = rowsOf(form).filter((row) => row !== source);
    const index = candidates.findIndex((row) => {
      const rect = row.getBoundingClientRect();
      return clientY < rect.top + rect.height / 2;
    });
    return index < 0 ? candidates.length : index;
  };

  const showIndicator = (form, source, index) => {
    clearIndicators(form);
    const candidates = rowsOf(form).filter((row) => row !== source);
    if (index < candidates.length) candidates[index].classList.add('okw-model-drop-before');
    else candidates.at(-1)?.classList.add('okw-model-drop-after');
  };

  const moveRow = (form, source, index) => {
    const candidates = rowsOf(form).filter((row) => row !== source);
    const before = candidates[index];
    if (before) before.before(source);
    else candidates.at(-1)?.after(source);
    const state = stateFor(form);
    state.visualRows = rowsOf(form);
    form.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const beginDrag = (form, row, handle, event) => {
    if (handle.disabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    handle.setPointerCapture?.(event.pointerId);
    const drag = { active: false, index: null, pointerId: event.pointerId, startY: event.clientY };
    const move = (moveEvent) => {
      if (moveEvent.pointerId !== drag.pointerId) return;
      if (!drag.active && Math.abs(moveEvent.clientY - drag.startY) < 6) return;
      drag.active = true;
      row.classList.add('okw-model-dragging');
      handle.setAttribute('aria-grabbed', 'true');
      drag.index = dropIndexAt(form, row, moveEvent.clientY);
      showIndicator(form, row, drag.index);
      moveEvent.preventDefault();
    };
    const finish = (finishEvent) => {
      if (finishEvent.pointerId !== drag.pointerId) return;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', cancel);
      row.classList.remove('okw-model-dragging');
      handle.setAttribute('aria-grabbed', 'false');
      clearIndicators(form);
      if (drag.active && drag.index !== null) moveRow(form, row, drag.index);
    };
    const cancel = (cancelEvent) => {
      if (cancelEvent.pointerId !== drag.pointerId) return;
      drag.active = false;
      finish(cancelEvent);
    };
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', cancel);
  };

  const enhanceRow = (form, row, disabled, label) => {
    const existing = row.querySelector('.okw-model-drag-handle');
    if (existing) {
      existing.disabled = disabled;
      return;
    }
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'okw-model-drag-handle';
    handle.textContent = '⠿';
    handle.title = label;
    handle.setAttribute('aria-label', label);
    handle.setAttribute('aria-grabbed', 'false');
    handle.disabled = disabled;
    handle.addEventListener('pointerdown', (event) => beginDrag(form, row, handle, event));
    row.classList.add('okw-sortable-model');
    row.prepend(handle);
  };

  const mapModels = (form, models) => {
    const state = reconcile(form);
    if (state.officialRows.length !== models.length || state.visualRows.length !== models.length) {
      return models.map((model, index) => ({ model, row: rowsOf(form)[index] ?? null }));
    }
    const byRow = new Map(state.officialRows.map((row, index) => [row, models[index]]));
    return state.visualRows.map((row) => ({ model: byRow.get(row), row }));
  };

  window.OpenKimiProviderSorting = Object.freeze({ enhanceRow, mapModels, reconcile });
}
