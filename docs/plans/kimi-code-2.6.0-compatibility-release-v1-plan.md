# Open Kimi Web 2.6.1 适配与发布 v1

## 目标与授权

发布新版本 `2.6.1-r1`，覆盖已验收的官方 2.6.0／2.6.1 适配、请求指标与分阶段诊断。
develop 经 PR 和必需 CI 合入 main，再从准确 main 创建 GitHub tag／Release；不发布 npm registry。
本次发布授权取代此前暂停状态，不升级用户实际 CLI、不重启生产、不修改网络；并行 `.gitignore` 改动不纳入。
新包发布并核验可下载、安装入口及更新发现后，删除旧 Release 的 `.tgz` 安装资产；保留历史 tag 与更新说明。
不删除用户安装、会话或其它本地数据，不修改历史源码；旧安装仍可从 latest 正常升级。
仅在官方实现与增强行为完全相同时停用重复补丁；有差异的保留，列明差异供用户决定。
旧版仍需的兼容路径保留，不擅自改变用户既有偏好。

## 已有事实

- 当前基线为准确官方 npm 2.6.1 与 tag `30e3ce442ae850a7461b80f2ce209cd73a301d02`，历史 contracts 不冒充新版协议。
- 官方用 conversation turns/items 替换 transcript；首批历史走 WebSocket，旧页走 agents/:agent/turns，撤销与文件历史参数亦变化。
- 指标、目录、子模型、只读任务、受管重启与安装均已有准确 2.6.1 后端验收，详细结果及首次失败保留在下文。
- 分阶段日志已确认部分等待发生在本机官方上游。隔离复现的迟接入重放缺陷已由官方 2.6.1 修复，
  但用户现场长时间等待的具体路径仍未确认；本次发布不将诊断包装成现场性能问题已解决。

## 当前交付状态

`v2.6.1-r1` 已从通过必需 CI 的准确 main 发布，公开包、同 SHA 安装入口和旧版更新发现核验通过。
21 个旧 tgz 资产已撤下，27 个 Release 及全部 tag 保留；正式结果见末节。
本次未启停生产服务，未升级用户官方 CLI；现场慢加载与适配验收分别记录。

### 追加跟进官方 2.6.1

兼容目标更新为2.6.1；沿用2.6.0结果，只补新版受影响验证，不重跑相同实图矩阵。
官方tag为 `30e3ce442ae850a7461b80f2ce209cd73a301d02`，新增会话重放性能与token计数／压缩修复。
准确包与实际界面、目录、子模型、只读任务、受管重启和安装pin已验证；保留旧owned2.6.0复用。
指标继续按结构而非版本启用；有差异补丁不擅自删除。既有隔离验收不等同实体手机或实际EasyTier已恢复。

## 实施顺序

1. 核对本轮实际增强依赖的公开协议与界面。保留官方会话与状态真相源，新增有界展示元数据，不重建正文或后端。
2. 适配手机消息目录及受影响的时间／加载提示，覆盖最近历史、旧页、实时变化、撤销、重连及路由竞态。
   不为首屏加版本白名单或假造 transcript，不改 WebSocket 正文和分页语义。
3. 验证并补齐新版全局子模型（含普通 primary 别名及跟随）、只读任务和受管重启的门禁与接口。
   任务保持只读、不隐式恢复；未知版本的写能力不放开；保留鉴权、锁、信任与忙时拒绝。
4. 核验缺官方安装时的准确 2.6.1 下载与运行时条件后更新 pin；继续复用已有可用版本并保留旧 owned 安装验证。
   元信息失败的 UI fallback 只在实际验证后同步，不触发用户 CLI 升级。
5. 沿用已完成的准确后端、实图、3249项UT／705项IT及lint／typecheck结果，不重复无变化矩阵。
   对准确版本重新打包并验证，PR／main CI必须通过默认并发和原覆盖率门槛；有新变化时仅补受影响验证。
6. launcher／插件版本、README 在线命令、CHANGELOG、UPSTREAM 和 upstream.json 同步；README 保持预览在前与两段安装命令。
   记录真实结果、首次失败与边界。检查实际将公开源码、包、媒体及新增提交历史，不公开 ignored QA 数据或 sourcemap。
