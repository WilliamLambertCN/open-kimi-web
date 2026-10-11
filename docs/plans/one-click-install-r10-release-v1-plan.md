# v2.1.1-r10 发布与 README 顶部一键兼容式安装

用户明确授权发布，并要求 README 第一行写清楚一键兼容式安装。
用户随后明确要求不重复已完成的验收；本计划据此收敛，不再扩验跨平台组合、UI 矩阵或本地全套测试。
发布已有安装器、手机子模型 UI 和英文修复，不重启生产、不读取真实配置或发模型调用，不重写历史。

## 已有验收与边界

- 最新源码已通过 199／199 完整官方 app 断言、64 项定向 UT、1430 项标准 UT、308 项 IT（Windows 两项跳过）。
- 真实 Windows／Linux 安装及 PTY 证据已归档安装计划；portable Git 与完整 coordinator 的分开证据不冒充组合验收。
- 官方固定 2.1.1，launcher 下一版 r10；缺依赖自动准备、已有 native／npm 优先复用，不需用户 Corepack／pnpm。
- 空 Linux PTY 构建仍需 Python 3、C／C++、make；macOS／arm64 与真实 Windows 注册表边界如实保留。
- main 要求 PR、gate 和线性历史；必须遵守 required CI，不绕过保护，但不再本地重复同一全套测试。

## 发布 CI 的定向修复

PR #27 首轮 Linux IT 在含 `%` 的真实安装路径失败；原始 URL 含正确 `%25`，Vitest 外部模块加载将其变成裸 `%`。
同路径原生 Node 安装、正式 update 身份、CLI 与依赖检查成功，安装器源码不需修改。
保留特殊路径和全部断言，仅将该安装调用移入原生 Node fixture；Linux 1 项通过／1 项既有跳过，Windows 2 项通过。
两平台定向 lint 通过；不改变 CI、覆盖率门槛或正式包，不扩大成新一轮完整安装／UI 验收。

## 收敛后的发布步骤

1. README 物理第一行明确一键兼容式安装，紧跟 Windows PowerShell 与 macOS／Linux 可复制命令。
   解析 r10 tag 的真实完整 SHA，下载同 SHA 薄入口并传同 `--revision`、固定 r10；失败停止并清理临时文件。
   同步版本 manifest、CHANGELOG 和当前安装文档；官方版本、历史 r9 和 update fixture 保持原样。
2. 补 pack 清单中新资源存在检查，仅验证新版本实际包及隐私范围，不重跑 UI、安装组合或本地标准全套。
   待提交源码／文档、实际 tgz 与新增推送历史不得带真实凭据、个人路径、sourcemap、缓存、profile 或日志。
3. 精确暂存目标源码、测试和文档（不 `git add .`）；提交／推送 develop，PR 正常 squash 到 main。
   等待 required PR／main gate 成功；只从真实已验 main 生成 tgz 与 annotated v2.1.1-r10，正式发布并设 latest。
4. 核对线上 Release 版本、资产 digest／字节以及 README 安装入口和同 SHA 完整源码归档可达。
   不重跑在线完整安装或交付包 UI 矩阵，不将来源可达检查声称为新的端到端安装验收。
   正常同步 main 回 develop，报告发布链接和剩余平台边界；生产服务仍由用户自行重启。

## 完成条件

README 首行与顶部安装命令清楚；r10 源码与 tgz 正式公开，required CI 成功，线上资产及脚本来源核对通过。
沿用真实既有验收、保留未测平台边界；无生产变更或自有进程／文件遗留。外部阻塞如实说明，不夸大验证范围。
