# 图片完整预览与 tab 及时反馈修复、v2.1.1-r6 发布计划

开始时间：2026-10-07T16:18:37+0800。规划、执行、等待和恢复沿用同一起点。

## 已确认范围

- 用户要求修复图片预览灰块、发布，并追加 tab 点击不跟手：可以先切换，显示载入中和滚圈。
- 当前官方兼容基线仍为 Kimi Code 2.1.1；远端 main 为 e2477a8，r5 为已发布版本。
- 图片预览 readFile({path}) 默认只读 1 MiB，前端丢弃 truncated 后当作完整图片。
- Chrome 的虚构 2.69 MB PNG 已复现上部正常、下部透明棋盘；不能靠 decode 成功断定完整。
- 不修改官方压缩 bundle，不读取用户真实图片、会话或凭证；保留 r5 及其它不相关 Release 资产。
- 已核对 r1 Release 返回 404，r2–r4 的 assets 均为空；用户要求撤下的旧 tgz 已不再提供下载。

## 图片修复

1. 独立 `mobile/imagePreviewGuard.js` 在官方 module 前加载，使用现有 fetch 包装惯例，幂等安装。
2. 限定同源 POST `/api/v1/sessions/{id}/fs:read`、合法 JSON 路径且无显式 length/非零 offset。
   显式部分读取、文本、其它 API、第三方 URL 继续官方行为。
3. 默认读取仅在 base64 图片被截断时走官方 `fs/{逐段编码路径}:download` 下载完整数据。
   明确的图片扩展名遇 FS_TOO_LARGE(41302)时也可下载，仍由官方检查会话和文件权限。
4. 保持 Request/init 覆盖、鉴权、credentials、signal 和 receiver；不记录路径或 token、不持久化图片。
   下载拒绝重定向；校验 image MIME、原 size/content-length 和完整字节，最大 32 MiB。
5. 超限、非图片、下载失败、字节不全要明确失败，不能退回看似成功的截断图；取消继续传播。
   分块 base64 转换，正确返回官方 envelope 和 size/truncated=false。
6. 登记 officialPresentation FILES/SCRIPTS，UT 覆盖安全/失败/取消/Request/大文件/透传，IT 核对资产及顺序。

## tab 追加范围

- 官方真实 2.1.1 app 已用独立 Chrome profile、虚构 REST/WS 复现：慢文件 B→快 C 的首帧
  为约 7–17 ms，官方已先选中并显示文件 spinner；12000 行文件安装形成约 58–72 ms 主线程任务。
  增强 observer 单次仅约 1–2 ms，暂不据此改动现有 observer；会话 spinner 有官方 250 ms 延迟。
- 新增独立 `mobile/tabFeedback.js` 和 CSS，capture 仅观察侧栏会话行、手机会话选择、侧栏分类
  与右侧 panel tab 的真实语义入口；不改官方 active/aria、不吞 click、不重放、不使用 Vue 私有状态。
  pending 是临时交互反馈，不是另一套会话或文件内容状态；错误、关闭、路由离开和连点均须清理。
- pending 在当前内容区域显示轻量载入中和 spinner，使用官方 tokens，pointer-events:none，
  不 disabled、不改变 tab 尺寸，不覆盖可点击控件。官方 loading 出现后交回原生展示；缓存/内联
  无请求时最迟下一可见帧收尾，不把点击意图描述为已加载成功。
- 只对本次 pending 对应的同源 transcript / fs:read（及相关分类列表）fetch 响应交付增加
  rAF 后任务让步，使选中和 pending 有一次绘制机会；保持原 Response、鉴权、signal、receiver，
  不复制内容 loader 或修改 API 数据，后台/无关请求不变。隐藏页或无法绘制时有有界 fallback。
- 快速 A→B→C 只保留当前反馈；旧请求不清 C，内容竞态继续依赖官方 generation。真实同步
  cached/inline 重渲染没有公开外层 hook，单纯反馈不能保证消除其主线程阻塞；须实測并报告边界。
- 验收真实官方 DOM：1500 ms 慢 B、450 ms 快 C 可继续点；错误、关闭、连续点击及短/长内容。
  记录 click→rAF 后可见任务和截图中的 native selected/loading，目标非长任务场景 ≤100 ms。
  桌面 1440 与手机 390、原始浅/深色及五套受影响主题对照实图；UT覆盖反馈race/API透传，
  IT核对资源和module前顺序，不能以等价 fixture 或编译通过代替真实官方 app/paint 验收。
- 已完成真实官方 app 的 14 组桌面/手机及七套外观验收：网络路径 56 次目标点击可见绘制任务
  均有 selected/route 与 spinner，耗时 4.6–31.1 ms；慢 B 旧响应未覆盖 C，失败、连点关闭无残留。
  分类列表 500 ms 失败及 1500 ms 重试后切至 Workspaces，旧响应不改当前分类，反馈均收尾。
- 大内容边界已复现：约 2.1 MB 内联文本点击后可见任务 453.6 ms，主线程任务 186/266 ms；
  45 turn 缓存会话切换 152 ms，任务 89/61/63 ms。以上不满足 ≤100 ms，安全外层无公开 hook
  可以拆分官方同步渲染，故不宣称整体 tab 卡顿全部消除；本次未重写内容加载或优化已有 observer。
  测量为 click→rAF 后任务的绘制机会，结合 Chrome screencast 与实图，不当作系统显示延迟。
- tab UT 9 项和注入 IT 5 项通过；与图片 guard 合跑 88 项通过；完整 UT 55 文件/644 项、
  IT 6 文件/61 项通过。UT 行/分支覆盖率 85.80%/77.37%，IT 89.90%/77.02%，未改覆盖率配置。
  完整 ESLint、typecheck、130 列检查和 diff 检查通过；全脚本 observer 收敛测试已纳入新增资源。
  QA 证据归档在忽略目录 `.cache/tab-feedback-qa/`，所有会话、文件及账号展示均为虚构数据；
  自建 HTTP/WS、Chrome 进程和 profile 已清理，截图与报告仅作本地验收证据。

## 验证和发布

- 实际 r6 tgz 用隔离 HTTP 后端、真实 PNG 和 Chrome 复现官方 1 MiB 截断读取；比较修复前后底部 alpha。
- 覆盖小/大/透明图、窄屏/桌面、原尺寸/适应切换、失败状态，不隐藏正常透明棋盘。
- 全部 lint、typecheck、UT/IT及覆盖率门槛、test:pack，130列和 git diff --check。
- 同步 launcher/plugin/README/package README/UPSTREAM/CHANGELOG 为 r6，记录事件根因、验证和剩余边界。
- privacy-check 只审实际新 diff/新增历史/实际 tgz；不用用户截图作公开媒体。
- 已核对 develop 与 main 的文件相同，但 squash 历史使 develop 携带许多旧祖先及个人邮箱。
  使用从 origin/main 分出的短期 `fix/preview-tabs-r6` 提交本轮改动，避免再次公开无关旧历史；
  通过 PR 与 CI squash 合入受保护 main，main CI 通过后 tag main 并发布 tgz。
- 同步 develop，不强推、不绕过保护；先用标准 Git，TLS 故障才明确记录官方 API 路线。
- 回下载发布包逐字节比较，核对 latest/tag/main/资产；不撤 r5。
- 清理自建临时服务/浏览器/文件。升级须重启 launcher 并刷新页面，无需删数据或官方缓存。
