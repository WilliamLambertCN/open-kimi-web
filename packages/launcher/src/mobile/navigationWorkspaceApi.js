{
  const text = (zh, en) => window.__okwLocale?.text(zh, en) ?? en;
  const failure = (status, code) => {
    if (status === 401 || status === 403) return text('页面授权已失效，请刷新页面。', 'Authorization expired. Refresh the page.');
    if (code === 40001) return text('请输入运行端的绝对目录路径。', 'Enter an absolute directory path on the server.');
    if (code === 40409) return text('目录不存在、不可访问或不是文件夹。', 'The directory does not exist, is inaccessible or is not a folder.');
    return text('无法添加工作空间，请检查服务连接后重试。', 'Could not add the workspace. Check the server connection and retry.');
  };
  const invalid = () => new Error(text('工作空间响应格式无效。请刷新确认是否已添加。',
    'Invalid workspace response. Refresh to confirm whether it was added.'));
  const rootKey = (root) => {
    const windows = /^(?:[A-Za-z]:[\\/]|\\\\|\/\/)/.test(root);
    const slashed = windows ? root.replaceAll('\\', '/') : root;
    const trimmed = slashed.replace(/\/+$/, '') || '/';
    if (!windows) return `posix:${trimmed}`;
    const normalized = /^[A-Za-z]:$/.test(trimmed) ? `${trimmed}/` : trimmed;
    return `win:${normalized.toLowerCase()}`;
  };
  const idempotencyKey = (identity) => {
    let hash = 0x6c62272e07bb014262b821756295c58dn;
    for (const byte of new TextEncoder().encode(identity)) {
      hash = BigInt.asUintN(128, (hash ^ BigInt(byte)) * 0x1000000000000000000013bn);
    }
    return `okw-workspace-v1:${hash.toString(16).padStart(32, '0')}`;
  };
  const validWorkspace = (item) => typeof item?.id === 'string' && item.id.length > 0 &&
    typeof item.root === 'string' && item.root.length > 0;
  const request = async (authorization, signal, body) => {
    const response = await window.fetch('/api/v1/workspaces', {
      method: body ? 'POST' : 'GET', signal, cache: 'no-store',
      headers: { authorization, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let envelope;
    try { envelope = await response.json(); } catch { throw new Error(failure(response.status)); }
    if (!response.ok || envelope?.code !== 0) throw new Error(failure(response.status, envelope?.code));
    return envelope.data;
  };
  window.__okwNavigationAddWorkspace = async (input, signal) => {
    const authorization = window.__okwNavigationAuthorization();
    if (!authorization) throw new Error(text('页面授权尚未就绪，请刷新后重试。', 'Authorization is not ready. Refresh and retry.'));
    const root = input.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
    if (!root) throw new Error(failure(400, 40001));
    const identity = rootKey(root);
    const list = await request(authorization, signal);
    if (!Array.isArray(list?.items) || !list.items.every(validWorkspace)) throw invalid();
    if (list.items.some((item) => rootKey(item.root) === identity)) return { existing: true };
    const workspace = await request(authorization, signal, { root, idempotency_key: idempotencyKey(identity) });
    if (!validWorkspace(workspace) || rootKey(workspace.root) !== identity) throw invalid();
    return { existing: false, workspace };
  };
}
