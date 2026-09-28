# 模型用量与 API 成本统计 v1 实施计划

状态：已完成实现、模型 ID 身份修正及多模型滚动验收，2026-09-28。
当前兼容基线为 Kimi Code 2.1.1。已有证据见
[用量统计 v1 验收记录](usage-statistics-v1-verification.md)。发布状态见 README 和 Git 提交记录。

## 目标与范围

在 Open Kimi Web 内提供独立的“使用统计”入口，作为 README 前排主打功能。
统计同一 Kimi 数据目录中已保存的 CLI、Web、Side Chat 和子 agent 用量。
历史统计以官方持久用量事件为依据，不建立另一套会话数据库，不保存聊天正文。

一期完整交付：

1. 自定义起止日期时间，以及 `1d`、`3d`、`1w`、`1m`、`2m`、`3m` 预设。
   按用户最新调整取消 1year；预设为最近 1、3、7、30、60、90 天。
   界面显示本地时区，自定义范围使用半开区间 `[from, to)`。
2. 分别统计普通输入、缓存读取、输出、缓存写入 token，并显示总输入与总 token。
3. 显示时间范围内各模型、整体的缓存命中率、模型分布和用量趋势。
4. 显示 API 等值费用；提供价格快照、在线刷新、持久化缓存、手动映射和四类单价覆盖。
5. 提供模型和工作区筛选、数据质量提示、未定价状态、加载/空数据/失败状态。
6. README 简介之后、版本变化之前展示功能说明及实际功能页的桌面和手机截图。

“写”按模型输出理解；“缓存写”指 prompt cache creation，不是文件写入或工具调用次数。

## 数据事实与计算口径

官方 `usage.record` 持久事件包含 `agentId`、`model`、`usage`、`usageScope` 和 epoch-ms `time`。
四类字段为 `inputOther`、`inputCacheRead`、`inputCacheCreation`、`output`。
每条事件是一次完成的 LLM 请求用量增量，不是需要再次差分的会话累计快照。
其中 `usage.record.model` 是别名；同一 wire 的持久 `llm.request.model` 才是当次发送给上游的模型 ID。
`llm.request.provider` 是协议，不能用来推断历史供应商或渠道。

```text
totalInput = inputOther + inputCacheRead + inputCacheCreation
totalTokens = totalInput + output
cacheHitRate = inputCacheRead / totalInput
estimatedCost = sum(each request's four token classes × applicable unit prices / 1,000,000)
```

总输入为零时命中率不可用。按 token 加权，不平均各请求的百分比。
阶梯价按单次请求的输入规模选择，不能拿整个时间区间的累计量触发高价档。
不存在价格且对应 token 非零时，该部分标为未定价，不能计为免费。

## 历史读取、去重与边界

- 受限服务端模块只读官方 `sessions/<workspace>/<session>/agents/<agent>/wire.jsonl`。
  只提取需要的用量数字、时间、请求模型 ID、辅助展示别名、工作区标识及去重元数据。
- 文件流式读取，限制单行大小；坏行、截断尾行、暂时不可读文件有可见质量计数。
- 统计物理用量事件，保留撤回、非活跃分支中已经产生的调用；不重复累计状态快照或子 agent 总结。
- fork 复制前缀不计为新调用。每个 agent wire 最后一个官方 fork marker 之后才是该 fork 的新增量。
  源会话已删除或来源不确定时显示质量提示，不用时间和 token 哈希猜测重复请求。
- 缓存字段零值可能来自供应商未报告；页面明确“按 Kimi 已记录的数据计算”。
  不能从四个归一化数字反推真实服务商缓存完整度。
- 按物理 wire 顺序关联同一 agent、别名和请求种类的 `llm.request` 与 `usage.record`。
  仅当候选请求的实际模型 ID 有效且一致时确认身份，消费后清除候选，不沿用上次 ID。
  缺失、损坏、超长、不完整请求或存在冲突时记为“模型 ID 未确认”；fork 边界清空关联状态。
  不用当前配置或最近一条请求猜测历史身份；重试和并发歧义必须有定向测试。
  多候选同 ID 的首条用量确认后，该别名保持未确认至可信的持久 `step.end`；不复用剩余候选。
  session/compaction 缺少等价结束边界，关联出现歧义后保守保持至 fork 或文件末尾。
- 同一模型 ID 的多个别名合并统计；同一别名改绑不同 ID 时分别统计、筛选和定价。
  未确认记录保留总 token，单独展示，不自动定价。别名只作为辅助信息。
- 按真实模型 ID 保存价格映射；ID 本身不证明调用渠道，渠道通过明确的价格目录选择确定。
  费用按当前单价估算，不能宣称恢复了历史渠道实际账单。
