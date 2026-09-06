---
description: 撤销外部 launcher 对 `kimi web` 的接管（不卸载 launcher 或插件，需用户确认）
---

帮助用户恢复官方 `kimi web` 命令路径。此操作只撤销独立 launcher 的接管，不卸载 launcher 或 Kimi 插件。用户参数：$ARGUMENTS

严格按顺序执行：

1. 向用户解释将发生的系统级修改：删除 `${OPEN_KIMI_WEB_HOME:-~/.open-kimi-web}/bin` 中带标记的 wrapper、精确移除 PATH/rc 项与状态文件；官方安装、用户数据与 TLS 证书不受影响。**获得明确确认后**继续。
2. 运行 `open-kimi-web integrate uninstall`。
3. 向用户汇报结果，并提醒：移除插件不会自动改动 PATH；若用户还想移除本插件，需要另行运行 `/plugins remove open-kimi-web`。已打开的终端可能需要 `hash -r` 或新开窗口。
