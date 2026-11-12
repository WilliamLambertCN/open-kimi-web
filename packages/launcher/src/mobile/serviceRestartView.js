{
  const text = (zh, en) => window.__okwLocale?.text(zh, en) ?? zh;
  const copy = () => ({
    title: text('重启服务', 'Restart service'), section: text('服务', 'Service'),
    hint: text('重启后自动重新连接，地址和会话不变。', 'Reconnect after restarting. Your address and sessions stay the same.'),
    confirm: text('所有连接到此服务的设备都会短暂断开。不会更新软件，也不会自动重发消息。',
      'All devices connected to this service will briefly disconnect. This does not update software or resend messages.'),
    draft: text('未发送的草稿留在当前页面。重连后可自行刷新，加载新的界面。',
      'Unsent drafts stay on this page. Refresh after reconnecting when you want to load the updated interface.'),
    cancel: text('取消', 'Cancel'), close: text('关闭', 'Close'), refresh: text('刷新页面', 'Refresh page'),
    loading: text('正在检查服务…', 'Checking service…'),
    ready: text('服务已恢复连接。', 'The service is connected again.'),
    restarting: text('正在重启，等待重新连接…', 'Restarting. Waiting to reconnect…'),
    checking: text('正在检查是否有运行中的任务…', 'Checking for active work…'),
    failed: text('尚未确认重启成功。请稍候重试连接；必要时在原终端运行 kimi web --host。',
      'Restart is not confirmed. Try connecting again shortly. If needed, run kimi web --host in the original terminal.'),
    busy: text('服务仍有任务运行、等待审批或回答，请处理完成后再重启。',
      'Work is running or waiting for approval or an answer. Finish it before restarting.'),
    unavailable: text('当前启动方式或后端版本不支持网页重启，请在原终端重启服务。',
      'This launch method or backend version does not support web restart. Restart in the original terminal.'),
    pending: text('已有重启正在进行，请等待连接恢复。', 'A restart is already in progress. Wait for the connection to return.'),
    auth: text('页面授权未就绪或已失效，请重新登录。', 'Page authorization is not ready or has expired. Sign in again.'),
    request: text('无法检查服务，请稍后重试。', 'Cannot check the service. Try again shortly.'),
    rejected: text('未能准备重启，服务未停止。请稍后重试或在原终端重启。',
      'Restart could not be prepared. The service was not stopped. Try again later or restart in the original terminal.'),
  });
  const node = (tag, className, content) => {
    const element = document.createElement(tag); element.className = className;
    if (content) element.textContent = content;
    return element;
  };
  const attr = (element, name, value) => {
    if (element.getAttribute(name) !== String(value)) element.setAttribute(name, value);
  };
  const setText = (element, value) => { if (element.textContent !== value) element.textContent = value; };
  const trigger = (mobile) => {
    const section = node('section', `okw-service-section${mobile ? ' is-mobile' : ''}`);
    const heading = node('h3', 'okw-service-heading');
    const row = node('div', 'okw-service-row');
    const main = node('div', 'okw-service-main');
    const label = node('span', 'okw-service-label');
    const hint = node('span', 'okw-service-hint');
    const button = node('button', 'okw-service-trigger ui-button ui-button--secondary ui-button--sm');
    button.type = 'button'; main.append(label, hint); row.append(main, button); section.append(heading, row);
    return { section, heading, label, hint, button };
  };
  const dialog = () => {
    const root = node('dialog', 'okw-service-dialog');
    const title = node('h2', 'okw-service-title'); title.id = 'okw-service-title';
    const explanation = node('p', 'okw-service-explanation');
    const draft = node('p', 'okw-service-explanation');
    const status = node('p', 'okw-service-status');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const actions = node('div', 'okw-service-actions');
    const cancel = node('button', 'ui-button ui-button--secondary ui-button--md'); cancel.type = 'button';
    const confirm = node('button', 'ui-button ui-button--primary ui-button--md'); confirm.type = 'button';
    attr(root, 'aria-labelledby', title.id); actions.append(cancel, confirm);
    root.append(title, explanation, draft, status, actions);
    return { root, title, explanation, draft, status, cancel, confirm };
  };
  const localizeTrigger = (ui) => {
    const words = copy(); setText(ui.heading, words.section); setText(ui.label, words.title);
    setText(ui.hint, words.hint); setText(ui.button, words.title); attr(ui.button, 'aria-label', words.title);
  };
  window.__okwServiceRestartView = { copy, node, attr, setText, trigger, dialog, localizeTrigger };
}
