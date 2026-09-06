---
description: 修复外部 launcher 接管（重新解析真实 kimi 并重建 wrapper/PATH 项，需用户确认）
---

修复独立安装的 Open Kimi Web launcher 对 `kimi web` 的接管，常用于官方 Kimi Code 重装或升级之后。安装本插件本身不会创建接管。用户参数：$ARGUMENTS

1. 先确认 `open-kimi-web --version` 可用；不可用则告知用户安装方式并停止。
2. 向用户解释 repair 属于系统级修改：会重新解析官方 kimi 的绝对路径、重写 wrapper 脚本与 PATH/rc 项（保留原安装时间）。**获得明确确认后**再执行。
3. 运行 `open-kimi-web integrate repair`。
4. 运行 `open-kimi-web integrate status` 验证并向用户汇报结果。
