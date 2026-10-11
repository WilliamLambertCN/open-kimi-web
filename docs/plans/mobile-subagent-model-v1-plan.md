# 手机子代理模型与思考强度 v1

## 目标与范围

用户要求在手机端补齐子代理默认模型与思考强度选择，保留官方外观、桌面原入口和官方后端配置真相源。
同轮追加英文夹中文反馈，本计划增补受影响增强的系统文案与同 tab 语言刷新，不翻译用户内容、不新增请求。
本计划是当前实施基线，不声称用户已另行显式审阅；按已要求的实现继续，不等待额外批准。
与[一键安装扩展计划](one-click-install-v1-plan.md)同轮实施，早期只本地实现。
2026-10-12 用户已授权发布，按[收敛 r10 发布计划](one-click-install-r10-release-v1-plan.md) 执行，不重复既有验收。
不读取真实会话、账号或供应商秘密，不登录、不发付费模型调用、不重启生产服务。
原任务累计计时起点 2026-10-10 17:15:02 +08:00；本新增范围记录于 19:15:20 +08:00，不重置累计计时。

## 2026-10-11 增补：沿用主模型选择 UI

用户明确否定独立原生下拉框、编号与常驻长身份详情，要求沿用主模型选择 UI；本次按该要求修本地源码，
不提交、推送、发布或重启生产服务。派发子代理不指定 model 覆盖，遵循系统默认子代理模型。

1. 准确官方 2.1.1 的 ModelPicker 未导出，无公开 secondary 目标；不调用主模型写入再回滚，
   不用 Vue 私有实例或 patch bundle。复用官方语义结构、必要样式与 token，不伪造 data-v-*。
2. 替换现有 View／controller／CSS：紧凑 srow 摘要入口，独立 BottomSheet 风格选择界面，
   搜索、横向供应商 chips、两行模型列表及当前草稿勾选；去掉编号 SELECT 与常驻四行详情。
   同名模型用 provider／alias 辨认，完整身份按需查看；不渲染无效收藏，不自动弹手机键盘。
3. 思考使用官方分段外观；保持 Auto、全模型池兼容交集、最小 secondary_model POST、
   保存前重读、回读确认和无法清除独立模型的边界，不改变主模型或其它配置。
4. 保留草稿／取消／重复请求／竞态／错误／语言刷新与 observer 收敛；补 scrim／Escape／焦点、
   父 sheet 关闭和断点退出清理，不能点击穿透或误写主模型。
5. 更新既有 UT 与 real DOM observer 测试，完整官方 app 用虚构 REST／WS 验证实际保存／回读。
   对照原主模型、旧子模型、新子模型的实图，覆盖 320／390／640、短／长／同名、zh／en、
   Original light／dark 与五个受影响主题，641／桌面不注入；实际查看代表图。
6. 运行 lint／typecheck／标准 UT／IT／pack，保持覆盖率门槛；更新现有文档并清理自有 QA 进程。
   旧 native-select 视觉／计数记录仅是历史，不作为新选择器的验收。结果在取得真实证据后追加。

## 已核对事实与边界

- 准确官方 Kimi Code `2.1.1` 的 MobileSettingsSheet 不含 Subagent 字段。
- 普通官方 Web 没有已证实的完整 Settings 公开打开动作；不能假造动作或访问 Vue 私有组件实例。
- 最小独立手机控件已本地实现，使用官方 GET config／models 与 POST `/api/v1/config`。
- 只提交 `secondary_model`，按官方行为处理 `defaultModel`、`defaultEffort` 与 models 池合并。
  不写主模型、权限或其它配置，不把模型配置另存 localStorage，不复制后端配置状态真相源。
- 思考强度 Auto 可合法提交 `defaultEffort: ''`，含义是按全局思考设置／模型默认，不等于清除独立模型。
- 未配置独立模型时继承调用者；已配置模型没有通过当前 API 恢复跟随主模型的能力。
  空模型或 null 不合法，merge 省略字段不清除；UI 必须明确此限制，不伪造成功或提交无效清除请求。
- 本地尚未发布；此前 r9 验收和安装脚本测试不代表本手机控件或新 config 请求路径已验收。

## 实施与当前状态