- 未落盘的失败/中断请求、已删除或损坏的历史不保证恢复；旧版本格式未经验证不能宣称完整支持。
- 提供可重建的按文件变更缓存，缓存只包含用量事实和必要索引，不缓存或导出聊天正文。

## 接入、安全与数据范围

- 本机受管后端使用实际传给 Kimi 的数据目录，来源由 launcher 启动参数决定。
  浏览器请求不得传入任意文件路径；不能默认把远程 target 映射成本机数据。
- `--target` 无法确认同一数据源时明确显示统计不可用及原因，不能显示本机数字冒充远端。
- 手机通过已认证的同源接口取汇总，不直接访问磁盘；默认仅本机处理用量数据。
- 统计与定价接口沿用页面 Bearer 授权并向目标后端验证，每次读取和写入均需授权。
  不记录 token，不在浏览器另存 token，不启用 debug endpoint。
- 不跟随越界符号链接；响应不暴露绝对路径、会话正文、凭证或原始配置。
  工作区只返回筛选所需的标识和安全展示名称。
- 价格联网只请求固定公开目录，不携带用户用量、模型配置、页面 token 或供应商凭证。
- `--web-dir` 继续不注入增强界面或开放专用 UI 功能。

## 价格与映射

- 内置精简的公开价格快照，标记来源、抓取日期、USD / 百万 token。
- 支持 models.dev 公开目录；OpenRouter 目录只用于 OpenRouter 渠道。
- 后台按缓存有效期刷新，并提供主动刷新。并发刷新去重；响应大小、超时、结构均受限。
- 失败保留最近成功快照，显示上次成功时间和错误；首次离线也能使用内置快照。
- 仅可确认的模型 ID 可映射到价格目录；渠道不明或匹配歧义时不静默套用其他渠道价格。
- 增加模型身份版本；旧的别名价格映射不能自动改解释为 ID 映射，保留公开目录但隔离旧映射并提示重选。
  旧映射经字段投影后保留在本地 `legacyAliasMappings`，不参与定价、不通过接口返回内容。
- 手动四类单价覆盖优先；允许显式零价，缺失价格和零价必须区分。
- 当前映射和覆盖保存于本机增强配置，不改动官方供应商/模型配置。
- 支持目录中可验证的上下文阶梯价；缺少缓存 TTL、特殊模态或其他计费维度时明确估算范围。
- 展示“按当前单价估算的 API 等值费用”，不宣称是订阅实际支出或完整服务商账单。

## UI 与 API 契约

- 官方侧栏新增独立“使用统计”按钮，打开可关闭的统计面板；不重建官方路由和会话状态。
  手机入口位于官方会话／工作区切换抽屉，避免依赖手机上被隐藏的桌面侧栏。
- 桌面为宽幅数据视图，手机为可读的纵向布局；继承官方浅/深色和已有五套主题语义变量。
- 顶部：时间预设、自定义起止、模型/工作区筛选、刷新。
- 概览：总 token、缓存命中率、API 等值费用及未定价提示。
- 图表：按时间的用量趋势、按模型的使用分布，提供读屏可用文本或表格等价信息。
- 明细：模型、四类 token、总量、命中率、供应商/单价和估算费用。
- 价格编辑：目录搜索、模型映射、四类单价编辑、保存、恢复目录价格、刷新状态。
- 模型较多时分布和明细完整可滚动，标题、关闭与筛选入口仍可到达；长 ID 换行且不撑宽页面。
  价格模型和公开目录支持搜索，列表不因固定截取而遗漏后部模型；验证滚轮、触摸和键盘访问。
  历史模型完整保留；公开目录超过 200 项时要求至少两个搜索字符，最多显示 200 个匹配并明确提示。
  任何目录项都能通过完整模型 ID 或目录键搜索到，不静默隐藏截取限制。
- 键盘可操作、可见焦点、Escape 关闭、焦点回到入口；异步响应不能覆盖更新的筛选结果。
- 接口前缀 `/__open-kimi-mobile/usage`；数据查询和价格配置分开，以下契约由实现双方共同使用。

### 一期内部接口契约

- `GET /__open-kimi-mobile/usage?from=<ms>&to=<ms>&model=<identity>&workspace=<id>&bucket=hour|day`
  的 `model`、`workspace` 可省略；服务端验证区间、字符串和 bucket，不接受文件路径。
- 成功数据形状：`{available, range, totals, models, buckets, modelOptions, workspaces, quality, pricing}`。
- `range` 为 `{from, to, bucket}`；`workspaces` 为 `{id, label}[]`。
- `modelOptions` 为 `{id, label, modelId}[]`；确认身份的 `id` 为 `model:<实际ID>`，
  未确认项为 `unresolved`，`modelId` 为 null；筛选传 `id`，不能把标签或别名当筛选键。
