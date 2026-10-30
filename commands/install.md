---
description: 提供一键兼容式安装路线，或用已安装 launcher 配置 `kimi web` 可逆接管（需用户授权）
---

帮助用户安装独立 Open Kimi Web launcher 或管理接管。安装本插件不安装、启动或卸载 launcher。用户参数：$ARGUMENTS
目标版本 `v2.4.1-r1`，兼容目标官方 `2.4.1`；CI、运行验收与发布状态以[正式 Release][current-release]及
[2.4.1 适配计划][compat241-plan]的真实记录为准，未记录不视为通过。[r2 计划][r2-plan]保留为历史。

严格按顺序执行：

1. 先检查 `open-kimi-web --version` 是否可用；wrapper 可使用记录的私有 Node，不能仅因 PATH 中无 Node／npm 就拒绝。
   launcher 不可用时，优先提供[README 顶部的一键兼容式命令][install]，不要求预装 Node／npm／Corepack／pnpm／Git／Kimi。
   命令从 `v2.4.1-r1` commit API 解析并校验真实 40 位十六进制 SHA，只下载同 SHA 入口，
   传同一 `--revision` 和固定 `--version 2.4.1-r1`；tag／资产未发布时停止，不伪造或复用旧 r10 SHA。
   下载失败即停，不回退 main／旧包；不静默联网安装，不声称 npm registry 已发布本包。
   解释联网、标准 curl／tar 与共享官方 Node ≥ 22.19.0 前提。Windows Git Bash 仍必需；
   新官方 `2.4.1` 无 node-pty，按精确身份做真实 Node `child_process` shell probe，不再无条件要求 Linux 编译工具链。
   旧 owned `2.3.1`／`2.1.1` 仍做真实 PTY，只有 legacy rebuild 需 Python 3、C／C++ 和 make，不自动 sudo／apt。
   macOS／arm64、Windows 真注册表／新终端及实体手机未全面验收，不承诺全部平台。仅源码开发需要 Corepack／pnpm。
2. 解释默认接管会在 `${OPEN_KIMI_WEB_HOME:-~/.open-kimi-web}/bin` 写 wrapper，修改用户 PATH／受支持 shell rc。
   不改官方文件；缺失依赖放用户目录。先发现并明确复用已有可用 native／标准 npm Kimi，不下载或升级该官方 CLI。
   保留显式 override／已登记目标／PATH 顺序，有界检查默认 bin、KIMI_INSTALL_DIR、uv／XDG、Windows 持久 PATH／npm
   及所选 Node 旁标准命令。不修改持久 PATH 来搜索，不执行未知 PowerShell 函数／脚本或带参 wrapper。
   坏、歧义或不支持候选明确拒绝，不当作 missing 后另装；只有确认缺失才准备固定官方 `2.4.1` tarball／SHA-512。
   ignore-scripts 避免旧 Python 迁移；旧 owned 版仅在精确身份、integrity 与 entry／shim digests 全通过后复用。
   已有其它已识别源码／prefix 需用户显式选择 `--switch-installation`，未知／部分安装和降级仍拒绝，不删除旧安装。
   仅安装包可选 `--no-integrate`，不建立、修改或撤销已有接管；已有用户日常升级用 `update --check`／`update`。
3. **取得安装／接管授权后**，按对应路线执行；一键安装器默认已接管，不重复运行 integrate install。
   对已可用 launcher，先核对已有 wrapper 的精确 Node／launcher 目标及归属，再决定是否首次接管。
   `integrate status` 不保证列出这些目标，无接管时也可能退出 0；不能只凭退出码称健康。
   首次手动接管才运行 `open-kimi-web integrate install`，已有其它安装或未知归属不能直接用 install／repair 改向。
4. 接管后开新终端，结合 status 输出、PATH 顺序及实际 wrapper 目标确认，再由用户启动 `kimi web --host`。
   System PATH 遮挡或 shell 不支持持久化时按输出处理，不把包已安装当接管成功；多 rc 的 zsh status 警告不作为盲目 repair 理由。
   `--no-integrate`／失败安装／PATH 未加载时使用输出的绝对 Node／launcher 入口，不猜默认 prefix。
   `integrate uninstall` 只撤销接管，不卸载专用 npm prefix／runtime／官方 Kimi；Windows 私有 Node User PATH 项可能保留。
   不宣称完整清理，不删除旧目录；安装器不自动登录、启动生产服务、读取真实会话或发付费调用。
   更新后提醒用户自行重启旧 launcher／实际 backend 并刷新，不自动重启生产，也不代开 Tower。

Tower 不是账号／provider 权限。入口要求 meta 的 `experimental_flags.tower === true`，实验默认 off，
单项 `KIMI_CODE_EXPERIMENTAL_TOWER` 优先配置再回退全局实验开关；核对实际进程环境与 `KIMI_CODE_HOME`。
off-start 后 live config true 可出现入口但工具未组装，需用户接受实验风险后自行重启实际后端；
chip 另要求会话已开启且非 Side Chat，缺 chip 不证明功能不存在。安全开启步骤见 [README][install]与[官方指南][official-tower]。

[install]: https://github.com/WilliamLambertCN/open-kimi-web#readme
[compat241-plan]: ../docs/plans/kimi-code-2.4.1-compatibility-v1-plan.md
[r2-plan]: ../docs/plans/provider-defaults-r2-release-v1-plan.md
[current-release]: https://github.com/WilliamLambertCN/open-kimi-web/releases/tag/v2.4.1-r1
[official-tower]: https://www.kimi.com/code/docs/en/kimi-code-cli/guides/tower.html
