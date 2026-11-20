# open-kimi-web 维护约定

本文件适用于整个仓库。修改前阅读 `README.md`、`UPSTREAM.md` 和相关实现、测试。
保留工作树中的并行改动；功能提交、发布、生产重启与历史清理分别按明确授权执行。
正式版本以 Release 为准，本地兼容与未发布范围见 `UPSTREAM.md` 和 `upstream.json`。
维护文档只记录工程约束和可公开证据，不保存个人指令流水、实际地址或私人会话测量。

## 实施计划

`docs/plans/` 仅供本地维护，不纳入公开版本控制；以下链接在没有本地计划的克隆中不可用。

- [Kimi Code 2.7.2 适配](docs/plans/kimi-code-272-compat-v1-plan.md)
- [计划文档与公开历史清理](docs/plans/private-plans-history-cleanup-v1-plan.md)
- [已完成侧栏宽度与 2.6.1-r7 发布](docs/plans/completed-sidebar-width-2.6.1-r7-release-v1-plan.md)
- [子代理候选池布局与 2.6.1-r6 发布](docs/plans/subagent-pool-layout-2.6.1-r6-release-v1-plan.md)
- [工作空间重复创建修复](docs/plans/workspace-duplicate-prevention-v1-plan.md)
- [子代理候选池与描述编辑](docs/plans/subagent-pool-editor-v1-plan.md)
- [触摸提示修复与 2.6.1-r3 发布](docs/plans/touch-tooltip-2.6.1-r3-release-v1-plan.md)
- [供应商预设保存与 2.6.1-r2 发布](docs/plans/provider-preset-save-2.6.1-r2-release-v1-plan.md)
- [公开历史隐私清理](docs/plans/privacy-history-cleanup-v1-plan.md)
- [官方 2.6 适配](docs/plans/kimi-code-2.6.0-compatibility-release-v1-plan.md)
- [分阶段诊断日志](docs/plans/large-session-debug-log-v1-plan.md)
- [请求指标升级兼容](docs/plans/request-metrics-upgrade-compatibility-v2-plan.md)
- [历史 0.43.1 适配](docs/plans/kimi-code-0.43.1-compatibility-v1-plan.md)
- [请求指标与重启发布](docs/plans/request-metrics-2.5.2-r3-release-v1-plan.md)
- [应用图标](docs/plans/app-icon-2.5.2-r2-release-v1-plan.md)
- [2.5.2 发布](docs/plans/kimi-code-2.5.2-r1-release-v1-plan.md)
- [品牌与 2.5.2 适配](docs/plans/branding-and-2.5.2-compatibility-v1-plan.md)
- [手机消息目录](docs/plans/mobile-conversation-toc-v1-plan.md)
- [2.4.1-r3 发布](docs/plans/kimi-code-2.4.1-r3-release-v1-plan.md)
- [2.4.1-r2 发布](docs/plans/kimi-code-2.4.1-r2-release-v1-plan.md)
- [局域网证书](docs/plans/android-lan-ca-v1-plan.md)
- [会话菜单](docs/plans/session-menu-actions-v1-plan.md)
- [用量统计](docs/plans/usage-statistics-v1-plan.md)
- [自动匹配价格](docs/plans/usage-pricing-auto-match-v2-plan.md)
- [价格刷新连续性](docs/plans/usage-pricing-refresh-v3-plan.md)
- [完整图片预览](docs/plans/image-preview-complete-v1-plan.md)
- [手机提问卡片](docs/plans/mobile-question-height-v1-plan.md)
- [会话体积与消息时间](docs/plans/session-size-v1-plan.md)
- [桌面会话体积](docs/plans/session-size-desktop-v2-plan.md)
- [聊天窗格自适应](docs/plans/chat-width-responsive-v1-plan.md)
- [手机列表与自更新](docs/plans/mobile-list-and-self-update-v1-plan.md)
- [大会话加载](docs/plans/large-session-lan-performance-v1-plan.md)
- [一键安装](docs/plans/one-click-install-v1-plan.md)
- [一键安装发布](docs/plans/one-click-install-r10-release-v1-plan.md)
- [手机子模型](docs/plans/mobile-subagent-model-v1-plan.md)
- [任务与统一导航](docs/plans/scheduled-tasks-management-v1-plan.md)
- [工作区与 2.3.1 适配](docs/plans/kimi-code-2.3.1-workspace-release-v1-plan.md)
- [模型发现修复](docs/plans/provider-model-discovery-r1-hotfix-v1-plan.md)
- [新模型默认能力](docs/plans/provider-defaults-r2-release-v1-plan.md)
- [2.4.1 适配](docs/plans/kimi-code-2.4.1-compatibility-v1-plan.md)
- [低带宽大会话](docs/plans/large-session-low-bandwidth-v2-plan.md)
- [安装到桌面](docs/plans/pwa-install-v1-plan.md)
- [请求指标与侧聊选模](docs/plans/request-metrics-sidechat-v1-plan.md)
- [受管服务重启](docs/plans/service-restart-v1-plan.md)