1. 已核对准确官方 `2.1.1` 的模型／思考协议和清除边界；继续以官方返回配置作为唯一真相源。
   未知字段、协议失败与保存结果不匹配须明确报错；Auto 与模型恢复跟随分别处理。
2. 独立 API／View／控件和 CSS 已实现并在 `packages/launcher/src/officialPresentation.mjs` 登记：
   `packages/launcher/src/mobile/mobileSubagentModelApi.js`、`mobileSubagentModelView.js`、
   `mobileSubagentModel.js`、`mobileSubagentModel.css`。
   仅增强官方手机设置区域，保持桌面入口、原始布局、主题和 `--web-dir` 不注入边界。
3. 控件读取当前官方配置和可选模型，支持默认子代理模型与思考强度；不能通过 API 清除已配置模型。
   2026-10-11 已替换为主模型风格的独立底部面板、搜索、供应商 chips、两行模型列表与草稿勾选。
   完整供应商、别名、上游模型 ID 按需展开；保存使用完整 alias，而非显示名或省略后的标签。
   原生 optgroup、编号和常驻四行详情已移除，下方相关测试／截图仅保留为历史证据。
4. 保存前核对最新配置，最小 POST 只包含 `secondary_model`；合并保留其它已有模型池项。
   保存后核对官方返回配置，验收另用 GET 回读；不能只因本地选项改变就显示已保存。
5. 已实现加载、空列表、失败、保存与取消反馈、重复保存保护、过期响应隔离和 DOM 幂等增强。
   新面板增加 scrim／Escape／焦点隔离、触摸不自动弹键盘和父面板／断点退出清理；修后完整 app 199／199 断言通过。
   Auto／On、关闭／重开、真实请求、桌面边界与 mutation 已复验；旧 focused 仅为历史，具体新证据见末节。
6. 文档按“已实现／阶段验证／阻塞／未验证”分别记录，不把新控件写成已发布。
   此前 final3 计数见[安装计划](one-click-install-v1-plan.md)；本次替换后的标准检查与视觉证据另行记录。

## 验证与验收

- 现有测试体系内补定向 UT／IT：真实官方请求形状、只改 secondary_model、池保留、Auto 与模型清除拒绝、
  加载／空列表、保存／回读、取消无写入、失败、重复保存、请求竞态、键盘／触摸、DOM mutation 收敛和注入清单。
- 使用准确官方 `2.1.1` 完整 app 与虚构 API，实际执行 GET／POST／回读／取消／错误路径，
  不用简化自造 settings DOM 代替完整 app 的入口与布局验收。
- 以官方未增强版为 baseline，对比增强后的手机 320／390／640 宽度、短／长模型名、语言和受影响主题。
  检查底部面板、搜索／筛选／列表的裁切、同名可辨识性、操作可达性、对齐与保存反馈；桌面原入口和布局不退步。
- 实际查看代表截图，保留必要定向断言；编译和 UT 通过不能替代视觉验收。
  不使用用户截图、真实会话、真实模型服务配置或 token 链接作为公开证据。
- 运行受影响文件 lint、typecheck、定向 UT／IT、launcher-official 注入检查；按本轮跨层变更运行标准
  UT／IT／test:pack，行与分支 coverage 继续要求不低于 70%，不降低门槛或凭排除新增代码过关。
- 不新增无关依赖、测试框架或持久配置存储；清理自己启动的测试进程和临时资源，保留既有 `.tmp/`。
- 最新源码的真实日志／截图／请求证据完成后追加；不预填全项目最终通过结论。

## 执行记录：2026-10-10 早期阶段证据（历史）

以下保留早期发现与失败；供应商／长菜单／Auto 的后续关闭证据见下一节，不将旧七主题矩阵冒充最新全量重跑。

- 计划和 AGENTS 链接已建立；实现按独立 API／View／控件／CSS 落地，当前仍未发布。
- 父级报告：初始定向 34 项 UT 通过；审查后修正 Auto 的合法空 effort 语义，40 项 UT 通过。
  这是阶段定向结果，不是最终标准测试总数或最新视觉修复结果。
- 已读取 `.cache/mobile-subagent-qa/acceptance-report.json`：完整官方 app 与虚构 REST／WS 的 baseline
  13 项断言通过；full 执行了 98 项通过断言，但 harness 在 viewport 恢复后重复打开已开 sheet，**full 命令失败**。
  补充 interactions 51 项通过，不描述为第二次独立 full 全通过。
