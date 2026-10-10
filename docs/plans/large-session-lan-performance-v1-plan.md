# 大会话局域网加载性能修复与 r9 发布计划

## 目标与边界

用户已授权自主 Goal：排查 Open Kimi Web 大会话经局域网加载慢于官方 Web，修复并发布新版本。
项目为 `open-kimi-web`，当前 develop 与已发布 `v2.1.1-r8` 内容一致，只有既有未跟踪 `.tmp/`。
保留该目录，不使用真实用户会话、凭据或配置，不更新用户安装、不重启用户服务。
候选新版本为 `v2.1.1-r9`，发布前重新核对远端。最终计划落盘
`docs/plans/large-session-lan-performance-v1-plan.md`，由 AGENTS 链接。

## 已确认事实（静态调查，不代替性能实测）

- 官方 2.1.1 主会话首次请求 `transcript?agent_id=main&page_size=10`，上滚使用 `before_turn`。
  r8 HTTP/WS 代理没有扩大 page_size 或预取所有历史，已有官方 HistoryWindow 与 resident session 缓存。
- 后端先恢复完整 agent 历史再分页；`tasks/interactions/attachments/todos/prompts` 返回完整关联实体。
  单 turn 仍可包含大量工具输出或正文；会话 wire 体积不是网络响应大小。
- `packages/launcher/src/httpProxy.mjs` 原样流式 pipe，保留编码头，但自身不压缩；
  `staticFiles.mjs`、`officialPresentation.mjs` 也是原始静态传输。
  官方本地 webAssets 同样 raw stream，而官方 Remote Control 会协商 gzip。
- `mobile/foldingDefaults.js` 改官方默认为工具展开，可能增加工具密集会话渲染；不能未经实测反转用户显式偏好。
- `mobile/themes.js` 等观察器会扫描新增子树，现有“零 document 查询”不代表零 Element 扫描。
- 时间戳不 clone 或主动读取 transcript；text 超 1MiB 跳过增强解析。tabFeedback 只让出一次绘制机会。
- imagePreviewGuard 的 fs:read 有额外 clone/JSON 解析，影响文件预览，不得直接称大会话根因。

## 1. 建立可归因基线

1. 复用 `.cache/tab-feedback-qa/run.mjs` 的官方 2.1.1 app、虚构 REST/WS、隔离 Chrome/CDP，
   并使用真实 `createLauncher`（参考 `.cache/session-size-desktop-qa/run.mjs`），不能只测直接 fixture 服务。
   新测量和脚本仅放 `.cache/large-session-lan-qa/`。
2. 同一虚构上游与正确分页数据，比较官方直连、r8 launcher 无增强、r8 完整增强；
   区分官方本地入口与具有 gzip 的 Remote Control 等价入口，避免不同后端/缓存比较。
3. 覆盖小会话、多 turn、单 turn 大工具输出、关联实体大的会话；首次 cold、重复 warm、resident切换及淘汰重载。
   记录 URL/page_size/分页次数、TTFB、encoded/decoded bytes、body完成、可见最新消息与可操作输入框时间、
   long tasks、DOM节点与观察器 Element扫描，折叠偏好分别显式0/1、Original与Nocturne。
4. 用受控带宽/延迟作为局域网等价网络，并保留回环控制组。每组重复少量采样取中位数，
   不以一次墙钟值宣称稳定倍数；真实家庭Wi-Fi和实体手机仍是未验边界。
5. 另在隔离官方2.1.1后端写入合法虚构 wire，核对真实REST最近页、旧页和恢复耗时。
   只能操作本任务home，不能读取用户wire或付费调用模型。

## 2. 在现有职责层做最小修复

1. 按基线决定并记录实际瓶颈，不能为了“按需加载”重复实现官方已经有的分页，也不截断转发的JSON或wire。
2. 若未压缩LAN传输占主要差异，在launcher加入无依赖的Node zlib流式gzip能力，
   由独立小模块管理Accept-Encoding协商及响应头，用于可压缩的大静态资源、注入资源及合适的REST响应。
   不缓存会话内容，不收集全文再压缩，不双重编码，不改变分页/正文/鉴权/取消/WS语义。
   保留identity/q=0、上游已压缩、HEAD、304/204、Range/206、SSE及no-transform边界；
   正确Vary、Content-Length、ETag/编码相关headers，pipeline错误/取消回收上游和压缩器。
   只做能由测量支持的范围，若REST传输不是瓶颈不盲改它。
3. 若增强观察器首屏热点显著，仅优化命中的独立脚本，提前排除本功能不可能出现锚点的正文/文件预览子树，
   保留首次挂载、嵌套替换、移除恢复、语言/主题变化；不建全局observer框架、不依赖Vue私有状态。