## 项目边界

- 本项目是官方 Kimi Code Web 和后端外层的轻量增强，不维护另一套会话前端、会话数据库或模型配置真相源。
- 官方后端负责会话、工作区、供应商、模型配置和文件历史。launcher 负责进程编排、HTTPS、访问链接、
  同源静态资源、REST/WS 代理及少量受限的私有转发端点。`packages/launcher/src/mobile/` 只负责
  官方页面上的展示和交互增强。
- 默认模式下载并服务官方 npm 包中的 `dist-web`。`--web-dir` / `OPEN_KIMI_WEB_DIR` 直接服务用户提供的构建，不注入本项目的展示脚本、主题或私有 UI 功能。
- 不在 DOM 补丁中重建官方状态管理。能调用官方 API 或复用官方表单提交时，继续让官方后端成为唯一真相源。

## 官方 2.7.2 与历史版本适配事实

- 当前兼容目标为准确 Kimi Code `2.7.2`，发布目标为 `2.7.2-r1`，保留准确 `2.6.0`／`2.6.1` 支持。
  缺少官方 CLI 时才校验安装固定 `2.7.2`；元信息失败的网页 fallback 同为 `2.7.2`，已有可用 CLI 不升级。
  旧 owned `2.6.1`／`2.6.0`／`2.4.1` 保留精确身份和 shell probe，`2.3.1`／`2.1.1` 保留 PTY 检查。
  [已完成侧栏宽度与发布计划](docs/plans/completed-sidebar-width-2.6.1-r7-release-v1-plan.md)是 r7 历史记录，不借旧 CI。
  `UPSTREAM.md`、`upstream.json` 和历史计划区分源码审计、真实 npm 后端与虚构 API 的完整 app 验收。
  新版 turns/items 的短目录不保存正文或另拉全会话；保留原生首批 WS、旧页 before_ordinal、重连及撤销。
  精确 2.6.0、2.6.1、2.7.2 使用 turns/items 并停用重复 foldingDefaults；旧版保留原注入路径。
  准确 2.6.0／2.6.1 的 638 个网页文件逐字节相同；2.7.2 单独核对。指标按完整结构启用，不按版本号过滤。
  0.41.0 协议快照未重捕；下列旧版行为保留为历史，不是新版保证。
- `2.6.1-r9` 对精确 `2.6.3` 的补丁关闭聊天 Markdown 的渐进平滑；追底时，仍在视口内的工具组结束后暂缓自动收起。
  不写滚动位置、不留占位空白，保留手动收折；未匹配的组件保留官方行为。
  不改变输出速率、完成状态、用户折叠偏好或自定义 Web 目录，也不代表完整适配 `2.6.3`。
  `2.7.2` 保留官方流式显示、运行时标签标题和主输入框思考档位处理，不套用旧版重复补丁。
- 精确 `2.5.2` 新增只读任务和最近页支持；不为列任务调用已删除的 GET `/status` 或恢复冷会话。
  原生 agent／usage／goal／todo／task 独立 WS 帧直接透传，不补造旧 transcript 状态。
- 全文搜索默认关闭时给出中英开启方法及扫描成本，不自动启用；普通标题筛选不受影响。
- 手机全局子模型控件不因模型池只有一项隐藏。同源 meta 确认精确 2.5.2、2.6.0、2.6.1、2.7.2 后允许清除 secondary_model。
  按真实省略 section 的回包验证跟随主模型；2.6.0、2.6.1、2.7.2 允许普通 `primary` 模型别名，旧版保留 reserved 规则。
  默认模型控件不写 force、特殊 primary 选项或改主模型；独立候选池编辑器按官方接口增量保存说明和候选。
  候选池保留思考档位与未修改配置，保存前检查并发变化、保存后回读；不先清空重建或另建配置存储。
