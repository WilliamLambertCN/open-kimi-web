# 大会话慢加载诊断日志 v1

## 目标与边界

针对“已能登录，但约 400 MB 会话在 5 Mbps 虚拟局域网要等几十秒”的反馈，
增加默认关闭、脱敏、低开销的分阶段日志，用真实 HTTP/WebSocket 链路验证后端等待和代理传输的区分。
本计划由用户的排查及日志请求驱动，自动退出计划模式不代表用户逐项审阅。

本轮不提交、推送或发布，不升级官方 Kimi，不修改网络，不擅自重启生产。
保留前轮首屏分页和折叠补丁，不重复旧 UI/安装矩阵，不复制或遍历其它真实会话。
日志不能测量浏览器 JSON 解析和 DOM 渲染；服务端结束响应不代表远端内容已显示。

## 已有调查

- 运行源码 launcher；实际官方静态资源及对应后端二进制报告 2.3.1，并非仓库兼容目标 2.4.1。
- 公开 foldingDefaults 资源匹配工作树；已有浏览器展开偏好不自动迁移。
- 虚拟局域网客户端确有已建立 TCP 连接，但现有日志非访问日志，不能还原各阶段耗时。
- 本机快速探针不代表隧道快；ICMP 超时不等于 HTTP 丢包率或根因。
- 尚未获得本次慢请求的分页命中、上游首字节和 WS 首帧证据，不能宣称具体故障已修复。

## 实施顺序

1. 在 `AGENTS.md` 链接本计划，明确本地实现与现场采集边界。
2. 新增独立 JSONL sink 与脱敏 schema，使用 Node 内置能力，不增加依赖：
   - 按用户追加要求，以 `--debug` 为推荐写法，保留 `--debug-log` 别名及 `OPEN_KIMI_WEB_DEBUG_LOG=1`。
     默认关闭，环境变量 `0` 不开启；短参数仍只启用 OKW 脱敏日志，不启用官方调试接口。
   - 输出到 OKW home 的 `logs`，每运行独立文件；每文件 5 MiB，最多两份轮转备份。
   - 上限仅针对单次运行，不声称整个目录总量有界；旧运行日志由用户删除。
   - 异步有界队列、丢弃计数、失败安全警告一次，不影响业务；关闭时有界 drain。
   - 固定事件、字段、路由和错误分类白名单；禁止正文、凭据、原始 URL、路径、ID、IP、原始错误落盘。
   - 每次运行随机盐匿名关联客户端和会话，参数仅有限数值和布尔。
3. 打通 `args.mjs`、`integration/wrapRoute.mjs`、`integration/supervisor.mjs`、`frontend.mjs`：
   - 普通 serve 与已接管 `kimi web --debug-log` 均使用日志，不透传此参数给官方。
   - `kimi web` 内显式 debug 的未知参数组合安全失败，不静默绕回官方；不启用官方 debug-endpoints。
   - 保留直接 CLI 使用习惯：非 web 调用先原样转交官方，不把同名参数或提示词误当成 OKW 选项。
   - 生命周期处理启动失败、端口重试和关闭；记录实际前端版本、增强和分页门控状态。
4. `serve.mjs`、`httpProxy.mjs`、`responseCompression.mjs` 接 HTTP 日志：
   - begin、upstream headers、首个 body chunk、低频 progress、end/abort/error。
   - 记录安全路由、分页是否改写、等待时间、状态码、耗时、原始/传输字节。
   - debug 时用计数 Transform 保持背压和取消；关闭不增加计数流，不监听 data 或缓冲正文。
   - 精确计数覆盖共用 sendResponse 路径；直接 end 的小响应不伪造字节统计。
5. `wsProxy.mjs` 接握手和双向统计：
   - begin、ready、首服务端帧、低频聚合、close/fail。
   - 消息数、字节、最大帧、bufferedAmount 峰值和安全 close code；不解析帧内容或记录 close reason。
   - 保持现有 64 MiB 双腿上限；成功、失败、中止、关闭都只结束一次。
   - TLS/client error 只记录白名单错误；不记录 SNI、证书、rawPacket 或 error.message。
6. 更新根与 launcher README、项目 Skill 和必要 CHANGELOG，保留新功能未发布说明。

## 验证

