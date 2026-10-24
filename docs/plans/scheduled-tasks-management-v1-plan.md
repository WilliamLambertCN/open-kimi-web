# 定时任务与导航：收回后端扩展，保留轻量增强

原始计时起点：2026-10-19T10:17:06+08:00（首次可观测时间；未记录的时间不编造）。
用户最新明确决定收回修改版后端方案，本计划完整替代此前新 home 与原 home 后端替代实施方案。
不含提交、推送、发布、上游 PR 或生产启停授权；历史实验通过不代表现需求完成。

## 最终边界

- 不维护修改版 Kimi 后端，不增加引擎、调度器、任务库或模型配置真相源。
- 不改任务日志，不向浏览器／局域网开放通用 debug，不让 AI 代执行假装管理成功。
- 保留独立完成的手机搜索、桌面／手机导航统一、Hyper-V 地址枚举修复。
- 用户最新要求优先核实“官方原版＋服务端固定白名单调试 RPC”轻量路线，不预设存在多个 CLI。
  先在隔离官方原版实例实测 list／addTask／removeTasks、原会话恢复、副作用与安全隔离；不自动给生产开启 debug。
  这是可行性验证，不恢复已撤回的后端分支，也不将源码可调用直接等同产品可用。
- 完整任务管理仍暂缺：编辑、暂停恢复和任务独立模型等原生未具备的语义不能在适配层伪造，
  后续优先由官方最小正式 API 支持。只读任务／历史仍须真实证据，未验证前不挂“管理”占位入口。

## 保留的产品行为

双端左上顺序统一为：新建会话 → 新建工作空间 → 搜索 → 使用统计。
手机保留原生新建会话／工作区操作，补充搜索；桌面创建工作区使用正式已有目录接口，不切当前会话或清草稿。

搜索共用官方 `POST /api/v1/search` 和索引，20 条分页、关键词／字面量、角色与相关度／时间排序。
结果打开所属会话，不宣称精准定位 turn。授权仅在内存复用，搜索与路径不落浏览器持久存储或日志。
导航弹层隔离官方 QuestionCard 全局按键，关闭还原 inert 与焦点；保留原生节点，不用 Vue 私有状态。

Hyper-V／vEthernet 地址进入访问链接与 TLS SAN，仍过滤 internal、回环、IPv6 link-local 和其它既有虚拟接口。
只改变软件地址枚举，不改 Windows 网卡、桥接、RSC、IP 或路由。

## 实施顺序

1. 撤掉本轮未发布的 `scripts/build-cron-backend.mjs`、`scripts/cron-backend/`、
   `upstream/cron-management/`、`packages/launcher/src/schedules/` 及专属测试。
   不 reset 整个工作树，不碰来源不明 `.tmp/` 或用户资源；实验缓存保留在约定私有 cache，不作为交付。
2. 恢复 `integration/supervisor.mjs` 直接启动记录的官方命令；移除 serve.mjs 的 schedules 代理。
   删除 THIRD_PARTY_NOTICES 中已撤回后端 patch 声明，不修改官方安装或生产服务。
3. 移除 `mobile/schedules*.js/css`、专属测试／testkit、注入清单与 pack/asset IT 对应项。
   navigation.js/css 只注册使用统计，不再提供定时任务按钮；保留导航、搜索和工作区保护。
   定向断言保证无残留假管理入口、后端选择环境变量或扩展请求。
4. README、launcher README、UPSTREAM、AGENTS 同步暂缺的完整管理能力，不保留新 home／扩展启动指引。
   只读可行性依准确官方 2.1.1 源码核实任务和历史数据来源及缺口，不立即新增页面或另一套数据库。
   官方贡献作为后续独立工作：最小任务列表／详情／编辑／启停／删除与可信历史契约须由原生服务实现，
   本轮不把旧大补丁当作已贡献，也不未经授权提交 PR。
5. 先定向验证导航、网络、supervisor、asset；随后标准 lint／typecheck／UT／IT／pack，不降低覆盖率。
   复用无变化搜索与主题验收，必要一次桌面／390px 官方 app 实图检查撤回后导航与搜索，不重复全主题矩阵。
   检查残留引用、git diff --check、工作树与自建进程树，最后如实报告保留／撤回／未完成项。

## 验收标准

- launcher 只能走原官方后端，不再包含本轮后端补丁、构建链路或 schedules CRUD 专用代理／UI。
- 双端导航顺序一致、手机能搜索，正式 API、焦点草稿与原生按键边界保持。
- Hyper-V 地址修复及证书 SAN 定向测试通过；不改变系统网络配置。
- 项目标准命令在最终交付工作树通过，实图已查看；未发布、未切生产必须明确说明。
- 只读可行性只报告已确认来源与缺口，不写成已完成查看，更不能冒充完整管理。

