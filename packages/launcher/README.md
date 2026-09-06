# open-kimi-web

[Kimi Code](https://github.com/MoonshotAI/kimi-code) 的非官方轻量增强 launcher：默认保留官方构建界面与后端，在外层提供单源代理、局域网 HTTPS 和移动页面修复。

> **这不是 Kimi Code 官方产品。** 社区项目，与 Moonshot AI 无关联、不由其维护或背书。

## 用法

前提：`kimi web` 已在运行，手上有它的 bearer token（启动时打印；也在 `<KIMI_CODE_HOME>/server.token`）。

```sh
open-kimi-web serve                     # http://127.0.0.1:4173
open-kimi-web serve --lan               # HTTPS，打印 Local + Network 链接
open-kimi-web serve --https             # 回环也强制 HTTPS
open-kimi-web serve --lan --insecure-http
open-kimi-web serve --cert-file ./server.crt --key-file ./server.key
open-kimi-web serve --token-file ./server.token
open-kimi-web serve --no-token-link
```

默认值：target `http://127.0.0.1:58627`，host `127.0.0.1`（仅回环），端口 `4173`；未指定端口且默认端口不可用时自动尝试后续端口，最后由系统分配，实际地址以启动输出为准。`--lan` 等价于 `--host 0.0.0.0`，打印局域网链接，不能与 `--host` 同用。`--target` 必须是纯 http(s) 地址——不带凭据、不带路径。先自己起 `kimi web`——或者让 launcher 接管这条命令（见下）。

默认服务**官方 `kimi-code` npm 包的 `dist-web` 前端**（标签页和共用模板的顶栏标题会变化，见根 README）。兼容性变更：官方 bundle 不可用时现在会明确中止启动，不再静默改用内置 UI；恢复 npm 网络及 `curl` / `tar` 后重试，或用 `--web-dir` 指向已准备好的官方前端构建。`--web-dir <path>` 直接服务现成构建目录，`--web-version <ver>` 固定官方包版本；对应环境变量 `OPEN_KIMI_WEB_DIR` / `OPEN_KIMI_WEB_VERSION` 也适用于接管后的 `kimi web`。

手机宽度下，默认官方模式会额外加载本项目的展示层，修复首页、会话设置、模型菜单与工作区列表的小屏布局。样式与脚本随 launcher 发布，不写入官方缓存；更新 launcher 后刷新页面即可加载。展示层也将侧栏品牌文字显示为 `OPEN-KIMI-WEB`。`--web-dir` 不注入展示层。已检查的官方组件版本为 `0.41.0`。个性化配置仍是后续方向，当前尚未实现。

## 接管（可选）

```sh
open-kimi-web integrate install     # 一次性：wrapper + PATH 条目
kimi web                            # 让官方 Web 经过本增强层
open-kimi-web integrate status      # wrapper / PATH / real-kimi 健康检查
open-kimi-web integrate repair      # 重新解析真 kimi、重建 wrapper
open-kimi-web integrate uninstall   # 撤销 wrapper 与 PATH 接管
```

`install` 把一个小 shim（`kimi` / `kimi.cmd`）放进
`${OPEN_KIMI_WEB_HOME:-~/.open-kimi-web}/bin` 并 prepend 到 PATH
（POSIX 写 shell rc 标记块；Windows 写 User PATH，System PATH 中更早的官方
`kimi` 可能遮蔽它，需按警告调整顺序）。同一目录还会放一个
`open-kimi-web` 命令本体，`status` / `repair` / `uninstall` 不再需要绝对路径。
之后 `kimi web` 会把官方 server 起在回环、前面架上本 launcher；其它所有
`kimi` 调用——包括 `web rotate-token` 和危险参数——都逐字透传给官方二进制
（其绝对路径已固化在 wrapper 里）。

接管可逆且不碰官方文件：`integrate uninstall` 只删带标记的 wrapper、精确的 PATH/rc
条目和状态文件。已知限制：用绝对路径调官方二进制会绕过 wrapper；已打开的
shell 可能要 `hash -r` 或开新终端刷新命令缓存；官方 CLI 重装/升级后，若
`status` 报告真身丢失，跑 `integrate repair`。该操作不会卸载 launcher，也与
Kimi 插件是否安装无关。

## 安全

- 回环 target 下 launcher 尽力读取 `${KIMI_CODE_HOME:-~/.kimi-code}/server.token`
  并打印带 `#token=...` 的直达链接。fragment 不会发给服务器，在应用挂载前
  即被移除。链接本身就是完整凭据：别分享。
- 官方 UI（0.41.0）把 token 存入 `localStorage`，有效期 7 天；关闭标签页
  不会清除。
- 回环默认 HTTP；`--lan` 与非回环 `--host` 自动 HTTPS；`--https` 在回环强制
  HTTPS；`--insecure-http` 是明文降级并打印警告。
- 托管自签名证书复用自 `${OPEN_KIMI_WEB_HOME:-~/.open-kimi-web}/tls/server.{key,crt}`。
  浏览器首次不信任：接受警告前请核对 launcher 打印的 SHA-256 指纹。证书无效、
  临近过期或缺少必需的 hostname/IP SAN 时自动轮换。
- `--cert-file` / `--key-file` 成对提供即使用自定义证书；无效或不匹配会中止
  启动，绝不回退 HTTP。
- 只代理 `/api/*`；hop-by-hop 头被过滤；`Authorization` 原样转发、绝不落日志。
- `index.html` 以 `no-cache` 提供；带内容 hash 的 `/assets/*` 为 `immutable`。

需要 Node ≥ 22。运行时 npm 依赖：`ws` 与 `selfsigned`（均 MIT）；首次下载
官方 UI 还需要 PATH 中可用的系统 `curl` 和 `tar`。源码运行先在仓库根执行
`corepack pnpm install`，然后直接运行 `node packages/launcher/bin/open-kimi-web.mjs serve`，无需构建本地前端。

## License

MIT — 见包内 `LICENSE` 与 `THIRD_PARTY_NOTICES.md`。含 Moonshot AI 的 MIT
许可代码，原始声明完整保留。
