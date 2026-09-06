---
description: 用已安装的 launcher 配置 `kimi web` 可逆接管（写入 PATH wrapper，需用户确认）
---

帮助用户用独立安装的 Open Kimi Web launcher 配置 `kimi web` 接管。安装本插件并不安装或启动 launcher。用户参数：$ARGUMENTS

严格按顺序执行：

1. 环境检查：`node --version` ≥ 22，且 `open-kimi-web --version` 可用。任一不满足时，告知用户安装命令（`npm install -g open-kimi-web` 或 tarball 方式）并停止——不要自行联网安装。
2. 向用户解释即将发生的系统级修改：在 `${OPEN_KIMI_WEB_HOME:-~/.open-kimi-web}/bin` 生成 `kimi`/`kimi.cmd` wrapper，并把它 prepend 到 PATH（POSIX 写 shell rc 标记块；Windows 改用户级 PATH）。强调不改动官方文件、可用 `integrate uninstall` 完整撤销。
3. **获得用户明确确认后**，运行 `open-kimi-web integrate install`。
4. 运行 `open-kimi-web integrate status` 验证结果并向用户汇报；提醒已打开的终端可能需要 `hash -r` 或新开窗口。