7. 使用已确认的 GitHub noreply 提交、推送 develop 并建 PR；required CI 通过后正常 squash 合入 main，等待准确 main CI。
   不放宽超时、降低覆盖率、隐藏失败或用 admin 绕过。
8. 从准确 main 的独立 ignored worktree 标准打包，创建新 annotated tag `v2.6.1-r1` 与正式 latest Release。
   核对公开包原字节／digest、同 SHA 安装入口、旧版真实更新发现；确认成功后只删除旧Release的tgz资产。
   保留旧tag与更新说明，不移动新tag或替换新资产；事后记录另作提交，正常同步main回develop。

## 验证与完成边界

- 必须实测普通官方后端（不开通用 debug）、新版首批历史及旧页／实时／重连，不只检查 import 或编译。
- 安装脚本只在缺官方时准备 2.6.1，已有可用官方 CLI 仍不下载或升级；原 CLI 使用习惯保持。
- 实体手机、任意巨大单轮、真实 EasyTier 隧道和全平台安装不据隔离结果保证。
- 发布完成需正式 Release 和可下载资产正确；生产部署、用户手动重启及现场慢连接复现是不同状态。

## 执行记录

结果在完成后追加，未记录为通过的检查不视为通过。

### 现场追加：原生同样慢与监听器警告

用户卸载 OKW 后确认原生 Kimi Web 也慢；本轮不恢复安装、接管或重启该服务。
这与已抓到的本机上游等待一致，但仍不证明后端具体函数根因。
另在真实 OKW 代理链复现同类 MaxListenersExceededWarning：debug 加 POST 时响应 close 监听器峰值 11。
先补默认上限不变的真实 HTTP 回归，收回上游响应头到达后已经重复的取消监听，保留提前断连、错误和压缩背压。
不提高监听上限、不过滤警告，不用该修复冒充原生慢加载问题已解决；用户现场原警告未取得完整栈。

- 最小修复已本地完成：响应头到达即由 sendResponse／pipeline 接管取消和正文销毁，移除等待阶段重复 close／aborted。
  成功、失败和提前断连均销毁自有上游；重启写入跟踪在 finish 或 close 后同时卸下另一监听。
- 真实回归修前 8 项中 2 项失败，debug＋POST 峰值 11；修后新增 9 项全部通过，连同旧诊断共 29 IT 通过。
  188 项相关 UT 与定向 ESLint 通过；开启 trace-warnings 未再出现同类警告，没有调上限、降并发或过滤输出。
- 独立真实链八组合复查峰值 8–10、默认上限仍 10；每个响应独立，没有观察到跨请求监听数量递增。
  这是监听器重复生命周期修复，不等于取得用户现场原警告完整栈，也不证明原生慢加载由内存泄露造成。

### 事件：debug 时出现 Possible EventEmitter memory leak 警告

- 影响：OKW 控制台可出现监听器超过默认阈值的警告，用户担忧内存泄露及加载停顿。
- 触发条件：增强模式开启 debug，部分 POST 响应同时有诊断、重启写入跟踪及流式传输的 close 监听。
- 根因：上游等待阶段的取消监听在收到响应头后仍保留，与 sendResponse／pipeline 的正文取消生命周期重复。
  重启写入跟踪也未在其中一个终态发生时主动删除另一个监听；未证明存在持续增长的实际堆内存泄露。
- 证据：真实 ServerResponse 的 newListener 统计精确复现峰值 11，trace-warnings 指向 pipeline 加 close 监听。
  原生 Kimi 同样慢及一分钟上游等待的证据与此分开记录，不将所有故障归为同因。
- 修复：按阶段转移取消职责并显式成对清理，不 setMaxListeners、不隐藏警告。
- 回归验证：真实默认阈值／GET／POST／gzip／debug 多次请求及头前断连新增 9 IT、相关 188 UT 通过。
  原有取消、背压、完整字节和传输诊断 20 IT 同时通过；原修前失败保留。
