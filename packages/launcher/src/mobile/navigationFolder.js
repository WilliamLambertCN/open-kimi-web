{
  const text = (zh, en) => window.__okwLocale?.text(zh, en) ?? en;
  const node = (tag, className = '') => {
    const result = document.createElement(tag); result.className = className; return result;
  };
  const button = (className) => {
    const result = node('button', className); result.type = 'button'; return result;
  };
  const build = (host) => {
    const root = node('section', 'okw-folder-browser'); root.hidden = true;
    root.setAttribute('aria-labelledby', 'okw-folder-title');
    const title = node('h3'); title.id = 'okw-folder-title';
    const tools = node('div', 'okw-folder-tools');
    const home = button('okw-folder-home'); const up = button('okw-folder-up');
    tools.append(home, up);
    const path = node('p', 'okw-folder-path');
    const list = node('ul', 'okw-folder-list');
    const status = node('p', 'okw-navigation-search-status'); status.setAttribute('role', 'status');
    const actions = node('div', 'okw-navigation-workspace-actions');
    const retry = button('okw-folder-retry'); const cancel = button('okw-folder-cancel');
    const choose = button('okw-folder-choose'); actions.append(retry, cancel, choose);
    root.append(title, tools, path, list, status, actions); host.append(root);
    return { root, title, home, up, path, list, status, retry, cancel, choose };
  };
  const localize = (ui) => {
    ui.title.textContent = text('浏览运行端文件夹', 'Browse folders on the Kimi server');
    ui.home.textContent = text('主目录', 'Home'); ui.up.textContent = text('上一级', 'Up');
    ui.cancel.textContent = text('取消选择', 'Cancel selection'); ui.choose.textContent = text('选择此文件夹', 'Choose this folder');
    ui.retry.textContent = text('重试', 'Retry'); ui.list.setAttribute('aria-label', text('子文件夹', 'Subfolders'));
  };
  const renderEntries = (state, navigate) => {
    const { ui, data, busy } = state; ui.list.replaceChildren();
    if (busy || !data) return;
    for (const entry of data.entries) {
      const item = node('li'); const target = button('okw-folder-entry');
      target.textContent = entry.name; target.addEventListener('click', () => navigate(entry.path));
      item.append(target); ui.list.append(item);
    }
  };
  const renderStatus = ({ ui, data, busy, error }) => {
    ui.status.dataset.error = String(!!error);
    if (error) ui.status.textContent = error;
    else if (busy) ui.status.textContent = text('正在读取文件夹…', 'Loading folders…');
    else ui.status.textContent = data?.entries.length ? '' : text('此目录没有子文件夹。', 'This folder has no subfolders.');
  };
  const render = (state, navigate) => {
    const { ui, data, busy, error } = state; localize(ui);
    ui.root.setAttribute('aria-busy', String(busy)); ui.path.textContent = data?.path ?? '';
    ui.home.disabled = busy; ui.up.disabled = busy || !data?.parent; ui.choose.disabled = busy || !data || !!error;
    ui.retry.hidden = !error; ui.retry.disabled = busy; renderEntries(state, navigate); renderStatus(state);
  };
  window.__okwNavigationCreateFolderPicker = (host, select) => {
    const state = { ui: build(host), data: null, busy: false, error: '', generation: 0, opened: false };
    const close = () => {
      state.opened = false; state.generation++; state.controller?.abort();
      state.ui.root.hidden = true; state.data = null; state.ui.list.replaceChildren(); state.ui.path.textContent = '';
    };
    const navigate = async (path) => {
      state.controller?.abort(); state.controller = new AbortController();
      const generation = ++state.generation;
      state.requested = path; state.busy = true; state.error = ''; render(state, navigate);
      try {
        const data = await window.__okwNavigationBrowseFolder(path, state.controller.signal);
        if (!state.opened || state.generation !== generation) return;
        state.data = data; state.busy = false; render(state, navigate);
      } catch (error) {
        if (!state.opened || state.generation !== generation) return;
        state.busy = false; state.error = error.message; render(state, navigate);
      }
    };
    state.ui.home.addEventListener('click', () => navigate());
    state.ui.up.addEventListener('click', () => { if (state.data?.parent) void navigate(state.data.parent); });
    state.ui.retry.addEventListener('click', () => navigate(state.requested));
    state.ui.cancel.addEventListener('click', close);
    state.ui.choose.addEventListener('click', () => {
      if (state.busy || !state.data) return;
      const path = state.data.path; close(); select(path);
    });
    window.__okwLocale?.observe(() => { if (state.opened) render(state, navigate); });
    localize(state.ui);
    return { close, open(path) { state.opened = true; state.ui.root.hidden = false; void navigate(path); } };
  };
}
