{
  const STORAGE_KEY = 'open-kimi-web.mobile-workspace-sort';
  const ORDER_KEY = 'kimi-web.workspace-order';
  const PINS_KEY = 'open-kimi-web.pinned-workspaces';
  const OFFICIAL_LOCALE_KEY = 'kimi-locale';
  const modes = ['recent', 'name', 'desktop'];
  const mobile = window.matchMedia('(max-width: 640px)');
  const sheets = new Map();
  let workspaces = [];
  let groupedWorkspaces = [];
  let home = null;

  const readStorage = (key) => {
    try { return localStorage.getItem(key); } catch { return null; }
  };
  let mode = readStorage(STORAGE_KEY);
  if (!modes.includes(mode)) mode = 'recent';

  const isId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 256 && !/[\\/]/.test(id);
  const readIds = (key) => {
    try {
      const value = JSON.parse(readStorage(key) ?? '[]');
      return Array.isArray(value) ? [...new Set(value.filter(isId))] : [];
    } catch { return []; }
  };
  const currentLocale = () => {
    const persisted = readStorage(OFFICIAL_LOCALE_KEY);
    if (persisted === 'zh' || persisted === 'en') return persisted;
    const language = document.documentElement.lang || navigator.language || '';
    return language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  };
  const copy = () => {
    return currentLocale() === 'zh' ? {
      label: '工作区排序', recent: '最近会话', name: '工作区名称', desktop: '桌面保存顺序',
      missing: '无法唯一识别工作区，桌面保存顺序不可用。',
      unsaved: '此浏览器尚无桌面保存顺序。',
    } : {
      label: 'Workspace order', recent: 'Recent sessions', name: 'Workspace name', desktop: 'Saved desktop order',
      missing: 'Workspace identity is not unique; saved desktop order is unavailable.',
      unsaved: 'No desktop order is saved in this browser.',
    };
  };
  const setText = (node, text) => {
    if (node.textContent !== text) node.textContent = text;
  };
  const setClass = (node, name, enabled) => {
    if (node.classList.contains(name) !== enabled) node.classList.toggle(name, enabled);
  };
  const shortPath = (root) => {
    if (home && root.startsWith(home)) return `~${root.slice(home.length)}`;
    const match = root.match(/^\/(?:Users|home)\/[^/]+(\/.*)?$/);
    return match ? `~${match[1] ?? ''}` : root;
  };
  const identities = () => {
    const records = new Map();
    [...workspaces, ...groupedWorkspaces].forEach(({ id, root }) => {
      const roots = records.get(id) ?? new Set();
      roots.add(root);
      records.set(id, roots);
    });
    return [...records].flatMap(([id, roots]) => [...roots].map((root) => ({ id, root, valid: roots.size === 1 })));
  };
  const identify = (groups) => {
    const records = identities();
    const candidates = groups.map((node) => {
      const path = node.querySelector('.mgh-path')?.textContent.trim() ?? '';
      return records.filter(({ root }) => path && shortPath(root).trim() === path);
    });
    const ids = candidates.map((matches) => matches.length === 1 && matches[0].valid ? matches[0].id : null);
    return ids.map((id) => id && ids.filter((other) => other === id).length === 1 ? id : null);
  };
  const clearList = (list) => {
    if (!list) return;
    setClass(list, 'okw-mobile-workspace-ordered', false);
    Array.from(list.children).filter((node) => node.classList.contains('okw-mobile-workspace-order-item'))
      .forEach((node) => {
        node.style.removeProperty('order');
        node.classList.remove('okw-mobile-workspace-order-item');
      });
  };
  const clearSheet = (state) => {
    state.control?.remove();
    state.control = null;
    clearList(state.list);
    state.list = null;
  };
  const makeControl = (state, tabs) => {
    const control = document.createElement('div');
    control.className = 'okw-mobile-workspace-sort';
    const label = document.createElement('label');
    const text = document.createElement('span');
    const select = document.createElement('select');
    modes.forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      select.append(option);
    });
    const hint = document.createElement('p');
    hint.className = 'okw-mobile-workspace-sort-hint';
    hint.setAttribute('role', 'status');
    label.append(text, select);
    control.append(label, hint);
    select.addEventListener('change', () => {
      if (!modes.includes(select.value) || select.selectedOptions[0]?.disabled) return;
      mode = select.value;
      try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* The current page keeps its selection. */ }
      refresh();
    });
    tabs.after(control);
    Object.assign(state, { control, text, select, hint });
  };
  const renderControl = (state, tabs, available, saved) => {
    if (!state.control?.isConnected) makeControl(state, tabs);
    const words = copy();
    setText(state.text, words.label);
    Array.from(state.select.options).forEach((option) => setText(option, words[option.value]));
    const desktop = state.select.options[2];
    if (desktop.disabled !== !available) desktop.disabled = !available;
    const value = mode === 'desktop' && !available ? 'recent' : mode;
    if (state.select.value !== value) state.select.value = value;
    const message = available ? '' : saved ? words.missing : words.unsaved;
    setText(state.hint, message);
    if (state.hint.hidden !== !message) state.hint.hidden = !message;
    return value;
  };
  const applyOrder = (list, groups, ids, selected, saved) => {
    const pins = readIds(PINS_KEY);
    const entries = groups.map((node, index) => ({
      node, index, id: ids[index], name: node.querySelector('.mgh-name')?.textContent.trim() ?? '',
    }));
    const pinRank = (id) => id && pins.includes(id) ? pins.indexOf(id) : pins.length;
    const savedRanks = new Map(saved.map((id, index) => [id, index]));
    const savedRank = (id) => savedRanks.get(id) ?? saved.length;
    entries.sort((left, right) => {
      const pinned = pinRank(left.id) - pinRank(right.id);
      if (pinned) return pinned;
      if (selected === 'name') return left.name.localeCompare(right.name) || left.index - right.index;
      if (selected === 'desktop') return savedRank(left.id) - savedRank(right.id) || left.index - right.index;
      return left.index - right.index;
    });
    const changed = entries.some(({ node }, index) => node !== groups[index]);
    if (!changed) {
      clearList(list);
      return;
    }
    setClass(list, 'okw-mobile-workspace-ordered', true);
    entries.forEach(({ node }, index) => {
      setClass(node, 'okw-mobile-workspace-order-item', true);
      if (node.style.order !== String(index)) node.style.order = String(index);
    });
  };
  const renderSheet = (state) => {
    const tabs = state.root.querySelector('.sheet-body > .view-tabs');
    const list = state.root.querySelector('.sheet-body > .mlist');
    if (state.list !== list) clearList(state.list);
    const groups = list ? Array.from(list.children).filter((node) => node.matches('.mgroup')) : [];
    if (!mobile.matches || !tabs || groups.length === 0) {
      clearSheet(state);
      return;
    }
    state.list = list;
    const ids = identify(groups);
    const saved = readIds(ORDER_KEY);
    const available = ids.every(Boolean) && saved.length > 0;
    const selected = renderControl(state, tabs, available, saved.length > 0);
    applyOrder(list, groups, ids, selected, saved);
  };
  const refresh = () => {
    sheets.forEach((state, root) => {
      if (!root.isConnected) {
        state.observer.disconnect();
        clearSheet(state);
        sheets.delete(root);
      } else renderSheet(state);
    });
  };
  const affectsSheet = ({ target, addedNodes, removedNodes }) => {
    const element = target.nodeType === 1 ? target : target.parentElement;
    if (element?.closest('.mgh, .view-tabs, .okw-mobile-workspace-sort')) return true;
    if (element?.matches('.mlist, .sheet-body')) return true;
    return [...addedNodes, ...removedNodes].some((node) => node.matches?.('.view-tabs, .mlist, .mgroup'));
  };
  const attach = (root) => {
    if (sheets.has(root) || !root.querySelector('.actions .newrow')) return;
    const state = { root, list: null, control: null };
    state.observer = new MutationObserver((records) => {
      if (records.some(affectsSheet)) renderSheet(state);
    });
    state.observer.observe(root, {
      childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['aria-selected', 'class', 'style'],
    });
    sheets.set(root, state);
    renderSheet(state);
  };
  const discover = (records) => {
    records.forEach(({ target, addedNodes, removedNodes }) => {
      if (target.closest?.('.sheet-root, .con, .chat-scroll, .sc-body, .composer')) return;
      addedNodes.forEach((node) => {
        if (node.matches?.('.sheet-root')) attach(node);
        else if (node.nodeType === 1 && !node.matches('.con, .chat-scroll, .sc-body, .a-msg')) {
          node.querySelectorAll('.sheet-root').forEach(attach);
        }
      });
      if (removedNodes.length) {
        sheets.forEach((state, root) => {
          if (root.isConnected) return;
          state.observer.disconnect();
          clearSheet(state);
          sheets.delete(root);
        });
      }
    });
  };
  const project = (items, rootKey) => items.flatMap((item) => {
    const id = item?.id;
    const root = item?.[rootKey];
    return isId(id) && typeof root === 'string' && root ? [{ id, root }] : [];
  });
  const projections = {
    '/api/v1/workspaces': (data) => {
      if (Array.isArray(data.items)) workspaces = project(data.items, 'root');
    },
    '/api/v1/fs:home': (data) => {
      if (typeof data.home === 'string') home = data.home;
    },
    '/api/v2/sessions': (data) => {
      if (Array.isArray(data.groups)) groupedWorkspaces = project(data.groups.map((group) => group?.workspace), 'cwd');
    },
  };
  const remember = (url, body) => {
    if (!body || (body.code !== undefined && body.code !== 0)) return;
    const data = body.data ?? body;
    if (!data || typeof data !== 'object') return;
    projections[url.pathname](data);
    refresh();
  };
  const isRequest = (input) => typeof Request !== 'undefined' && input instanceof Request;
  const requestMethod = (input, init) => (init?.method ?? (isRequest(input) ? input.method : 'GET')).toUpperCase();
  const observedUrl = (input, init) => {
    if (requestMethod(input, init) !== 'GET') return null;
    const url = new URL(isRequest(input) ? input.url : String(input), location.href);
    if (url.origin !== location.origin || !projections[url.pathname]) return null;
    if (url.pathname === '/api/v2/sessions' && url.searchParams.get('view') !== 'by_workspace') return null;
    return url;
  };
  const sameOriginResponse = (response) => !response.redirected &&
    (!response.url || new URL(response.url).origin === location.origin);
  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = async function mobileWorkspaceSortFetch(input, init) {
      const response = await nativeFetch.apply(this, arguments);
      try {
        const url = observedUrl(input, init);
        if (url && response.ok && sameOriginResponse(response)) {
          void response.clone().json().then((body) => remember(url, body)).catch(() => {});
        }
      } catch { /* Official requests and responses are never changed. */ }
      return response;
    };
  }
  const observer = new MutationObserver(discover);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.querySelectorAll('.sheet-root').forEach(attach);
  mobile.addEventListener('change', refresh);
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) mode = modes.includes(event.newValue) ? event.newValue : 'recent';
    if ([STORAGE_KEY, ORDER_KEY, PINS_KEY, OFFICIAL_LOCALE_KEY].includes(event.key) || event.key === null) refresh();
  });
}