## 历史阶段证据（已撤回方案，不作为当前交付）

此前实验采用固定官方 2.1.1 `f67e6398fb3210ad8ace970e2dfd5bcc984ed61f` 的本地窄扩展，
曾通过 121 项定向 native 测试和新 home 的 37 项真实 supervisor／官方浏览器断言。
本项目当时 lint／typecheck、1541 UT＋1 跳过、329 IT＋2 跳过及 pack 通过；不代表原有任务接入已完成。
旧原生实验报告位于 `.cache/scheduled-tasks/`，旧浏览器报告位于 `.cache/scheduled-tasks-ui/`，
包括 `native-1792387379111/report.json`；失败报告和遗留锁不删除，不公开含隔离本机路径的截图。

上述验证无法弥补“用户要管理原任务却要求全新目录”的需求偏差；用户随后也明确拒绝维护修改版后端。
因此原扩展及专属管理链路撤回，不继续在此路线叠加接管、锁或兼容框架。
保留的导航／搜索先前已做官方完整 app 与定向回归，撤回后仍需必要的最终工作树检查。

## 撤回后的当前验证

- `corepack pnpm lint`、`typecheck`、`test:ut`、`test:it`、`test:pack` 全部 exit 0。
  UT 84 文件／1462 项通过，行覆盖率 88.78%、分支 80.22%；
  IT 19 文件通过／1 文件跳过，308 项通过／2 项 Windows 上的 POSIX 测试跳过，行覆盖率 84.60%、分支 70.56%。
  覆盖率门槛未降低；日志位于 `.cache/scheduled-tasks-parent/withdrawal-*.log`。
- pack 从当前工作树打包、安装后验证 version、静态服务和 API 代理，并排除已撤回的后端与 schedules 资源。
  这不是新版本发布，也不是原版任务 RPC 的验收；实际任务调用和撤回后导航实图单独记录。
- `supervisor.mjs`、`serve.mjs`、`THIRD_PARTY_NOTICES.md` 与 HEAD 一致；`git diff --check` 通过。
  Hyper-V／访问链接／TLS SAN 定向 UT 42 项、HTTPS IT 5 项通过；未改系统网络或生产服务。
- 撤回后完整官方 2.1.1 app＋虚构鉴权 REST/WS 的一次双端回归 30／30 通过，无页面异常。
  桌面 1280px Original 英文与手机 390px Nocturne 中文实图均已查看，四项导航顺序正确、搜索可用，无任务管理假入口。
  验证了正式搜索分页参数、结果跳原生会话、草稿／节点／焦点／inert 保留和 QuestionCard 按键隔离。
  报告与两图归档于 `.cache/navigation-qa/withdrawal-2026-10-19T07-48-57-356Z/`；自建浏览器树和监听已清理。
  这是前端验收，不是原生任务后端或实体手机／软键盘验收。

## 原版 RPC 安全调查（尚未交付适配）

- 固定官方源码显示：debug 默认关闭；启用时可反射访问内部服务，HTTP 200 也须检查业务错误 code。
  原版实测已完成：session scope 只找 live session，不会仅因 list 自动恢复冷会话；恢复确实重新启用原生 timer。
- 官方 Remote Control 默认关闭，但同实例 debug 与 Remote Control 不互斥。
  Remote Control 使用 native loopback origin 和本地有效认证直接转发 HTTP／WS，不经过 OKW，且客户端未排除 debug 路径。
  因而不能仅凭 OKW 拦截 `/api/v1/debug` 就保证官方隧道隔离；这不是已证实的未授权公网漏洞。
  公网 relay 的服务端鉴权和路径规则不在此次本地源码审查范围，未联网验证远端可达性。
- 官方没有已找到的禁用 Remote Control 专用参数；若走受控实例方案，须明确与同实例官方 Remote Control 不兼容，
  禁止其启动参数和浏览器启用入口，并保证 debug 不直达浏览器。外围限制仍不能约束本机认证调用者主动另行启用。
  不能用非回环绑定、关闭认证或另一份后端来绕过这一边界。
- 关键源码证据：`packages/kap-server/src/start.ts` 的 native origin／RC 启用条件、
  `packages/remote-control/src/remote-control.ts` 的 HTTP／WS 转发，及 `apps/kimi-code/src/cli/sub/web/run.ts`。
  当前未自动开启生产 debug，也未提供管理入口；Remote Control 旁路结论仍是源码证据，不是公网实测。

## 原版真实调用结果

报告和机器可读结果归档在 `.cache/cron-rpc-probe/`，未改产品源码、官方源码或生产安装。
候选已安装可执行文件隔离 `--version` 为 2.2.0，未将其用于 2.1.1 验收；
实际使用官方固定 2.1.1 Windows 原生 binary，校验官方 manifest，`--version` 与运行时 meta 均为 2.1.1。