4. 工具默认展开若证实造成主要回归，使用保留显式0/1的兼容方案并同步产品文档；
   不静默覆盖用户现存偏好或削除工具历史。先测量再确定最小必要变更。
5. 冷后端完整折叠属于官方共同成本，明确记录；不以随意tail日志或新状态存储伪造修复。
   若改善需要更大上游改造，先把实际证据与计划变化落盘，不将较小结果冒充整个Goal完成。

## 3. 回归和真实验收

- 在既有UT/IT补针对实际修复的失败与协议边界；代理压缩用原始HTTP字节验证gzip可解码、内容完全一致、
  大响应流式首段可达、取消/断线/部分失败收尾、已编码透传及缓存/Range/HEAD边界。
- 观察器改动以大新增子树统计Element查询、真实MutationObserver收敛，保留相关控件发现及主/侧聊流式回归。
- 完整官方app复跑受影响性能场景，验证首次只最近10turn、上滚旧页、缓存切换、慢B快C、失败重试、
  WS增量/reset及输入可用，不改官方会话数据；桌面/手机、Original/Nocturne必要实图确认不退步。
- 使用相同数据、网络与偏好前后对比，报告分层数值及未解决边界；改善必须在交付包上可复现。
- 最终运行标准lint、typecheck、UT、IT、test:pack，独立覆盖率行/分支均不低于70%，不降低门槛。

## 4. 文档、隐私、发布与收尾

1. 更新README、launcher README、UPSTREAM、CHANGELOG中的真实行为/性能证据和Bug短复盘，
   更新launcher/plugin版本r9，保留历史事实，不宣称实体手机/生产用户已验。
2. 对新增公开diff、提交身份和实际tgz做定向隐私检查，不附带QA截图、日志、profiles、.tmp或sourcemap。
   本地commit/tag/merge使用GitHub noreply；GitHub squash显式authorEmail并核对结果，
   不重复r8的账户默认邮箱问题，不擅自清理已有公开历史。
3. 提交推送develop，经PR required gate合入main；main CI成功，从main生成tag和正式latest Release，
   上传精确tgz。不删旧版资产、不强推、不绕过branch protection。
4. 下载线上tgz与上传包比较，在隔离prefix安装并验证version、update检查/已最新路径和静态/API实际调用；
   复用同包性能验收，不重复无价值整套矩阵。旧服务不自动重启，用户升级说明清楚。
5. main正常merge回develop、CI核对；关闭本任务Chrome子树/HTTP/WS/backend，移除自有home/profile/scratch，
   报告与必要基准归档ignored .cache。最终GetGoal逐项检查后才能complete，未完成不得报成功。

## 执行记录（2026-10-10）

- 已完成准确官方 2.1.1 契约及注入层只读审计；旧 `kimi-code` checkout 为 2.0.1，未用于当前行为结论。
- 真实 launcher 的回环传输基线已运行三次：虚构最近页 JSON 为 8,907,975 bytes，r8 代理仍为 identity 全字节。
  同正文 gzip level1 参考为 62,325 bytes；此高度重复 fixture 只证明可压缩传输差异，不代表真实会话压缩比例。
  r8 转发完成约 54–65ms，官方本地 raw 约 35–40ms；回环样本不能直接推断实际 Wi-Fi 的延迟或倍数。
  官方主 JS 3,906,433 bytes、手机排序资源 12,270 bytes 也为 identity；上游 gzip 参考不是实际 Remote Control tunnel。
- 并行进行完整官方 app 的正确分页／工具密集 browser LAN 基线、真实官方 backend 合法 wire 最近页验证。
  独立压缩协议模块先实现并测试、不接线，保留 r8 浏览器基线不被实现过程污染。
- 目前未修改分页、工具折叠默认、观察器或用户安装，尚不能称大会话性能问题已修复。
- 真实官方 2.1.1 backend 两次隔离启动、48 个请求／147 项断言通过：1000turn 返回最近10turn，旧页 cursor 排他。
  33,471,330-byte wire 的最近10turn响应仅8,788 bytes；单8MiB工具turn的最近页仍为8,389,619 bytes。
  60turn关联entity场景最近页为321,983 bytes，含10turn＋60taskref；最新1turn仍314,216 bytes，关联entity未随页过滤。
  cold／warm仅有限回环样本，未清OS文件缓存，不等于live/resident；真实鉴权401、owned树/端口/home收尾均通过。
