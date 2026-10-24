# 工作空间路径修复、官方 2.3.1 适配与发布

开始时间：2026-10-24T14:50:33+08:00。计时包含调查、等待及后续发布，不重置。
用户明确要求修复双端直接路径添加工作空间，核对官方更新，一起适配并发布。
项目：open-kimi-web，当前 develop；保留已有未提交导航、cron、Hyper-V 等实现，不回退其它工作。
本计划由任务要求驱动，auto plan exit 不代表用户另行逐项审核。

## 已确认的事实

- 官方 2.3.1 tag 对应 commit `684bae9ea6a437f3bae98bba1dcb797a917d500b`。
- 官方文档 changelog 尚止于 2.3.0；2.3.1 更新以精确 GitHub Release／源码为准，不伪造文档条目。
- POST `/api/v1/workspaces` 的 `{root}` 与 code/data 响应未改变；注册已有目录不等于创建文件夹或授信。
- navigation.js 只让桌面打开共享直接路径表单，手机仍走原生先浏览／搜索文件夹的入口。
- navigationApi.js 仅 trim，未像原生一样去掉成对外层引号，Windows“复制为路径”会被判无效。
- 官方 2.3.1 新会话锁要求核对 cron debug 写入持久化，不直接加版本白名单；不关锁、不自动接管。
- 旧 Side Chat scrollTop 补丁与新版原生跳到底逻辑冲突，应按准确版本限定；常见图片已原生 download，SVG 仍需保留覆盖。

## 实施步骤

1. 在 AGENTS 链接本计划。新授权覆盖此前“本轮不发布”，不扩大到重启生产、删除旧包、覆盖用户安装或重写历史。
2. 修 `mobile/navigation.js`／`navigationApi.js`／必要的 `navigationWorkspace.js`：
   双端复用同一直接路径表单，保留 native 新会话节点和工作空间列表状态；提交前 trim 并去一对匹配引号。
   不按浏览器 OS 改写服务端路径，不自动 mkdir／授信，不切离当前会话或丢草稿。
   在现有 navigation 测试补双端真实动作、引号／空格／非法路径、取消、重复提交和失败回归。
3. 获取并核验准确 2.3.1 官方 npm／native 产物，隔离 HOME 使用，不读取真实配置、会话或 token。
   更新 officialBundle fallback、upstream.json、installer 精确版本／URL／SRI 和 network allowlist。
   已知 owned 2.1.1 保持严格归属验证后复用，不把合法旧安装误判 partial；未知归属继续拒绝，不自动升级或删除。
4. 完成受影响兼容适配：
   - 保留官方信任、占用／重试／接管、模型切换确认，不绕过。
   - 按版本停用 Side Chat 旧滚动干预；保留旧版兼容和残余图片边界。
   - 核对 cron 版本 gate、fork 清任务、journal shape；真实双实例验证新锁下 CRUD 的行为及持久化。
     若官方无可安全复用的原子管理边界，新增版本必须明确拒绝不安全写入并如实说明，不能假报成功或关闭保护。
     此风险先核验并记录，不偷改为模型代执行或新后端。
   - 核对手机子模型、归档恢复／删除、使用统计、会话体积和主题挂点，发现的实际问题最小修。
5. 一次必要的完整官方 2.3.1 页面验收，复用现有浏览器工具，修正 method-agnostic fixture：
   双端真实键盘／触摸输入并提交服务端路径，包含 Windows 引号／空格与 POSIX 输入、失败、列表更新和持久化。
   新目录选择后交由原生信任 UI 明确确认；占用和模型切换对话框不被增强层遮挡。
   桌面／320、390 手机、短长内容及受影响 Original／氛围主题实图和边界断言；定向 Side Chat 与媒体切换。
   使用隔离原版后端真实注册／恢复／锁场景，无付费模型；清理仅自有服务树和监听，不触碰生产 58627。
6. 将 launcher 升为 `2.3.1-r1`，同步 CHANGELOG、README、launcher README、UPSTREAM、AGENTS 和安装入口。
   标准 lint／typecheck／test:ut／test:it／test:pack；UT／IT 行与分支均保持 70% 门槛。
   沿用已完成旧版证据，不重复无变化的全矩阵；按真实结果记录边界和用户可见 bug 复盘。
7. 调用 privacy-check 检查精确待提交 diff、新增历史和实际 tgz／发布范围；不公开 .cache、.tmp、用户截图或 sourcemap。
   精确暂存目标文件，提交推送 develop，经 PR 和 required CI 正常进入 main，不绕过保护。
   只从已验 main 打新 tag 并发布新 tgz，保留旧 releases／tags；核验下载资产、精确版本和在线安装脚本来源。
   正常同步 main 回 develop；不自动升级用户的官方 CLI 或重启生产。

