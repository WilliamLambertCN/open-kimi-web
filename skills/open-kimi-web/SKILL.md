---
name: open-kimi-web
description: |
  Open Kimi Web launcher 是围绕 Kimi Code 官方 Web 与后端的轻量增强层，提供局域网 HTTPS、token 直达链接和移动页面修复。
  当用户要管理或恢复 launcher 的 kimi web 接管（integrate install/status/repair/uninstall）、检查或更新 launcher，
  或在手机上访问、排查异常时使用本 skill。安装本 Kimi 插件本身不会安装或启动 launcher。
---

# OpenWeb for Kimi Code（官方 Web 的轻量增强层）

Open Kimi Web 是**非官方**的轻量增强 launcher：默认保留 Kimi Code 官方 Web 与后端，
在外层增加 HTTPS、直达链接、移动页面修复、供应商模型排序、工作区置顶和已归档会话永久删除。

版本 `v2.1.1-r10` 兼容官方 `2.1.1`，包含兼容式安装、主选择器风格的手机子模型控件及英文修复。
保留 r9 流式 gzip 与既有偏好；Release 发布状态／CI 以 [Release 页面][r10-release]和[发布计划][r10-plan]的真实记录为准。

本 skill 管理独立的 `open-kimi-web`，驱动 `integrate install|status|repair|uninstall` 和 `update`。
安装或移除 Kimi 插件不会安装、启动或卸载 launcher，也不会自动修改或撤销 PATH 接管。

## 前置检查（每次必做）

1. 先检查 `open-kimi-web --version` 是否可用；wrapper 可使用记录的私有 Node。
   **不要仅因 PATH 中 `node --version` 缺失／过旧拒绝正常 wrapper。** 直调 launcher 需 Node ≥ 22，共享官方 npm runtime 需 ≥ 22.19.0。
2. 管理已有接管时运行 `open-kimi-web integrate status`，结合 PATH 顺序、真实 Kimi 与 wrapper 的精确 Node／launcher 目标判断归属。
   status 不保证列出这些目标，无接管时也可能退出 0，不能只凭退出码推断接管成功或健康。
   若 `--no-integrate`／失败安装／PATH 未加载导致命令不可用，使用安装输出的绝对 Node／launcher 入口，不猜默认 prefix。
3. launcher 不可用时提供以下安装路线，未获安装／接管授权不得静默联网执行。
   **不把缺 Node／Corepack／pnpm 的用户引到源码依赖安装**；本项目不发布到 npm registry，不声称裸包名安装可用。

### 提供安装路线（先解释影响并确认授权）