- 捕获版本验证仅提交 secondary_model、池与主模型等保留、取消／Escape 无 POST、失败保留草稿、
  保存后 GET 回读、桌面原 Settings 读取手机保存值、竞态与真实 MutationObserver 收敛。
  七个外观样例覆盖 320／390／640、短／长、中文／英文、Original light／dark 与五个氛围主题。
- QA 实图发现缺供应商标识／分组，以及 390 宽原生长菜单越界且同前缀选项无法区分；页面无横向溢出不能关闭此问题。
  当时修复与父级代表实图检查尚未完成，后续结果见下一节。
- 捕获后 API／View 已变更 Auto／On 行为；旧“不能清除 effort”断言只属于旧版本，已不适用于当前实现。
  当时最新行为需补验；实体手机、软键盘、真实后端磁盘持久化与模型调用仍未验证。
- 文档任务仅读取报告，不重跑浏览器或产品测试；全套标准检查、覆盖率与 pack 由父级最终复跑后另记。

## 执行记录：2026-10-10 最新 focused 验证通过

- 已读取 `.cache/mobile-subagent-qa/final-acceptance-report.json`：准确官方 2.1.1 完整 app、实际 launcher 注入资源，
  虚构 stateful REST／WS 的 focused 命令通过，108 项断言／28 图、无问题或页面异常；资源字节在本次执行和 QA 复核未变。
  父级另报告当时 44 项定向 UT 通过，不计入 browser 108，也不作为全项目最终总数。
- 最小矩阵为 390 Nocturne dark 中文长名称、320 Original dark 英文碰撞名称、390 Aurora dark 英文同碰撞样例。
  原生 SELECT 保留供应商分组，供应商／模型编号区分同名、同紧凑别名；320／390 模型与 effort 弹出菜单横向有界。
  紧凑 label 后另有四行完整身份详情，换行无裁切，触摸／键盘选择完整 value、不同碰撞别名分别保存并 GET 回读。
- 显式 effort 恢复 Auto：Save 可用，明确 POST `defaultEffort: ''`、GET／重开空值；短 Auto 标签配持续完整语义说明。
  heterogeneous low-only／high-only 全池支持 Auto／Off／On，On 保存回读；加入 always-thinking 池成员后移除 Off。
  已配置模型清除仍明确限制、禁 Save 且无 POST；未配置模型继承调用者正常。
- 所有保存只改 secondary_model，原池、其它选项和主模型／provider／thinking 保留；取消／Escape 无写入，
  失败保留草稿／旧保存值，held 请求及 640／641／390 切换不应用过期值；真实 observer 收敛。
  1280 桌面原布局不变、641 以上不出现新手机控件，原生 Settings 回读手机保存的模型／Medium。
- QA 已实际检查菜单、详情、Auto、失败／限制、全池思考与桌面图；父级最新确认查看代表
  320 英文菜单、390 中文身份详情和 Auto 草稿图，补齐报告生成时尚待的父级实图检查。
- focused 关闭早期供应商标识、长菜单与 effort-reset 错误预期，不表示当前七主题全部重跑或实体设备验收。
  320 Original baseline 的既有 thinking 标签重叠／appearance 裁切不归因于本新增控件。
  测试进程／监听已清理，必要虚构 profiles、报告与图片归档 ignored QA 目录。
- 当时用户新增英文界面夹中文反馈，独立 i18n 尚待修复；本 focused 不覆盖随后改动或子代理同 tab 动态切语言。
  最新 i18n 的实现与动态验收见下方；标准门禁已通过，详见[安装计划](one-click-install-v1-plan.md) final3 记录。

## 同轮请求增补：英文界面系统文案与语言切换

用户要求英文界面不夹中文系统文案；在本计划增补主题、presentation、session、usage、provider 等受影响增强范围，
不新建巨大计划或声称用户另行确认最终计划。模型／供应商名、会话及工作区等用户内容不翻译，保留官方语言设置真相源。
修复必须覆盖 visible text、title、aria、placeholder；同 tab 官方切语言时更新已挂载系统文案，保留草稿、输入与勾选状态，
不重新请求配置／模型／usage 或写入配置。共享 observer 要收敛，桌面／手机及受影响主题不退步。