## 已验证的兼容决策（2026-10-24）

- 准确 npm 2.3.1／真实 metadata 与 tag peel 一致；tarball 18,665,962 bytes，实际 SHA-512 与 registry 一致。
- 25 个真实 workspace 请求确认裸路径／空格目录、幂等、非法路径拒绝、初始未授信及正常重启持久化。
  证据：`.cache/compat-231/workspace-qa-2026-10-24T07-11-47-698Z/results.json`。
- 50 个真实双后端同 home／sid 请求确认：正式 prompt 在别的后端持锁时返回 40931，
  debug cron add／remove／flush 却 code 0、先仅存内存；正常关闭 B 时又在 A 仍持锁时落盘。
  B 的 stale gate 返回 40932 后，直接 debug cron 仍能落盘。不将此误写为“关闭必丢失”。
  未找到同时保证 ownership／freshness／durable receipt 的原子管理入口。
  证据：`.cache/compat-231/cron-lock-qa-2026-10-24T07-16-27-340Z/results.json`。
- 因此精确 2.3.1 接入只读任务／历史；服务端在任何 debug mutation 前明确拒绝创建、删除，UI 显示原因。
  不提供“恢复并管理”动作，避免仅为只读面板唤醒冷会话；用户仍可主动打开原会话。
  2.1.1／2.2.0 既有已验写能力保留，未知版本拒绝；不关锁、不接管、不改日志、不用 AI CRUD 或新引擎。
  这是明确兼容限制，不将新版完整任务管理写成已完成，发布说明与最终报告必须告知。
- 安全审查发现 raw HTTP request-target 的 `#` 可能被官方路由视为分隔符，原策略只切 `?`。
  在解码前同时切原始 `?`／`#`，补 raw HTTP 不触上游断言；文件名 `%23` 不当作原始 fragment。
  该问题仍需有效鉴权，不是免认证漏洞；不为验收实际启用 RC relay。

## 阶段结果与未完成项

- 双端路径及错误、取消、重复、重开、abort 和真实 MutationObserver 收敛定向 5 文件／71 UT 通过。
  手机绑定原生第二个按钮、不克隆／搬动节点；POST fixture 按 method 返回单 workspace，不再误回 items。
- 实际 UI 版本传递、显式 pin、旧版兼容及官方资源定向 89 UT／5 asset IT、lint 通过。
  这些是源码／HTTP 阶段结果，完整官方 2.3.1 的浏览器交互与原生跳到底仍单独验收。
- 安装器当前 pin 与旧 owned 兼容定向 164 UT／73 network IT、lint 通过，准确 tarball 已独立核验。
  真实安装 IT 改为白名单工具环境、隔离 HOME／npm／git 配置，保留认证、不继承真实模型／代理凭据或关锁开关。
  本轮真实 npm 安装、PTY 及认证 Web 检查须以最终标准 IT 结果为准，尚未据静态 hash 宣称完成。
- raw HTTP 隔离修复阶段 87 UT／206 IT 通过；随后补充 `%23` 合法路径的非误拦断言，待最终标准套覆盖。
- 发布文档顶部两段系统在线命令已完成语法及成功／失败 mock 检查，同 SHA／版本传递正确、失败不执行。
  新 tag 尚未创建，不伪造 SHA；线上入口与 tgz 需发布后核验，不等同完整在线安装验收。
- 增量 diff／新源码／新计划的只读隐私审查未发现新凭据、个人路径、上报或持久化泄漏，fixture 不当作真实秘密。
  页面 bearer 仅在内存、固定同源请求；任务响应 no-store，错误不回传原生 stack 或原始消息。
- 本地 pack-audit tgz 检查 130 个文件、8,413,601 bytes，无配置、凭据、缓存、日志、测试或 sourcemap 混入。
  包内五张背景图与公开 HEAD 原字节一致，无新增媒体；准确官方 2.3.1 dist-web 无 map／sourceMappingURL。
  此包形成于最终标准门禁前，不能作为正式 Release 资产；产品或包文档后续变化只补查相关增量。
