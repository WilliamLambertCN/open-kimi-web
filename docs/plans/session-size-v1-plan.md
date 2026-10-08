# 当前会话体积提示 v1

## 目标与范围

在手机标题下现有“空闲 · 分支 · 5 个会话”状态行末尾增加“会话 123 KB / 1.2 MB”。
保持官方桌面布局与现有主题，不改正文图片大小，不修改官方 bundle。
本轮完成实现、测试、提交与推送，不发布新版本、不删除旧 tag。

## 数据口径

官方 2.1.1 的 GET session 返回 id、workspace_id，没有 bytes 字段。
官方持久目录是受管 home/sessions/workspace_id/session_id/agents/agent/wire.jsonl。
会话体积取该会话所有直接 agent 的 wire.jsonl 字节数之和，仅做目录查询与 lstat。
不读取、解析 wire，不调用全量用量扫描或导出，不计图片、附件、blobs、其他诊断日志。
提示明确：日志体积不是当前模型上下文 token 占用；上下文压缩不会让历史日志同比缩小。
无法确认或读取时显示“会话 —”，不以 0 B 伪装未知；真实空文件显示 0 B。
单位按 1024 进位，B/KB/MB/GB/TB，最多一位小数。

## 实施

1. `packages/launcher/src/sessionSize.mjs` 增加独立只读 endpoint 与计量服务。
   `serve.mjs` 注册，仅默认官方注入模式可达，复用受管 usageHome 边界。
   请求携页面 Bearer，由官方 GET `/api/v1/sessions/{id}` 验证授权并取得真实 workspace_id。
   校验单一路径段、session 响应 ID、路径层级、符号链接和文件类型；枚举有上限。
   错误不得返回磁盘路径、token 或私有内容；响应 no-store。
   外部 target 返回明确不可用；不接收浏览器提供的 home 或 workspace 路径。
2. 独立 `mobile/sessionSize.js` 与 `sessionSize.css`。
   沿用 usageApi 内存鉴权，有限节流，仅页面可见且手机状态栏存在时刷新。
   切换会话立即清除旧值，迟到响应不得写到新会话；隐藏页面停止周期请求。
   `presentation.js` 仅把现有状态文字放入独立摘要 span，保留新的体积子节点。
   既有状态/分支/会话数可省略截断，新增体积保持可读；不重绘正文、不扫描全文。
   观察器只响应相关顶部节点并幂等收敛。
3. `officialPresentation.mjs` 同步资源登记及加载顺序，更新注入 IT。
   README 说明功能和口径，AGENTS 链接本计划与功能边界；版本仍为 r6。

## 验证

- 现有 Vitest 增加只读计量与接口测试：空文件、含子代理、增长、缺失数据、鉴权失败、
  非法 ID、路径穿越、符号链接、非普通文件、外部 target、custom web 不注入。
- 前端回归：加载/失败、会话切换竞态、单位门槛、隐藏停止刷新、原状态保留、真实 MutationObserver 收敛。
- 一次真实官方 2.1.1 浏览器验收，使用隔离虚构服务与临时会话：
  320/390 手机、桌面原版基线、短/长标题与分支、KB/MB、original 浅深及 nocturne 主题。
  查看实图并断言体积可见、无水平溢出、既有状态不丢失，桌面无布局变化。
- 定向 ESLint/UT/注入 IT 先行；本次跨前后端，再运行标准 lint、typecheck、UT、IT 与 pack smoke。
  不降低覆盖率门槛。

## 追加：消息时间戳

用户追加要求补上消息时间戳，并查明何时消失；与本轮体积提示一并测试、推送。
官方 2.1.1 仍有用户和 assistant 时间组件，但冷历史可能缺少 startedAt，部分时间因此不显示。
第一条 turn 还可能使用官方 session 创建时间 fallback；增强不把该 fallback 视作可靠消息时间。
历史能确认的变化是官方 0.33.0 切换 code-app bundle 后，旧点击展开完整日期交互不再存在；
没有发现 Open 删除全部时间显示的提交，不把静态历史缺口推断冒充用户现场复现。

- 独立 `mobile/messageTimestamps.js/css`，继续使用官方语义节点、精确 data-turn-id 与正式接口时间。
- 不 clone、不修改响应值、bundle 或 Vue 私有状态，不增发 transcript 请求。
  官方 2.1.1 使用 Response.text()，文本原样交付后另一个 task 解析主会话元信息；
  只处理不超过 1,048,576 个 JavaScript 字符的响应，超限直接跳过，不扫描大正文。
  上限内仍有一次额外同步 JSON.parse 成本，不把延后执行称作零开销或耗时上限。
  Response.json() 路径复用官方解析对象，不再解析；只保留精确 ID 对应的时间元信息。
  官方切换先预载目标 transcript 再更新 URL；跨会话主快照绑定下一路由 generation，
  仍同时校验目标 session 和 generation，离开再返回不接收旧响应。
  只为主会话使用精确对应的 prompt.createdAt、turn/step.startedAt 和终态 endedAt。
- 正式 messages 接口也可能用 sessionCreatedAt 加消息序号合成时间，响应没有来源标记，因此不用于回补。
  不按消息文字、显示顺序、session 建立时间或 Date.now 推测消息时间；没有可靠数据时保留未知。
- 有可靠时间时补显示、完整日期 tooltip 和点击展开；未知时间不伪造，失败不阻碍聊天。
  保持已存在官方时间与流式结束时间语义，增强仅内存保存，不持久化会话内容或 ID。
- Side Chat 没有可确认 agent 身份的公开 DOM 标识，保留官方时间，不套用 main 的元信息。
  仅从实时 WS 到达而未出现在 transcript 快照中的消息保留官方紧凑时间，不承诺完整日期增强。
- 真实 MutationObserver 测试收敛、主/侧会话隔离、切换竞态、历史缺时间、原时间保留及点击恢复。
  补真实官方 app 历史/运行态、桌面/手机、主题实图和点击断言，完成后重新跑受影响标准检查。

## 交付

检查实际 diff、将公开文件和新增提交历史的隐私；只暂存本轮明确文件，不触碰既有未跟踪内容。
测试与实图验收全部通过后提交并正常推送 develop，核对远端提交与相关 CI。
不打 tag、不上传 tgz、不宣称已有 r6 包含新功能。
清理本轮启动的浏览器/服务；需要复核的 QA 归档于已有忽略目录。
最终报告推送分支/commit、测试结果、口径、重启 launcher 的要求与未发布版本边界。