- sink UT：关闭默认、env=0、白名单、轮转、队列上限、失败、幂等关闭。
- 两入口 UT：日志 flag/env 正确传递，不透传官方、不因未知组合跳出增强。
- 聚焦 IT：真实 createLauncher、临时 home、HTTP/HTTPS 与 WS，延迟 headers/body、gzip、慢读/取消和握手失败。
- 注入虚构 token、session、query、body、路径、error.message、close reason 标记，整份日志检查不含原文。
- 默认关闭响应和协议不变；旧分页、鉴权、gzip 测试继续通过。
- 最终版本运行 `corepack pnpm lint`、`typecheck`、`test:ut`、`test:it`、`test:pack`，不降低覆盖率。
- diff、行长、隐私与临时资源收尾；不触碰原 `.tmp` 和生产资源。

## 现场采集边界

运行中进程不能热装埋点。本轮不重启生产，完成后给出原命令增加 `--debug-log` 的启用方式。
用户启用并复现后，再用匿名关联和分阶段数据判断这一轮几十秒的具体原因。
不得把隔离测试或诊断日志功能通过冒充生产故障已解决。

## 本地验收记录（2026-11-06）

实现与审查完成，未提交、推送或发布，未重启生产或再次读取真实会话。

- `--debug-log` 与 env=1 均经真实 wrapper → supervisor → frontend → sink 链验证；env=0 不建日志目录。
  独立 parseArgs → frontend 入口也验证，显式 debug 与不支持参数组合拒绝，不透传官方调试参数。
- 真实 HTTP／HTTPS／WS、延迟头和正文、gzip、已编码响应、背压与中止、错误和关闭：3 个新增 IT 文件共 30 项通过。
  日志整体检查虚构 token／session／IP／query／body／路径／close reason 无原文及编码变体。
- 审查发现 HTTP 结束后晚到回调仍发阶段事件、WS 协议错误被记成 closed，均已修复。
  HTTP 终态为最后事件；WS 普通 close 保留先前 error，显式 aborted／shutdown／rejected 保持原分类。
  23 项定向 UT 与真实非法 RSV1 帧回归通过，二次只读复核未发现新问题。
- 标准 `corepack pnpm lint`、`typecheck`、`test:ut`、`test:it`、`test:pack` 最终均 exit 0。
  UT：110 文件／2483 项通过；行 93.27%、分支 84.55%。
  IT：26 文件通过、2 文件跳过；613 项通过、6 项既有 Windows 平台条件跳过；行 84.50%、分支 71.80%。
  独立行／分支 70% 门槛未降低，未增加覆盖率排除或提高测试 timeout。
- 首次完整 IT 有一项既有 sh 安装入口测试触及 5 秒超时；保留首失败记录。
  同文件单 worker 43 项通过、该项 3819ms；未改实现或 timeout，再跑原标准 IT 全部通过。
  这只能说明本轮重跑通过，不能由此断定首轮超时原因。
- 新 pack 日志断言初版 complexity=11 被 lint 拒绝，简化完整行解析后 lint 通过，未禁用规则。
- `test:pack` 实际 tgz 包含 8 个新增分页／诊断模块，安装后 CLI 的静态／API 真实调用和日志落盘通过。
  版本保持 2.4.1-r1，仅本地临时包冒烟，不代表线上同版本资产已更新；临时包和安装由脚本清理。
- 验证输出归档到 ignored `.cache/large-session-debug-final-*.log`；
  首失败 IT、完整重跑 `it-recheck` 和定向 `large-session-debug-install-recheck.log` 分别保留。
- 自有诊断 IT／双入口／pack 临时目录及 fake backend／pack Node 进程残留 0；后台任务 0。
  原 `.tmp` 保留不动，44 个本轮及前轮改动文本无超长行，`git diff --check` 通过。

### 隐私检查

- 检查范围：本轮新增日志／入口／代理代码与文档，实际 tgz 的内容清单和本次新增源码；没有新截图或媒体。
- 发现：指定新增内容未发现隐私泄露。日志 schema 固定白名单，不输出正文或原始凭据／标识／错误；
  默认官方构建静态根与 OKW home/logs 分离。源码中未发现 sourcemap 引用；包检查拒绝 maps、logs、JSONL、缓存和凭据文件。