- 真实原版 2.3.1＋完整官方 app：桌面键盘／390 手机触摸通过 64 项断言和 3 张图；5 次提交覆盖双端成功、
  不存在目录、相对路径与普通文件拒绝，取消不发请求，保留路由及草稿；正常重启保留 workspace ID／信任状态。
  手机新目录通过原生信任弹窗明确确认；未创建缺失目录、无付费调用，自有 backend 正常退出且监听清零。
  证据：`.cache/compat-231/workspace-browser-qa-2026-10-24T07-33-37-985Z/results.json`。
- 同一真实 launcher 的 2.3.1 cron 补验 9 次调用：只读能力成立，创建／删除 409 且无出站 mutation；
  冷会话仍 cold、无恢复请求，wire 211 bytes 前后相同；raw `#` RC 拦截未触上游，也未启用实际 relay。
- 完整官方 app＋虚构 REST／WS 定向 252／252 功能断言、41 图，覆盖路径表单、原生 Side Chat、媒体与手机子模型。
  功能通过不等于全面视觉通过：实图发现 Nocturne 手机全屏预览透底、子模型提示仍写旧版本；只补验受影响修复。
  真实 Chrome 手机布局 grouped 列表还发现新增后身份遗漏与 locale 不一致：只观察 GET，原生创建后没有重拉列表；
  本轮补成功同源 POST 的单 workspace 身份投影和共享 locale 刷新，不改路径匹配、不新增请求或持久化路径。
  准确 2.3.1 的短路径算法未变，真实冲突继续 fail-closed；原生 DOM 节点不移动。
  定向 56／56 UT＋lint；真实原版后端定向分段共 94 个通过断言，320／390、Original／Nocturne、原生语言切换和草稿保持通过。
  driver 曾把原生 By workspace 写成 Group by workspace 而停止，39 个通过后修 driver 续验 55 项，未重复注册、原失败保留。
  父级已查看新增后中文 390、中文 320 夜幕及英文 320 原版图；自有进程／监听清零。
  证据：`.cache/compat-231/mobile-sort-fix-2026-10-24T07-51-22-928Z/`。
  跨客户端仅 WS 新增且尚无正式响应可旁观时仍禁用保存顺序，等待正式数据／刷新，不根据名称或顺序猜 ID。
- 标准 lint／typecheck／pack 通过；UT 93 文件／2016 项通过，Lines 92.17%／Branches 83.49%。
  首次并行 UT／IT／pack 时 4 项 IT 超过原 5 秒时限；不改代码、不放宽时限，先定向单 worker 58／58 通过，
  再独立运行标准 test:it，22 文件通过／1 文件跳过，552 项通过／2 项 Windows native POSIX 跳过，
  Lines 85.08%／Branches 72.07%，UT／IT 的 70% 门槛未改变。首次失败日志保留，不声称原因已完全确证。
  真实固定 npm 2.3.1 安装、CLI／PTY／鉴权 Web、owned 复用及损坏拒绝在标准 IT 通过；没有碰用户实际安装。
  日志：`.cache/compat-231/release-{lint,typecheck,ut,pack}.log`、`release-it-standalone.log`；
  首次失败 `release-it.log`，定向复现 `it-timeout-repro.log`。
- 最终只读安全增量复核未发现 P1／P2 或发布阻塞：精确版本双 gate、冷会话只投影、capabilities 失败清写权限、
  用户确认恢复边界与固定错误／内存 bearer 契约均从源码调用链复核；不把只读快照说成跨进程实时同步。
- 手机排序与预览／文案补丁落盘后，标准 UT 94 文件／2035 项通过，Lines 92.17%／Branches 83.49%；
  lint／typecheck、5 项 official asset IT 和 test:pack 通过。定向源码 diff／新增回归未发现凭据、个人路径或 sourcemap。
  日志：`.cache/compat-231/release-{lint,typecheck,ut,pack}-final.log`、`release-assets-final.log`。
- 手机预览仅为 `.global-preview.mobile` 添加 Canvas 不透明基底，不改主题 token、Original 或官方布局；
  子代理限制提示删除过时版本号，保留禁用 Save／零配置写入。定向 UT 76 项及 ESLint 通过，已由最终标准 UT 覆盖。
  完整 app 定向预览／文案分段 45＋18 项断言通过：390 Original／五氛围主题、320 Nocturne 长内容及中英文提示。
  红／绿底层对照中修后 header 零像素变化，旧背景 390 的 18,330 像素、320 的 15,040 像素全部变化；几何不变。
  初 run 在 45 项通过后遇 320 登录焦点竞态而整体未完成，保留 false；修 driver 同步后仅续未完成范围 18 项。
