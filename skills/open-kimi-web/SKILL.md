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

本轮目标版本 `v2.5.2-r3`，兼容目标官方 `2.5.2`，发布状态以[正式 Release][current-release]为准。
本版按精确调用显示 TTFT、包含等待的平均 TPS 和缓存命中率，历史按相同位置显示；侧聊可独立选模。
桌面“设置 → 通用”和手机会话设置可重启受管服务，忙时拒绝；不自动刷新草稿或重发消息。
保留 r2 图标、r1 消息目录、实际版本、话题标签和官方 2.5.2 适配。
更新后须手动重启并刷新；系统缓存旧桌面图标时，可移除旧快捷方式再重新添加。
精确 2.5.2 支持子代理恢复跟随主模型；全文索引关闭时解释开启方法，不自动开启。发送与插队交给官方。
保留双端菜单、手机置顶、局域网 CA、脱敏日志、App 安装入口和普通 CLI 原样透传。
保留推理档位排序、Tower 条件说明及已有 Kimi 发现／运行时检查；不强制开启实验、不改当前选择或保存数组。
本轮不新增付费调用、不擅自改用户配置、不升级实际官方 CLI，也不自动重启生产。
安装器缺官方时仍固定 2.4.1，metadata 失败的 UI fallback 不变；保留 r1 的 Windows 原生句柄清理与退出确认。
保留 `2.3.1-r2` 新模型默认：仅 `video_in`、`image_out` 不选，其它能力、六档 effort 及 `adaptive_thinking` 选中。
已有显式数组（含空数组）、未知值与 false 不自动改写；保留 r1 的发现选择、唯一可见表单及逐字段保存。
默认是用户偏好，不保证模型服务支持。历史 Coding 对照为 low 成功、xhigh 400，修后 thinking:on 未显式 effort 成功；
medium/high/max 未逐档验证，不依据默认勾选承诺这些参数可用。
本轮验收、CI、包与线上结果见[发布计划][release252r3-plan]；未记录不视为通过。
[2.5.2-r1 发布记录][release252r1-plan]、[2.4.1-r3 发布记录][release241r3-plan]、[2.4.1-r2 发布记录][release241r2-plan]、
[2.4.1-r1 适配计划][compat241-plan]、[2.3.1-r2 计划][r2-plan]及[其 Release][r2-release]保留历史证据。
更早的 [r1 计划][current-plan]及下方 r9／r10 记录不代表本轮结果。

本 skill 管理独立的 `open-kimi-web`，驱动 `integrate install|status|repair|uninstall` 和 `update`。
安装或移除 Kimi 插件不会安装、启动或卸载 launcher，也不会自动修改或撤销 PATH 接管。

## 手机安装到桌面

`2.4.1-r2` 起提供 PWA 清单、安装图标和双端入口；本轮正式发布状态以[Release][current-release]为准。
默认官方增强页面提供“安装到桌面”：手机在会话／工作区抽屉中使用统计之后，桌面在侧栏同一顺序。
Android 等浏览器有原生安装事件时可点安装，否则按面板提示用浏览器菜单；iOS／iPadOS 用 Safari 分享 → 添加到主屏幕。
若系统显示“作为 Web App 打开”，保持开启；独立窗口隐藏安装入口。不能把合成安装事件当作实体手机验收。
必须使用手机信任的 HTTPS；局域网 HTTP 或只跳过自签证书警告不能保证安装，不自动修改证书信任／网络配置。
不注册 service worker、不新增离线会话缓存、不把凭据放入 manifest／start_url／安装元信息。
新窗口无官方凭据或凭据过期时使用原生登录框；不另存 token。自定义 `--web-dir` 不注入。
升级后须用户自行重启实际 launcher 并刷新；实体手机和系统安装未验收，已有检查边界见[PWA 计划][pwa-plan]。

### 局域网证书

`2.4.1-r3` 纳入本地 CA 和手机证书指引，旧 `2.4.1-r2` 包不包含；正式发布状态以[Release][current-release]为准。
先确认实际安装已支持此功能，并与日常启动使用同一 `OPEN_KIMI_WEB_HOME`；未自定义时沿用默认 home。
获得用户启用授权后，使用该安装入口执行一次：

```sh
open-kimi-web tls setup
```