- 补代理协议基线：上游gzip原始字节、编码／长度／Vary／ETag透传，以及首chunk在完整body生产前可达。
  定向ESLint与httpProxy 15项UT通过；尚未接入压缩，未将上述结果宣传为修复效果。
- 完整官方 app 的 r8 对照完成17组样本／383项断言：25ms、1MiB/s下，首次工具／正文／entity约2.8／2.8／4.5秒，
  gzip等价基线约81／228／129ms；n=3中位数，fixture高度重复，不代表真实Remote Control或普遍压缩倍数。
  首次只取最近10turn，上滚before_turn正常；resident工具切换零transcript下载，不能称整个历史全量下载。
- 工具展开的共同渲染及Nocturne布局仍有400–900ms长任务；enhancement observer回调约12–29ms，未支持大范围重构。
  保留工具折叠显式偏好与既有默认，只针对已证实的传输瓶颈接入gzip。未修复官方同步渲染成本。
  父已看桌面工具与手机两主题代表实图；Original浅色手机顶部对比/标识既有问题保留，不能称全面视觉验收。
- 独立responseCompression模块119项UT、35项原始HTTP IT通过；覆盖协商、流式首段、背压、错误/取消、缓存与编码边界。
  现在接线httpProxy/staticFiles/officialPresentation，下一步验证真实launcher及交付包，尚未发布。
- r9 源码完整 app 复测10组／217项断言，竞态/恢复另27项通过，报告errors为空；同25ms／1MiB/s、显式fold=1、n=3。
  正文可见中位数：冷小2381ms、200turn105ms、工具109ms、大文本257ms、entity145ms、resident工具18ms。
  工具1,340,243-byte正文传输11,710 bytes，主JS3,906,433→1,436,290 bytes；解码正文大小相同。
  高度重复测试数据不代表一般压缩比例，trusted输入在正文可见后执行，不是最早输入可用时刻。
- 最近10turn、真实wheel旧页、resident零正文下载、慢B完成后不覆盖C、HTTP500原生自动重试、合法WS增量/reset与缺序恢复通过。
  慢B并未取消，不能用该例证明取消；压缩流取消另由原始HTTP/真实launcher定向测试覆盖。
  父实际查看r9桌面旧页、Nocturne手机折叠、Original手机展开；既有浅色顶部问题未变。
- 标准Windows lint/typecheck与66文件／1128项UT通过，UT行／分支覆盖率88.07%／80.62%。
  接线初测3项IT失败来自旧测试默认identity长度假设与partial竞态；修正表征断言，保留内容/失败要求。
  真实launcher新增10项IT覆盖三种路径、完整gzip解码、HEAD/identity、原请求与上游编码透传、客户端断开及partial两种编码。
  全IT13文件／133项通过，IT行／分支覆盖率87.81%／75.72%；test:pack通过，新模块随包，运行实际静态/API调用。
  不降门槛、不加覆盖率排除或依赖；交付包browser、PR/mainCI和线上安装尚待完成。
- 独立只读审查发现304变体metadata、HEAD/忽略Range完整200的Vary、ServerResponse既有setHeader整合与异常205长度边界。
  当前正常链路未触发既有setHeader风险；发布前仍修复module并补真实conditional往返及首gzipchunk后idle超时回归。
  保留HEAD identity原长度/无正文，不新增静态Range或conditional支持、不建立状态缓存；修后重新运行受影响标准门禁。
  宿主机定向CIM复核本轮large-session QA Chrome残留为0，不影响用户Chrome。
- 审查4项修复与只读复核完成，无明确剩余阻塞；纯函数137项UT、rawHTTP53项IT及真实launcher13项IT通过。
  identity/gzip的304均保留Vary维度，只gzip变体弱etag/删identity长度；HEAD仍identity。
  最终标准lint/typecheck、UT66文件1146项、IT13文件154项、test:pack通过；UT行/分支88.14%/80.76%，IT87.98%/75.91%。
  候选tgz实际101文件定向隐私检查通过，无配置/日志/缓存/map/个人路径/疑似凭证混入，新module字节与源码相同；媒体未变。
  实际解包候选的完整官方app核心验收完成：runner30项与报告定向46项通过，errors/Runtime problems为空。
  25ms/1MiB/s、fold=1、n=1：工具119ms/正文258ms/entity138ms/resident20ms，传输11710/11053/25839 bytes、decoded不变。
  最近191–200、真实wheel旧181–190、resident无新正文下载与所有核心trusted输入保持；未将此候选QA称线上验证。
  两张必要旧页/正文实图核对；自有Chrome/node子树、4入口listener、home/profile宿主机定向复核无残留。
