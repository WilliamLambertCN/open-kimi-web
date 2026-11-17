{
  const text = (zh, en) => window.__okwLocale?.text(zh, en) ?? en;
  const failure = (status) => {
    if (status === 401) return text('页面授权已失效，请刷新页面。', 'Authorization expired. Refresh the page.');
    if (status === 403) return text('没有权限浏览该目录，或页面授权已失效，请刷新页面。',
      'This directory is not browsable with the current authorization. Refresh the page.');
    if (status === 404) return text('目录不存在、不可访问或不是文件夹。',
      'The directory does not exist, is inaccessible or is not a folder.');
    if (status === 503) return text('服务暂时无法读取该目录，请稍后重试。',
      'The server cannot read this directory right now. Please retry shortly.');
    return text('浏览文件夹失败，请重试。', 'Could not browse folders. Please retry.');
  };
  const invalid = () => new Error(text('文件夹浏览响应格式无效。', 'Invalid folder browse response.'));
  const validEntry = (entry) => typeof entry?.name === 'string' && entry.name.length > 0 &&
    typeof entry?.path === 'string' && entry.path.length > 0 && entry.is_dir === true;
  const validParent = (parent) => parent === null || (typeof parent === 'string' && parent.length > 0);
  const listing = (data) => {
    if (typeof data?.path !== 'string' || !data.path || !validParent(data?.parent) ||
      !Array.isArray(data.entries) || !data.entries.every(validEntry)) throw invalid();
    return { path: data.path, parent: data.parent, entries: data.entries };
  };
  window.__okwNavigationBrowseFolder = async (path, signal) => {
    const authorization = window.__okwNavigationAuthorization();
    if (!authorization) throw new Error(text('页面授权尚未就绪，请刷新后重试。', 'Authorization is not ready. Refresh and retry.'));
    if (path !== undefined && (typeof path !== 'string' || !path)) {
      throw new Error(text('请选择有效的目录路径。', 'Choose a valid directory path.'));
    }
    const query = path === undefined ? '' : `?path=${encodeURIComponent(path)}`;
    const response = await window.fetch(`/api/v1/fs:browse${query}`,
      { method: 'GET', signal, cache: 'no-store', headers: { authorization } });
    let envelope;
    try { envelope = await response.json(); } catch { throw new Error(failure(response.status)); }
    if (!response.ok || envelope?.code !== 0) throw new Error(failure(response.status));
    return listing(envelope.data);
  };
}