- 无鉴权／错误 bearer 均为 401；原生 `agentCronService` 的 list／addTask／removeTasks 真实成功，管理期间模型请求为 0。
  addTask 参数为 `[init]`，removeTasks 为 `[[id]]`；错写 `[id]` 得 HTTP 200、业务 code 50001。
  GET 加 arg 也能执行变更，因此不能把通用 dispatcher 的 GET 当只读。
- 正常关闭会话、正常关服后以同 home 重启，冷会话 list 返回 HTTP 200、code 40401，不会隐式恢复。
  普通 session GET 不恢复；正式 snapshot 恢复后旧任务 ID、prompt、cron、createdAt、recurring 保持。
- 官方测试 clock 推进后，cold 时无模型请求；正式恢复重新启动 timer，向回环 fixture 模型发送真实 cron-fire。
  返回固定文本后原生 turn 完成、one-shot 自动删除。不能为了汇总查看而静默恢复所有历史会话。
  首轮因没有选 session 模型而失败的记录保留；随后正式 profile 选模型并完成真实链路，不算付费供应商验收。
- 内部 service 绕过工具层校验：实测接受非法 cron、空 prompt、非布尔 recurring、额外字段、8193-byte prompt 和第 51 项。
  轻量适配必须自己严校参数、字段、字节数、数量及未来触发时间，并检查业务 code；不能简单透传内部方法。
- 现有 OKW debug 阻断存在编码路径绕过：canonical path 为 404，但 `%64ebug`／`deb%75g` 为 200、code 0。
  officialPresentation=true 下编码 add／list／remove 也实际成功。无 bearer 仍 401，这是调试隔离绕过而非认证绕过。
  已测双斜线、dot、双重编码未穿透，debug WS 未穿透，正常 WS 101；未做穷举 fuzz 或多层代理验证。
  必须先修代理路径边界，不能直接启用生产 debug。
- 全部自建 backend 正常 shutdown、exit 0，实验端口均关闭，最终 fixture 进程为 0、监听为空；未碰生产端口。
  原版轻量路线已证明基本读／增／删和旧任务恢复可行，不代表 adapter 或页面完成。
  其它平台、2.2.0、并发 CLI 写入、崩溃恢复和完整 stale／coalescing／jitter 矩阵未验证。

最小后续顺序：修复编码 debug 隔离 → 明确同实例 Remote Control 互斥边界 → 严格白名单及参数校验 →
活动会话原任务查看／新增／删除。冷会话恢复必须明确告知会唤醒任务；不伪造编辑、暂停或独立任务模型。
用户最初要求的全局历史和完整管理仍未完成，不能将这一最小范围冒充原需求全部交付。

## 用户同意补齐校验后的安全前置实施

用户明确同意增加参数校验，并要求解释实际恢复动作；本阶段补安全前置，不等于任务页面交付。
不更改官方后端、不新增引擎、不自动开启生产 debug，不增加管理 HTTP 路由或 UI。
同实例 Remote Control 及 2.2.0 兼容仍需处理，不能因完成校验就自动启用。

1. 新增 `packages/launcher/src/apiPathPolicy.mjs`，在 `serve.mjs` 所有扩展／代理之前检查路径。
   阻断普通和百分号编码 debug 根及子路径，处理编码歧义／分隔符／dot／嵌套编码边界。
   只用于访问控制，不改正常原始 URL／query；不误伤合法文件路径里的百分号、Unicode 或 debug 文件名。
   WS 保持只允许精确 `/api/v1/ws`。用现有 `tests/it/launcher.it.test.mjs` 原始 HTTP helper 断言不会到达上游。
2. 新增小型 `packages/launcher/src/cron/` 校验与固定白名单客户端，实现可调用的 list／create／remove 核心。
   只允许已验证版本、回环目标、main agent 固定服务，不接受 service／method／URL，不存储任务数据或凭据。
   限制输入／响应大小、超时、重定向；检查 HTTP 和业务 code，错误不回显内容／token／内部堆栈。
   创建仅允许 cron／prompt／recurring；严校五字段数字语法、范围／列表／步长／星期 0或7／DOM-DOW OR 语义，
   非空白内容、合法 Unicode、UTF-8 8 KiB、5 年内触发、一次性首次不超过 350 天，默认 recurring=true。
   现有 launcher 无 cron 库，不静默加依赖；实现有限表达式校验而非另一调度器。
   创建前读取原生 disabled／now／list，每会话适配写入串行化并拒绝第 51 项；不承诺与独立原生写入的全局原子性。
   冷会话返回未加载，不调用 snapshot／resume；写入不自动重试。
