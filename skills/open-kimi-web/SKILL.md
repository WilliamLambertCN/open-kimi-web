---
name: open-kimi-web
description: |
  Open Kimi Web launcher 是围绕 Kimi Code 官方 Web 与后端的轻量增强层，提供局域网 HTTPS、token 直达链接和移动页面修复。
  当用户要管理或恢复 launcher 的 kimi web 接管（integrate install/status/repair/uninstall）、检查或更新 launcher，
  或在手机上访问、排查异常时使用本 skill。安装本 Kimi 插件本身不会安装或启动 launcher。
---

# OpenWeb for Kimi Code（官方 Web 的轻量增强层）

Open Kimi Web 是**非官方**的轻量增强 launcher：默认保留 Kimi Code 官方 Web 与后端，
在外层增加 HTTPS、直达链接、移动页面修复、供应商模型排序、工作区置顶和已归档会话永久删除。

当前版本 `v2.1.1-r9` 兼容官方 `2.1.1`，新增无依赖的 Node 流式 gzip；既有增强与偏好不变。
Windows 标准检查及源码官方 app 实测通过；交付包浏览器、CI 与线上验证按发布流程单独记录在[计划][lan-plan]。

本 skill 是已独立安装的 `open-kimi-web` 工具管理入口，驱动 `integrate install|status|repair|uninstall` 和 `update`。
安装或移除 Kimi 插件都不会安装、启动或卸载 launcher，也不会自动修改或撤销 PATH 接管。

## 前置检查（每次必做）

1. `node --version` 必须 ≥ 22。
2. `open-kimi-web --version` 必须可用。
3. 如果不可用，**明确告诉用户需要先安装**，给出下面一种实际可用的方式后停下等用户决定，不要静默联网安装，也不要声称 npm registry 已发布本包：

```sh
# 源码方式
git clone https://github.com/WilliamLambertCN/open-kimi-web.git
cd open-kimi-web
corepack pnpm install --frozen-lockfile
node packages/launcher/bin/open-kimi-web.mjs integrate install

# 或使用 GitHub Release 固定版本 URL
npm install -g https://github.com/WilliamLambertCN/open-kimi-web/releases/download/v2.1.1-r9/open-kimi-web-2.1.1-r9.tgz
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
- `kimi web --host 0.0.0.0` 会启用自签名 HTTPS；独立启动 launcher 时使用 `open-kimi-web serve --lan`。
  **提醒用户在浏览器核对 launcher 打印的 SHA-256 指纹后再接受证书警告**。

## 撤销接管

插件系统**没有**卸载钩子。移除插件不会运行 `integrate uninstall`，也不会撤销在插件外完成的 wrapper/PATH 接管；launcher 是否仍可用取决于其独立安装状态。要恢复官方命令路径时：

1. 运行 `open-kimi-web integrate uninstall`，移除 wrapper、PATH/rc 项和状态文件；官方安装、launcher 包与用户数据不受影响；
2. 若还要移除插件，再单独运行 `/plugins remove open-kimi-web`。

## 诊断与修复

- `open-kimi-web integrate status`：检查 wrapper 完好性、PATH 顺序、真实 kimi 解析、TLS 指纹。退出码 0 = 健康。
- 官方 CLI 重装/升级后 wrapper 可能丢失真实路径：运行 `open-kimi-web integrate repair`（会重写 wrapper 与 PATH 项，属于系统级修改，同样先解释再确认）。

## 安装自更新（r8 起可用）

`v2.1.1-r8` 起提供 update；安装版本与固定 tgz 链接见项目 README 的“快速上手”。
旧 r7 发布包不含 update，须先手动升级至 r8 或更高版本，不能直接在 r7 上运行该命令。
用户要求更新已具备该命令的 launcher 时，先运行：

```sh
open-kimi-web update --check
```

核对输出中实际执行安装、源码／npm 渠道及目标。获得用户更新授权后再运行 `open-kimi-web update`；
不要把只要求检查当成更新授权，不使用不存在的 npm registry @latest。
源码仅支持官方仓库的干净 main 跟踪 origin/main；开发分支、修改、领先或分叉必须明确拒绝，
不能替用户 stash、reset、clean、切分支。npm 仅更新已识别的同一全局／自定义 prefix 或简单本地直接依赖；
本地更新会修改 owner manifest／lock 并保留生产／开发依赖类别。
临时 npx、链接、workspace、混合管理器或身份不明时，说明限制，不去更新另一份全局安装。
更新非原子，失败时按输出解释实际阶段，不宣称原安装未变；不自动回滚、repair 或重启。
成功后提醒停止旧 launcher、重新启动并刷新页面；同路径更新不需要 repair，切换位置才需要。
该命令不更新官方 Kimi、不修改 PATH、接管状态、证书、官方 Web 缓存或会话数据。
包管理器缓存可能正常变化；本地 npm 会解析 owner 依赖树，不保证无关依赖逐字节不变。
若后代进程退出无法确认，安装锁会保留；先核实原 updater 及其后代已停止，再按错误提示手工解除锁。

## 大会话加载诊断（r9）

- r9 在 HTTP 代理、官方／自定义静态和注入资源层协商流式 gzip，不新增依赖，不缓存会话或收集全文后压缩。
  已知长度至少 1024 bytes 或长度未知的可压缩流可用 gzip，采用 level 1 与 `Z_SYNC_FLUSH`；背压和取消继续沿用。
  identity 优先、gzip q=0、已编码、HEAD、无正文、Range／206、SSE 与 no-transform 不转码。
- 准确官方 `2.1.1` 已有最近 10 turn、before_turn 与最多 4 个 resident 会话，不要把加载慢解释成全历史下载。
  后端先完整 reduce 再分页，每页仍带 tasks 等实体，单 turn 可能巨大；官方 Remote Control 压缩，本地入口 raw。
- 不修改正文、分页、鉴权、WS、工具默认展开或显式偏好、observer、主题，也不以截断工具输出伪造提速。
  共同 render／layout 仍可能有 400–900 ms 长任务，本轮不修；gzip 不能消除后端恢复、解析和同步渲染。
- r9 Windows 标准检查和完整官方 app 源码实测通过；虚构高度重复 fixture 的受控网络结果不代表普遍倍数或真实 LAN。
  不将正文可见后的输入测试称为最早输入可用，也不把慢 B→快 C 的竞态验证当取消证明。
  代表实图不等于全面视觉验收；实体手机、真实家庭 Wi-Fi 与生产安装未验证，详细发布记录见[计划][lan-plan]。
- 升级后提醒重启旧 launcher，再刷新或重新打开页面；无需清官方缓存或迁移会话数据。
  排查时核对实际版本与运行进程，不读取用户会话、凭据或 wire 来制作测试数据。

## 安全边界

- 绝不读取、打印或保存 `server.token` 的内容；token 直达链接本身等同于完整凭证，提醒用户不要分享。
- 不替用户接受 HTTPS 证书——指纹核对必须由用户完成。
- 不要把插件删除描述成能恢复系统状态的操作：恢复只能靠 `integrate uninstall`。
- `--web-dir` 只能指向隔离的前端构建目录；目录内所有可访问的静态文件都会公开给 launcher 访问者，
  不要在其中放日志、备份、配置或凭证。

[lan-plan]: https://github.com/WilliamLambertCN/open-kimi-web/blob/main/docs/plans/large-session-lan-performance-v1-plan.md
