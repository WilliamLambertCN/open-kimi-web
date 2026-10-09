# 会话体积桌面补齐 v2

## 目标与边界

开始时间：2026-10-08 21:43:24 +08:00，恢复后沿用此起点，累计耗时包含等待和暂停。

用户要求电脑也显示现有会话 B / KB / MB 体积。复用现有只读接口、计量口径与鉴权，不新增统计服务。
沿用现有外观，只增加桌面显示；手机状态行不退步。实现阶段仅补功能与验证，未自动提交或发布。
用户于 2026-10-09 授权发布，按[手机列表与自更新计划](mobile-list-and-self-update-v1-plan.md)的 r8 发布范围一并交付。

## 已核对事实

- sessionSize.js 的 header/eligible/render 和 CSS 明确仅 mobile；既有 UT 还断言 desktop 不请求。
- 官方 2.1.1 desktop 是 `.app > .con > .chat-header`，单行 48px，没有 mobile `.st` 状态槽。
- header 中 `.ch-id` 包含工作区和有 `.ui-tip` 包装的标题，其后是 more、spacer、git、PR 和 toggles。
- 官方窄窗格已经用 container queries 收缩标题、隐藏部分控件；不能只按 viewport 判断窗格宽度。
- presentation.restoreDesktop 会移除 `.okw-workspace-status`，桌面必须使用独立体积节点。
- 零 turn 且不 loading 的桌面没有 ChatHeader，只有 `.empty-drag`，应为已存在 session 提供只读体积 fallback。

## 实现

1. 将本计划落盘 `docs/plans/session-size-desktop-v2-plan.md`，AGENTS 链接，作为 v1 的桌面扩展。
2. 修改 `packages/launcher/src/mobile/sessionSize.js`：
   - 手机继续挂 `.okw-workspace-status`；桌面仅主 pane 的 `.chat-header`，在 spacer 前挂独立体积 span。
   - 零 turn session 在原生 `.empty-drag` 中挂同类提示，不伪造官方 header，不改官方/Vue状态。
   - desktop 文案为 `会话 1.2 MB`，mobile 保留 ` · 会话 1.2 MB`；tooltip/aria 数据口径一致。
   - 移除手机专属刷新门槛，页面可见且当前适用主 header 存在时才刷新；panel-expanded 隐藏主 pane 不轮询。
   - 两种显示共用 current/request/timer；断点换 mount 清理旧节点，不建立第二计时器，不因流式正文刷新。
   - observer 识别主 header/con/app 插入与移除、嵌套替换；排除 Side Chat，并保证写入幂等收敛。
3. 修改 sessionSize.css：保留手机规则，新增精确桌面 scope 的 muted 小字号、不换行、不挤小按钮。
   沿用标题栏高度与官方 padding；空会话 fallback 预留 sidebar 和右开关区域。窄 pane 保留体积可读并让标题缩短。
4. 更新既有 sessionSizeUi.test.mjs 的真实 desktop fixture，不用 `.app.mobile` 冒充桌面：
   - B/KB/MB、loading/失败、切会话与迟到响应、隐藏停止刷新、单10秒计时器。
   - 640↔641 改变实际 DOM 后正确换挂载点；与 presentation.restoreDesktop 共存，旧节点不残留。
   - header/con/包裹app替换、空会话、header移除、SideChat/history流式更新无全局扫描或重复请求。
   - 标题、rename、tooltip、控件原层级不变；真实 MutationObserver 收敛。
5. README/launcher README 说明桌面补齐为未发布内容，不改 r7 历史宣称；不更改版本或后端。

## 验证和交付

- 定向 ESLint/sessionSize UI UT 与注入 IT；最终标准 lint/typecheck/UT/IT/pack 在交付内容上通过。
- 一次真实官方 2.1.1 app，隔离虚构 REST/WS/home，复用现有 ignored QA helper：
  desktop 1440/宽屏、长短标题、KB/MB、Original 浅深/Nocturne；右面板开/关及窄分栏、sidebar收起。
  390 手机控制、640↔641转换、空会话fallback、切换/loading/失败；断言无header/按钮重叠、无水平溢出。
- 与 baseline 只禁用目标sessionSize增强做必要截图比较；实际查看实图，记录header高度及控件可达。
- 不读取用户真实数据，QA只归档忽略.cache，finally关闭本轮Chrome树/launcher/API/WS并确认无残留。
- 检查diff/status，不处理既有.tmp。最终说明显示位置、真实验证、计量限制与尚未发布边界。

## 本地验收结果（2026-10-09，未发布）

- 标准 lint、typecheck、876 项 UT、77 项 IT、pack smoke 和 diff 检查通过，覆盖率门槛未降低。
- 当前 workspace launcher 服务完整官方 2.1.1 app，目标 JS/CSS 与本地源码一致；仅使用虚构 REST/WS/home。
- 1440 Original 浅色短标题/120 KB、深色长标题/1.5 MB，以及 2560 Nocturne 长标题完成目标增强开关对比。
  实际查看截图和原尺寸标题栏；正文、输入卡片、字体与基线一致，桌面标题栏仍为 48px。
- 侧栏收起、右面板开关、真实分栏拖到 422px 主窗格，体积与标题、more 按钮无重叠；可见控件可命中。
  实测长标题 tooltip、more 菜单及 rename 输入框可打开，取消 rename 不改标题。
- 零 turn 走官方 empty-drag 显示 0 B；切会话清旧值、迟到响应隔离、503 fallback 和真实 10 秒恢复通过。
  panel-expanded 实际隐藏主 pane 后，10.5 秒内请求计数不增加，定时器停止。
- 390 手机状态行保留；640→641→640 实际断点迁移无重复节点，始终至多一个 10 秒计时器。
- 最终浏览器恢复段 exit 0，44 项检查通过；复用此前已完成的外观矩阵和原生控件证据，不累加各轮数量。
  早期 helper 的换行比较和原生 selector 错误记录仍为失败；修正 helper 后补验，无产品源码额外修改。
- QA 归档于忽略的 `.cache/session-size-desktop-qa/`；Chrome 树、launcher、API/WS 和测试端口均已关闭。
- 未在真实手机、用户真实会话或外部 target 上验收；浏览器未实测 document hidden、展开面板后恢复按钮及 rename 保存。
  相关隐藏/恢复逻辑有 UT 覆盖，不能据此宣称所有原生交互均完成浏览器验证。当时源码尚未提交、推送或发布。
- 用户后续授权发布 r8；本项随该版本交付，发布步骤及 Windows／Ubuntu 标准链证据见
  [r8 发布验收记录](mobile-list-and-self-update-v1-plan.md#r8-发布验收记录2026-10-09)。