setup 建立稳定根并启用签发，不修改设备信任或网络，不启动／重启服务。让用户自行重启实际服务，再打开 Network 链接。
手机在“安装到桌面”下载根公证书，与电脑终端的 SHA-256 指纹核对，由本人到安卓设置导入 CA，再完全关闭并重开 Chrome。
不要只凭网页上的指纹信任下载文件；不替用户导入证书。日常启动复用同一根，地址变化或网站证书临期才续签。
局域网与 EasyTier 地址仍分别登录和安装，图标不会自动换地址；证书可信不保证 WebAPK，实体手机安装尚未验收。
`open-kimi-web tls status` 查看状态和根指纹，`open-kimi-web tls disable` 仅取消下次启动选用，不删证书或撤销手机信任。
显式自定义证书优先；根损坏、缺失或过期明确报错，不自动换根。[详细操作][lan-ca-guide]与[本地验证][lan-ca-plan]。

## 会话三个点菜单

电脑会话行三个点打开原生右键菜单，使用其中的 Fork／分叉及置顶；原右键入口不变，不先选择源会话。
手机三个点提供分叉、置顶／取消置顶，列表顶部“已置顶／Pinned”区显示已置顶会话，支持平铺和按工作区视图。
手机普通原生行会先打开源会话并关闭列表，从本次原生选择后的路由确认精确 ID；不要按标题、时间或行顺序猜身份。
分叉使用正式接口，不自动重试、终止、信任或接管；失败或结果未知按提示处理，不把重复点击作为安全重试。
置顶只沿用当前浏览器、同一站点的会话 ID 偏好，不改变工作区置顶，不跨设备或不同 IP／端口同步。
手机置顶／取消置顶会重新加载一次并恢复列表，保留未发送的文本草稿；附件准备或上传未结束时须等待后重试。
已有真实后端及完整 app 验证的边界见[会话菜单计划][session-menu-plan]，不据此承诺实体手机或任意大会话。

## 前置检查（每次必做）

1. 先检查 `open-kimi-web --version` 是否可用；wrapper 可使用记录的私有 Node。
   **不要仅因 PATH 中 `node --version` 缺失／过旧拒绝正常 wrapper。** 直调 launcher 需 Node ≥ 22，共享官方 npm runtime 需 ≥ 22.19.0。
2. 管理已有接管时运行 `open-kimi-web integrate status`，结合 PATH 顺序、真实 Kimi 与 wrapper 的精确 Node／launcher 目标判断归属。
   status 不保证列出这些目标，无接管时也可能退出 0，不能只凭退出码推断接管成功或健康。
   若 `--no-integrate`／失败安装／PATH 未加载导致命令不可用，使用安装输出的绝对 Node／launcher 入口，不猜默认 prefix。
3. launcher 不可用时提供以下安装路线，未获安装／接管授权不得静默联网执行。
   **不把缺 Node／Corepack／pnpm 的用户引到源码依赖安装**；本项目不发布到 npm registry，不声称裸包名安装可用。

### 提供安装路线（先解释影响并确认授权）

