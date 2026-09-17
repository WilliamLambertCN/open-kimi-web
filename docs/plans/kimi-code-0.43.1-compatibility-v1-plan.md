# Kimi Code 0.43.1 兼容整改计划 v1

## 状态

- 实施状态：已完成；发布版本定义为 `0.43.1-r1`，对应 tag 为 `v0.43.1-r1`。
- 发布验收：正式 tag 只能从通过 required gates 的 `main` 创建，并以本计划的验收标准为准。
- 兼容边界：完整协议快照仍为 `0.41.0` 历史记录，`0.43.1` 结论来自发布包静态审计。
- 验证边界：尚未完成真实浏览器 click-through 或 live protocol recapture，不登记为 live tested。

## 已核对基线

- 官方包：`@moonshot-ai/kimi-code@0.43.1`。
- npm provenance commit：`75ac010bcb2050338444455de8328492d152c919`。
- npm integrity：
  `sha512-jq60K07tJV+uZB/mTN7rgb99WU5z6PtUeLybywGhXpF5QybaehIWsWudZ9HR8hEEmc7pppB+GAA92RDqOOKnRg==`。
- `index.html` 仍使用 `<title>Kimi Code Web</title>`。
- 运行时标题组合器仍生成 `` `${workspace} | Kimi Code` ``，静态补丁实测唯一命中一次。
- `.archive-*`、`.dock-approval`、`.dock-question` 和 `kimi-locale` 等现有稳定选择器保持可用。
- v2 已归档列表 wire shape 与 v1 fallback 保持；正式删除接口仍为
  `POST /api/v1/sessions/{session_id}:delete`，成功响应包含 `data.deleted=true`。
- 官方设置中的归档列表仍只提供 Restore，本项目的永久删除入口没有与官方按钮重复。
- Rive 资源改为 JavaScript chunks，不再依赖独立 WASM 文件；通用静态服务无需新增兼容分支。

## 兼容问题

官方 `0.43.1` 在运行中的普通 `.send` 只创建 queued prompt。要把指定 prompt 注入当前回合，
客户端需另调 `POST /api/v1/sessions/{session_id}/prompts:steer` 并传入其精确 `prompt_id`。
官方 `Ctrl+S` 映射到 `steerQueued(0)`，旧增强却让自定义“插队”按钮合成 `Ctrl+S`，
无法保证操作的是刚输入的草稿。

手机完成提醒脚本若在同一页面重复执行，会安装两套 WebSocket 包装和 DOM 观察状态机；同一次
running → idle 转换因此可能创建两个完成弹窗。

## 目标

1. 将官方 bundle、服务兼容和发布版本统一升级到 `0.43.1` / `0.43.1-r1`。
2. 让桌面和手机“插队”按钮通过官方 `.send` 创建当前 queued prompt，再按精确 `prompt_id` steer。
3. 不接管或改写官方 `Ctrl+S` 的“提升现有队首”行为。
4. 让完成提醒脚本重复执行时只安装一套状态机，同一次完成只显示一个弹窗。
5. 保持归档删除、手机强提醒、主题、供应商编辑、工作区置顶和 launcher 安全边界不退化。
6. 把静态审计、历史协议快照和 live 验证状态明确分开，避免扩大兼容声明。

## 实施范围

1. 将 `OFFICIAL_FALLBACK_VERSION`、launcher/plugin 版本及发布文档更新到目标版本。
2. 使用官方 `0.43.1` 标题组合器的精确 fixture 更新 official bundle UT/IT。
3. `presentation.js` 让自定义按钮点击当前官方 `.send`，捕获本次 queued `prompt_id` 后精确 steer。
4. `completionModal.js` 使用全局安装标记，使重复执行在安装第二套监听器前直接返回。
5. 为精确 steer、普通提交隔离、重新渲染、不可用 `.send` 和重复提醒脚本补充定向测试。
6. 更新 `upstream.json` 和 `UPSTREAM.md`，记录 provenance、integrity、静态审计与验证边界。
7. README 顶部只介绍 `0.43.1-r1` 的变化，主体继续维护相对官方 Web 的完整增强功能。
8. CHANGELOG 新增 `0.43.1-r1` 条目及两次用户可见问题的事件复盘。
9. 保持 `contracts/upstream` 的 `0.41.0` 快照不变，`liveTestedServer*` 继续留空。

## 不在本次范围

- 不重新捕获完整 OpenAPI、AsyncAPI 或真实服务协议。
- 不把发布包静态审计写成真实浏览器或真实后端验证。
- 不修改用户会话、账号、工作区、token、模型配置或本地 Kimi 数据。
- 不重建官方队列状态管理，也不创建本项目自己的 queued prompt 真相源。

## 验证

- official bundle UT 断言 `0.43.1` fallback、精确 title fixture、tarball URL 和缓存目录。
- launcher official IT 使用 `0.43.1` title fixture 验证下载、解包、标题补丁和展示层注入。
- presentation 定向测试覆盖当前草稿的精确 `prompt_id`、旧队列隔离、重新渲染、不可用 `.send`
  和不带“插队”意图的普通提交。
- completion modal 定向测试让脚本执行两次，并断言一次 running → idle 只生成一个弹窗。
- 运行受影响文件的 ESLint、定向 UT、launcher official IT、`git diff --check` 和 130 字符行长检查。
- 提交或发布前检查公开 diff、发布文件清单、构建产物和提交历史中的隐私与 sourcemap 风险。

## 验收标准

- launcher 无法读取目标 metadata 时回退到官方 bundle `0.43.1`。
- launcher 和插件版本均为 `0.43.1-r1`，Release 安装链接指向 `v0.43.1-r1`。
- 标题补丁对官方 `0.43.1` 运行时组合器唯一命中，静态标题仍正确改写。
- 自定义“插队”按钮通过当前官方 `.send` 创建 queued prompt，只 steer 本次返回的 `prompt_id`。
- 普通发送继续加入队列；自定义按钮不再合成 `Ctrl+S`，官方快捷键语义由上游保留。
- `completionModal.js` 重复执行不会重复安装监听器，同一次任务完成只显示一个完成弹窗。
- `upstream.json` 的 live-tested 数组为空，协议快照继续明确标记为 `0.41.0` 历史参考。
- 新增或修改的手写源码、测试、配置与文档每行不超过 130 个字符。