- 用量汇总字段统一为 `input`、`cacheRead`、`cacheWrite`、`output`、`totalInput`、`totalTokens`、
  `requests`、`cacheHitRate`、`costUsd`、`costComplete`、`unpricedRequests`、`unpricedTokens`。
  命中率为 0..1 或 null；费用为已知部分小计，无可定价部分时为 null。
- `models` 项为 `{id, model, modelId, aliases, ...汇总字段, price}`；`model` 用于展示真实 ID 或未确认标签。
  `aliases` 是辅助展示列表，不能用作分组或价格键；`buckets` 项为 `{time, ...汇总字段}`。
  `price` 给出 `{catalogKey, provider, modelId, source, rates, custom}` 或 null。
- `quality` 包含 `{notes, ...计数}`，notes 项为 `{code, message, count?}`，不包含路径或聊天数据。
- 不支持的数据源返回 `{available:false, reason, message}`，不能用空的成功统计掩盖不支持。
- `GET /__open-kimi-mobile/usage/pricing` 返回
  `{catalog, mappings, identityVersion, legacyMappingsIgnored, updatedAt, source, lastRefreshError}`。
- catalog 项为 `{key, providerId, providerName, modelId, name, rates, tiers?}`；
  rates 为 `{input, cacheRead, cacheWrite, output}`，单位 USD / 百万 token，缺价为 null。
  tiers 为 `{threshold, rates}[]`，以单次请求总输入超过 threshold 时选档。
- mappings 为按真实模型 ID 索引的 `{catalogKey, rates?}`；rates 手动覆盖可为空。
- `catalogKey` 可为 null，允许给目录中不存在的自定义模型直接填写四类单价。
- `PUT /__open-kimi-mobile/usage/pricing` 使用 `{model, catalogKey, rates?}` 保存映射/覆盖，
  或 `{model, remove:true}` 删除该模型 ID 的设置。`model` 传真实 ID，不传带前缀的筛选键。
  成功返回最新 pricing 数据；未确认模型不进入价格编辑列表。
- `POST /__open-kimi-mobile/usage/pricing:refresh` 主动刷新固定公开目录，返回最新 pricing 数据。
- `pricing` 摘要至少提供 `{updatedAt, source, lastRefreshError}`；失败使用可读 `{error}` JSON。
- 刷新未改变当前手动映射；所有接口都在验证页面授权后访问数据。

## 文件职责与工作方式

- 服务端统计、扫描、定价放入独立 `packages/launcher/src/usage/` 模块。
- 界面放独立 mobile JS/CSS，不修改现有问答卡片的未提交改动。
- 新资源登记 `officialPresentation.mjs` 清单并验证注入与安装包包含关系。
- 手写源码、测试、配置、文档单行不超过 130 字符。
- GPT-6 Sol / High 负责实现，主 agent 负责计划、接入审查、交互和视觉验收、README 与最终核验。
- 本任务授权功能实现与文档/截图，不自动发布新版本；提交、推送和 tag 另按用户明确指令执行。

## 验收矩阵

1. 真实官方 wire shape 的虚构 fixture：四类 token、边界时间、多模型、多工作区、多 agent。
2. fork、嵌套 fork、来源缺失、撤回/非活跃分支、重复刷新、追加/截断/删除文件及坏行。
3. 时间范围与筛选结果、按 token 加权命中率、未定价与显式零价、逐请求阶梯费用。
4. 价格目录解析、手动优先、持久化、刷新失败回退、并发刷新和大响应/超时/畸形数据。
5. 未授权请求、任意路径/符号链接越界、远端 target 隔离、无正文与凭证出现在 API/缓存。
6. 页面预设/自定义时间、筛选、刷新、映射与价格保存完整操作；空数据与失败恢复。
7. 对比官方基线；桌面/手机、长短内容、浅/深色及受影响主题实图和定向布局断言。
8. 一次完整 lint、typecheck、UT/IT 与覆盖率门槛；验证实际打包清单，不重复安装冒烟。
9. README 前排桌面/手机截图使用虚构数据，实际查看图片并检查公开文件、媒体和 sourcemap。
10. 最终检查实际 diff、遗留工作树改动、测试结果和运行进程；清理本任务临时脚本与服务子进程。
11. 模型身份：别名改绑分离、同 ID 多别名合并、缺失请求、重试、并发冲突、fork 及损坏行边界。
    旧别名价格不误用于新模型 ID；未确认模型仍计总量且不定价。
12. 使用至少 40 个模型及长 ID，在桌面和手机实际滚动到最后一项，完成后部模型筛选与价格编辑。

## 完成标准

全部一期功能可在隔离的官方 2.1.1 Web 环境实际操作；自动化用量结果有独立期望值。
README 的截图来自完成后的真实功能页。数据来源、估算口径和不可恢复边界在产品中清楚呈现。
用户原有未提交改动保持完整；无遗留测试服务、临时数据或凭证进入公开材料。