优先提供[README 快速上手](https://github.com/WilliamLambertCN/open-kimi-web#快速上手)中的在线安装命令，
无需克隆仓库或手动下载脚本。
Windows PowerShell ≥ 5.1／macOS-Linux sh 从 `v2.5.2-r3` GitHub commit API 解析并校验真实 40 位十六进制 SHA。
只下载该 SHA 入口，成功后用 PowerShell script block／`sh -c` 执行，传同一 `--revision` 与固定 `--version 2.5.2-r3`。
入口取同提交完整 coordinator／helpers；tag、SHA、下载或资产不可用即停，不回退 main／旧包，不复用旧 r10 SHA 或伪造将来 SHA。
HTTPS 和同提交配对不是签名验证；正式发布前不说入口已在线可用。本地入口与 helpers 也必须同提交：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 --version 2.5.2-r3
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 --version 2.5.2-r3 --no-integrate
```

```sh
sh scripts/install.sh --version 2.5.2-r3
sh scripts/install.sh --version 2.5.2-r3 --no-integrate
```

- 无需预装 Node／npm／Corepack／pnpm／Git／官方 Kimi，仍需联网与标准 PATH curl／tar，不是离线安装。
  优先 Node ≥ 22.19.0 与配套 npm，缺失才校验并准备固定 Node `22.23.3`；home 必须是安全绝对目录。
  launcher prefix、official prefix、runtime 和 bin 分离，不覆盖系统 Node／Git，不要求管理员权限。
- 保留显式 override／已登记目标／PATH 顺序，有界检查官方默认 bin、`KIMI_INSTALL_DIR/bin`、uv／XDG、
  Windows 持久 Machine／User PATH、APPDATA/npm 及所选 Node 旁标准命令，不递归扫盘或修改持久 PATH 来搜索。
  多份无明确优先级需显式 override；未知 PowerShell 函数／脚本／带参 wrapper 不执行，不猜新旧。
  先明确复用已有可用官方 CLI，不下载或升级它；坏、歧义、不支持候选拒绝，不当 missing 后另装。
- 只有确认缺失才准备固定官方 `2.4.1` tarball／SHA-512，ignore-scripts 避免旧 Python 迁移。
  旧 owned `2.3.1`／`2.1.1` 仅在精确 version／integrity、package 身份与 entry／shim digests 全通过后复用。
  未知归属／坏 override／partial 拒绝，不自动续装。适当的真实 probe 成功才写 record；重复 probe，坏安装不自动重建。
- 官方 `2.4.1` 无 node-pty，按精确身份做真实 Node `child_process` shell probe；不是任意缺 node-pty 都算成功。
  旧 owned 版仍需真实 PTY；Linux **只有 legacy rebuild** 需 Python 3、C／C++ 和 make，不再无条件要求新版装编译工具链。
  legacy rebuild 仅审计固定 node-pty 1.1.0／node-addon-api 7.1.1 并限定绝对目录，不跑根 Kimi 或其它包脚本，不 sudo／apt。
- Windows Git Bash 仍必需，可用即复用，缺失才验证 portable Git；不改系统 Git，未知 `KIMI_SHELL_PATH` 报错。
  SFX 不运行默认 post-install.bat，显式执行审计过的初始化；历史 portable 和缺 Git 完整 coordinator 是分开验证。
- 默认接管会写用户 PATH／受支持 shell rc，先解释并取得授权；已有其它已识别源码／prefix 需显式 `--switch-installation`。
  未知／部分接管及降级仍拒绝，不删除旧安装；`--no-integrate` 不建立、修改或撤销接管。
  **已有用户日常升级用 `update --check`／`update`**，不以重装或切换绕过身份检查。
- PowerShell `--` 参数原样传递，Bypass 仅限此次进程；不猜写成 `-Version`／`-NoIntegrate`。
  本地薄入口 `--help` 不要求 Node、不联网、不写入，非法参数也在 runtime 前拒绝；独立入口须显式匹配 revision。
- PATH 遮挡或 shell 不支持时按输出处理，不把包已安装当接管生效；不自动登录、启动生产服务、读真实会话或发付费调用。
  macOS／arm64、Windows 真注册表／新终端及实体手机未全面验收；历史见[安装计划][install-plan]。
  本轮只以[发布计划][release252r3-plan]的实际证据为准，不把旧 r9、本地 pack 或 Git Bash 当作全平台通过。

已有 Node ≥ 22／npm 可手动装 launcher，但不准备官方 Kimi；官方 npm `2.4.1` 需 Node ≥ 22.19.0，Windows 仍需 Git Bash。
不需要 Corepack／pnpm；正式发布后使用固定 URL：

```sh
npm install -g https://github.com/WilliamLambertCN/open-kimi-web/releases/download/v2.5.2-r3/open-kimi-web-2.5.2-r3.tgz
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

- 用户照旧运行 `kimi web`：官方服务器在 loopback 启动，launcher 增加展示层并打印 token 直达链接。
  wrapper 只有首参数为 `web` 才解析和校验 OKW 选项；非 web 调用，包括 `kimi --debug` 或提示词，原样交给官方。
  非 web 调用不换 `KIMI_CODE_HOME`，不改变工作目录、argv 或退出码；不要用 OKW 参数校验拦截普通 CLI。
- `kimi web --host 0.0.0.0` 启用 HTTPS；自定义证书优先，其次为显式启用的本地 CA，未启用时仍用旧自签名证书。
  独立启动 launcher 时使用 `open-kimi-web serve --lan`；提醒用户核对终端上的网站证书指纹，CA 导入按上方步骤本人确认。

### 慢会话诊断

`2.4.1-r2` 起提供脱敏日志，本轮保留；完整说明见[诊断计划][debug-plan]。
用 `kimi web --host --debug` 或 `open-kimi-web serve --lan --debug` 启用，保留用户原 home／target／选项。
保留 `--debug-log` 别名及 `OPEN_KIMI_WEB_DEBUG_LOG=1`，其它环境值不启用。
只有这些 Web 入口消耗 OKW 日志选项，不传给官方后端，不启用官方 debug-endpoints；普通 `kimi --debug` 仍交给官方。
先确认实际执行的 launcher 支持该参数；生产重启须用户授权，拉取源码不能热装日志。
只读取 OKW home 的 `logs/debug-*.jsonl`，不要收集含 token 直达链接的完整终端输出。
按 id／clientTag／sessionTag 关联 HTTP begin／upstream／first_byte／end 和 WS ready／first_frame／progress。
上游等待长、输出体积大与浏览器渲染慢必须区分；日志不测浏览器 DOM 解析／渲染，服务端 finished 不等于用户已显示。
rawBytes 是进入压缩器前的正文，已有 gzip 不解压；wireBytes 不含协议开销，measured=false 不可当零流量。
日志无正文、原始凭据／路径／IP／ID，仅每运行匿名标记；仍含时间和流量，不无条件公开。
单文件 5 MiB、每运行最多两备份，旧运行日志不自动清理；不要宣称加日志等于修复现场故障。

### 推理档位只改展示

已支持项按 `none → minimal → low → medium → high → xhigh → max` 展示，未知项稳定保留在 Max 前；
Auto／Off／On 保持各入口原语义。不重排 `supportEfforts`、不新增支持项、不改当前值、默认推导或保存数组，r2 默认保留。
旧 `low / medium / max` 通过 Set 追加 `high / xhigh` 会产生用户所见乱序，旧测试仅用有序数组漏掉该路径。
不要通过清洗用户配置或更改默认来修展示；键盘顺序及真实 app 结果只按 [2.4.1 计划][compat241-plan]记录说明。

### Tower 入口与安全开启

Tower 不是账号／provider 权限。实际 backend 的 `GET /api/v1/meta` 必须有 `experimental_flags.tower === true` 才显示入口，
实验默认 off。单项 `KIMI_CODE_EXPERIMENTAL_TOWER` 优先配置，再回退全局实验开关；实际进程继承的环境与 `KIMI_CODE_HOME` 重要。
会话 chip 另要求模式已开且不是 Side Chat；不以缺 chip 判断功能不存在，Side Chat 无入口正常。
off-start 后 live config true 可显示入口，但启动时未组装工具。不能用页面刷新或只重启独立 proxy 代替实际 backend 重启。

先解释[官方实验指南][official-tower]：worker／reviewer 使用 Never Ask，可能快照未提交／未跟踪文件，
各 agent 独立消耗 token／磁盘，worktree 不是安全沙箱；先检查仓库和秘密文件。
只有用户决定开启才给操作建议，不代开或自动重启。请用户自行停止实际后端，
在同一重启终端设置单项变量，保留原 home／工作区及其它启动选项：

```powershell
$env:KIMI_CODE_EXPERIMENTAL_TOWER = 'true'
kimi web --host
```

```sh
KIMI_CODE_EXPERIMENTAL_TOWER=true kimi web --host
```

这适用于已接管入口；独立 `serve --target` 应让用户重启 target。实验入口可见与会话开启 Tower 是两步，
不发付费 prompt、不用 `/tower status` 来验证入口，不在日志或回复中输出 token／真实配置。

### 官方 2.3.2—2.4.1 变化与 cron 边界

按[官方更新日志][official-changelog]解释以下上游变化，不称为本项目新造：

- `2.3.2` 默认不主动 delegate，AgentSwarm 须用户显式开启 swarm。
- `2.3.3` 增加 Swarm 高用量警示并更新模型切换确认；保留官方信任、锁与确认，不自动接管。
- `2.4.0` 增加 Claude Code／Codex 近期导入（近 15／30 天）、provider refresh、`Ctrl-O` 思考显示切换，
  Tower 每任务模型与并发默认 16→256；Plan 须用户显式要求且执行前 review。空闲 30 分钟卸载／透明恢复，
  统一 interaction，移除 node-pty／session terminal，不把卸载当作 archive／delete。
- `2.4.1` Read 默认 100,000 字符或约 25,000 tokens 先到为准，`read.max_chars` 可调；内置 prompt／重复提醒精简及 Web 修复。

cron 默认 off，显式 `kimi web --scheduled-tasks` 才启用。READ 精确 `2.3.1`／`2.4.1`／`2.5.2` 只读，
WRITE 仍只精确 `2.1.1`／`2.2.0` 且须显式恢复确认；未知与相邻未列版本拒绝。
保留 transport／route 双写 gate、鉴权、冷会话不恢复和普通／编码 debug 封闭；不能与同实例 RC 并用，外部 target 不开放。
不伪造 cron 编辑／暂停／独立任务模型；Tower 每任务模型不是 cron 模型能力。历史协议快照未为 2.4.1 重捕，实际验收见本轮计划。

## 撤销接管

插件系统**没有**卸载钩子。移除插件不会运行 `integrate uninstall`，也不会撤销在插件外完成的 wrapper/PATH 接管；launcher 是否仍可用取决于其独立安装状态。要恢复官方命令路径时：

1. 运行 `open-kimi-web integrate uninstall`，移除 wrapper、接管 PATH/rc 项和状态文件；
   官方安装、launcher 包与用户数据不受影响；
2. 若还要移除插件，再单独运行 `/plugins remove open-kimi-web`。

Windows 一键安装器加入的私有 Node User PATH 项在 r9 撤销后仍保留；无需时解释具体路径并请用户手动移除。
撤销接管不是卸载安装器的专用 npm prefix 或私有 runtime，不自动删除旧源码或其它安装目录。
撤销只移除 OKW 入口，不替官方补 PATH；原来已在 PATH 的官方 `kimi` 继续可用，原来需绝对路径的仍需绝对路径。

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
`2.5.2-r3` 正式发布后，旧版正常运行 `update --check`／`update`，先核对实际安装和目标 `2.5.2-r3`。
不要求同版重装、重跑安装器或追加 `--switch-installation`；源码仍须干净 main 跟踪 origin/main，只做快进。
完成后用户自行重启旧 launcher／对应 backend 并刷新；独立 target 须重启实际后端，不自动开启 Tower。
CA 需另行显式 setup，更新不会自动启用或导入手机证书。
更新不升级用户已有官方 Kimi，官方功能取决于实际 backend；保留 `2.3.1-r2` 默认与已有显式模型配置。
本轮 latest/update 与线上验收以[发布计划][release252r3-plan]实际记录为准，旧计划保留历史，不借旧记录写通过。
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

## 大会话加载诊断

`2.4.1-r2` 起提供最近页优化；本版支持增强 UI 精确 2.3.1／2.4.1／2.5.2，main 无 cursor 最近页先取 1 轮。
旧历史仍用官方分页，正文和实体不变；自定义 UI 和其它版本不改请求。
无偏好时默认折叠工具活动，已有值不迁移；旧用户可在官方设置开启折叠。短首屏可用原生“加载更早消息”。
不承诺自动预取或巨大单轮秒开，后端恢复、实体和解析仍可能慢；已有证据见[低带宽计划][low-bandwidth-plan]。
发布状态以[正式 Release][current-release]为准，下方 r9 数据是历史结果，不代替本轮验收。

### r9 历史传输改动

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
Auto 合法提交 `defaultEffort: ''`；旧版不能以空／null 或省略字段清除配置。
本版仅对确认的精确 2.5.2 使用原生 `secondary_model: null` 恢复跟随主模型，其它版本不猜测支持。
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
[current-plan]: ../../docs/plans/kimi-code-2.3.1-workspace-release-v1-plan.md
[r2-plan]: ../../docs/plans/provider-defaults-r2-release-v1-plan.md
[r2-release]: https://github.com/WilliamLambertCN/open-kimi-web/releases/tag/v2.3.1-r2
[compat241-plan]: ../../docs/plans/kimi-code-2.4.1-compatibility-v1-plan.md
[release241r2-plan]: ../../docs/plans/kimi-code-2.4.1-r2-release-v1-plan.md
[release241r3-plan]: ../../docs/plans/kimi-code-2.4.1-r3-release-v1-plan.md
[session-menu-plan]: ../../docs/plans/session-menu-actions-v1-plan.md
[lan-ca-plan]: ../../docs/plans/android-lan-ca-v1-plan.md
[lan-ca-guide]: https://github.com/WilliamLambertCN/open-kimi-web/blob/main/packages/launcher/README.md#局域网证书
[low-bandwidth-plan]: ../../docs/plans/large-session-low-bandwidth-v2-plan.md
[debug-plan]: ../../docs/plans/large-session-debug-log-v1-plan.md
[pwa-plan]: ../../docs/plans/pwa-install-v1-plan.md
[release252r1-plan]: ../../docs/plans/kimi-code-2.5.2-r1-release-v1-plan.md
[release252r3-plan]: ../../docs/plans/request-metrics-2.5.2-r3-release-v1-plan.md
[current-release]: https://github.com/WilliamLambertCN/open-kimi-web/releases/tag/v2.5.2-r3
[official-changelog]: https://www.kimi.com/code/docs/en/kimi-code-cli/release-notes/changelog.html
[official-tower]: https://www.kimi.com/code/docs/en/kimi-code-cli/guides/tower.html
