---
name: open-kimi-web
description: |
  Open Kimi Web launcher 是围绕 Kimi Code 官方 Web 与后端的轻量增强层，提供局域网 HTTPS、token 直达链接和移动页面修复。当用户要管理或恢复 launcher 的 `kimi web` 接管（integrate install/status/repair/uninstall）、在手机上访问或排查异常时使用本 skill。安装本 Kimi 插件本身不会安装或启动 launcher。
---

# OpenWeb for Kimi Code（官方 Web 的轻量增强层）

Open Kimi Web 是**非官方**的轻量增强 launcher：默认保留 Kimi Code 官方 Web 与后端，在外层增加 HTTPS、直达链接和移动页面修复。个性化配置尚未实现。

本 skill 只是已独立安装的 `open-kimi-web` 命令行工具的管理入口，驱动 `integrate install|status|repair|uninstall`。安装或移除 Kimi 插件都不会安装、启动或卸载 launcher，也不会自动修改或撤销 PATH 接管。

## 前置检查（每次必做）

1. `node --version` 必须 ≥ 22。
2. `open-kimi-web --version` 必须可用。
3. 如果不可用，**明确告诉用户需要先安装**，给出命令后停下等用户决定，不要静默联网安装：

```sh
npm install -g open-kimi-web          # 或：npm install -g ./open-kimi-web-<version>.tgz
```

## 安装接管（系统级修改，必须先确认）

`open-kimi-web integrate install` 会在 `${OPEN_KIMI_WEB_HOME:-~/.open-kimi-web}/bin` 写入
`kimi`/`kimi.cmd` 包装脚本，并把该目录 prepend 到 PATH（POSIX 写入 shell rc 文件的标记块；
Windows 修改用户级 PATH）。**不修改任何官方文件。**

执行前必须向用户解释上述影响并获得明确确认，然后运行：

```sh
open-kimi-web integrate install
open-kimi-web integrate status   # 安装后自动体检，确认全绿
```

已打开的终端可能需要 `hash -r` 或新开窗口才能命中新 PATH。

## 日常使用

- 用户照旧运行 `kimi web`：官方服务器在 loopback 后台启动，launcher 在官方 Web 前增加增强层并打印带 token 的直达链接。其它所有 `kimi` 子命令原样委托给官方二进制。
- `kimi web --host 0.0.0.0` 会启用自签名 HTTPS；独立启动 launcher 时使用 `open-kimi-web serve --lan`。**提醒用户在浏览器核对 launcher 打印的 SHA-256 指纹后再接受证书警告**。

## 撤销接管

插件系统**没有**卸载钩子。移除插件不会运行 `integrate uninstall`，也不会撤销在插件外完成的 wrapper/PATH 接管；launcher 是否仍可用取决于其独立安装状态。要恢复官方命令路径时：

1. 运行 `open-kimi-web integrate uninstall`，移除 wrapper、PATH/rc 项和状态文件；官方安装、launcher 包与用户数据不受影响；
2. 若还要移除插件，再单独运行 `/plugins remove open-kimi-web`。

## 诊断与修复

- `open-kimi-web integrate status`：检查 wrapper 完好性、PATH 顺序、真实 kimi 解析、TLS 指纹。退出码 0 = 健康。
- 官方 CLI 重装/升级后 wrapper 可能丢失真实路径：运行 `open-kimi-web integrate repair`（会重写 wrapper 与 PATH 项，属于系统级修改，同样先解释再确认）。

## 安全边界

- 绝不读取、打印或保存 `server.token` 的内容；token 直达链接本身等同于完整凭证，提醒用户不要分享。
- 不替用户接受 HTTPS 证书——指纹核对必须由用户完成。
- 不要把插件删除描述成能恢复系统状态的操作：恢复只能靠 `integrate uninstall`。