3. 增加 UT 与真实 TCP IT，覆盖错误字段／类型／UTF-8／表达式／数量／并发／上游失败／冷会话，及正常 API／WS 不退步。
4. 使用已归档官方 2.1.1 binary 在新的隔离 fixture 验证修后路径阻断与受限读／增／删、冷会话无自动恢复。
   不重新下载、不重复导航截图矩阵、不付费调用；自建服务 finally shutdown 并核对监听。
5. 跨层改动完成后跑标准 lint／typecheck／UT／IT／pack，不降低门槛，检查 diff 和自建资源，更新现有文档状态。
   不提交、推送、发布；原始全局任务管理、历史、模型等需求保持未完成，不伪造暂停／编辑语义。

## 官方 2.1.1 网页恢复动作核实

- 已追通该版本发布的 `apps/kimi-code/dist-web/assets/index-CiJ6FDOC.js`，不是用 `/snapshot` 实验推断网页行为。
  默认 Web 没有调用 `/snapshot`；点击列表行选择会话后，附带请求 `/status`、`/goal`、`/warnings` 等会触发恢复。
  `packages/kap-server/src/routes/sessions.ts:769` → `sessionLegacyService.ts:49-68` 为 status 恢复链，
  warnings 在 `routes/sessions.ts:826` 直接恢复。无需先发送消息。
- 初始分组列表 `/api/v2/sessions?view=by_workspace` 只读索引；列表看到很多历史会话不等于全部已恢复。
  但网页初始化可能自动选择 URL 指定的会话或列表首项，因此无手动点击也可能恢复那一项。
- 浏览器已缓存历史仍会加载选中会话的状态；后端已 live 则复用已有 handle，不另建实例。
  WebSocket 退订或关浏览器不等于关闭后端会话，不能承诺关闭页面就停止任务。
- transcript 的冷读与 WebSocket subscribe 本身不恢复；此前 snapshot 的恢复实验是有效接口证据，
  但不是默认网页点击路径。cron 恢复是重启原生轮询，实际执行还要满足到期、未禁用和 agent 空闲等条件。
- 以上是固定 2.1.1 发布 bundle 与源码核对；候选本机 2.2.0、实体浏览器的本轮真实请求仍未做同项验收。

## 安全前置代码阶段与审查修正

- `apiPathPolicy.mjs` 已前置普通／编码 debug namespace 检查，仅作访问控制，不改变正常代理 URL。
  定向 65 UT、122 TCP HTTP／WS IT 与 ESLint 通过；两种 presentation 模式均断言请求没有到达上游。
  原版 2.1.1 修后复验通过：直连三种路径均可调用，经 OKW 两种 presentation／有无鉴权组合共 12 次均为 404；
  正常 health／meta／WS 不退步。证据 `.cache/cron-rpc-probe/path-qa/run-1792399228523/report.json`。
- `src/cron/client.mjs` 提供 `createCronClient({target, fetchImpl?})`，方法为
  `list({sessionId, authorization})`、`create({sessionId, authorization, init})`、`remove({sessionId, authorization, id})`。
  每操作验证实际 meta 为 2.1.1／v2／鉴权开启；只允许字面回环 origin、固定 main agentCronService。
  meta 是目标服务的兼容声明，不是二进制来源证明；可信服务端负责选择目标。
  无永久 token／任务缓存；参数、时间、50 项、响应大小、超时、重定向、业务 code 均校验，写入不重试。
  冷会话返回 not-loaded，不请求 snapshot／resume；同 origin/session 写入跨 client 实例串行，非跨 CLI 原子保证。
- 定向 118 UT、7 TCP IT 与 ESLint 通过；原版 2.1.1 的 26 次 client 操作／46 次 fetch 通过，模型请求为 0。
  验证真实读增删、UTF-8 等非法输入不新增、第 50 项成功／第 51 项拒绝、重启冷读不恢复和显式恢复旧 ID。
  证据 `.cache/cron-rpc-probe/adapter-qa/report.md` 与 `results.json`；两项实验自建进程树／监听均清理。
- 审查前标准 lint／typecheck／UT／IT／pack 已通过：UT 87 文件／1645 项，Lines 89.39%／Branch 81.13%；
  IT 20 文件通过／1 文件跳过，410 项通过／2 项 Windows POSIX 跳过，Lines 85.03%／Branch 70.88%。
  首轮安装 IT 超默认 5 秒；原样单测通过，随后只将该已有多进程用例预算设为 15 秒，完整 IT 重跑通过。
  不改断言或覆盖率门槛。日志 `.cache/scheduled-tasks-parent/restricted-*.log`，IT 最终为 `restricted-it-final.log`。
  pack 的版本／静态资源／真实代理冒烟通过；以上是审查修正前的基线，不冒充修正后的验收。