- 官方原生 trust／retry／takeover／模型确认定向 45／45 项、12 图通过，bare Original 390 对照 enhanced Nocturne 320／1280。
  显式 trust 3 次，受控 40931 prompt 6 次，takeover／config POST 均为零；按钮可达，危险提示、初始 Cancel 焦点保留。
- cron 定向 34／34 项、8 图通过：320 Nocturne 英文长内容与 1280 Original 中文短内容，冷保存记录及已加载内存快照。
  使用真实 launcher route／guard／inventory／projection／client 和隔离 wire／journal，未覆盖浏览器 API；
  额外 4 次合成增删全部 409 read-only-version，无 outcomeUnknown、debug mutation 或冷会话恢复，文件原字节不变。
- 父级实际查看预览、英文子模型、320 原生接管／模型确认、1280 中文冷任务及 320 英文详情六图；此前排序三图已查看。
  定向记录：`.cache/compat-231-ui/targeted-final-report.json`，失败／续验报告原样保留，不重复无变化的整套 UI／安装矩阵。
  31 个 QA run 有报告且收尾无失败，122 个自有端口零监听；未触生产，未发付费模型调用，不公开这些 QA 资源。
  虚构 40931 取消流程出现旧“任务完成”通知但未遮挡原生安全弹窗；真实后端未复现，未据此宣称新版回归或已修。
  实体手机／软键盘、真实云规则／cron 执行、其它平台及所有安装组合未全面验证；虚构协议 UI 不代替真实机制验收。
- [PR #29](https://github.com/WilliamLambertCN/open-kimi-web/pull/29) 的 required gate 通过后正常 squash 合入 main，
  发布提交为 `c9a3e0ce2a71037f510d794303e84ce6bed69209`，未绕过保护、强推或重写历史。
  [PR CI](https://github.com/WilliamLambertCN/open-kimi-web/actions/runs/40077694762) 与
  [main CI](https://github.com/WilliamLambertCN/open-kimi-web/actions/runs/40077853592) 均通过全部标准命令。
  main Ubuntu UT 94 文件／2010 通过＋25 平台跳过，Lines 91.97%／Branches 83.53%；
  IT 22 文件通过／1 跳过，532 项通过＋22 平台跳过，Lines 85.57%／Branches 72.97%，门槛未变。
- 从该准确 main 提交只打包一次正式 tgz：130 文件、8,413,567 bytes，源码／文档与 checkout 原字节一致；
  唯一 manifest 变换是 pnpm 移除 prepack／postpack，已按实际 pack 行为核对，其它字段完全一致。
  未发现凭据、个人路径、配置、日志、QA 截图、测试或 sourcemap；五背景 PNG 为既有公开原字节。
  正式检查：`.cache/compat-231/release/package-audit.json`；pack 流程法律文件副本已自动清理。
- [v2.3.1-r1 Release](https://github.com/WilliamLambertCN/open-kimi-web/releases/tag/v2.3.1-r1)
  于 2026-10-24T16:26:52+08:00 正式发布，非 draft／prerelease，设为 latest；不改任何旧 Release／tag／资产。
  [正式 tgz](https://github.com/WilliamLambertCN/open-kimi-web/releases/download/v2.3.1-r1/open-kimi-web-2.3.1-r1.tgz)
  已真实重新下载，与本地正式资产原字节相同，GitHub size／digest 一致。
  SHA-256：`219349fa92b0f3bb3b59d6283d32dfc76a9e30e419921700a665e75c5e8ec7a8`。
- 线上 tag commit API 确认上述 main SHA；五个在线入口／coordinator／官方 pin helpers 与同 SHA 本地内容一致，
  同 SHA 完整源码归档可下载，产品真实 latestRelease() 已识别 `2.3.1-r1` 及准确 tgz URL。
  证据：`.cache/compat-231/release/online-verification.json`，此为来源／字节验证，不冒充完整线上安装或实体手机测试。
  发布后证据为单独文档更新，不移动 tag、不重打或替换已发布 tgz；main 正常同步回 develop。
  历史 2.1.1／2.2.0 证据不代替新版；生产未重启，用户实际官方 CLI 未升级，旧资产未删除。

## 完成标准

- 双端通过实际输入路径即可注册运行端已有目录，真实后端持久化成功；原会话和草稿保留，信任不被绕过。
- 官方 2.3.1 更新有可核查来源；新版静态 UI／后端的实际验收与未验边界清楚。
- 标准门禁与 required CI 通过，正式新 Release／tgz 可下载且内容／隐私核验通过。
- 报告实际发布链接、修复原因、使用方式及剩余限制；任何阻塞不伪装成已发布。
