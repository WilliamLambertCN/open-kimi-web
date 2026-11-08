{
  const text = (zh, en) => window.__okwLocale?.text(zh, en) ?? en;
  const el = (tag, className = '') => {
    const node = document.createElement(tag); node.className = className; return node;
  };
  const messages = {
    ready: ['浏览器已准备好安装。点击“安装”继续。', 'Your browser is ready. Select Install to continue.'],
    prompting: ['请在浏览器提示中选择是否安装。', 'Choose whether to install in the browser prompt.'],
    accepted: ['已接受安装请求，等待浏览器完成。', 'Install request accepted. Waiting for the browser to finish.'],
    dismissed: ['已取消安装。可从浏览器菜单重试。', 'Installation dismissed. Try again from the browser menu.'],
    failed: ['未能打开安装提示。请从浏览器菜单重试。', 'Could not open the install prompt. Try the browser menu.'],
    installed: ['浏览器已报告安装完成。', 'The browser reported that installation is complete.'],
    standalone: ['当前已在独立窗口中打开。', 'Already open in an app window.'],
    manual: ['此浏览器未提供安装提示。', 'This browser has not provided an install prompt.'],
    insecure: ['当前连接不是可信安全上下文。', 'This connection is not a trusted secure context.'],
  };
  const guides = {
    ios: [
      '在 Safari 中打开，轻点“分享”→“添加到主屏幕”。如有“作为 Web App 打开”开关，请保持开启。',
      'Open in Safari, tap Share → Add to Home Screen. If shown, keep Open as Web App enabled.',
    ],
    browser: [
      '在浏览器菜单中查找“安装应用”或“添加到主屏幕”。若没有此项，请使用支持安装的浏览器。',
      'Look for Install app or Add to Home Screen in the browser menu. Otherwise, use a browser that supports installation.',
    ],
    insecure: [
      '局域网 HTTP 或未受信任的 HTTPS 不能保证安装。请使用 HTTPS，并让手机信任其证书；localhost 开发访问除外。',
      'LAN HTTP or untrusted HTTPS may prevent installation. Use HTTPS with a certificate trusted by your phone; ' +
        'localhost development is an exception.',
    ],
    secure: [
      '安装还受浏览器和证书信任状态限制。若没有安装选项，请检查 HTTPS 证书是否被设备信任。',
      'Installation also depends on browser support and certificate trust. If no install option appears, ' +
        'check that the device trusts the HTTPS certificate.',
    ],
  };
  window.__okwPwaInstallBuildView = ({ close, install }) => {
    const root = el('div', 'okw-navigation-search-backdrop okw-pwa-install-backdrop'); root.hidden = true;
    const panel = el('section', 'okw-navigation-search-panel okw-pwa-install-panel');
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'okw-pwa-install-title');
    const head = el('header'); const title = el('h2'); title.id = 'okw-pwa-install-title';
    const dismiss = el('button'); dismiss.type = 'button'; dismiss.addEventListener('click', close);
    head.append(title, dismiss);
    const status = el('p', 'okw-pwa-install-status'); status.setAttribute('role', 'status');
    const guide = el('p'); const security = el('p', 'okw-pwa-install-security');
    const caSection = el('section', 'okw-pwa-install-ca'); caSection.hidden = true;
    const caTitle = el('h3'); const download = el('a'); download.href = '/__open-kimi-mobile/tls/ca.cer';
    download.download = 'open-kimi-web-ca.cer'; download.hidden = true;
    const fingerprintLabel = el('p'); const fingerprint = el('code', 'okw-pwa-install-fingerprint');
    const warning = el('p'); const steps = el('ol'); const items = [el('li'), el('li'), el('li')];
    steps.append(...items); const iosNote = el('p');
    caSection.append(caTitle, download, fingerprintLabel, fingerprint, warning, steps, iosNote);
    const actions = el('div', 'okw-pwa-install-actions'); const submit = el('button'); submit.type = 'button';
    submit.addEventListener('click', install); actions.append(submit);
    panel.append(head, status, guide, security, caSection, actions); root.append(panel);
    root.addEventListener('click', (event) => { if (event.target === root) close(); });
    document.body.append(root);
    return { root, panel, dismiss, submit,
      render({ phase, ios, secure, available, busy, ca }) {
        caSection.hidden = !ca; download.hidden = !ca;
        if (ca) {
          caTitle.textContent = text('信任此电脑的证书', 'Trust this computer’s certificate');
          download.textContent = text('下载 CA 公证书（仅公钥）', 'Download CA certificate (public only)');
          fingerprintLabel.textContent = text('SHA-256 指纹 · 与电脑终端核对', 'SHA-256 fingerprint · compare with computer terminal');
          fingerprint.textContent = ca.fingerprint;
          warning.textContent = text('此操作会改变手机信任。只安装自己电脑的证书，并核对指纹。',
            'This changes your phone’s trust. Only install your own computer’s certificate and verify its fingerprint.');
          items[0].textContent = text('下载后与电脑终端核对指纹，不能只凭本页面确认。',
            'Download and compare the fingerprint with your computer terminal, not just this page.');
          items[1].textContent = text('在安卓设置搜索“安装证书”，选择“CA 证书”，由你确认安装。',
            'In Android Settings, search for Install a certificate, choose CA certificate, and confirm installation yourself.');
          items[2].textContent = text('完全关闭并重开 Chrome，回到此地址安装；仍须浏览器提供安装选项。',
            'Fully close and reopen Chrome, then return here to install. Your browser must still offer installation.');
          steps.hidden = ios; iosNote.hidden = !ios;
          iosNote.textContent = text('iPhone／iPad 的证书安装与信任需在系统设置中单独确认，不使用安卓步骤。',
            'On iPhone or iPad, certificate installation and trust require separate confirmation in system settings.');
        }
        title.textContent = text('安装到桌面', 'Install app');
        dismiss.textContent = text('关闭', 'Close'); dismiss.setAttribute('aria-label', text('关闭', 'Close'));
        submit.textContent = text('安装', 'Install');
        status.textContent = text(...messages[phase]);
        guide.textContent = text(...guides[ios ? 'ios' : 'browser']);
        security.textContent = text(...guides[secure ? 'secure' : 'insecure']);
        submit.hidden = !available; submit.disabled = busy;
        actions.hidden = !available;
      },
    };
  };
}