- 注入代码不得依赖 Vue 的 `data-v-*`、构建哈希文件名或压缩变量名。使用稳定的语义类名、可见结构和
  官方请求结果。`2.1.1` 供应商表单使用 `.pf`、`.pf-field`、`.pmt` 与 `.pmt-grid`；
  归档设置页仍使用 `.archive-list`、`.archive-card`、`.archive-row`、`.archive-name`、
  `.archive-time` 与 `.archive-workspace .path`；上游变更时重新核对。
- 归档列表可使用 v2 `GET /api/v2/sessions?meta.archived=true`，条目包含 `id`、`workspace` 和 `meta`。
  保留旧 v1 `archived_only=true`；2.7.2 的侧栏和设置只用官方删除动作，不按显示标题绑定会话 ID。
- 2.7.2 的任务盘点只读分页列表和已有记录。受管服务的双端一键重启须保留，不把会话列表当作允许停机的凭据。
  不为重启开启 debug；官方拒绝时不得回退到强制停机。请求结果不明时只查状态，不重发请求。
- 官方 `2.1.1` 仍提供 `POST /api/v1/sessions/{session_id}:delete`。永久删除必须调用该正式接口，
  继续让官方服务负责关闭会话并清理会话数据。
- 发送、排队和插队由官方处理；不再注入自定义按钮、发送意图或自动 steer 请求。
  旧版精确 prompt ID 的实现及验收仅为历史，不恢复合成快捷键或重复操作。
- 浏览器不得访问通用 debug dispatcher。`/api/v1/debug` 及其子路径必须在代理层返回 404；
  launcher 不得为永久删除常态开启 `--debug-endpoints` 或维护另一个删除协议。
- 外部 `--target` 不支持官方正式删除接口时，必须显示清楚的错误，不能只从页面隐藏条目或误报成功。

## 注入层和功能归属

- `packages/launcher/src/officialPresentation.mjs` 是注入资源清单。新增独立 JS/CSS 时同时登记 `FILES` 与
  `SCRIPTS`/`STYLES`，并更新 `tests/it/launcher-official.it.test.mjs`。需要拦截官方启动请求的脚本
  必须排在官方 module script 之前。
- 优先把一个功能放在独立 JS/CSS 中。不要把无关逻辑继续堆进 `presentation.js`、`presentation.css` 或 `providerEnhancements.js`。
- `providerSorting.js` 只维护供应商表单中的视觉顺序，并把顺序交回官方表单保存；不能另建模型配置存储。鼠标和触摸都必须可用，拖拽不能打乱每行模型能力配置。
- `providerSave.js` 在增强表单点击保存时通知官方提交完整模型列表；挂载、异步目录加载和取消不得提前标脏。
  只处理同源、唯一可见且已就绪的增强表单，不接管独立 `.ap-import` 目录页或无模型的局部更新。
  模型行数或身份不匹配时返回本地失败响应，由官方显示中英原因；不得静默漏存、写后补 PUT 或回显凭证。
  已按保存配置渲染的行改名后须保存当前显示的选项，不能混入旧身份或预设的能力值。
  回归须覆盖准确官方预设的保存分流及后端回读，不能只自造带完整 models 的请求。
- `subagentPoolApi.js` 只按修改项合并官方候选与说明，保留思考档位、主模型和未修改候选，保存后重新 GET 核对。
  不通过清空重建实现删除，不用 `primary` 伪造继承。两套说明模板不自动删减池或分配模型角色。
  双端共用编辑器；桌面在实际子智能体段定位，2.6.1 位于“智能体与会话”，不是通用页。
  设置 tab 的 `style.display` 切换须触发定向更新；不得因流式聊天扫描设置或丢失正在编辑的草稿。
  原生弹层打开异常必须释放当前打开状态并在入口提示可重试；原生关闭事件须同步清理，不能留下无响应的入口。
- `desktopSessionView.js` 快捷按钮委托官方列表视图菜单，不重建列表或另写偏好存储，原排序入口保留。
  活动状态复用官方存储键；手机和没有原生视图菜单的项目管理页不挂载，不在聊天流式变化时扫描侧栏。
- `touchTooltip.js` 按实际触摸来源取消官方悬停提示，不按屏幕宽度禁用鼠标或键盘提示。
  复用官方 mouseout／mouseleave 清理计时和浮层，不删除 tooltip DOM、不修改 Vue 状态、ARIA 或主题颜色。
  在原输入事件完整派发后的 task 中清理；微任务可能早于浏览器后续 listener，回归须验证手指仍按住时也不弹出。
  不阻止滚动、点击、编辑和文字选择，不全页扫描或新增 MutationObserver；覆盖混合输入、滚动和页面离开。
