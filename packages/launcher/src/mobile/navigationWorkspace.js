{
  const text = (zh, en) => window.__okwLocale?.text(zh, en) ?? en;
  const el = (tag, content) => {
    const node = document.createElement(tag);
    if (content !== undefined) node.textContent = content;
    return node;
  };
  const build = (state, close, submit) => {
    const root = el('div'); root.className = 'okw-navigation-search-backdrop'; root.hidden = true;
    const panel = el('section'); panel.className = 'okw-navigation-search-panel okw-navigation-workspace-panel';
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'okw-navigation-workspace-title');
    const title = el('h2'); title.id = 'okw-navigation-workspace-title';
    const hint = el('p'); hint.className = 'okw-navigation-search-status';
    const form = el('form'); form.className = 'okw-navigation-search-form';
    const label = el('label'); const caption = el('span'); const input = el('input');
    input.type = 'text'; input.required = true; input.autocomplete = 'off'; input.spellcheck = false;
    input.setAttribute('autocorrect', 'off'); input.setAttribute('autocapitalize', 'none');
    input.setAttribute('aria-describedby', 'okw-navigation-workspace-hint'); hint.id = 'okw-navigation-workspace-hint';
    label.append(caption, input);
    const status = el('p'); status.className = 'okw-navigation-search-status'; status.setAttribute('role', 'status');
    const actions = el('div'); actions.className = 'okw-navigation-workspace-actions';
    const cancel = el('button'); cancel.type = 'button'; cancel.addEventListener('click', close);
    const save = el('button'); save.type = 'submit'; actions.append(cancel, save);
    const browse = el('button'); browse.type = 'button'; browse.className = 'okw-workspace-browse';
    const folders = window.__okwNavigationCreateFolderPicker(form, (path) => { input.value = path; input.focus(); });
    browse.addEventListener('click', () => folders.open(input.value.trim().replace(/^(['"])([\s\S]*)\1$/, '$2') || undefined));
    form.prepend(label, browse); form.append(status, actions);
    form.addEventListener('submit', (event) => { event.preventDefault(); void submit(); });
    panel.append(title, hint, form); root.append(panel); document.body.append(root);
    root.addEventListener('click', (event) => { if (event.target === root) close(); });
    const localize = () => {
      title.textContent = text('新建工作空间', 'New workspace'); caption.textContent = text('目录路径', 'Directory path');
      hint.textContent = text('浏览或粘贴 Kimi 运行端已有文件夹的路径，不是此浏览器所在设备的路径。不会创建文件夹或切换当前会话。',
        'Browse or paste an existing folder on the Kimi server, not this browser’s device. ' +
        'No folder is created or session switched.');
      browse.textContent = text('浏览文件夹', 'Browse folders');
      cancel.textContent = text('关闭', 'Close'); save.textContent = text('添加工作空间', 'Add workspace');
    };
    localize(); state.ui = { root, panel, input, status, save, browse, folders, localize };
  };
  window.__okwNavigationCreateWorkspace = () => {
    const state = { opened: false, generation: 0, busy: false, inert: [] };
    const message = (value, error = false) => {
      state.ui.status.textContent = value; state.ui.status.dataset.error = String(error);
    };
    const busy = (value) => {
      state.busy = value; state.ui.save.disabled = value; state.ui.browse.disabled = value; state.ui.input.disabled = value;
    };
    const reported = (result) => {
      if (result?.existing) {
        message(text('此目录已有工作空间，未重复添加。当前会话保持不变，可在列表选择。',
          'This directory already has a workspace, nothing was added. ' +
          'Your current session is unchanged. Select it from the list.'));
        return;
      }
      state.ui.input.value = '';
      message(text('已添加工作空间。当前会话保持不变，可在工作空间列表中选择。',
        'Workspace added. Your current session is unchanged. Select it from the workspace list.'));
    };
    const close = () => {
      if (!state.opened) return;
      state.opened = false; state.generation += 1; state.controller?.abort(); busy(false); state.ui.folders.close();
      state.ui.root.hidden = true; state.ui.input.value = '';
      for (const [node, previous] of state.inert) if (node.isConnected) node.inert = previous;
      document.documentElement.classList.remove('okw-navigation-search-open');
      if (state.opener?.isConnected) state.opener.focus();
    };
    const submit = async () => {
      if (state.busy || !state.ui.input.value.trim()) return;
      busy(true); state.ui.folders.close(); state.controller = new AbortController();
      const generation = ++state.generation;
      message(text('正在验证目录并添加…', 'Validating the directory and adding…'));
      try {
        const result = await window.__okwNavigationAddWorkspace(state.ui.input.value, state.controller.signal);
        if (!state.opened || state.generation !== generation) return;
        reported(result);
      } catch (error) {
        if (state.opened && state.generation === generation) message(error.message, true);
      } finally {
        if (state.generation === generation) busy(false);
      }
    };
    document.addEventListener('keydown', (event) => {
      if (state.opened) window.__okwNavigationSearchKey(event, { panel: state.ui.panel, close });
    }, true);
    window.__okwLocale?.observe(() => { state.ui?.localize(); });
    return {
      open(opener) {
        if (state.opened) { state.ui.input.focus(); return; }
        if (!state.ui) build(state, close, submit);
        state.opener = opener; state.opened = true; state.ui.root.hidden = false; state.ui.save.disabled = false;
        state.inert = [...document.querySelectorAll('#app, .sheet-root')].map((node) => [node, node.inert]);
        for (const [node] of state.inert) node.inert = true;
        message(''); document.documentElement.classList.add('okw-navigation-search-open'); state.ui.input.focus();
      }, close,
    };
  };
}