- 独立审查的两项 P2 已修：DST 回拨改为官方同语义的本地日历推进并保留 iteration cap；
  create 专用返回校验要求合法时间与规范化 cron／prompt／recurring 精确相等，list 继续兼容原生旧字段。
  新增回归先复现失败再修正通过；连同精确双版本 gate，定向 129 UT／9 TCP IT／ESLint 通过。
  DST 为独立 Node TZ fixture，并非原生 binary TZ 实验；要求同机同有效时区。
  POST 超时或响应不一致代表结果未知，不自动重试／回滚，后续界面须先回读确认。
- 以上核心未挂载 HTTP/UI，不解决官方 RC 直连旁路，不代表完整任务管理交付。

## 原版 2.2.0 核对与最小兼容接入

- 官方精确 tag SHA 为 `472192c34c1efad89a369870eff0da0b708ce9bb`；13 个相关文件已核对，9 个与 2.1.1 相同。
  CronTask、创建工具／输入限制、表达式、debug dispatcher、meta／sessions REST 契约保持；不使用 semver 范围推断。
- 2.2.0 的 fork 清空新分支继承的 Cron，源会话保留；RC 增设备管理及 conflict 状态，但仍没有通用 debug 隔离。
  仍无正式编辑／暂停／独立任务模型／执行结果历史 API，不能以 lastFiredAt 冒充执行成功。
- 隔离候选 binary 的 `--version` 和真实 meta 均为 2.2.0；raw 原生 now／isDisabled／list／addTask／removeTasks 通过。
  close／重启后 list 为 40401，普通列表与 get 不恢复；显式正式 status 恢复后同任务 ID 和完整内容读回。
  当前 client 按原 gate 只读 meta 后拒绝 2.2.0；未伪造 meta 通过。0 模型请求，自建 PID／监听均已清理。
  证据 `.cache/cron-rpc-probe/compat-220/report.md`、`results.json`；一次必要编码路径检查也被 launcher 拒绝。
- 受限核心已改为精确 `2.1.1`／`2.2.0`，其它版本继续拒绝；双版本 TCP CRUD 和未知版本失败回归通过。
  修后真实 2.2.0 client 11 次操作／28 次 fetch 通过：规范化 cron／中文／一次性与默认重复回包一致、精确创建时间、
  close／重启后仅 meta→list 返回 not-loaded，显式 status 后同 ID 读回并删除；模型请求与自建进程／监听残留均为 0。
  证据 `.cache/cron-rpc-probe/client-220/report.md`、`results.json`；没有重跑 timer／51 项矩阵。
- 本节只推进已核验的受限接口，不等于整体 UI 已兼容 2.2.0；跨版本数据迁移、fork 全链和其它平台仍未实测。

## 继续接通受控入口与任务页面的实施增量

本节延续用户原有特性要求与继续指令，不是用户另行确认缩减功能。覆盖前文“当前不接 HTTP/UI”的阶段边界，
不恢复已撤回的修改版后端，不授权提交／推送／发布／生产重启。全局原任务、可信历史与模型展示仍需完成或明确缺口。

1. 收尾两项审查修正与精确双版本 gate。修后定向 129 UT／9 TCP IT 通过；真实 2.2.0 client 读增删与冷读另验，
   不以此前 raw RPC 代替，不重做 timer／51 项矩阵。
2. `integration/wrapRoute.mjs`／`wrapMain.mjs`／`supervisor.mjs` 增加显式 `kimi web --scheduled-tasks`。
   默认不启 debug；选项仅在固定官方 argv 追加 `--debug-endpoints`，沿用原 home，不建新数据目录或引擎。
   与 RC／危险 auth／未知参数／custom web 冲突时明确报错，不 delegate；拒绝削弱 host／CORS 与 runtime 注入环境。
   验证受控实例／token 后、公开 frontend 前核版本、auth、RC off；失败正常清理自己启动的后端及子进程。
3. `frontend.mjs`／`serve.mjs` 显式传受控能力，默认缺省关闭；外部 `serve --target` 不开放新增任务管理接口。
   opt-in 时沿用 `apiPathPolicy.mjs` 编码归一化封闭整个 `/api/v1/remote-control` 路径族；普通模式 RC 不变。
   新 `cron/routes.mjs` 只公开固定 list／create／remove，沿用同源 bearer，每次向原版认证，不接受 URL／service／method。
   限制请求体、并发／队列，未知字段拒绝；每次要求原生 RC `state=off` 且 `enabled=false`，异常不执行。
   写超时／回包不一致表示结果未知，先回读确认，不重试或回滚；删除二次确认精确 ID。
4. 原会话列表／详情／历史采用实际只读来源，核实结论先补入本计划再实现；不静默 status／snapshot 恢复全部会话。
   冷会话显示未加载；只有显式“恢复并管理”确认会启动其任务后才调用正式恢复链。
   触发记录只认原生已保存证据，不以 lastFiredAt 推断运行结果；模型标为跟随所属会话，不伪造每任务独立配置。
   不将原需求悄悄改为仅管理新建任务或当前会话；缺失数据须清楚显示不可用。