## 执行记录：2026-10-10 i18n 实现与定向验收

- 已读取 `locale.js`、`usageLocale.js`、`providerLocale.js` 与 `officialPresentation.mjs`：locale helpers 先于增强脚本注入，
  共享语言读取官方 `kimi-locale` 的 zh／en，缺失时按 navigator fallback，不以 document 根 lang 代替官方状态。
  DOM／storage 观察只在语言变化时通知；usage／provider 按已绑定节点刷新，不替换用户输入节点或篡改中文用户内容。
- 根因是主题固定双语标签、此前依据根 lang 而与官方 kimi-locale 不同、已挂载文案不随同 tab 切换刷新，
  以及 usage 系统文案仅中文。已补 themes／presentation／sessionSize／messageTimestamps／tabFeedback／workspacePins、
  usage 与 provider 等增强的当前英文系统 text／title／aria／placeholder；本次覆盖范围为单语言英文，用户中文名保留。
- 已读取 `.cache/locale-qa/run-2026-10-10T13-17-43-981Z/report.json`：准确官方 2.1.1 完整 app、虚构 REST／WS，
  实际 usage scanner 只读生成的虚构 wire；主矩阵 41 断言／25 图全通过，先以旧资源复现主题混中文再对比新资源。
  覆盖 320 Original 短名称／390 Nocturne 长名称与 1360 桌面短／长、其它四套主题 390 英文，popup／usage 面板有界。
  同 tab 原生 zh→en／en→zh 无 reload／storageevent，已挂载 theme／session／usage 文案刷新，保留输入节点和值，
  语言变化前后后端请求数相同，真实 MutationObserver 收敛；父级已查看 320 Original／390 Nocturne 英文主题代表图。
- 已读取 `.cache/locale-qa/provider-2026-10-10T13-22-26-607Z/report.json`：provider 补充 2 断言／1 图通过，
  桌面原生 provider 控件切语言后无中文系统文案、同一 checkbox 节点与未勾选状态保留，无 reload／storageevent／refetch。
  两份报告无 problems，测试进程与监听清理；Chrome emulation 不替代实体设备，不修改官方资产或 Vue 私有状态。
- 父级报告 scoped lint／typecheck、13 文件／176 项定向 UT 和 5 项 asset IT 通过；这是阶段结果，不是全项目最终总数。
  子代理动态语言的新证据见下一节；最新标准 counts／coverage／pack 集中见安装计划 final3，改动仍未发布。

## 执行记录：2026-10-10 子代理同 tab 动态语言补验

- 父级确认控件以最小共享 `locale.observe`／`locale.current` 刷新字段 labels、标准 efforts，保留已挂载草稿节点。
  最新 46 项子代理 UT 通过，覆盖无 storageevent、stale html.lang 与 sheet 外 mutation；final3 UT 日志核实三文件 20／20／6 项。
- 已读取 `.cache/locale-qa/subagent-lang-2026-10-10T13-44-07-907Z/report.json`：准确官方 2.1.1 完整 app、
  虚构 stateful REST／WS，390px Chrome touch emulation，长中文身份与 catalog-only 缺供应商模型。
  同 tab 真实官方语言按钮原生六次 zh→en／en→zh，无 reload／storageevent；44 断言中 38 通过、3 图，整体 passed=false。
- 通过项包括挂载 section／editor／model／effort 节点身份与失败草稿保留、错误／hint／title／aria／options 单语言，
  中文用户完整身份保留、缺供应商／Follow sentinel 英文；标准 Auto／Off／On／Low／Medium／High 的底层 values 不变。
  切语言无额外 GET／POST，成功最小 secondary_model POST aliasB＋Auto 并 GET 回读，主模型／thinking／原池保留；
  保存后 disabled、Follow 限制与无无效写入、横向边界与真实 MutationObserver 收敛均通过。
- 6 项失败均为 harness strict 绝对 scrollTop 相等断言：sheet 每次 ±22px，editor scroll 仍为 0，focus 节点不变，
  可视 section anchor 变化 <0.6px；报告同时记录中英文说明高度变化。用户未要求绝对 scrollTop 数值不变，
  因而不直接判为 i18n 失败，六项 strict 断言未通过的原报告保留；裸官方与可视 anchor 对照见下方记录。
