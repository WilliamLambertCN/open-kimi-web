# Changelog

本项目是 Kimi Code 的非官方社区增强层，与 Moonshot AI 无关联、不由其维护或背书。
版本号跟随已验证的官方 Kimi Code 兼容基线。

## [open-kimi-web v0.41.0] - 2026-09-07

兼容官方 Kimi Code `0.41.0`。

### 新增

- 提供夜幕、极光、暮色、余烬与矿物青绿五套可切换深色主题，覆盖桌面端和手机端。
- 模型供应商较多时，供应商标签栏支持触摸滑动、鼠标拖动、滚轮横向滚动与键盘导航。
- 会话运行中且输入框有可发送内容时，桌面端和手机端显示“插队”按钮；桌面端仍可使用 `Ctrl+S`。
- 为局域网访问提供 HTTPS、自签名证书指纹与带 token 的直达链接。
- 提供可逆的 `integrate install` / `repair` / `uninstall`，让 `kimi web` 可选地经过本增强层。

### 修复

- 工作区目录不存在时明确显示原目录和错误原因，不再静默回退到其他目录。
- 修复计划、后台 Bash 等 composer dock 控件与输入框错位的问题。
- 后端不可达时尽早终止并显示可操作的诊断信息。
- 源码依赖未安装时，为 `integrate` 命令显示明确的缺失依赖提示。
- 兼容 `corepack pnpm dev -- --lan` 中包管理器传入的参数分隔符。

[open-kimi-web v0.41.0]: https://github.com/WilliamLambertCN/open-kimi-web/releases/tag/v0.41.0