5. 双端 `navigation.js/css` 顺序为新建会话→新建工作空间→定时任务→搜索→使用统计。
   独立 `mobile/cron*.js/css` 复用官方字体／主题 tokens、对话框和焦点习惯；桌面列表＋详情，手机单列。
   包含加载／空／错误／未启用／冷会话／写结果未知状态，中英齐全，内容以 textContent 渲染，不持久化任务或 token。
   `officialPresentation.mjs` 登记资源并更新 asset／pack 检查，不用 Vue 私有状态，不复制会话状态管理。
6. 定向 UT／TCP IT 覆盖默认／opt-in／冲突、编码 RC 拒绝、鉴权／限额、冷读、CRUD、失败／重复点击／取消／恢复提示。
   新隔离 HOME＋原版 binary 验公开 HTTP 链路，不碰生产／付费模型；结束清理自有进程树和监听。
   完整官方 app 进行桌面／手机、短长内容、Original／受影响主题实图与布局断言；不重复无变化旧矩阵。
7. 最终工作树 lint／typecheck／test:ut／test:it／test:pack 通过，不降覆盖率；文档如实列出已完成和剩余项。
   部分核心或页面不冒充原任务管理全部完成；不发布、不自动更新生产。

安全信任边界：只承诺普通直接 API 不暴露通用 debug 和 RC 启动，不声称构建新的权限沙箱。
授权浏览器已有原生 terminal／hook 等主机执行能力，此类授权者与本机程序处于可信边界；外围检查不能阻止其主动绕过。
RC 状态检查是失效保护，不是跨进程原子锁；外部 target 的 loopback 地址或 off 状态不证明其受控归属。

## 全局冷读目录、历史与模型的来源

- 正式 `/api/v2/sessions?meta.archived=all&page_size=20` 可分页列全部原生会话，但没有 loaded 字段。
  不用 idle/model=null 猜冷会话；主进程已加载目录由固定 `sessionManager/list` RPC 核实。
  两版真实响应和冷态保持已核验；非空下一页 token 与真实归档组合尚未验收。
  不批量调用各会话 main Cron RPC，因为 dispatcher 的 ensureMainAgent 可能初始化 main。
- 对 supervisor 确认的原 native home，只读 `sessions/<workspaceId>/<sessionId>/agents/main/wire.jsonl`。
  ID 来自正式目录、不得接受浏览器路径；每级 lstat／realpath／文件范围检查，符号链接拒绝。
  复用 usage scanner 的流式／体积／坏行质量处理思路，不修改其统计语义，不增加磁盘缓存、任务库或引擎。
  首次精确扫描必须读取候选 wire 的完整字节；不能称为无需全扫。采用分页会话、按需详情和有界内存以限制成本，
  达字节／行／时间／结果上限或遇坏行明确 incomplete，不能冒充空列表或完整任务数。
- 任务状态按整个 journal 的 `cron.add`／`cron.delete`／`cron.cursor` 顺序投影，不按对话 activeChain 回滚。
  这些事件无 agentId，main 归属来自文件。2.1.1 fork 继承任务，2.2.0 遇 forked 清空，按目标恢复版本处理。
  任务键包括 workspace/session/main/jobId；删除原因不可推断。cold 只能展示保存状态，不冒充当前进程运行状态。
- 历史只认 `turn.prompt`／`turn.steer` 的 `origin.kind=cron_job` 及精确 jobId；显式 `turn.ended` 才显示结束原因。
  completed 标为原生回合完成，不代表外部业务成功；steer 标共享回合；缺结束证据就是未知，不写仍运行或成功。
  fork 前复制历史标继承，不重复算新会话执行；已删除任务的历史保留。
- `cron.fired` 不在 main wire，但被原生 server 观察时可写入 `server/events/<sessionId>.jsonl`。
  可按需只读既存文件补充“观察到调度提交”，不新建 broadcaster，不按时间猜关联回合；缺失 journal 不代表没有触发。
  调度游标、删除、通知都不作为成功证据；不使用冷 transcript 默认 completed 推断。
- 模型展示区分 v2 activity.model 的当前 live 别名、wire profile.bind/config.update 的最后保存别名、
  历史 llm.request 按精确 turnStep 关联的实际 model/modelAlias/provider；不读取或回传 key、systemPrompt、完整对话。
  不把宿主模型设置伪装成任务独立选择，未知就明确标未知。
- 全局页逐批显示全部原会话及其任务，历史按选中会话读取；未加载会话的保存状态与原进程 live 值区别呈现。
  首轮实现需验证上述 wire shape/live RPC 和 2.1.1／2.2.0 fork 差异，源码推导不能冒充实测。

## 只读来源与 HTTP 接线阶段核验