- 运维动作：仅本地修改，尚未提交或发布；用户已卸载，未恢复安装、接管或重启原生服务。
- 剩余边界：没有用户原警告完整栈或堆快照；不承诺已解决原生后端恢复停顿。

### 原生后端调查：具体缺陷与现场采样

- 精确 2.6.0 的 `EventDispatcherService.attachLateNow` 对每条历史事件深复制逐渐增长的全部 participant 状态。
  只读隔离实验强制触发 conversation 迟接入，确认深复制占据主要耗时；使用既有 replayImmer 的诊断副本可显著减少等待。
  这是已复现的官方缺陷，不是已确认的现场根因；迟接入由诊断副本人为触发，撤销／冻结／失败语义尚未补验。
  不把实验改动装入 OKW，不替换用户 exe、不维护另一份常态后端。
- 同版本原生 exe、npm 诊断副本和完整记录的隔离测试均未自然复现现场长时间阻塞。
  展示投影不足以证明完整恢复路径；多 agent 并发恢复也未自然触发该迟接入条件，不能排除其它现场条件。
  真实输入只读，测试数据仅在自有临时目录或容器 tmpfs，结束后核验原数据未变、自有服务与容器已清。
- 短时采样未复现同一慢路径，不将普通重放热点确认为故障原因。调试监听已关闭，原服务保留；
  只归档脱敏统计，不公开私人样本规模、原始 profile 或操作时间线。
- 已核对准确官方 npm 2.5.2、2.5.3 与 2.6.0：前两版迟接入直接 `produce(attachment.getState(), ...)`，
  2.6.0 在循环中新增 `structuredClone(attachment.getState())`。
  引入提交为 `b263e80ff3ca93998336b1f89e7bc85946f8f76f`（PR #4630）；直接父提交该处没有深复制。
  同一发布区间由 PR #4663 引入 ConversationFeed 替代旧 TranscriptService，新增历史投影路径与普通浅复制开销。
  版本新增代码与隔离缺陷均已确认；尚未确认用户一分钟现场自然触发该迟接入路径。