优先提供[README 顶部完整一键兼容式命令](https://github.com/WilliamLambertCN/open-kimi-web#readme)，无需克隆仓库。
Windows PowerShell ≥ 5.1 或 macOS／Linux sh 命令解析 r10 tag 的 GitHub commits API 真实 `.sha`；
sh 使用 `Accept: application/vnd.github.sha` 得纯 SHA，校验 40hex 后下载 `raw/<sha>/scripts/install.ps1`／`install.sh` 到临时文件。
执行时传同一 `--revision <sha>` 和固定 `--version 2.1.1-r10`，TLS 1.2／下载失败即停／清理／退出码齐全，不裸 pipe／eval。
下载失败即停，不回退漂移的 main 或旧包；HTTPS 和同提交配对不是脚本签名验证。
可先审阅该 SHA 的完整源码；本地使用时，入口、coordinator 与 helpers 必须来自同一提交：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 --version 2.1.1-r10
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 --version 2.1.1-r10 --no-integrate
```

```sh
sh scripts/install.sh --version 2.1.1-r10
sh scripts/install.sh --version 2.1.1-r10 --no-integrate
```

- 无需预装 Node／npm／Corepack／pnpm／Git／官方 Kimi，仍需联网与标准 PATH curl／tar，不是离线安装。
  优先 Node ≥ 22.19.0 与配套 npm，缺失才校验并准备固定 Node `22.23.3`；home 必须是安全绝对目录。
  launcher prefix、official prefix、runtime 和 bin 分离，不覆盖系统 Node／Git，不要求管理员权限。
- 可用 native／npm Kimi 按实际顺序复用，不升级或覆盖；缺官方准备固定 `2.1.1` tarball／SHA-512、ignore-scripts，避免旧 Python 迁移。
  未知归属／坏 override／partial 拒绝，不自动续装。新 owned 安装先真实 PTY，成功才写 record；重复 probe，损坏拒绝不自动重建。
  Linux 缺 binding 只对固定 node-pty 1.1.0／node-addon-api 7.1.1 审计后限定 rebuild，不跑根 Kimi 或其它包脚本。
  **空 Linux（glibc）仍需 Python 3、C／C++ 编译器和 make**；不自动 sudo／apt 或安装完整工具链，不以 Web 200 替代 PTY。
- Windows 仍需 Git Bash，可用即复用，缺失才校验并准备 portable Git；不覆盖系统 Git，未知 `KIMI_SHELL_PATH` 报错。
  portable SFX 不运行默认 post-install.bat，显式执行审计过的初始化。既有 portable 与缺 Git 完整 coordinator 是分开验证。
- 默认接管会写用户 PATH／受支持 shell rc，先解释并取得授权；已有其它已识别源码／prefix 需显式 `--switch-installation`。
  未知／部分接管及降级仍拒绝，不删除旧安装；`--no-integrate` 不建立、修改或撤销接管。
  **已有用户日常升级用 `update --check`／`update`**，不以重装或切换绕过身份检查。
- PowerShell `--` 参数原样传递，Bypass 仅限此次进程；不猜写成 `-Version`／`-NoIntegrate`。
  本地薄入口 `--help` 不要求 Node、不联网、不写入，非法参数也在 runtime 前拒绝；独立入口须显式匹配 revision。
- PATH 遮挡或 shell 不支持时按输出处理，不把包已安装当接管生效；不自动登录、启动生产服务、读取真实会话或发付费调用。
  macOS／arm64、Windows 真注册表／新终端接管未全面验证；历史 fixture、失败及检查见[安装计划][install-plan]。
  发布与资产核对见发布计划；不能把旧 r9 场景、本地 pack 或 Git Bash 当作全平台结果。

已有 Node ≥ 22／npm 可手动装 launcher，但不会准备官方 Kimi；官方 npm `2.1.1` 需 Node ≥ 22.19.0，Windows 仍需 Git Bash。
不需要 Corepack／pnpm；可用 r10 Release 的固定 URL：

```sh
npm install -g https://github.com/WilliamLambertCN/open-kimi-web/releases/download/v2.1.1-r10/open-kimi-web-2.1.1-r10.tgz
```

仅用户明确需要源码开发且已有 Node ≥ 22／Git／Corepack 时，提供源码路线：

```sh
git clone --branch main https://github.com/WilliamLambertCN/open-kimi-web.git
cd open-kimi-web
corepack pnpm install --frozen-lockfile
node packages/launcher/bin/open-kimi-web.mjs integrate install
```

## 安装接管（用户级 PATH 修改，必须先确认）

`open-kimi-web integrate install` 会在 `${OPEN_KIMI_WEB_HOME:-~/.open-kimi-web}/bin` 写入
`kimi`/`kimi.cmd` 包装脚本，并把该目录 prepend 到 PATH（POSIX 写入 shell rc 文件的标记块；
Windows 修改用户级 PATH）。**不修改任何官方文件，不需要管理员权限。**

默认安装器已接管时不必重复 install。手动接管前，先解释上述影响并获得明确确认，
核对当前 launcher、已有 wrapper 的目标及归属；已有其它源码／prefix 或归属不明时，
不能直接用 install／repair 改向当前入口。确认是首次接管时运行：

```sh
open-kimi-web integrate install
open-kimi-web integrate status   # 查看状态、PATH 和 note，不只看退出码
```

已打开的终端可能需要 `hash -r` 或新开窗口才能命中新 PATH；Windows System PATH 遮挡须按警告处理。

## 日常使用

- 用户照旧运行 `kimi web`：官方服务器在 loopback 后台启动，launcher 在官方 Web 前增加增强层并打印带 token 的直达链接。其它所有 `kimi` 子命令原样委托给官方二进制。
- `kimi web --host 0.0.0.0` 会启用自签名 HTTPS；独立启动 launcher 时使用 `open-kimi-web serve --lan`。
  **提醒用户在浏览器核对 launcher 打印的 SHA-256 指纹后再接受证书警告**。

## 撤销接管

插件系统**没有**卸载钩子。移除插件不会运行 `integrate uninstall`，也不会撤销在插件外完成的 wrapper/PATH 接管；launcher 是否仍可用取决于其独立安装状态。要恢复官方命令路径时：

1. 运行 `open-kimi-web integrate uninstall`，移除 wrapper、接管 PATH/rc 项和状态文件；
   官方安装、launcher 包与用户数据不受影响；
2. 若还要移除插件，再单独运行 `/plugins remove open-kimi-web`。

Windows 一键安装器加入的私有 Node User PATH 项在 r9 撤销后仍保留；无需时解释具体路径并请用户手动移除。
撤销接管不是卸载安装器的专用 npm prefix 或私有 runtime，不自动删除旧源码或其它安装目录。

## 诊断与修复

- `open-kimi-web integrate status`：检查 wrapper 完好性、PATH 顺序、真实 kimi 解析和已有 TLS 指纹。
  无接管时也可能退出 0，旧 shell 未加载 PATH 时可能只显示 note；必须结合输出和实际 wrapper 目标判断。
  r9 按首个已有 rc 诊断，多 rc 的 zsh 场景可能错误警告；安装器独立核验实际 shell 的 rc／wrapper，
  不仅凭该警告执行 repair 或切换。
- bash 安装器在 Release／npm 前检查 `.bash_profile`，仅缺失时检查 `.bash_login`，不改原文件。
  只接受空行／整行注释加无条件 `source`／`.` 加载 `~/.bashrc`、`"$HOME/.bashrc"` 或 `"${HOME}/.bashrc"`。
  空文件、仅注释、条件或复杂未知脚本拒绝，不说接管成功；解释 `--no-integrate` 或手动安排简单加载后重试，
  不替用户改写复杂 profile。原生 WSL bash `--login -ic` 的已知简单加载补验通过，无新增下载。
- 官方 CLI 重装／升级后 wrapper 可能丢失真实路径。确认实际 launcher 归属和修复授权后，
  用目标安装的明确入口执行 `integrate repair`；它会重写 wrapper 与用户级 PATH 项，
  不能把修复一份安装变成未经确认的源码／prefix 切换。

## 安装自更新（r8 起可用）

`v2.1.1-r8` 起提供 update；安装版本与固定 tgz 链接见项目 README 的“快速上手”。
旧 r7 发布包不含 update，须先手动升级至 r8 或更高版本，不能直接在 r7 上运行该命令。
用户要求更新已具备该命令的 launcher 时，先运行：

```sh
open-kimi-web update --check
```

一键安装的专用 prefix 沿用标准 npm 全局布局；wrapper 使用记录的 Node，更新器优先解析其旁的 npm，
不因 shell 中没有 Node／Corepack／pnpm 要求重新安装运行时或重跑安装器。
用户曾选 `--no-integrate` 时没有新 wrapper／PATH 入口，必须先确认所选 Node 与专用 prefix 的绝对入口，
用该 Node 执行该 launcher 的 `update --check`／`update`；不要用默认 `npm root -g` 或 PATH 上的旧安装猜目标。
安装输出的 `Update:` 使用绝对 Node／launcher 路径；先加 `--check`，Windows PowerShell 命令保留开头的 `&`。

核对输出中实际执行安装、源码／npm 渠道及目标。获得用户更新授权后再运行 `open-kimi-web update`；
不要把只要求检查当成更新授权，不使用不存在的 npm registry @latest。
源码仅支持官方仓库的干净 main 跟踪 origin/main；开发分支、修改、领先或分叉必须明确拒绝，
不能替用户 stash、reset、clean、切分支。npm 仅更新已识别的同一全局／自定义 prefix 或简单本地直接依赖；
本地更新会修改 owner manifest／lock 并保留生产／开发依赖类别。
临时 npx、链接、workspace、混合管理器或身份不明时，说明限制，不去更新另一份全局安装。
更新非原子，失败时按输出解释实际阶段，不宣称原安装未变；不自动回滚、repair 或重启。
成功后提醒停止旧 launcher、重新启动并刷新页面；同路径更新不需要 repair，切换位置才需要。
该命令不更新官方 Kimi、不修改 PATH、接管状态、证书、官方 Web 缓存或会话数据。
包管理器缓存可能正常变化；本地 npm 会解析 owner 依赖树，不保证无关依赖逐字节不变。
若后代进程退出无法确认，安装锁会保留；先核实原 updater 及其后代已停止，再按错误提示手工解除锁。

## 大会话加载诊断（r9）

- r9 在 HTTP 代理、官方／自定义静态和注入资源层协商流式 gzip，不新增依赖，不缓存会话或收集全文后压缩。
  已知长度至少 1024 bytes 或长度未知的可压缩流可用 gzip，采用 level 1 与 `Z_SYNC_FLUSH`；背压和取消继续沿用。
  identity 优先、gzip q=0、已编码、HEAD、无正文、Range／206、SSE 与 no-transform 不转码。
- 准确官方 `2.1.1` 已有最近 10 turn、before_turn 与最多 4 个 resident 会话，不要把加载慢解释成全历史下载。
  后端先完整 reduce 再分页，每页仍带 tasks 等实体，单 turn 可能巨大；官方 Remote Control 压缩，本地入口 raw。
- 不修改正文、分页、鉴权、WS、工具默认展开或显式偏好、observer、主题，也不以截断工具输出伪造提速。
  共同 render／layout 仍可能有 400–900 ms 长任务，本轮不修；gzip 不能消除后端恢复、解析和同步渲染。
- r9 Windows 标准检查和完整官方 app 源码实测通过；虚构高度重复 fixture 的受控网络结果不代表普遍倍数或真实 LAN。
  不将正文可见后的输入测试称为最早输入可用，也不把慢 B→快 C 的竞态验证当取消证明。
  代表实图不等于全面视觉验收；实体手机、真实家庭 Wi-Fi 与生产安装未验证，详细发布记录见[计划][lan-plan]。
- 升级后提醒重启旧 launcher，再刷新或重新打开页面；无需清官方缓存或迁移会话数据。
  排查时核对实际版本与运行进程，不读取用户会话、凭据或 wire 来制作测试数据。

## 手机子代理模型与英文界面（r10）

独立 API／View／控件／CSS 属于 r10，不把旧 r9 安装说成已含新控件；发布记录见[发布计划][r10-plan]。
官方 `2.1.1` MobileSettingsSheet 不含 Subagent 字段，没有已确认的完整 Settings 手机打开动作，ModelPicker 未公开导出。
控件复用主模型选择器风格的底部面板、搜索、供应商标签、两行列表、勾选和分段思考，身份按需展开。
同供应商同名长 alias 前置真实唯一差异，保存完整值；不调用 Vue 私有实例或主模型写入回滚，不恢复编号原生 SELECT。
读取官方 config／models，仅 POST `/api/v1/config` 的 `secondary_model` 并合并池，不写主模型、权限／其它配置或 localStorage。
Auto 合法提交 `defaultEffort: ''`；已配置模型仍不能通过 API 清除为跟随主模型，空／null 或省略字段不能清除。
取消不写、失败不假报成功；用户授权变更后才保存，不用付费模型调用验证。

增强层 locale 以官方 `kimi-locale` 为准，本轮覆盖的英文系统 text／title／aria／placeholder 随语言切换刷新，
保留用户中文模型／供应商名、草稿和输入，不新增请求；不扩大为全英文／全平台。
沿用已有 1430 UT、308 IT＋两项 Windows native POSIX 跳过、完整官方 app 199／199 断言，不重复同一验收。
旧 focused 与六项 strict scrollTop 失败仍保留在[手机计划][mobile-plan]；实体手机、OS 软键盘与真实磁盘持久化未验证。
虚构 REST／WS 回读不冒充实际模型调用；r10 发布与资产核对见[发布计划][r10-plan]。

## 安全边界

- 绝不读取、打印或保存 `server.token` 的内容；token 直达链接本身等同于完整凭证，提醒用户不要分享。
- 不替用户接受 HTTPS 证书——指纹核对必须由用户完成。
- 插件删除不恢复接管；仅在 launcher 可用且归属已确认时运行 `integrate uninstall`，不宣称完整清理所有依赖／PATH。
- `--web-dir` 只能指向隔离的前端构建目录；目录内所有可访问的静态文件都会公开给 launcher 访问者，
  不要在其中放日志、备份、配置或凭证。

[lan-plan]: https://github.com/WilliamLambertCN/open-kimi-web/blob/main/docs/plans/large-session-lan-performance-v1-plan.md
[install-plan]: ../../docs/plans/one-click-install-v1-plan.md
[r10-plan]: ../../docs/plans/one-click-install-r10-release-v1-plan.md
[mobile-plan]: ../../docs/plans/mobile-subagent-model-v1-plan.md
[r10-release]: https://github.com/WilliamLambertCN/open-kimi-web/releases/tag/v2.1.1-r10