- 两版原生目录契约已各用新隔离实例核实，共 48 次请求，模型请求 0、自有进程／监听残留 0。
  证据 `.cache/cron-rpc-probe/inventory-contract/report.md`、`results.json` 和 `events-schema.json`。
  v2 返回 `items/total/has_more/next_page_token`；live RPC 返回 `[]` 或 `{id,kind:"session",accessor:{}}` 数组。
  目录、live RPC 和普通详情均未恢复冷会话；API ID 自带 `session_`，磁盘 basename 原样对应，不增减前缀。
- fresh create 尚未 materialize main 时，state.json 存在而 main wire 可以不存在；缺日志必须标为无法确认，
  不能直接当损坏、完整空任务或为了补文件静默恢复。历史 fixture 的 cron.add/delete 无 agentId。
  wire turnId 为数字、loop-event turnId 为字符串；精确 step UUID 关联，不以时间猜对应。
  server journal 的 cron.fired 无 turnId，只展示提交证据，不与邻近回合强行合并。
  旧 2.1.1 timer 历史仅复用既有证据，未重发模型；2.2.0 fire、真实多页与归档组合仍未验收。
- HTTP 已补 `GET /__open-kimi-mobile/cron/sessions?cursor=<opaque>` 和所选会话 `/history`，
  前置同源、认证、RC guard 后才读受控 home；未启用／缺 home 不返回伪造空列表。
  精确 namespace 判断避免吞掉 cronApi.js／cronView.js／cron.js／cron.css 静态资源。
  定向 50 UT／20 TCP IT 与 ESLint 通过；这是路由阶段，不代表受控启动／真实原版 HTTP／UI 已验收。
- journal／projection／inventory 已实现：每页共用 128 MiB／100 万行／5 秒扫描预算，单行 1 MiB，
  任务保留最多 1024 项／页合计 16 MiB，历史最近 100 项；限额和缺证据均返回 quality，不持久缓存。
  history 使用正式 GET profile 获取归属，避免普通 GET 的 event cursor 副作用；不调用恢复接口。
  定向 57 UT／6 TCP IT 与 ESLint 通过，原版公开 HTTP 与 UI 尚待整体验收。
- 独立 HTTP 审查发现错误 bearer 慢正文可占满 8 个名额：旧实现只验格式就等正文，3 秒内阻塞有效读取。
  已改为真正 meta 鉴权后才等正文，正文结束再检查 meta／RC 后执行，避免复用早先 RC 状态。
  回归先红后绿：8 个错误 bearer 的未完成 POST 及时返回 401，有效读取为 200，不进 debug／磁盘／变更。
  修后 routes＋guard 71 UT／routes 21 TCP IT／ESLint 通过；不宣称这能消除持续流量或慢上游造成的资源耗尽。
- 目录审查的合法输入误拒已修：安全路径段可含内部 `..`，仍拒绝独立 `.`／`..`、分隔符及 Windows 特殊路径；
  原生会话标题允许换行，不因合法标题整页失败。游标输入／输出统一限制 4096 UTF-8 字节，超限不截断。
  两项回归先红后绿，最终 inventory／journal 67 UT／7 TCP IT 与 ESLint 通过。

## 原版公开 HTTP 与受控启动验收

- `.cache/cron-rpc-probe/public-http-qa/run-2026-10-19T12-40-52-098Z/report.md` 及逐版 results、cleanup 为证据。
  2.2.0 → 2.1.1 单次顺序运行通过；每版 58 个公开请求、27 个 native setup／辅助请求，模型调用与公网 fetch 均 0。
- 真实 `superviseWeb → registry/token/meta/guard → startFrontend`，全新隔离 HOME 使用原先自有 fixture 的副本，
  没有重新造任务历史；旧源字节不变。仅 spawn seam 替换固定后端端口为自有端口，未探测或触碰生产 58627。
  正式静态缓存命中准确官方 2.1.1；2.2.0 此轮也使用该 UI，不据此宣称整体 2.2.0 页面兼容。
- 真分页为 20＋2 个唯一会话，包含已归档；fresh missing-wire 标为无法确认。7 次 cold 409 证明只读没有隐式恢复。
  原 sid 显式 status 后公开创建／读取／关闭／冷投影／再次恢复同 task ID 与完整内容／删除通过。
- 2.1.1 已存历史显示提交、回合开始与 completed／failed，以及精确实际请求模型；负面 fixture 的非法历史仍明确
  quality incomplete，不隐藏警示。2.2.0 历史为空，不宣称新 timer／fire 验收；未重做 timer／51 项矩阵。
- cron 静态四资源 200，普通及编码 debug／RC 路径 404；两版正常 authenticated shutdown，supervisor／native exit 0，
  自有 worker／子进程／端口残留 0，无强杀。runtime RC 失效退出沿用 UT／TCP IT，不声称真 relay／竞争原子隔离。