- 后续范围包括向官方提交 PR 并补 Issue。提交前查重发现官方 #4888 已修 conversation mutable replay，
  #4893 同步到 main；2.6.1 已于同日发布并列出该修复，不再把仍开放的 #4885 当作修复尚未发布的证据。
  已按官方贡献规则先报 [Issue #4917](https://github.com/MoonshotAI/kimi-code/issues/4917)，
  并在 [PR #4885 评论](https://github.com/MoonshotAI/kimi-code/pull/4885#issuecomment-6848554793) 通知原修复作者。
  正文区分2.6.0隔离复现、现场待确认与2.6.1仅源码核对；公开文本已脱敏并通过API回读逐字核验，无真实数据附件。
  未新建重复实现PR；剩余默认participant路径须按官方要求先获维护者 `/approve` 后再准备外部跟进PR。
  未安装或实测2.6.1、未重启生产，不把官方源码修复等同用户现场已经解决。
- 下一步验证官方已发布修复与实际慢请求；核心问题尚未在用户场景闭环，不据此恢复OKW发布。

### 本地兼容续做：2.6.0 的展示、配置、任务与安装

本节只记录本地适配。原生慢加载调查继续独立进行；PR／发布暂停，不恢复安装、接管或重启用户服务。
正式包与插件版本仍为 `2.5.2-r4`，未改线上安装命令去引用不存在的 `2.6.0-r1`。

- 新 `conversationMetadata.js` 读取准确2.6的原生 turns/items，只留短标签、顺序、精确ID和时间。
  首批走原生WS、旧页用 before_ordinal，实时新增／删除、撤销、重连与切会话均按身份处理；不存正文或另拉历史。
  元数据最多4会话、每会话2000项，超过2MiB的观察内容可跳过；目录可能缺项，原生正文不截断。
  时间补显与tab加载提示接入新路径，不用旧 transcript 伪造新版状态。
- 全局手机子模型在成功同源精确2.6元信息下支持 null 恢复跟随，允许名为 primary 的普通模型别名。
  不写已移除的 force，不改主模型或池；其它版本仍按既有验证范围处理。
- 准确2.6新增只读原任务／历史和受管重启支持。任务列表不恢复冷会话，写入在mutation前拒绝；
  未新增编辑、暂停或独立任务模型，普通debug和同实例RC的外层隔离保持。
- 缺官方时安装器固定校验并准备2.6.0，元信息失败网页默认版本同步为2.6.0；已有可用官方不升级。
  旧owned2.4.1保留shell probe，2.3.1／2.1.1保留身份与PTY验证；不运行根postinstall迁移。

### 本轮补丁取舍

- 仅在准确2.6.0停用 `foldingDefaults.js`：官方 activity-run-folding 在未设置时已默认折叠，
  与增强缺省写1的结果完全相同。已有偏好不迁移，旧版脚本继续保留。
- 原生发送／排队／插队已无OKW重复按钮；>=2.3 UI原本就不注入旧Side Chat滚动补丁，不恢复它们。
- 保留用户口径的逐调用平均TPS／缓存命中、手机目录／时间、子模型和侧聊选模、导航排序及主题／自适应阅读。
- 图片的常规下载预览已有官方实现，但旧版／SVG的fs:read截断和413兜底不同；通知在取消后重问与并发请求也不同。
  手机原菜单仍无Fork／Pin动作，桌面三个点是原生右键菜单的额外入口，因此保留。
- 官方设置已能删除归档会话，但原生确认／toast／响应式移除与OKW的显式确认／错误／刷新不同，
  OKW还覆盖已完成侧栏；不把“同样能删除”等同完全相同，先保留，待用户决定是否局部交回官方。
  Fork前缀保护和工作区默认最近排序同样不同，不擅自删掉。

### 新版没有保存的历史模型不能补造

准确官方2.6的真实任务触发日志含 usage.record 和 step.begin／end，但不再有 llm.request。
已核对打包源码：请求配置只写info logger，不dispatch旧请求事件；usage中的model是别名，step中无实际API模型名。
因此任务历史缺证据就省略实际模型，用量token仍计入unresolved，不估价；不使用当前配置倒推旧调用。
新增真实记录形状回归，确认input／output计数保留、modelId和cost为null、costComplete为false。

### 本地真实验证及保留的首次失败

- 准确官方2.6安装：42项UT与8项真实包IT通过，覆盖CLI／shell／鉴权Web、owned复用及损坏拒绝。
  使用已有校验过的tarball，没有重复全平台安装矩阵、生产安装或付费调用。
- 连续两次真实受管重启11／11通过：同端口、token、会话、工作区、路由和草稿保留，原生WS重连，worker退出后服务仍可用。
  使用实际supervisor／重启链，仅spawn seam换临时后端端口以避开真实58627；不是默认端口字面原bin的整链验收。
  早先直接原bin因真实端口已有服务而meta401的失败保留，未停止该服务。
- 完整app第一段11项通过：12轮真实本地provider数据、首批10轮、旧页before_ordinal、目录定位首项、
  WS重连保留旧页、撤销精确移除及primary／null回读。随后driver点错手机设置按钮，原报告保留失败。
- 修正driver后只补未完成部分：21／21通过，覆盖手机模型入口、关闭搜索提示、fork标题保护、忙时重启409、
  320／390／640手机目录、1440三主题桌面、时间补显、无新增折叠偏好和无runtime error。
  390／1440对照只旁路本次新目录／时间脚本，header／composer几何相同，不冒称完全无OKW的官方基线。
  共查看8张代表实图；没有重复已经验收的指标／侧聊矩阵，实体手机和软键盘未验证。
- 只读任务12／12通过：原生真实任务触发并结束、本地provider仅1次、live与cold原任务一致、真实触发历史、
  不猜缺失实际模型、创建删除409、wire原字节不变、冷会话不恢复、公共debug／RC404及错误鉴权401。
  第一次误期望实际模型、一次driver把404文本当JSON及一次未定位阶段的ECONNRESET均保留，未改为全绿报告。
- 以上主浏览器／重启流程不开官方debug、付费调用0；定时任务仅在显式opt-in的隔离loopback后端启用所需内部接口。
  运行时home／workspace／浏览器profile均已清，最终报告的自有进程及监听为空；脚本、统计和实图归档ignored cache。

### 标准检查与测试fixture修复

本轮最终标准检查全部通过，默认并发及行／分支70%门槛不变，没有扩大超时、条件跳过或隐藏失败。

- `corepack pnpm test:ut`：142文件、3229项通过；Lines 92.50%、Branches 83.67%。
- `corepack pnpm test:it`：35文件通过、2个既有平台条件跳过；704项通过、6项Windows上的POSIX条件跳过；
  Lines 83.93%、Branches 71.12%。
- `corepack pnpm lint`、`corepack pnpm typecheck` 通过。
- `corepack pnpm test:pack` 通过。解包产物确认2.6选新metadata、不注入旧metadata／foldingDefaults，
  真实HTTP可取新脚本，CLI／API代理／PWA／证书／日志原有检查通过。本地包仍标r4，只是开发验证，不是替换正式r4资产。
- 首次完整UT有13失败，包含遗留版本／下载URL断言和一项PowerShell启动超时；修正旧fixture后定向209项通过。
  下一次完整UT仍有两失败：CLI单例串六次真实子进程共5.745秒超过原5秒，弹窗固定10ms等待早于嵌套0ms回调。
  按命令拆分CLI断言，弹窗改用fake timers明确执行原生120ms定时；保留原断言和所有真实进程分支，30项定向通过。
  最终完整UT通过；首次PowerShell超时根因未独立确认，不把通过一次当作已证明系统负载原因。
- 相关原始失败和最终日志在ignored `.cache/compat-260-qa/`；没有将失败记录覆盖为成功或重复已有整包安装／实图矩阵。

### 事件：官方2.6升级后目录、配置入口与指标依赖不再匹配

- 影响：旧目录和时间监听transcript，2.6原生turns/items不再触发；任务／重启／手机跟随模型原本受旧精确版本门禁限制。
  指标旧结构与新版普通接口的计时缺失已在前轮单独修复，本轮沿用其验收，不重复冒领。
- 触发条件：选择准确官方2.6.0 UI／后端，而增强仍用旧事件和门禁。
- 根因：上游协议与字段变化，旧fixture只描述旧transcript，未覆盖新item身份、before_ordinal和普通primary别名。
- 证据：真实WS最近10轮、正式旧页、撤销／重连、配置POST与省略section回读，以及真实任务wire；详见上述报告。
- 修复：按新版结构旁观短目录与时间，扩展已真实验证的精确能力；只停与官方完全同义的缺省折叠脚本。
- 回归验证：真实后端／完整app补验、42安装UT／8真实安装IT、12只读任务、11重启及最终标准门禁全部通过。
- 运维动作：本地未提交／发布，不恢复安装或重启生产；将来部署需另获授权并重启实际旧服务、刷新页面，无会话迁移。
- 剩余边界：一分钟现场慢加载未闭环；2.6日志缺实际模型不估价；实体手机、真实EasyTier、任意400–500MB单轮和全平台未保证。
  本节为2.6.0当时的结果；2.6.1的准确包与增量验收见下节，不将两版或现场结果混为一谈。

### 跟进 2.6.1：准确包与关键链路

- 官方tag `30e3ce442ae850a7461b80f2ce209cd73a301d02`，npm包15,854,190 bytes，SHA-512与registry一致。
  官方[#4888](https://github.com/MoonshotAI/kimi-code/pull/4888)修会话重放，
  [#4907](https://github.com/MoonshotAI/kimi-code/pull/4907)修工具结果备注／错误／耗时导致的token计数与压缩异常。
  638个dist-web文件与2.6.0逐字节相同；指标完整结构匹配为active，不新增版本限制或修改版后端。
- 目录、缺省折叠停注入、手机子模型null／primary、只读任务、重启均增加准确2.6.1；旧版能力不移除。
  新装缺官方时pin／元信息失败fallback改2.6.1，保留owned2.6.0／2.4.1原身份及shell验证；不升级现有可用CLI。
- 真实隔离app 17／17：12轮原生记录、首批WS、before_ordinal旧页、手机目录定位、重连、撤销、时间、
  primary保存／null跟随／主模型不变、手机真实选模入口、搜索关闭提示、fork保护、busy重启409及无runtime error。
  只验证新增版本链路，沿用逐字节相同UI的2.6.0三主题／窄屏矩阵，不重做整套布局。
- 真实指标17／17：实际下发补丁JavaScript、普通turns仍无计时、按官方wire精确step匹配、思考首段、
  全程平均TPS及75%／0%缓存命中、历史重渲染、长短回复与1440／390夜幕双端对照通过。
  两次high本地provider调用，首例output24／(414＋1606ms)=11.9 tok/s，缓存15／20=75%；无付费、无debug。
  手机／桌面基线只旁路指标、保留其它增强；header／composer相同，未将其冒称完全裸官方。
- 只读任务12／12：真实原任务及触发结束、本地provider仅1次、live／cold同任务、无隐式恢复、wire原字节不变、
  创建删除409、公共debug／RC404、坏鉴权401；确认2.6.1仍缺持久实际API模型名，不猜任务历史模型或费用。
- 两次受管重启11／11：准确2.6.1、同端口／鉴权／会话／工作区／路由／草稿、原生WS重连、临时worker退出后仍可用。
  复用隔离真实supervisor与临时端口seam，不停止真实58627或用户服务；不是首次生产迁移问题的结案。
- 完成报告分别在ignored `.cache/compat-261-qa/` 的app-final2、metrics-final2、cron-final、restart-isolated。
  各报告自有服务／浏览器进程与监听均为空，home／workspace／profile已清；不公开虚构凭据或运行日志。

### 2.6.1 增量验证的首次失败

- 首次解包受Git Bash tar的盘符解析影响；改用同目录相对文件名后解包，包字节未重下或修改。
- 直接运行未安装依赖的tarball先报缺chokidar；先在解包目录npm install又触及未公开devDependencies而404。
  保留官方包不改，用隔离上级manifest只安装其已声明运行依赖；这是QA准备，不当作正式安装器通过。
  随后正式安装器的8项真实global tarball安装IT通过，ignore-scripts和完整SHA-512校验不变。
- 首轮指标手机对照误把仍在连接的空白页当baseline，几何断言失败、原报告保留。
  等待真实历史正文和原生loading消失后再比较，17项补验通过；未改产品CSS或放宽几何阈值。
- 新版定向UT先518项通过；补旧owned2.6.0保留与旧tarball拒绝后，安装相关118项通过。
  最终完整门禁结果见下节，不以定向通过替代完整结果。

### 2.6.1 最终本地检查与收尾

- `corepack pnpm lint`、`corepack pnpm typecheck`均通过。
- `corepack pnpm test:ut`：142文件／3249项通过；行覆盖率92.50%，分支83.67%。
- `corepack pnpm test:it`：35文件通过、2个既有平台文件跳过；705项通过、6项Windows上的POSIX条件跳过。
  行覆盖率83.97%，分支71.16%；默认并发与行／分支70%门槛均未调整。
  准确2.6.1真实global安装、CLI／shell／鉴权Web、owned复用及损坏拒绝8项均在本次完整IT内通过。
- `corepack pnpm test:pack`通过：实际解包检查2.6.0／2.6.1选新版metadata，不注入旧metadata或重复折叠脚本；
  CLI、真实HTTP静态／API、PWA、CA、debug及进程收尾通过。包仍标2.5.2-r4，仅作本地验证，不替换正式资产。
- 原始日志在ignored `.cache/compat-261-qa/`：ut-final.log、it-final.log、pack-final.log、lint-first.log、typecheck-first.log。
  完成后的四份真实后端报告分别为17、17、12、11项，无付费请求；汇总在final-summary.json。
- 自有测试服务、浏览器及监听已归零；虚构home／workspace、浏览器profile及临时运行依赖已删除，报告与官方包归档保留。
  清理脚本首次把自身Node进程列为候选，修为仅排除精确自身PID，其余候选仍须为空；不杀用户服务。
- 本地源码适配完成，未提交、推送、发布或重启生产；源码安装接管已按另一次授权恢复，不将两项授权混淆。
  现场一分钟慢加载尚未确认解决，保留2.6.1官方修复后的用户实测边界；不据隔离通过声称EasyTier已恢复。
  有差异的归档删除、Fork标题保护及默认recent排序等增强仍保留，未经用户选择不擅自删除。


### v2.6.1-r1 正式发布与旧包撤下

- [功能 PR #51](https://github.com/WilliamLambertCN/open-kimi-web/pull/51) 正常 squash 合入 main，
  准确发布提交 `1e6f16e1d6377e50d33fe768585a0f4d71bfc1d1`。
  [PR CI](https://github.com/WilliamLambertCN/open-kimi-web/actions/runs/43450591058) 与
  [准确 main CI](https://github.com/WilliamLambertCN/open-kimi-web/actions/runs/43451051600) 全通过。
  lint、typecheck、完整 UT／IT、coverage 和 pack 均保持既有门禁，不关闭分支保护或强推。
- Ubuntu main：142个UT文件、3221项通过／28项既有平台跳过；UT Lines92.39%、Branches83.79%。
  IT 35文件通过／2平台文件跳过，686项通过／25项既有平台条件跳过；Lines84.79%、Branches72.35%。
  Windows本地3249 UT／705 IT及6项POSIX跳过的结果见前节，两平台数字不混用。
- 从准确 main 的干净隔离worktree冻结安装并标准打包；准确版本的test:pack另通过CLI、真实HTTP／API、
  新旧会话资源、PWA、CA、debug及进程收尾。不重复已有实图或全平台安装矩阵。
  包共193文件、9,063,063 bytes；标准pnpm pack移除开发打包脚本，文本仅有Git正常行尾转换。
  其它文件与干净发布checkout逐字节一致，公开内容检查无新增凭证、私人路径、缓存、备份或调试sourcemap。
- annotated tag `v2.6.1-r1` 对象 `dc8a308bcbbf1a22eeb152e3f6849cd02d5bd872` 指向上述准确main。
  [正式 latest Release](https://github.com/WilliamLambertCN/open-kimi-web/releases/tag/v2.6.1-r1)
  ID `444389116`，非草稿、非预发布；唯一资产 `open-kimi-web-2.6.1-r1.tgz`，ID `744124108`。
  SHA-256为 `4893d6dabdebe4808e94cb0ba560a5c51374a07dc7642ae0423383c64a59bb09`。
  公开下载与本地正式包逐字节一致，大小和GitHub digest一致，不替换已上传包或移动tag。
- tag commit API、同SHA的PowerShell／sh／coordinator／关键helper均HTTP200且与Git原字节一致。
  公开完整源码归档23,534,027 bytes，其中21个安装入口／helper逐字节匹配同一提交。
  真实r4包的CLI在隔离npm prefix执行`update --check`退出0，联网发现2.6.1-r1及准确新包URL；
  原隔离manifest仍为r4，未实际升级生产或重复整包安装。
- 完成上述核验后，按精确asset ID删除21个旧tgz，总177,389,766 bytes；回读仅剩新包。
  全部27个Release保留，原说明前增加旧包撤下及latest指引；所有远端tag在清理前后完全一致。
  不删除用户安装、会话、配置、本地旧包、历史源码或其它附件，不发布npm registry。
- main已正常合回develop，发布结果另作文档提交，不重写已发布提交或替换tag／资产。
  分支保护保持strict gate、管理员约束及线性main，force push关闭；提交和tag使用noreply邮箱。
  本轮未重启生产、升级用户官方CLI或改变网络。实体手机／真实EasyTier及现场慢加载仍按前述边界，不据发布判定解决。
- 本轮临时脚本、报告、包与CI日志归档ignored `.cache/release-261/`；此前隐私历史清理和GitHub旧PR缓存边界不变。
  此处的包清理不是全网缓存或历史副本清除，也不替代已泄露凭证的撤销或轮换。