- 父级已查看 `english-error-draft.png` 与 `english-unknown-provider.png`，系统英文与用户中文保留；不声称三图都已由父级查看。
  报告 cleanup clean=true，进程／监听无遗留；原 core focused 108 不替代动态验收，不声称全 44 green、实体手机或全英文覆盖。

## 执行记录：2026-10-10 语言切换视觉锚定对照

- 准确官方 2.1.1 裸页面与当前增强版、390×844、虚构 REST／WS，使用原生语言按钮各完成 zh→en→zh。
  `.cache/locale-qa/subagent-anchor-2026-10-10T13-53-12-078Z/report.json`：21／21 断言通过、6 张实图。
- 裸官方 sheet scrollTop 不变，但语言按钮可视位置移动约 39.19px；增强版 sheet 补偿约 22px，
  子代理 section／model／effort／details 的可视位置移动不到 0.6px，语言按钮移动约 18.58px。
  翻译换行改变内容高度，不要求绝对 scrollTop 相等；不能声称所有控件均保持在 2px 内。
- 子代理内容视觉锚定及语言控件相对裸官方不增加位移的针对性断言通过，无需为数值补偿添加产品补丁。
  四次语言点击为 trusted，零新增请求／配置写入，无 reload／storageevent，草稿及节点身份保留。
- 原 44 项中的 6 项 strict scrollTop 失败未改成绿色；首轮 20／21 的配置写入计数误纳官方 fs:git_status，
  仅修正 QA 过滤为 /api/v1/config 后完成补验。没有修改产品，最终标准 final3 结果仍适用。
- QA 实际查看六张图，进程／监听清理通过；浏览器验证的是被点击的语言按钮焦点，
  不扩大为 model select 焦点、实体手机或真实磁盘持久化验收。

## 执行记录：2026-10-11 主模型风格替换与视觉修正

- 独立 View／controller／CSS 已替换为官方主模型的底部面板、搜索、供应商 chips、两行模型列表与草稿勾选，
  思考使用官方 Settings 分段外观，完整身份默认折叠；不调用未导出的 Vue 组件，不写主模型再回滚。
- `.cache/mobile-subagent-picker-qa/` 归档准确官方 2.1.1 完整 app、真实 launcher 和虚构 stateful REST／WS 证据。
  官方主选择器与旧 editor 基线 44／44 断言、15 图通过；旧 SELECT 图只用于对比，不是新控件验收。
- 新 UI 首次完整可用运行 162／171 断言、29 图，exit 1：七个分段密度失败、一个同供应商同名长 alias 不可辨认，
  另一个键盘假阴性来自 QA 在导航重置采样后才读取事件。原报告未改绿；修正采样后交互定向 66／66、6 图通过。
  父级已查看 320px 同供应商碰撞及展开详情两图，确认可见身份问题，未仅凭 title／aria 判为修复。
- 已修两项产品问题：碰撞组从真实 alias 计算前置唯一差异片段，完整身份仍保留在 title／aria／详情及保存值；
  思考按钮按准确官方 computed 对齐 24px 高、12.5px 字号、左右 4px、weight 400、Inter stack 与 item gap 4px。
  修后 3 文件／64 项定向 UT 通过，包含中间／末尾／前后缀关系、Unicode、过滤稳定与语言 observer 回归。
  定向 UT 与标准检查不替代视觉验收；完整 app 修后结果见下方。
- 修正后的标准命令均 exit 0：`corepack pnpm lint`、`typecheck`、`test:ut`、`test:it`、`test:pack`。
  UT 79 文件／1430 项通过，Lines 88.77%／Branch 80.21%；IT 19 文件通过／1 文件跳过，308 项通过／2 项跳过，
  Lines 84.94%／Branch 71.07%，70% 门槛不变；Windows native POSIX 跳过不算平台验收。
  对应日志为该 QA 目录的 `final-{lint,typecheck,ut,it,pack}.log`；pack 为本地 r9 清单、版本、custom-page 与 API 冒烟，
  不等于新 UI 的交付包浏览器矩阵、发布或安装器完整跨平台验收。