- 本轮未提交、推送、发布或修改生产安装。真实平台仅 Windows，实体手机、完整 2.2.0 UI、跨进程 CLI 控制、
  迁移／fork 全链与长期运行仍不在本轮验收范围；不得把以上链路通过写成完整原生管理语义均已具备。

## 完整官方页面实图与最终本地门禁

- `.cache/cron-ui-qa/run-2026-10-19T12-45-31-398Z/report.json`：完整 2.1.1 app＋虚构 REST／WS，
  真实 launcher routes／inventory，53／53 交互断言通过、15 图。四组覆盖 1280 英文 Original light、
  1440 中文 Nocturne、390 英文 Original dark、320 中文 Aurora，短长标题与任务内容。
  五导航、冷读不恢复、恢复二次确认与取消、一次增删、草稿／语言切换、未知写入禁止重试和回读解锁、默认未启用通过。
- 初次实图发现两处真实缺陷，不能把上述通过当作视觉通过：手机滚动列表 flex item 被压缩造成长标题叠字，
  氛围主题 rgba surface 单层背景透出底层文字。cron.css 禁止条目收缩、列表标题两行预览（选中详情全文保留），
  复用现有 search 的 surface-raised／color-bg／Canvas 叠加不透明基底；对应两项 CSS 契约回归通过。
- 修后 `.cache/cron-ui-qa/run-2026-10-19T12-50-49-074Z/report.json` 为 67／69、21 图，原报告不改。
  各宽度所有条目文字都在自己的边界内、无横向溢出；主题不再透字，历史显示实际请求模型。父级已查看代表图。
  2 项失败是 Original 隐藏整个底层 app 前后全像素比较；两张差异图显示面板本身文字抗锯齿改变，不能算透底证据。
  两次只跑 Original 的诊断保留 `12-53-16-638Z`／`12-54-35-348Z` 失败报告，不重复其它组合。
- 精确改为不隐藏 app，在面板下放同层级红／蓝色块比较内部像素；无产品修改。
  `.cache/cron-ui-qa/run-2026-10-19T12-56-01-548Z/report.json` 的 Original 定向 21／21、6 图通过，
  长短任务面板内部像素差 0；父级已查看最终短内容图。其余三外观此前像素／边界断言均过，不重跑整套交互。
  所有自建 browser 树、调试监听、fixture／launcher 监听已清理，未触碰真实会话或生产。
- 最终标准日志在 `.cache/scheduled-tasks-parent/integrated-{lint,typecheck,ut,it,pack}-final.log`：
  lint／typecheck／test:pack exit 0；UT 93 文件／1891 项，Lines 91.38%／Branch 82.56%；
  IT 22 文件通过／1 跳过，512 项通过／2 项 Windows native POSIX 跳过，Lines 85.07%／Branch 72.06%。
  覆盖率 70%／70% 门槛和实质断言不变，没有新增排除项。
- 首轮 UT 旧脚本总数断言仍为 30，已改为实际 33 并明确含三项 cron JS，observer 收敛定向 10 项通过。
  首轮 IT 的既有 sh 安装失败清理用例在并发时超 5 秒，原样单独通过（3.854 秒）；仅该多进程用例改为 15 秒，
  最终完整 IT 通过。保留首轮失败日志，不把超时当功能修复。
- pack 检查新增静态／后端文件随包、无旧 schedules 链／测试，真实包版本／首页／API 代理冒烟通过。
  包仍是工作树 r10 版本，只用于本地验证，不上传、不替换现有发布、不作为新版本交付。
  README／UPSTREAM／launcher README／AGENTS 已同步当前功能和边界；本轮未提交、推送、发布或重启生产。

### 事件：调试路径编码写法绕过外层隔离

- 影响：持有有效登录凭据的请求可通过旧代理访问本应封闭的 debug 路径；不是免认证漏洞。
- 触发条件：原版后端启用了 debug，浏览器使用 `%64ebug` 等编码路径，而旧代理只按未解码字符串匹配。
- 根因：外层和原版路由的路径规范化不同；旧测试只覆盖普通路径。
- 证据：同原版端点直连可达，修后普通／编码路径经代理均 404，公开链路双版本再次核验。
- 修复：前置 API 路径策略封闭规范化 debug namespace，opt-in 同样封闭 RC 路径族，正常代理 URL 不改写。
- 回归验证：规范化 UT、真实 TCP HTTP／WS 及两版原生公开接口；不以仅字符串测试代替真实路由。
- 运维动作：本轮未部署；以后升级并重启 launcher 才加载修复，普通模式仍不启 debug。
- 剩余边界：有效授权者原有主机执行能力不构成新权限沙箱，RC 状态检查不是跨进程原子锁。
