---
description: 提供一键兼容式安装路线，或用已安装 launcher 配置 `kimi web` 可逆接管（需用户授权）
---

帮助用户安装独立 Open Kimi Web launcher 或管理接管。安装本插件不安装、启动或卸载 launcher。用户参数：$ARGUMENTS
版本 `v2.1.1-r10`，官方兼容基线仍为 `2.1.1`；Release 发布状态／CI 以 README 链接及发布计划的真实记录为准。

严格按顺序执行：

1. 先检查 `open-kimi-web --version` 是否可用；wrapper 可使用记录的私有 Node，不能仅因 PATH 中无 Node／npm 就拒绝。
   launcher 不可用时，优先提供[README 顶部的一键兼容式命令][install]，不要求预装 Node／npm／Corepack／pnpm／Git／Kimi。
   命令解析 r10 tag 的真实 40 位 commit SHA，下载同 SHA 入口，传同 `--revision` 和固定 `--version 2.1.1-r10`。
   下载失败即停，不回退 main／旧包；不静默联网安装，不声称 npm registry 已发布本包。
   解释联网及标准 curl／tar 前提；空 Linux（glibc）仍需 Python 3、C／C++ 和 make，不自动 sudo 或安装工具链。
   macOS／arm64、Windows 真注册表／新终端接管未全面验收。只有源码开发才需要 Corepack／pnpm。
2. 解释默认接管会在 `${OPEN_KIMI_WEB_HOME:-~/.open-kimi-web}/bin` 写 wrapper，修改用户 PATH／受支持 shell rc。
   不改官方文件；缺失依赖放用户目录，可用 native／npm Kimi 优先复用，不自动升级或覆盖。
   已有其它已识别源码／prefix 需用户显式选择 `--switch-installation`，未知／部分安装和降级仍拒绝，不删除旧安装。
   仅安装包可选 `--no-integrate`，不建立、修改或撤销已有接管；已有用户日常升级用 `update --check`／`update`。
3. **取得安装／接管授权后**，按对应路线执行；一键安装器默认已接管，不重复运行 integrate install。
   对已可用 launcher，先核对已有 wrapper 的精确 Node／launcher 目标及归属，再决定是否首次接管。
   `integrate status` 不保证列出这些目标，无接管时也可能退出 0；不能只凭退出码称健康。
   首次手动接管才运行 `open-kimi-web integrate install`，已有其它安装或未知归属不能直接用 install／repair 改向。
4. 接管后开新终端，结合 `open-kimi-web integrate status` 输出、PATH 顺序及实际 wrapper 目标确认，再由用户启动 `kimi web --host`。
   System PATH 遮挡或 shell 不支持持久化时按输出处理，不把包已安装当接管成功；多 rc 的 zsh status 警告不作为盲目 repair 理由。
   `--no-integrate`、安装失败或命令未进 PATH 时，status／uninstall 可能不可用；用安装输出的绝对 Node／launcher 入口，不猜默认 prefix。
   `integrate uninstall` 只撤销接管，不卸载专用 npm prefix／runtime／官方 Kimi；Windows 私有 Node User PATH 项可能保留。
   不宣称完整清理，不删除旧目录；安装器不自动登录、启动生产服务、读取真实会话或发付费调用。

[install]: https://github.com/WilliamLambertCN/open-kimi-web#readme