- 修复：打包冒烟补充新增模块必需清单与 logs／JSONL 排除断言，实测安装包开启日志后的虚构上下文不泄漏。
- 未验证项：未检查线上服务、Git 全历史或用户真实日志；本轮没有提交／发布范围。
  自定义 web-dir 内的普通日志文件并非通用访问控制保护，用户仍须只放前端产物。
  日志仍含访问时间和流量，不能无条件公开；文件 POSIX mode 调用已测，但 Windows 不据此宣称 POSIX 权限生效。

### 事件：大会话仍需几十秒，旧日志无法区分等待与传输

- 影响：低带宽用户已能登录，但无法确定慢在后端恢复、响应体积、网络还是浏览器渲染。
- 触发条件：大型会话经虚拟局域网访问；当前进程未启用本次新日志。
- 根因：本次现场性能根因仍未确认；已有普通启动日志缺少请求阶段和 WS 首帧证据。
- 证据：隔离真实链路能分别记录人为延迟的上游头、首正文和 WS 帧；不是现场性能证据。
- 修复：增加默认关闭的分阶段诊断，不改会话数据或以截断正文制造提速。
- 回归验证：上述双入口、真实传输链、完整标准测试和实际包冒烟；旧测试不含新增日志终态竞态，现已补回归。
- 运维动作：用户自行在原启动命令加 `--debug-log` 并重启 launcher；保留原 home、target 和其它选项。
- 剩余边界：仍需用户启用后复现；服务端 finished 不证明浏览器已显示，日志不测 JSON／DOM 时间。

## 短参数追加

用户要求命令简短，推荐用法改为 `kimi web --host --debug`／`open-kimi-web serve --lan --debug`。
`--debug-log` 作为等价别名保留，环境变量与日志格式不变；在 `kimi web` 内两者均不传给官方，也不启用 `--debug-endpoints`。
`kimi web` 的显式短参数遇未知组合、RC、官方调试接口或赋值时，与长参数一样安全拒绝，不回显未知参数内容。

- 本次别名变更定向 4 文件／180 UT、双入口真实落盘 18 IT 通过；lint／typecheck／diff 检查通过。
- 实际包改用 `--debug` 启动，静态／API 请求、脱敏日志落盘通过，旧别名由双入口 IT 验证。
- 上方 2483 UT／613 IT 为追加短参数前的完整阶段记录，本次未重复无变化的全量传输／UI／安装矩阵。
- 没有提交、推送、发布或重启生产；官方参数说明另据当前官方命令文档核对。

## 直接 CLI 调用兼容补充（2026-11-07）

用户要求安装后继续直接使用 `kimi`，不能只满足网页启动，也不能改变原有 CLI 使用习惯。
默认安装已有新终端 PATH 配置；常见目录发现不要求用户手动指定真实命令，原官方文件和数据目录不改。
`--no-integrate` 仍只安装，不修改命令入口；撤销接管仅移除本工具入口，不替原来未加入 PATH 的官方命令新增入口。

### 事件：网页选项校验误拦普通 CLI 参数

- 影响：普通 CLI 调用或提示词包含 `--debug`、`--debug-log`、`--scheduled-tasks` 时，可能被 wrapper 提前拒绝。
- 触发条件：通过已接管的 `kimi` 调用非 web 命令，参数与 OKW 选项同名；不是官方不支持参数的证据。
- 根因：网页专用校验早于非 web 分流；旧测试把非 web 拒绝写成了预期，未覆盖保留原 CLI 语义的要求。
- 修复：先判断首参数是否为 web，非 web 全部原样转交；网页 debug 与定时任务的安全拒绝条件保持。
- 回归验证：102 项定向 UT、45 项 IT、标准 lint 和 typecheck 通过。新增 7 项 IT 运行实际生成的命令入口，
  通过虚构 CLI 验证 argv、cwd、KIMI_CODE_HOME、环境标记与退出码，官方 fixture 原文件不变。
  本机真实官方 CLI 的版本、帮助及 `--debug --help` 直接／wrapper 对照三项一致；数据目录隔离，不发模型调用。
- 运维动作：修复仅在本地代码中，未提交、推送或发布；没有修改用户 PATH、安装、会话，也没有重启生产。
- 剩余边界：本轮实际运行在 Windows，未新增跨平台安装、交互终端与付费对话验收；未重复完整测试或打包矩阵。
