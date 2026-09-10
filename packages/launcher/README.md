# open-kimi-web

[Kimi Code](https://github.com/MoonshotAI/kimi-code) 的非官方轻量增强 launcher：默认保留官方构建界面与后端，在外层提供单源代理、局域网 HTTPS 和移动页面修复。

> **这不是 Kimi Code 官方产品。** 社区项目，与 Moonshot AI 无关联、不由其维护或背书。

## 安装

本项目当前不发布到 npm registry。r4 GitHub Release 提供固定版本的 tgz，可直接安装：

```sh
npm install -g https://github.com/WilliamLambertCN/open-kimi-web/releases/download/v0.41.0-r4/open-kimi-web-0.41.0-r4.tgz
open-kimi-web integrate install
```

也可从源码安装：

```sh
git clone https://github.com/WilliamLambertCN/open-kimi-web.git
cd open-kimi-web
corepack pnpm install --frozen-lockfile
node packages/launcher/bin/open-kimi-web.mjs integrate install
```

## 用法

前提：官方后端已在 target 运行，手上有它的 bearer token（启动时打印；也在 `<KIMI_CODE_HOME>/server.token`）。未接管时先用真实的官方 Kimi 二进制启动后端，再运行下列 `serve`；如果 `kimi` 已由本项目接管，则改用 `kimi web --host` 一次启动受管后端和 launcher，不要同时运行独立的 `serve`。

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

`open-kimi-web serve` 使用上述 `4173` 独立端口。通过 `integrate install` 接管的 `kimi web` 保留官方后端固定回环端口 `58627`，并把 Open Kimi Web 固定在配套对外端口 `48627`。任一端口已被占用时会明确失败；可关闭占用程序，或用 `kimi web --port <port>` 显式更换 Open Kimi Web 端口。

默认服务**官方 `kimi-code` npm 包的 `dist-web` 前端**（标签页和共用模板的顶栏标题会变化，见根 README）。官方 bundle 不可用时会明确中止启动；恢复 npm 网络及 `curl` / `tar` 后重试，或用 `--web-dir` 指向隔离且已准备好的官方前端构建目录。`--web-dir <path>` 会公开并服务目录内所有可访问的静态文件，不要在其中放日志、备份、配置或凭证；静态服务会拒绝通过符号链接越过该目录。`--web-version <ver>` 固定官方包版本；对应环境变量 `OPEN_KIMI_WEB_DIR` / `OPEN_KIMI_WEB_VERSION` 也适用于接管后的 `kimi web`。

默认官方模式会额外加载本项目的展示层，在手机宽度下修复首页、会话设置、模型菜单与工作区列表的小屏布局，并将侧栏品牌文字显示为 `OPEN-KIMI-WEB`。模型供应商标签支持触摸、鼠标拖动、滚轮和键盘横向浏览；可编辑供应商的模型支持逐项配置图片/视频、工具调用、思考、始终思考和全部思考档位，新模型与缺失字段默认全选，已有显式配置保持不变。供应商表单还可用当前 Base URL 和可选 API Key 拉取 `/models`，从下拉框选中并添加，也可通过专用手柄用鼠标或触摸调整模型顺序；请求由当前页面 token 保护的 launcher 同源端点转发，不记录或回显 API Key，不跟随重定向。工作区更多菜单支持置顶与取消置顶，本地存储只保留工作区 ID。已归档会话可在二次确认后永久删除；该能力仅在 `kimi web` 受管启动时可用，外接的 `--target` 未启用官方内部删除服务时会显示明确错误。会话运行中有可发送草稿时，桌面和手机均提供“插队”按钮，桌面 `Ctrl+S` 快捷键保持可用。首次访问默认使用夜幕主题；桌面可在左下角账号菜单的**氛围主题**中切换，手机可在**设置 → 氛围主题**中选择极光、暮色、余烬、矿物青绿、夜幕五套主题，或恢复原始外观。主题使用随包附带的独立星云背景、半透明面板和组件样式，只加载当前主题的背景。所有选择（包括原始外观）保存在当前浏览器、当前站点的本地存储中，不修改官方浅色/深色设置。

样式与脚本随 launcher 发布，不写入官方缓存；更新 launcher 后必须结束旧进程并重新启动，再刷新或重新打开页面。`--web-dir` 不注入展示层及主题功能。已检查的官方组件版本为 `0.41.0`。

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

## 升级

全局 tgz 安装更新时，再次安装上面的版本化 URL；源码安装更新时，在仓库目录运行 `git pull --ff-only` 和 `corepack pnpm install --frozen-lockfile`。随后执行 `open-kimi-web integrate status`，仅在它报告异常时执行 `open-kimi-web integrate repair`。最后结束旧的 `kimi web` / launcher 进程并重新启动，使新版本生效。

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
- 已归档会话的永久删除入口要求同源请求和当前页面 Bearer 授权，并在删除前向官方后端确认会话已归档；受管后端的通用 `/api/v1/debug/*` 路由不会代理给浏览器。
- `index.html` 以 `no-cache` 提供；带内容 hash 的 `/assets/*` 为 `immutable`。

需要 Node ≥ 22。运行时 npm 依赖：`ws` 与 `selfsigned`（均 MIT）；首次下载
官方 UI 还需要 PATH 中可用的系统 `curl` 和 `tar`。源码运行先在仓库根执行
`corepack pnpm install --frozen-lockfile`，然后直接运行 `node packages/launcher/bin/open-kimi-web.mjs serve`，无需构建本地前端。

## License

MIT — 见包内 `LICENSE` 与 `THIRD_PARTY_NOTICES.md`。含 Moonshot AI 的 MIT
许可代码，原始声明完整保留。
