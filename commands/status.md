---
description: 体检外部 launcher 的接管状态（wrapper、PATH 顺序、真实 kimi、TLS 指纹），只读
---

检查独立安装的 Open Kimi Web launcher 接管状态。安装本插件本身不会创建该状态。用户参数：$ARGUMENTS

1. 先确认 `open-kimi-web --version` 可用；不可用则告知用户安装方式并停止。
2. 运行 `open-kimi-web integrate status`（只读操作，无需用户确认）。
3. 逐项向用户汇报：wrapper 是否完好、PATH 顺序是否正确、真实 kimi 是否仍能解析、TLS 指纹。退出码非 0 或出现 issue 时，建议用户运行 `/open-kimi-web:repair`。