- `navigationWorkspaceApi.js` 创建前读取官方工作空间列表，按根目录身份避免重复；新目录带稳定幂等键，失败不回退无键提交。
  Windows 形状路径比较大小写和分隔符，POSIX 保留大小写；不自动合并历史重复、符号链接或挂载别名。
  `navigationFolderApi.js` 只调用官方运行端目录浏览接口；选择仅填表，确认添加才登记，不创建会话、文件夹或信任。
  路径、目录列表和授权不另行持久化；关闭取消未完成的浏览，不能用手机本地目录选择冒充运行端文件树。
- `workspacePins.js` 只在当前浏览器保存经过校验的工作区 ID。不得把工作区名称、路径或会话内容写入 `localStorage`；置顶排序只影响展示。
- `archivedSessionDelete.js` 只增强已归档页中能与官方响应唯一对应的会话行。确认对话框必须包含会话标题
  并明确不可撤销；取消不发请求，重复点击只发一次，失败保留行并显示可读错误，成功后移除或刷新行。
  不得记录标题、ID、路径或把它们写入浏览器存储。
- 页面 Bearer token 只在当前运行内存中沿用，不写日志、不回显、不另行持久化。模型发现 endpoint 的 API Key 也遵守同一规则。
- `MutationObserver` 回调中的 DOM 增强必须幂等；文本、属性和顺序未变化时不重复写入。
  涉及观察器写入的回归必须验证真实 DOM mutation 会收敛，不能只靠空 `observe()` 的 fake DOM。
  无限回调的测试保护须在 observer 回调内部断开；外部 timer timeout 可能被微任务循环阻塞。

## 进程和运行时检查

- 拉取代码、切换提交或更新远端 `main` 不会热替换已经运行的 launcher 或 Kimi 后端。用户可见功能缺失时，
  先核对 `HEAD`/`origin/main`、进程启动时间、监听端口、首页是否注入目标资产、资产是否返回 200，
  再判断代码失效。
- 验证官方行为时使用仓库内明确命名的临时 `KIMI_CODE_HOME` 和虚构数据。不得读取、打印或截图用户真实会话、工作区路径、token 或账号信息。验证结束后停止自己启动的服务并删除自己的临时目录。
- 不随意终止无法确认归属的进程。只清理由当前任务启动，或已明确属于测试的 PID/端口。
- Windows 原生树清理使用固定系统 .NET Framework 编译器，临时编译和执行共用三秒预算，用完删除临时程序。
  保留 PID、创建时间和句柄归属校验；系统编译器缺失、启动失败或清理超时必须报未确认，不能追杀同名进程。

## 开发流程

### Clean Code

- 新增或修改的手写源码、测试、配置与文档，每行不得超过 130 个字符。
- 上游生成的契约快照、锁文件和第三方资源保持其生成格式；不得为满足行长限制手工改写生成内容。
- 优先通过拆分表达式、参数和段落控制行长，不使用禁用规则或压缩可读代码绕过限制。
- ESLint 忽略 `.tmp/`、`.cache/` 等临时或生成目录；这些目录不属于待交付源码。

1. 明确用户可见触发条件、期望结果、失败行为和版本边界。
2. 检查工作树、相关注入清单、当前官方 bundle/源码、运行进程及已有测试；先取得事实再改代码。
3. 选择最小职责层：视觉问题放独立 mobile 资源；同源安全边界放 launcher；持久数据变更调用官方后端。
4. 保留并行修改。共享清单只追加自己的资源，修改前重新读取最新文件。
5. 更新或新增能复现真实触发条件的定向测试。修复 API 版本问题时，测试必须使用真实 wire shape，而不是只验证自创 fixture。
6. 运行最少必要校验并记录结果。完成后检查 `git diff --check` 和 `git status --short`，清理临时进程与数据。
7. 除非任务明确要求，不提交、不推送、不发布。

README 保持简短：先放界面预览，再在“快速上手”里给两段系统安装命令及启动方法。
按用户追加要求，在根README快速上手直接展开源码安装命令，不放入折叠块，并与launcher README同步。
只留必要的增强功能概览、截图、升级和常见问题，不在“快速上手”外重复安装说明。
使用 humanizer-zh 优化文字，用动作说明用户能做什么，把压缩的术语展开为通俗句子，不为缩短篇幅堆砌名词。
详细命令链接到 launcher README，兼容细节到 UPSTREAM，历史和验收不堆在首页。
保留既有图片，新功能补真实界面图；新增 App 图须区分安装面板与实体安装结果，未发布功能明确标注。
`develop` 的未发布内容仅在确有必要时维护于 CHANGELOG 顶部，准备发布时整理成对应版本条目。

