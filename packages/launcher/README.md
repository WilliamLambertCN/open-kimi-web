# open-kimi-web

[Kimi Code](https://github.com/MoonshotAI/kimi-code) 的非官方轻量增强 launcher：默认保留官方构建界面与后端，在外层提供单源代理、局域网 HTTPS 和移动页面修复。

> **这不是 Kimi Code 官方产品。** 社区项目，与 Moonshot AI 无关联、不由其维护或背书。

## 安装

本项目不发布到 npm registry；版本 `v2.3.1-r1` 兼容 Kimi Code `2.3.1`。
本轮真实双端路径／原生信任与重启持久化、cron 只读及官方 npm 安装验收已通过，标准 lint／typecheck／UT／IT／pack 通过。
手机预览透底、子模型文案及新增工作区排序已修，并完成受影响主题、窄屏及官方安全对话框的定向实图检查。
准确证据与未验边界见[发布计划][current-plan]；CI 与发布以公开记录及 [Release 页面][current-release]为准。
官方 [2.3.1 Release][official-231-release] 修复无 Git Bash 时的工作区信任流程、POSIX 崩溃残留占用，
并改进持有客户端名称及 retry／takeover 对话框；增强层保留原生信任、会话锁与模型确认，不关锁或自动接管。
2.3.0 的模型切换确认受云配置控制，RC 压缩／100 MiB 处理和归档恢复属于官方功能，不作为本项目新增能力。

### 一键安装（推荐）

复制对应系统的命令到终端运行，自动下载安装，无需手动下载脚本。

**Windows：打开 PowerShell，粘贴运行。**

```powershell
& {
  $api = 'https://api.github.com/repos/WilliamLambertCN/open-kimi-web/commits/v2.3.1-r1'
  $sha = (Invoke-RestMethod $api -ErrorAction Stop).sha
  if ($sha -notmatch '^[0-9a-fA-F]{40}$') { throw 'Invalid release commit SHA' }
  $url = "https://raw.githubusercontent.com/WilliamLambertCN/open-kimi-web/$sha/scripts/install.ps1"
  & ([scriptblock]::Create((Invoke-RestMethod $url -ErrorAction Stop))) --revision $sha --version 2.3.1-r1
}
```

**macOS / Linux：打开终端，粘贴运行。**

```sh
(
  set -eu
  api='https://api.github.com/repos/WilliamLambertCN/open-kimi-web/commits/v2.3.1-r1'
  metadata=$(curl --fail --silent --show-error --proto '=https' --tlsv1.2 "$api")
  sha=$(printf '%s\n' "$metadata" | sed -n 's/^[[:space:]]*"sha":[[:space:]]*"\([0-9a-fA-F]*\)".*/\1/p' | head -n 1)
  case "$sha" in ''|*[!0-9a-fA-F]*) exit 1 ;; esac
  [ "${#sha}" -eq 40 ] || exit 1
  url="https://raw.githubusercontent.com/WilliamLambertCN/open-kimi-web/$sha/scripts/install.sh"
  script=$(curl --fail --silent --show-error --proto '=https' --tlsv1.2 "$url") &&
    sh -c "$script" install.sh --revision "$sha" --version 2.3.1-r1
)
```

自动补齐缺少的 Node/npm、Kimi 和 Windows Git Bash，已有安装优先复用。
安装后新开终端运行 `kimi web --host`；Linux 工具前提和其它选项见
[快速上手](https://github.com/WilliamLambertCN/open-kimi-web#快速上手)。

命令从 `v2.3.1-r1` commit API 解析并校验 40 位 SHA，只下载同 SHA 入口，再传同一 `--revision` 获取完整安装器。
固定 `--version 2.3.1-r1`；tag、入口或资产不可用即停，不回退旧版、不直接执行可变名称入口；HTTPS 不等于签名验证。
已有其它源码／prefix 需显式 `--switch-installation`；仅装包加 `--no-integrate`，日常升级用 `open-kimi-web update`。
空 Linux（glibc）仍需 Python 3、C／C++ 编译器与 make；macOS／arm64、Windows 真注册表／新终端未全面验收。

运行时优先 Node ≥ 22.19.0 与配套 npm，缺失才 SHA-256 校验固定 `22.23.3`；launcher prefix、官方 prefix、runtime 与 bin 分离。
缺官方时准备固定真实 `2.3.1` tarball／SHA-512、ignore-scripts，不迁移旧 Python 命令；坏 override／partial／未知归属拒绝。
已知 owned `2.1.1` 须验证 version／integrity、package 身份及 entry／shim digests 后复用，不自动升级。
新自有安装先真实 PTY，成功才写 record；owned 重复 probe，损坏拒绝不自动 rebuild，non-owned 安装不重建。
Linux 缺 binding 只审计固定 node-pty 1.1.0／node-addon-api 7.1.1 并限定绝对目录 rebuild，不跑根 Kimi 或其它包脚本。
Windows 缺 Git Bash 才准备校验过的 portable Git，不改系统 Git；SFX 不运行默认 post-install.bat，显式执行审计过的初始化。
本地入口与 coordinator／helpers 必须来自同一提交；本地 `--help` 不联网、不写入、不要求 Node。
完整选项与 shell 限制见[仓库 README](https://github.com/WilliamLambertCN/open-kimi-web#快速上手)。
历史 r9 场景及 fixture 仅代表对应阶段；portable 与缺 Git 完整 coordinator 不是同一次组合验收，Web 200 不能代替 PTY。
根安装脚本不在 launcher tgz；历史发布记录见 [r10 计划][r10-plan]，本轮安装、CI 与资产结果见[当前计划][current-plan]。

### 手动 npm 安装（已有 Node ≥ 22／npm）

此路线只装 launcher；需自行准备可运行的官方 Kimi，官方 npm `2.3.1` 需 Node ≥ 22.19.0，Windows 仍需 Git Bash。
不需要 Corepack／pnpm；首次安装且尚未接管时，使用 `v2.3.1-r1` Release 的固定 tgz URL：

```sh
npm install -g https://github.com/WilliamLambertCN/open-kimi-web/releases/download/v2.3.1-r1/open-kimi-web-2.3.1-r1.tgz
open-kimi-web integrate install
```

### 开发者源码路线

仅源码开发需要 Node ≥ 22、Git 和 Corepack／pnpm，普通用户不必克隆源码并安装开发依赖。

```sh
git clone --branch main https://github.com/WilliamLambertCN/open-kimi-web.git
cd open-kimi-web
corepack pnpm install --frozen-lockfile
node packages/launcher/bin/open-kimi-web.mjs integrate install
```

已有接管时，手动切换安装方式或目录还需要按下方“升级”说明更新入口。

### 手机子代理模型与英文界面（r10）

手机控件沿用主模型选择器风格的底部面板、搜索、供应商标签、两行列表、勾选与分段思考，身份按需展开。
同供应商同名长 alias 前置真实唯一差异，保存完整 alias；保留桌面原入口和官方外观。
官方 `2.1.1` 未导出 ModelPicker，也没有已确认的完整 Settings 手机打开动作；独立控件不调用 Vue 私有实例或主模型写入。
通过官方 GET config／models 与 POST `/api/v1/config` 仅保存 `secondary_model` 并合并池，不覆盖其它配置、不另存 localStorage。
Auto 合法提交 `defaultEffort: ''`；已配置模型仍不能通过 API 清除为跟随主模型，空／null 或省略字段不能清除。

共享 locale 读取官方 `kimi-locale`，本轮覆盖的主题、手机状态、会话、usage／provider 等英文系统文案随语言切换刷新，
保留用户中文模型／供应商名、草稿与输入，不新增后端请求。
沿用已有 1430 UT、308 IT＋两项 Windows native POSIX 跳过、完整 app 199／199 断言，不扩大为全平台验收。
实体手机、软键盘及真实磁盘持久化未验证；旧 focused／strict scrollTop 失败保留在[手机计划][mobile-plan]。
发布与资产核对见[发布计划][r10-plan]的真实记录。

`2.1.1-r9` 新增无依赖的 Node 流式 gzip，覆盖 HTTP 代理、官方／自定义静态资源及注入资源。
保留桌面会话体积、手机平铺与三种工作区展示排序，以及 r8 起提供的安全自更新。
聊天自适应宽度、消息时间戳补显、图片完整预览和 tab 反馈继续保留。
手机提问卡片支持长题干与选项共同滚动，也可拖动高度并保存当前浏览器和站点的档位；
包含模型用量统计、归档删除与长会话性能增强。
保留 r5 的价格修复：离线快照、联网刷新、真实模型 ID 自动建议和批量确认，模糊建议不直接计费。
手动映射和单价优先；目录刷新沿用各模型原默认键，缺失键保留上次有效价格并标出旧价。

## 统一导航与会话搜索

桌面和手机左上操作顺序统一为：新建会话、新建工作空间、定时任务、搜索、使用统计。
两端搜索使用官方 `/api/v1/search` 索引与分页，可选内容、匹配方式和排序，点击结果打开所属会话。
双端工作空间弹层直接接收运行端已有目录的绝对路径，支持粘贴带成对外层引号的路径，调用正式接口。
不切离当前会话或丢失草稿，不创建文件夹、不自动授信；不是在手机或浏览器设备上选择本地目录。

**定时任务轻量接入（版本受限）：** 沿用原版后端、原数据目录及原会话，不维护后端分支、不加引擎、不改任务日志。
支持分页查看原会话与保存的任务、内容／计划／模型来源、真实触发记录；显式 `kimi web --scheduled-tasks` 启用，默认关闭。
精确 `2.1.1`／`2.2.0` 保留显式恢复确认后的新建、删除；本轮精确 `2.3.1` 适配限定只读任务／历史，未知版本拒绝。
实测 `2.3.1` debug 写入可绕过会话锁和 stale gate，且可能延迟落盘，缺少兼顾归属、新鲜度与持久化回执的原子入口。
已实现服务端 transport／route 双 gate，在 debug mutation 前拒绝写入；UI 中英提示只读、隐藏恢复／新建、禁用删除。
定向测试及真实 launcher 验收确认创建／删除 409 且无 mutation，冷会话与 wire 不变；不为只读唤醒冷会话。
用户仍可主动打开原会话；定向 UI、CI 与发布记录见[当前计划][current-plan]。
该模式不兼容同实例官方 Remote Control；外部 `serve --target` 不开放管理能力，不自动修改安装或重启生产。
普通和编码 debug 路径均阻断；opt-in 另封闭 RC 路径族，逐次检查原版鉴权和 RC 状态，失效时退出自有实例。
只读列表不会恢复冷会话；旧版“恢复并管理”须确认会启动其中原有任务，关闭浏览器不等于停止任务。
首次冷读仍需有界扫描日志；缺失／变化／超限明确提示不完整，历史只显示最近最多 100 项，不支持历史翻页。
模型跟随所属会话，历史有证据才显示实际请求模型；回合完成不等于业务成功。
原生没有的编辑、暂停和独立任务模型不伪造。历史双版本公开链路通过，完整 2.2.0 UI／实体手机／其它平台未全面验收。
历史 r10 不包含此特性；此前实现与验收见[实施计划][cron-plan]，不据此承诺新版 cron 全功能。

Hyper-V／vEthernet 不再因名称从网络访问链接和 TLS SAN 中排除；internal、回环和 IPv6 link-local 仍过滤。
只更改软件地址枚举，不修改网卡、桥接、路由或生产服务。

## r9 流式 gzip 与验证边界

`src/responseCompression.mjs` 仅使用 Node 内置 zlib／stream，不增加运行时依赖。
按 Accept-Encoding 为可压缩 MIME 协商 gzip；已知长度至少 1024 bytes 或长度未知的流可压缩。
使用 level 1、`Z_SYNC_FLUSH` 与 `pipeline`，保持背压，错误、取消和断线时清理上游与压缩器。
不为压缩收集完整正文、不缓存会话内容；不改变正文、分页、鉴权、WS、工具展开默认及显式偏好、observer 或主题。
合并 Vary，压缩后删除原 Content-Length／digest 等编码相关头，并弱化合法强 ETag。
identity 优先、gzip q=0、已编码、HEAD、无正文状态、Range／206、SSE 与 no-transform 不转码。

准确官方 `2.1.1` 已有最近 10 turn、before_turn 分页及最多 4 个 resident 会话，并非全历史下载。
后端先完整 reduce 再分页，每页仍带 tasks 等实体，单 turn 可很大；官方 Remote Control 会协商 gzip，本地入口 raw。
本轮只修可压缩传输差异；共同的后端恢复、JSON 解析和工具展开 render／layout 仍可能慢，后者有 400–900 ms 长任务。
完整官方 app 源码实测 10 个样本／217 项断言及 27 项边界断言通过，无页面错误；旧页、resident 与 WS 恢复保持正常。
工具响应解码后仍为 1,340,243 bytes，gzip 编码为 11,710 bytes；主 JS 的 3,906,433 bytes 编码为 1,436,290 bytes。
受控网络、虚构高度重复 fixture 不代表普遍压缩倍数或实际 tunnel／LAN；输入验证在正文可见后执行，不是最早可用时刻。
代表实图已核对，Original 手机顶部 badge／subtitle 的既有对比问题不变，不宣称全面视觉通过。
实体手机、真实家庭 Wi-Fi 与生产安装未验证；升级后须重启旧 launcher 并刷新页面。

r9 Windows lint、typecheck、66 文件／1146 项 UT、13 文件／154 项 IT 与 test:pack 通过。
UT 行／分支覆盖率 88.14%／80.76%，IT 87.98%／75.91%；覆盖率门槛不变。
审查后补齐条件请求变体 metadata、既有响应头、205 长度及首 gzip 段后的空闲超时回归。
打包冒烟确认 r9 版本、压缩模块随包及静态／API 实际调用；源码 app 实测不等于交付包浏览器验收。
交付包浏览器、CI 与线上验证按发布流程单独记录在[计划][lan-plan]。

## 聊天增强与保留的 r8 历史验收

桌面正文列和输入卡片随主聊天窗格自身宽度调整，大窗格正文可用列约占 60%，窄窗格保留边距。
侧栏、右面板和分隔条改变窗格尺寸时自动重排，目录保持在正文外侧；手机及 Side Chat 保持原布局。

手机标题下、桌面主会话标题旁及空会话顶部显示当前会话各 agent 的 wire 日志 B / KB / MB 体积。
每 10 秒轻量刷新，不读取日志全文；手机与桌面共用计量和刷新状态。
不含图片附件，不代表上下文 token 上限；仅受管本机模式可用，独立 target 或计量失败显示“会话 —”。

主会话 transcript 提供可靠时间且能精确对应消息时，补显示缺失时间，支持点击或键盘展开完整日期。
不伪造未知时间；Side Chat、仅实时 WS 消息和超过 1,048,576 字符的 transcript 响应保留官方时间显示。

以下仅为保留的 r8 历史验收，不代表 r9 结果：
r8 Windows lint、typecheck、65 文件／1007 项 UT、11 文件／89 项 IT 与 test:pack 通过。
Windows UT 行／分支覆盖率 87.58%／79.64%，IT 87.43%／74.87%；覆盖率门槛不变。
[PR #24 Ubuntu CI](https://github.com/WilliamLambertCN/open-kimi-web/actions/runs/37879364663) 通过 lint、typecheck 与 test:pack。
Ubuntu UT 65 文件、1006 项通过＋1 项 Windows-only 跳过（共 1007）；IT 10 文件通过＋1 文件跳过，
87 项通过＋2 项 Windows-only 跳过（共 89）。Ubuntu UT 行／分支覆盖率 87.31%／79.79%，IT 86.11%／73.95%。
官方完整 app 使用虚构数据完成 42 组手机外观矩阵及分页、折叠、选择、偏好和断点定向补验。
自更新已完成隔离源码／npm 安装与测试 tgz 的真实替换，Ubuntu CI 另验证 npm Config／Pacote 反证和
POSIX TERM／process-group 收尾；线上资产安装与已最新检查在发布后单独核验，生产用户升级与实体手机操作未验证。

## 图片完整预览与 tab 反馈

官方 `2.3.1` 的 PNG／JPG／GIF／WEBP／BMP／ICO／AVIF 与 PDF 原生使用鉴权 download／Blob 预览。
SVG 与旧版仍可能走 `fs:read`；保留增强 fallback，将截断 base64 图片转为官方鉴权 `fs/{path}:download`。
fallback 拒绝重定向并校验图片 MIME、原 size 与完整字节，上限 32 MiB；此上限不是新版所有原生预览的限制。
超限、下载失败或字节不全明确报错，不退回半图；部分读取、文本和无关请求不变，不持久化图片、路径与 token。

会话、分类和右侧文件 tab 提供不挡操作的 Loading 与滚圈；关联响应交付让出一次绘制机会，原生 loading 出现后交回。
快速点击只保留当前反馈，慢 B→快 C 的旧响应、错误和关闭均会正确收尾；内容竞态仍由官方 generation 处理。
不改官方 bundle，不用 Vue 私有状态，不复制官方会话／文件状态或接管内容 loader。

保留的 r6 历史验收：实际 tgz 等价图片 Chrome 像素矩阵完成 115 项断言、110 张截图；
opaque 2.69 MB、transparent 1.57 MB、
>10 MiB、失败及 Fit／Actual 的全部主题检查通过，完整 RGBA 正确；这不是完整 app 验收。
另以完整官方 `2.1.1` app 动态 import 实际解包的 officialPresentation 资源，4 张 PNG 使用原生 `.fp-image`，
read 1 MiB→download 完整 opaque 3,148,932 bytes、透明 1,833,306 bytes，底部 RGBA 与 Fit→Actual→Fit 通过。
原始桌面、夜幕手机两组共 8 次点击的绘制机会为 9.8–34.5 ms，slow B→fast C、失败及关闭通过。
此前 14 组／56 次网络路径点击的 4.6–31.1 ms 与清理验证保留；指标是绘制机会，不是系统显示延迟。
约 2.1 MB 内联文本仍需 453.6 ms，45 turn 缓存会话仍需 152 ms，仍会阻塞；不宣称所有 tab 卡顿已消除。
r6 当时的 lint、typecheck、644 项 UT、61 项 IT、test:pack 与实际包安装启动通过，PR #22 CI 已绿。
实体设备与用户实际数据未验证，不公开用户截图。

## 模型用量与 API 成本统计

桌面侧栏和手机会话／工作区切换抽屉提供“使用统计”入口。
支持 `1d`、`3d`、`1w`、`1m`、`2m`、`3m` 和自定义时间，按实际请求的模型 ID 汇总，
展示普通输入、缓存读取、输出、缓存写入、缓存命中率和 API 等值费用。
历史用量排除 fork 复制前缀；模型分布、明细和建议分批展示，价格配置可搜索模型与公共目录。
可刷新目录并批量确认建议，或手动覆盖单价；同键使用新价，缺失键沿用上次有效价格并标旧价。
旧版价格缓存按已知内置来源自动兼容，无需删除缓存或迁移会话数据。

统计需要通过接管的 `kimi web` 受管模式启动，独立 `serve --target` 模式不会读取本机用量。
未记录或身份不明确的数据会标出；费用按当前单价估算，不代表订阅支出或服务商账单。
完整功能与截图见[项目 README](https://github.com/WilliamLambertCN/open-kimi-web#readme)。

## 用法

前提：官方后端已在 target 运行，手上有它的 bearer token；token 会在启动时打印，
也保存在 `<KIMI_CODE_HOME>/server.token`。未接管时先启动官方后端，再运行下列 `serve`。
如果 `kimi` 已由本项目接管，则改用 `kimi web --host`，不要同时运行独立的 `serve`。

```sh
open-kimi-web serve                     # http://127.0.0.1:4173
open-kimi-web serve --lan               # HTTPS，打印 Local + Network 链接
open-kimi-web serve --https             # 回环也强制 HTTPS
open-kimi-web serve --lan --insecure-http
open-kimi-web serve --cert-file ./server.crt --key-file ./server.key
open-kimi-web serve --token-file ./server.token
open-kimi-web serve --no-token-link
```

默认 target 为 `http://127.0.0.1:58627`，host 为 `127.0.0.1`，端口为 `4173`。
默认端口不可用时会尝试后续端口，最后由系统分配，实际地址以启动输出为准。
`--lan` 等价于 `--host 0.0.0.0`，不能与 `--host` 同用。`--target` 必须是不带凭据和路径的
纯 http(s) 地址。先启动 `kimi web`，或让 launcher 接管该命令。

`open-kimi-web serve` 使用上述 `4173` 独立端口。接管后的 `kimi web` 保留官方后端固定
回环端口 `58627`，Open Kimi Web 使用配套端口 `48627`。端口被占用时会明确失败；
可关闭占用程序，或用 `kimi web --port <port>` 更换 Open Kimi Web 端口。

默认服务**官方 `kimi-code` npm 包的 `dist-web` 前端**，标题变化见根 README。
官方 bundle 不可用时会明确中止启动；恢复 npm 网络及 `curl` / `tar` 后重试，
或用 `--web-dir` 指向已准备好的隔离前端目录。该目录内所有可访问文件都会被公开，
不要放日志、备份、配置或凭证；静态服务拒绝通过符号链接越界读取。
默认根据 target `/api/v1/meta` 选择官方 UI，metadata 不可用时 fallback 为 `2.3.1`。
`--web-version <ver>` 固定官方 UI 版本，不会固定或升级后端；`OPEN_KIMI_WEB_DIR` / `OPEN_KIMI_WEB_VERSION`
也适用于接管后的 `kimi web`。

默认官方模式会额外加载本项目的展示层，在手机宽度下修复首页、会话设置、模型菜单与
工作区列表的小屏布局，并将侧栏品牌文字显示为 `OPEN-KIMI-WEB`。模型供应商标签支持
触摸、鼠标拖动、滚轮和键盘横向浏览；可编辑供应商的模型支持逐项配置图片/视频、工具
调用、思考、始终思考和全部思考档位，新模型与缺失字段默认全选，已有显式配置保持不变。
供应商表单还可用当前 Base URL 和可选 API Key 拉取 `/models`，从下拉框选中并添加，也可
通过专用手柄用鼠标或触摸调整模型顺序；请求由当前页面 token 保护的 launcher 同源端点
转发，不记录或回显 API Key，不跟随重定向。桌面工作区首次使用默认按最近活动排序，
也可切回官方手动顺序；更多菜单支持置顶与取消置顶，置顶仅在本地保存工作区 ID。
手机会话抽屉支持原生“平铺／按工作区”，保留官方各端独立的视图偏好。
分组新增“最近会话／工作区名称／桌面保存顺序”，平铺和组内会话仍按官方更新时间排序。
能唯一确认工作区身份时沿用已有置顶；缺数据或路径缩写冲突时禁用桌面保存顺序，不猜 ID。
只改 CSS 视觉顺序，不搬 Vue 节点，因此键盘／读屏顺序仍为官方 DOM 顺序。
已归档会话可在二次确认后通过 Kimi Code 官方接口永久删除。
fork 会话在官方 Web 中完成回合后，自动标题生成不会抹掉仍存在的 `Fork: ` 标记；
手动重新生成标题仍走官方接口。直接使用官方 CLI 的请求不经过这一页面增强。
实际选用的官方 UI ≥ `2.3.0` 时由原生 Side Chat 处理滚动，不再注入旧 scrollTop guard；
旧 `2.1.1`／`2.2.0` UI 保留向上阅读不抢位、回到底部恢复跟随的补丁，判断不只依赖后端版本。
会话运行中有可发送草稿时，桌面和手机均提供“插队”按钮。按钮通过官方 `.send` 创建
当前 queued prompt，再按返回的 `prompt_id` 调用 `prompts:steer`。官方 `Ctrl+S` 的行为由上游自身处理。
首次访问默认使用夜幕主题；桌面可在左下角账号菜单的**氛围主题**中切换，手机可在
**设置 → 氛围主题**中选择极光、暮色、余烬、矿物青绿、夜幕五套主题，或恢复原始外观。
主题使用随包附带的独立星云背景、半透明面板和组件样式，只加载当前主题的背景。所有选择
（包括原始外观）保存在当前浏览器、当前站点的本地存储中，不修改官方浅色/深色设置。

样式与脚本随 launcher 发布，不写入官方缓存；更新 launcher 后仍需自行结束旧进程并重启，
再刷新或重新打开页面，本轮不会自动重启生产。`--web-dir` 不注入展示层及主题功能。
当前适配的官方 UI 为 `2.3.1`，新版真实 UI／native、标准门禁与线上结果见[当前计划][current-plan]。
r9 完整官方 app 源码实测使用虚构 API，其交付包浏览器与线上记录保留在[历史计划][lan-plan]，不充作新版验收。

## 接管（可选）

```sh
open-kimi-web integrate install     # 一次性：wrapper + PATH 条目
kimi web                            # 让官方 Web 经过本增强层
open-kimi-web integrate status      # wrapper / PATH / real-kimi 健康检查
open-kimi-web integrate repair      # 重新解析真 kimi、重建 wrapper
open-kimi-web integrate uninstall   # 撤销 wrapper 与 PATH 接管
```

`install` 把一个小 shim（`kimi` / `kimi.cmd`）放进
`${OPEN_KIMI_WEB_HOME:-~/.open-kimi-web}/bin` 并 prepend 到 PATH
（POSIX 写 shell rc 标记块；Windows 写 User PATH，System PATH 中更早的官方
`kimi` 可能遮蔽它，需按警告调整顺序）。同一目录还会放一个
`open-kimi-web` 命令本体，`status` / `repair` / `uninstall` 不再需要绝对路径。
之后 `kimi web` 会把官方 server 起在回环、前面架上本 launcher；其它所有
`kimi` 调用——包括 `web rotate-token` 和危险参数——都逐字透传给官方二进制
（其绝对路径已固化在 wrapper 里）。

接管可逆且不碰官方文件：`integrate uninstall` 只删带标记的 wrapper、精确的 PATH/rc
条目和状态文件；不卸载专用 npm prefix 或私有 runtime。Windows 一键安装器加入的私有 Node User PATH 项
在 r9 撤销接管后仍保留，无需时按安装输出的路径手动移除。
已知限制：用绝对路径调官方二进制会绕过 wrapper；已打开的 shell 可能要 `hash -r` 或开新终端刷新命令缓存。
r9 status 按首个已有 rc 诊断，多 rc 的 zsh 场景可能错误警告；安装器独立验证实际 shell 的 rc／wrapper，
应核对新 shell 的实际命令，不盲目 repair。bash 在 Release／npm 前检查 `.bash_profile`，仅缺失时选 `.bash_login`。
只允许空行／整行注释加无条件 `source`／`.` 加载 `~/.bashrc`、`"$HOME/.bashrc"` 或 `"${HOME}/.bashrc"`，保留原文件。
空文件、仅注释、条件或复杂未知脚本拒绝且不宣称接管成功；可选 `--no-integrate` 或手动安排简单加载后重试。
原生 WSL bash `--login -ic` 的已知简单加载补验通过，无新增下载。
官方 CLI 重装／升级后真身丢失时，先确认目标安装再运行 `integrate repair`；该操作与 Kimi 插件是否安装无关。

## 升级

**安全自更新（r8 起可用）：** 旧 r7 包没有该命令，须先按下方方式手动升级至 r8 或更高版本。

```sh
open-kimi-web update --check   # 只检查实际执行安装
open-kimi-web update           # 更新同一安装，不自动重启
open-kimi-web update --help
```

一键安装的专用 prefix 沿用标准 npm 全局布局，常规升级用上面的 `update`，不重跑安装器或追加切换参数。
wrapper 会调用记录的 Node，更新器优先使用该 Node 旁的 npm，不要求 shell 的裸 `node` 可用。
`--no-integrate` 不建立新 wrapper／PATH，更新时须用所选 Node 的绝对路径执行该专用 prefix 中的 launcher，
再加 `update --check`／`update`，不能让 PATH 中的旧安装或默认 `npm root -g` 代替目标入口。
安装输出的 `Update:` 已使用绝对 Node／launcher 路径；先加 `--check` 核对，PowerShell 中保留开头的 `&`。

源码只接受官方仓库的干净 main，跟踪 origin/main、无领先或分叉，使用快进和 frozen lockfile；
不替用户 stash、reset 或切分支。npm 安装从 GitHub 最新正式 Release 获取精确版本 tgz，
不使用 npm registry 的 @latest；支持可确认的全局／自定义 prefix，以及简单 npm 本地直接依赖。
本地更新保留生产／开发依赖类别并修改 owner 的 package.json 和 package-lock.json。
临时 npx、workspace、链接、混合包管理器和身份不明目录拒绝，不去更新另一份全局安装。
成功／检查退出 0，网络、安装、安全或验证失败退出 1，参数错误退出 2。
更新非原子，失败说明已完成阶段与恢复方式，不自动回滚；不改官方 Kimi、PATH、接管、证书或会话。
同路径更新无需 repair；完成后仍需自行停止旧 launcher，重启并刷新页面。
包管理器缓存可能正常变化，本地 npm 会解析所属项目依赖树，不保证无关依赖逐字节不变。
若后代进程退出无法确认，会保留安装锁；先核实原 updater 及其后代已停止，再按错误提示手工解除锁。

手动升级全局 tgz 安装时，再次安装上面的版本化 URL。
手动升级源码安装时，在仓库目录运行
`git pull --ff-only origin main` 和 `corepack pnpm install --frozen-lockfile`，确保使用 main 分支。
切换安装方式或目录时，`integrate install` 可能保留已有入口，需显式使用目标安装位置执行 `repair`：

```sh
# 切换到已安装的全局 tgz 包
node "$(npm root -g)/open-kimi-web/bin/open-kimi-web.mjs" integrate repair

# 或切换到当前源码仓库
node packages/launcher/bin/open-kimi-web.mjs integrate repair
```

随后在新终端执行 `open-kimi-web integrate status`，结合实际命令和目标确认异常后才用目标入口 repair；
多 rc 的 zsh 仅有上述 r9 status 警告时不盲目 repair。
最后停止旧的 `kimi web` / launcher 并重新启动，再刷新或重新打开页面；无需迁移会话数据。

## 安全

- 回环 target 下 launcher 尽力读取 `${KIMI_CODE_HOME:-~/.kimi-code}/server.token`
  并打印带 `#token=...` 的直达链接。fragment 不会发给服务器，在应用挂载前
  即被移除。链接本身就是完整凭据：别分享。
- 官方 UI 的 token 存储行为由上游负责；带 token 的直达链接仍等同完整编程代理权限。
- 回环默认 HTTP；`--lan` 与非回环 `--host` 自动 HTTPS；`--https` 在回环强制
  HTTPS；`--insecure-http` 是明文降级并打印警告。
- 托管自签名证书复用自 `${OPEN_KIMI_WEB_HOME:-~/.open-kimi-web}/tls/server.{key,crt}`。
  浏览器首次不信任：接受警告前请核对 launcher 打印的 SHA-256 指纹。证书无效、
  临近过期或缺少必需的 hostname/IP SAN 时自动轮换。
- `--cert-file` / `--key-file` 成对提供即使用自定义证书；无效或不匹配会中止
  启动，绝不回退 HTTP。
- 只代理 `/api/*`；hop-by-hop 头被过滤；`Authorization` 原样转发、绝不落日志。
- 已归档会话的永久删除入口沿用当前页面 Bearer 授权，调用官方
  `POST /api/v1/sessions/{id}:delete`；通用 `/api/v1/debug/*` 路由不会代理给浏览器。
- `index.html` 以 `no-cache` 提供；带内容 hash 的 `/assets/*` 为 `immutable`。

launcher 直调入口最低 Node ≥ 22；官方 npm 的共享 runtime 需 ≥ 22.19.0，可由一键入口准备私有运行时。
wrapper 不依赖 shell 中的裸 `node`；Linux 编译工具前提和未测平台边界仍适用，本轮交付验收见[当前计划][current-plan]。
运行时 npm 依赖：`ws` 与 `selfsigned`（均 MIT）；首次下载官方 UI 还需要 PATH 中可用的系统 `curl` 和 `tar`。
仅源码开发路线先在仓库根执行 `corepack pnpm install --frozen-lockfile`，
然后直接运行 `node packages/launcher/bin/open-kimi-web.mjs serve`，无需构建本地前端。

## License

MIT — 见包内 `LICENSE` 与 `THIRD_PARTY_NOTICES.md`。含 Moonshot AI 的 MIT
许可代码，原始声明完整保留。

[lan-plan]: https://github.com/WilliamLambertCN/open-kimi-web/blob/main/docs/plans/large-session-lan-performance-v1-plan.md
[r10-plan]: https://github.com/WilliamLambertCN/open-kimi-web/blob/main/docs/plans/one-click-install-r10-release-v1-plan.md
[mobile-plan]: https://github.com/WilliamLambertCN/open-kimi-web/blob/main/docs/plans/mobile-subagent-model-v1-plan.md
[cron-plan]: https://github.com/WilliamLambertCN/open-kimi-web/blob/main/docs/plans/scheduled-tasks-management-v1-plan.md
[r10-release]: https://github.com/WilliamLambertCN/open-kimi-web/releases/tag/v2.1.1-r10
[current-plan]:
  https://github.com/WilliamLambertCN/open-kimi-web/blob/main/docs/plans/kimi-code-2.3.1-workspace-release-v1-plan.md
[current-release]: https://github.com/WilliamLambertCN/open-kimi-web/releases/tag/v2.3.1-r1
[official-231-release]: https://github.com/MoonshotAI/kimi-code/releases/tag/%40moonshot-ai/kimi-code%402.3.1