- 此前标准首次并行 UT 抽中 fetch 禁止端口、IT npm-config 5000ms 超时；单独 IT 又遇 owned child 清理时序失败。
  原 `ut.log`／`it.log`／`it-final.log` 保留，相关 5 项定向及后续两次标准 IT 均通过；未为绿色修改无关产品／tests。
  父级限定测试 fixture 前缀检查 node 进程，无残留，不清理其它服务或生产进程。

## 执行记录：2026-10-11 修正后完整 app 复验通过

- `.cache/mobile-subagent-picker-qa/followup-acceptance-report.json` 与对应 `run-followup-2026-10-11T00-15-49-202Z/report.json`
  已核对：`node .cache/mobile-subagent-picker-qa/harness.mjs --execute --followup` exit 0，199／199 断言、23 图、零页面异常。
  复用准确官方归档测量，不重复跑基线；一次完整交互序列，原 162／171 失败报告不改写成 green，计数不与旧报告相加。
- 320px 同供应商同名长 alias 的 `…A／…B` 在选择前可见；中间差异、prefix／suffix 关系和三项碰撞组亦可辨认，
  精确 alias 搜索后片段不变。Unicode grapheme 保留，但 12px 人物细节较小，不扩大为实体手机可读性保证。
  七外观样例覆盖 Original light／dark 与五主题、320／390／640、短／长／同名、zh／en，分段 computed 全部匹配官方。
  search／chips／两行密度、16px inset、sheet 边界与底部操作可达均通过；641／1280 不注入且布局对照不变。
- 7 个真实 fixture config POST 全部仅 `secondary_model`，6 个成功含两个 held 完成、1 个故意后端失败。
  同供应商碰撞 B 使用完整长 alias＋Medium 保存，GET／重开确认，不提交显示差异片段；池和其它配置保留。
  Auto 明确提交空值、全池 On、最新模型池重读拒绝无效 effort 而不 POST、失败保留草稿及重复请求保护通过。
- Cancel／Escape／scrim／grab、Tab 隔离、精确 inert／aria-hidden 恢复、普通输入键、held load／POST、
  Escape 后立即重开及断点清理通过；真实 observer 收敛。mounted locale 用虚构 profile 的 kimi-locale＋DOM mutation，
  保留草稿／焦点／节点且无新增请求，不冒充底层已 inert 的原生语言按钮 trusted 点击。
- QA 实际查看 17 张原图及 Unicode 局部图；父级实际查看七张代表图：320 同供应商碰撞及展开详情、middle、
  prefix、multiple peers，320 Original light 短名称、640 Twilight 长名称，确认差异、密度和操作可达。
  所有实图／虚构 profile／报告集中归档 ignored QA 目录，不公开用户截图、真实会话或供应商配置。
- 四个注入资源与当前源码字节一致；自有八个 Chrome 子树、24 个端口及 WS 重新检查均无残留。
  产品／正式 tests 未被 QA 修改，生产服务未碰；仍未提交、推送、发布或重启生产。
  Chrome 模拟不等于实体手机／OS 软键盘；虚构 REST／WS 不等于真实磁盘持久化或模型实际调用。

### 事件：手机子模型独立表单不沿用主模型选择器

- 影响：手机配置子代理模型时，编号下拉框和常驻长详情冗长，与主模型 UI 不一致。
- 触发条件：本地未发布的手机控件；长同名 alias 还会在改造初版两行列表中被相同省略前缀遮蔽。
- 根因：首次实现单独表单，没有以主选择器密度作验收基线；后来复用列表只保留完整 title，没验证触摸选择前可见差异。
- 证据：准确官方完整 app／320 实图确认相同 ellipsis；七分段 computed 不同，原 162／171 失败报告保留。
- 修复：底部面板／搜索／供应商 chips／两行模型勾选，思考对齐原版；碰撞身份前置真实差异，完整详情默认折叠。
- 回归验证：64 定向 UT，七外观样例完整 app 199／199 断言、23 图，父级查看七张代表图；标准检查与打包冒烟通过。
- 运维动作：本轮未重启或发布；部署这版源码后需重启旧 launcher 并刷新页面，不需清官方会话缓存或迁移数据。
- 剩余边界：官方组件未公开导出，复用结构／样式而非同一 Vue 实例；实体手机、软键盘及真实磁盘持久化未验证。
