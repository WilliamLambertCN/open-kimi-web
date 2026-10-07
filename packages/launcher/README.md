# open-kimi-web

[Kimi Code](https://github.com/MoonshotAI/kimi-code) 的非官方轻量增强 launcher：默认保留官方构建界面与后端，在外层提供单源代理、局域网 HTTPS 和移动页面修复。

> **这不是 Kimi Code 官方产品。** 社区项目，与 Moonshot AI 无关联、不由其维护或背书。

## 安装

本项目当前不发布到 npm registry。`v2.1.1-r6` 实际 tgz 的隔离安装、启动及浏览器验收通过。
通过 GitHub Release 固定版本 URL 安装：

```sh
npm install -g https://github.com/WilliamLambertCN/open-kimi-web/releases/download/v2.1.1-r6/open-kimi-web-2.1.1-r6.tgz
open-kimi-web integrate install
```

`2.1.1-r6` 仍兼容 Kimi Code `2.1.1`。新增图片完整预览与 tab 及时 Loading 反馈。
手机提问卡片支持长题干与选项共同滚动，也可拖动高度并保存当前浏览器和站点的档位；
包含模型用量统计、归档删除与长会话性能增强。
保留 r5 的价格修复：离线快照、联网刷新、真实模型 ID 自动建议和批量确认，模糊建议不直接计费。
手动映射和单价优先；目录刷新沿用各模型原默认键，缺失键保留上次有效价格并标出旧价。

也可从源码安装：

```sh
git clone --branch main https://github.com/WilliamLambertCN/open-kimi-web.git
cd open-kimi-web
corepack pnpm install --frozen-lockfile
node packages/launcher/bin/open-kimi-web.mjs integrate install
```

已有接管时，切换安装方式或目录还需要按下方“升级”说明更新入口。

## 图片完整预览与 tab 反馈

官方默认 `fs:read` 只读 1 MiB；截断的 base64 图片通过官方鉴权 `fs/{path}:download` 获取完整内容。
显式部分读取、文本和无关请求不变；下载拒绝重定向，校验图片 MIME、原 size 与实际字节，上限 32 MiB。
超限、下载失败或字节不全明确报错，不退回半图；正常透明区域继续显示，不记录或持久化图片、路径与 token。

会话、分类和右侧文件 tab 提供不挡操作的 Loading 与滚圈；关联响应交付让出一次绘制机会，原生 loading 出现后交回。
快速点击只保留当前反馈，慢 B→快 C 的旧响应、错误和关闭均会正确收尾；内容竞态仍由官方 generation 处理。
不改官方 bundle，不用 Vue 私有状态，不复制官方会话／文件状态或接管内容 loader。

最终验收：实际 r6 tgz 等价图片 Chrome 像素矩阵完成 115 项断言、110 张截图；opaque 2.69 MB、transparent 1.57 MB、
>10 MiB、失败及 Fit／Actual 的全部主题检查通过，完整 RGBA 正确；这不是完整 app 验收。
另以完整官方 `2.1.1` app 动态 import 实际解包的 officialPresentation 资源，4 张 PNG 使用原生 `.fp-image`，
read 1 MiB→download 完整 opaque 3,148,932 bytes、透明 1,833,306 bytes，底部 RGBA 与 Fit→Actual→Fit 通过。
原始桌面、夜幕手机两组共 8 次点击的绘制机会为 9.8–34.5 ms，slow B→fast C、失败及关闭通过。
此前 14 组／56 次网络路径点击的 4.6–31.1 ms 与清理验证保留；指标是绘制机会，不是系统显示延迟。
约 2.1 MB 内联文本仍需 453.6 ms，45 turn 缓存会话仍需 152 ms，仍会阻塞；不宣称所有 tab 卡顿已消除。
lint、typecheck、644 项 UT、61 项 IT、test:pack 与实际包安装启动通过，PR #22 CI 已绿。
实体设备与用户实际数据未验证，不公开用户截图。

## 模型用量与 API 成本统计

桌面侧栏和手机会话／工作区切换抽屉提供“使用统计”入口。
支持 `1d`、`3d`、`1w`、`1m`、`2m`、`3m` 和自定义时间，按实际请求的模型 ID 汇总，
展示普通输入、缓存读取、输出、缓存写入、缓存命中率和 API 等值费用。
历史用量排除 fork 复制前缀；模型分布、明细和建议分批展示，价格配置可搜索模型与公共目录。
可刷新目录并批量确认建议，或手动覆盖单价；同键使用新价，缺失键沿用上次有效价格并标旧价。
旧版价格缓存按已知内置来源自动兼容，无需删除缓存或迁移会话数据。

统计需要通过接管的 `kimi web` 受管模式启动，独立 `serve --target` 模式不会读取本机用量。
未记录或身份不明确的数据会标出；费用按当前单价估算，不代表订阅支出或服务商账单。
完整功能与截图见[项目 README](https://github.com/WilliamLambertCN/open-kimi-web#readme)。

## 用法

前提：官方后端已在 target 运行，手上有它的 bearer token；token 会在启动时打印，
也保存在 `<KIMI_CODE_HOME>/server.token`。未接管时先启动官方后端，再运行下列 `serve`。
如果 `kimi` 已由本项目接管，则改用 `kimi web --host`，不要同时运行独立的 `serve`。

```sh
open-kimi-web serve                     # http://127.0.0.1:4173
open-kimi-web serve --lan               # HTTPS，打印 Local + Network 链接
open-kimi-web serve --https             # 回环也强制 HTTPS
open-kimi-web serve --lan --insecure-http
open-kimi-web serve --cert-file ./server.crt --key-file ./server.key
open-kimi-web serve --token-file ./server.token
open-kimi-web serve --no-token-link
```

默认 target 为 `http://127.0.0.1:58627`，host 为 `127.0.0.1`，端口为 `4173`。
默认端口不可用时会尝试后续端口，最后由系统分配，实际地址以启动输出为准。
`--lan` 等价于 `--host 0.0.0.0`，不能与 `--host` 同用。`--target` 必须是不带凭据和路径的
纯 http(s) 地址。先启动 `kimi web`，或让 launcher 接管该命令。

`open-kimi-web serve` 使用上述 `4173` 独立端口。接管后的 `kimi web` 保留官方后端固定
回环端口 `58627`，Open Kimi Web 使用配套端口 `48627`。端口被占用时会明确失败；
可关闭占用程序，或用 `kimi web --port <port>` 更换 Open Kimi Web 端口。

默认服务**官方 `kimi-code` npm 包的 `dist-web` 前端**，标题变化见根 README。
官方 bundle 不可用时会明确中止启动；恢复 npm 网络及 `curl` / `tar` 后重试，
或用 `--web-dir` 指向已准备好的隔离前端目录。该目录内所有可访问文件都会被公开，
不要放日志、备份、配置或凭证；静态服务拒绝通过符号链接越界读取。
`--web-version <ver>` 固定官方包版本；`OPEN_KIMI_WEB_DIR` / `OPEN_KIMI_WEB_VERSION`
也适用于接管后的 `kimi web`。

默认官方模式会额外加载本项目的展示层，在手机宽度下修复首页、会话设置、模型菜单与
工作区列表的小屏布局，并将侧栏品牌文字显示为 `OPEN-KIMI-WEB`。模型供应商标签支持
触摸、鼠标拖动、滚轮和键盘横向浏览；可编辑供应商的模型支持逐项配置图片/视频、工具
调用、思考、始终思考和全部思考档位，新模型与缺失字段默认全选，已有显式配置保持不变。
供应商表单还可用当前 Base URL 和可选 API Key 拉取 `/models`，从下拉框选中并添加，也可
通过专用手柄用鼠标或触摸调整模型顺序；请求由当前页面 token 保护的 launcher 同源端点
转发，不记录或回显 API Key，不跟随重定向。工作区首次使用默认按最近活动排序，
也可切回官方手动顺序；更多菜单支持置顶与取消置顶，置顶仅在本地保存工作区 ID。
已归档会话可在二次确认后通过 Kimi Code 官方接口永久删除。
fork 会话在官方 Web 中完成回合后，自动标题生成不会抹掉仍存在的 `Fork: ` 标记；
手动重新生成标题仍走官方接口。直接使用官方 CLI 的请求不经过这一页面增强。
Side Chat 运行中，向上滚动后会保持阅读位置；滚回底部后继续自动跟随新内容。
会话运行中有可发送草稿时，桌面和手机均提供“插队”按钮。按钮通过官方 `.send` 创建
当前 queued prompt，再按返回的 `prompt_id` 调用 `prompts:steer`。官方 `Ctrl+S` 的行为由上游自身处理。
首次访问默认使用夜幕主题；桌面可在左下角账号菜单的**氛围主题**中切换，手机可在
**设置 → 氛围主题**中选择极光、暮色、余烬、矿物青绿、夜幕五套主题，或恢复原始外观。
主题使用随包附带的独立星云背景、半透明面板和组件样式，只加载当前主题的背景。所有选择
（包括原始外观）保存在当前浏览器、当前站点的本地存储中，不修改官方浅色/深色设置。

样式与脚本随 launcher 发布，不写入官方缓存；更新 launcher 后必须结束旧进程并重新启动，
再刷新或重新打开页面。`--web-dir` 不注入展示层及主题功能。已检查的官方组件版本为
`2.1.1`（静态审计、自动化回归及实际 tgz 资源在虚构 API 下的完整官方 app 隔离验收）。

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

全局 tgz 安装更新时，再次安装上面的版本化 URL。源码安装更新时，在仓库目录运行
`git pull --ff-only origin main` 和 `corepack pnpm install --frozen-lockfile`，确保使用 main 分支。
切换安装方式或目录时，`integrate install` 可能保留已有入口，需显式使用目标安装位置执行 `repair`：

```sh
# 切换到已安装的全局 tgz 包
node "$(npm root -g)/open-kimi-web/bin/open-kimi-web.mjs" integrate repair

# 或切换到当前源码仓库
node packages/launcher/bin/open-kimi-web.mjs integrate repair
```

随后在新终端执行 `open-kimi-web integrate status`；若有异常，使用目标入口执行 `integrate repair`。
最后停止旧的 `kimi web` / launcher 并重新启动，再刷新或重新打开页面；无需迁移会话数据。

## 安全

- 回环 target 下 launcher 尽力读取 `${KIMI_CODE_HOME:-~/.kimi-code}/server.token`
  并打印带 `#token=...` 的直达链接。fragment 不会发给服务器，在应用挂载前
  即被移除。链接本身就是完整凭据：别分享。
- 官方 UI 的 token 存储行为由上游负责；带 token 的直达链接仍等同完整编程代理权限。
- 回环默认 HTTP；`--lan` 与非回环 `--host` 自动 HTTPS；`--https` 在回环强制
  HTTPS；`--insecure-http` 是明文降级并打印警告。
- 托管自签名证书复用自 `${OPEN_KIMI_WEB_HOME:-~/.open-kimi-web}/tls/server.{key,crt}`。
  浏览器首次不信任：接受警告前请核对 launcher 打印的 SHA-256 指纹。证书无效、
  临近过期或缺少必需的 hostname/IP SAN 时自动轮换。
- `--cert-file` / `--key-file` 成对提供即使用自定义证书；无效或不匹配会中止
  启动，绝不回退 HTTP。
- 只代理 `/api/*`；hop-by-hop 头被过滤；`Authorization` 原样转发、绝不落日志。
- 已归档会话的永久删除入口沿用当前页面 Bearer 授权，调用官方
  `POST /api/v1/sessions/{id}:delete`；通用 `/api/v1/debug/*` 路由不会代理给浏览器。
- `index.html` 以 `no-cache` 提供；带内容 hash 的 `/assets/*` 为 `immutable`。

需要 Node ≥ 22。运行时 npm 依赖：`ws` 与 `selfsigned`（均 MIT）；首次下载
官方 UI 还需要 PATH 中可用的系统 `curl` 和 `tar`。源码运行先在仓库根执行
`corepack pnpm install --frozen-lockfile`，然后直接运行 `node packages/launcher/bin/open-kimi-web.mjs serve`，无需构建本地前端。

## License

MIT — 见包内 `LICENSE` 与 `THIRD_PARTY_NOTICES.md`。含 Moonshot AI 的 MIT
许可代码，原始声明完整保留。