### KISS 分支模型

- `main` 始终保持可发布，是所有正式 tag 的唯一来源。
- `develop` 是日常集成分支。功能和修复在 `develop` 完成定向验证后合入 `main`。
- 只有改动较大、需要独立评审或会阻塞 `develop` 时，才创建短期 `feature/*` 或 `fix/*`；完成后及时合并并删除，不把它们当长期分支。
- 不设置长期 `release/*` 分支。发布直接从已验证的 `main` 打 tag；发布完成后把 `main` 同步回 `develop`，避免版本记录和修复漂移。
- 采用该模型不代表改写既有历史。不得为整理分支而 rebase/force-push 已共享历史；历史重写仍需明确授权。

## KISS 验证规则

- 优先运行受影响文件的 ESLint、对应单元测试，以及注入清单变化时的一份 `launcher-official` 集成测试。
- CI 中 UT 与 IT 的独立覆盖率报告均要求行覆盖率不低于 70%、分支覆盖率不低于 70%。覆盖率不足时优先补充失败路径、安全边界和真实分支的测试，不得降低门槛或用复制实现凑数。
- 完整 UT/IT、coverage、打包或安装冒烟只在跨层改动、发布准备、CI 故障复现或用户明确要求时运行。覆盖率不足时补有意义的测试或按既有规则排除由定向 UT 独占的文件；不得降低阈值。
- 不重复做浏览器 E2E、截图对比、整包安装、逐文件 SHA256 或没有新证据价值的相同测试。一次真实浏览器/临时服务验证足够时，做完即停。
- 测试必须覆盖实质风险。破坏性 UI 至少覆盖取消、确认成功、后端失败、重复点击和作用域限制；纯样式或可逆小改不为覆盖率机械复制实现。

## 发布前隐私与安全检查

提交、推送、发布包或部署前，对实际公开范围做一次有针对性的检查；相关内容没有变化时不重复扫描。

- 检查待提交 diff、发布文件清单、构建产物和将推送的提交历史，而不只看 `.gitignore`。
- 合并前从 `gh api user` 核对当前账号的 ID 和登录名。CLI squash 合并必须显式传 `--author-email`
  和该账号的 `ID+LOGIN@users.noreply.github.com`；不能确认身份或命令不支持时停止，不回退到默认邮箱。
- 合并后、打 tag 前再核验远端 main 的作者、提交者和提交正文。发现非匿名邮箱时停止发布；
  本地 Git 身份或 PR 检查通过都不能代替这一步。
- 检查 `.map`、`sourceMappingURL`、内联 sourcemap、`sourcesContent`/`sourceRoot`；默认不公开调试 sourcemap。
- 检查真实 `.env`、`.npmrc`、token、Cookie、API Key、私钥、证书容器、日志、备份和缓存。不得在命令输出或报告中复述疑似秘密。
- 检查真实用户名、个人绝对路径、内部地址、工作区名和敏感业务内容；示例使用相对路径、环境变量或通用占位符。
- 实际查看准备公开的截图、图片和录屏，核对地址栏、账号、路径、会话、模型/服务配置及相关元数据。
- 核对 npm `files`、静态服务范围和发布产物，不把隐藏配置、调试映射、缓存或备份带出。
- 已进入 Git 历史的敏感信息要区分“当前文件已清理”和“历史已重写”。只有明确授权才能重写历史或强推，并使用 `--force-with-lease`；真实凭证泄露时提醒撤销或轮换。

## 用户可见 Bug 事件复盘
每次修复用户已经遇到的 Bug 后，在任务报告、PR 描述或维护记录中使用下面的短模板。内容必须来自本次证据，不包含真实 token、私人会话、个人路径或不必要的内部信息。

```md
### 事件：<一句话描述用户可见问题>

- 影响：<谁在什么操作下看到了什么>
- 触发条件：<版本、模式、入口和必要前置条件>
- 根因：<代码原因；若包含旧进程/旧缓存，分别写清>
- 证据：<真实请求/DOM/状态码/进程时间等最小充分证据>
- 修复：<改动层和最终行为>
- 回归验证：<定向测试及一次必要的真实验证>
- 运维动作：<是否需要重启 launcher、清缓存、迁移或无需动作>
- 剩余边界：<未验证版本、外部 target 限制或无>
```

不要只写“已修复”。复盘必须能解释为什么原测试没发现、这次测试如何覆盖真实触发条件，以及用户是否需要重启正在运行的旧进程。
