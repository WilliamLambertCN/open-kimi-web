# Open Kimi Web · 一键安装

在手机和电脑的浏览器里使用 Kimi Code，查看模型用量、估算费用、切换主题。
仍使用官方页面和服务，并调整手机上的布局与操作。

**Windows：打开 PowerShell，粘贴运行。**

```powershell
& {
  $api = 'https://api.github.com/repos/WilliamLambertCN/open-kimi-web/commits/v2.4.1-r2'
  $sha = (Invoke-RestMethod $api -ErrorAction Stop).sha
  if ($sha -notmatch '^[0-9a-fA-F]{40}$') { throw 'Invalid release commit SHA' }
  $url = "https://raw.githubusercontent.com/WilliamLambertCN/open-kimi-web/$sha/scripts/install.ps1"
  & ([scriptblock]::Create((Invoke-RestMethod $url -ErrorAction Stop))) --revision $sha --version 2.4.1-r2
}
```

**macOS / Linux：打开终端，粘贴运行。**

```sh
(
  set -eu
  api='https://api.github.com/repos/WilliamLambertCN/open-kimi-web/commits/v2.4.1-r2'
  metadata=$(curl --fail --silent --show-error --proto '=https' --tlsv1.2 "$api")
  sha=$(printf '%s\n' "$metadata" | sed -n 's/^[[:space:]]*"sha":[[:space:]]*"\([0-9a-fA-F]*\)".*/\1/p' | head -n 1)
  case "$sha" in ''|*[!0-9a-fA-F]*) exit 1 ;; esac
  [ "${#sha}" -eq 40 ] || exit 1
  url="https://raw.githubusercontent.com/WilliamLambertCN/open-kimi-web/$sha/scripts/install.sh"
  script=$(curl --fail --silent --show-error --proto '=https' --tlsv1.2 "$url") &&
    sh -c "$script" install.sh --revision "$sha" --version 2.4.1-r2
)
```

电脑上已有能正常运行的 Kimi，就继续使用，不重新下载或升级；没有安装时，脚本才会下载。
默认安装会配置命令入口，新开终端仍可直接运行 `kimi`，继续使用原来的 CLI、配置和会话；`kimi web` 则打开增强网页。
脚本会按需安装运行所需的 Node.js、npm，以及 Windows 上的 Git Bash。需要联网，不用提前安装 Corepack 或 pnpm。
首次使用 Kimi 时需要自行登录；安装不会启动服务。遇到损坏或无法识别的旧安装会报错，不会直接覆盖。

[![CI][ci-badge]][ci-workflow]
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> 非官方社区项目，与 Moonshot AI 无关联。当前发布版 [v2.4.1-r2][current-release]，适用于 Kimi Code `2.4.1`。

## 快速上手

安装完成后，新开终端，运行：

```sh
kimi web --host
```

手机连接同一局域网，打开终端打印的 **Network** 链接。
首次遇到证书警告时，先核对证书上的 SHA-256 指纹是否与终端显示的一致，确认连接的是自己的电脑。
**链接含有登录凭据（token），拿到它的人能使用 Kimi 的编程功能，包括读写文件、执行命令。不要分享。**

默认网页端口为 `48627`；如果已被占用，用 `kimi web --port <port>` 换一个。
需要通过 npm、源码安装，或连接已运行的 Kimi 服务？见[更多安装方式和命令](packages/launcher/README.md#安装)。

## 有哪些增强

- **在手机上操作**：手机和电脑在相同位置提供常用操作，可以搜索会话、输入目录路径创建工作空间。
  手机上也能直接列出所有会话、选择排序方式，并为执行分工任务的子代理选择模型。
- **查看模型用量**：按日期、模型或工作区，查看模型处理了多少内容（以 token 为单位）、有多少复用了缓存，以及估算费用。
  可以自动匹配单价、批量确认，也可以手动填写价格。
- **阅读消息和图片**：聊天区随窗格宽度调整，标题下用 B／KB／MB 显示会话记录的大小，消息旁显示时间。
  可以完整预览图片；切换标签时会先显示加载状态。
- **处理任务提醒**：Kimi 完成任务、需要你批准操作或回答问题时，手机页面会显示提醒；提问卡片可以拉高。
  任务运行中也能插队发送新消息，但仍按官方规则请求确认，不绕过权限。
- **选择与配置模型**：从服务商获取模型列表后选择模型，调整显示顺序和可用能力；选择思考强度时，Max 放在最后。
  不自动改写已有配置。
- **整理会话**：置顶工作区、按最近活动排序；复制出的会话保留 `Fork:` 标记，避免与原会话混淆。
  已归档会话可以永久删除，删除前会再次确认。
- **更换主题**：可选五套主题，也能恢复官方外观。电脑从账号菜单、手机从设置进入“氛围主题”。
- **连接与更新**：通过 HTTPS 加密连接，识别 Hyper-V 虚拟网卡的地址，并压缩传输的数据。
  无论通过源码还是 npm 安装，都可以用命令更新；也可以恢复原来的 `kimi web` 命令。

启动时加上 `--scheduled-tasks` 才能查看定时任务。使用官方 `2.4.1` 时，只能查看已有任务和已记录的触发历史，
不能编辑、暂停或为任务单独选模型，也不能在同一个 Kimi 服务中同时开启官方远程控制（Remote Control）。
[了解定时任务的使用限制](packages/launcher/README.md#统一导航与会话搜索)

## 安装到手机桌面

手机上打开会话／工作区列表，点击 **安装到桌面**；电脑侧栏也有这个入口。

- **Android／电脑**：浏览器支持直接安装时，点击面板中的“安装”；否则按提示从浏览器菜单操作。
- **iPhone／iPad**：在 Safari 中点“分享”→“添加到主屏幕”；若有“作为 Web App 打开”，保持开启。
- **地址须使用 HTTPS，且设备信任网站证书**。只跳过证书警告不一定能安装。
  安装后仍需连上正在运行的 Kimi 服务，不能离线聊天；登录方式不变。

<table>
  <tr><th>中文 · 极光主题</th><th>English · 夜幕主题</th></tr>
  <tr>
    <td align="center">
      <a href="docs/images/feature-pwa-install-zh.png">
        <img src="docs/images/feature-pwa-install-zh.png" alt="手机端安装到桌面面板，中文极光主题" width="220" />
      </a>
    </td>
    <td align="center">
      <a href="docs/images/feature-pwa-install-en.png">
        <img src="docs/images/feature-pwa-install-en.png" alt="手机端 Install app 面板，英文夜幕主题" width="220" />
      </a>
    </td>
  </tr>
</table>

以上是当前安装面板的截图，使用虚构数据，不代表已在实体手机上完成安装。点击可查看原图。

## 模型用量与 API 成本统计

在电脑侧栏或手机的会话列表中，点击 **使用统计**。这里读取本机已保存的用量记录，按模型接口（API）的单价估算费用，不是服务商账单。
请用本工具提供的 `kimi web` 启动服务；如果用 `serve --target` 连接已运行的 Kimi 服务，这里不会提供本机用量。

<table>
  <tr><th width="65%">桌面端</th><th width="35%">手机端</th></tr>
  <tr>
    <td align="center" valign="top">
      <a href="docs/images/feature-usage-desktop.png">
        <img src="docs/images/feature-usage-desktop.png" alt="桌面端使用统计总览" width="360" />
      </a>
    </td>
    <td align="center" valign="top">
      <a href="docs/images/feature-usage-mobile.png">
        <img src="docs/images/feature-usage-mobile.png" alt="手机端使用统计与模型明细" width="60" />
      </a>
    </td>
  </tr>
  <tr>
    <td align="center" valign="top">
      <a href="docs/images/feature-usage-pricing-desktop.png">
        <img src="docs/images/feature-usage-pricing-desktop.png" alt="桌面端自动匹配价格并批量确认" width="360" />
      </a>
    </td>
    <td align="center" valign="top">
      <a href="docs/images/feature-usage-pricing-mobile.png">
        <img src="docs/images/feature-usage-pricing-mobile.png" alt="手机端自动匹配价格并批量确认" width="138" />
      </a>
    </td>
  </tr>
</table>

## 界面预览

下列截图使用基于官方 `0.41.0` 的旧版界面，当前按钮和布局细节可能不同；图中均为虚构演示数据。

![夜幕主题：工作区列表与对话界面](docs/images/theme-nocturne-desktop.png)

<p>
  <img src="docs/images/theme-nocturne-mobile.png" alt="夜幕主题：手机对话" width="31%" />
  <img src="docs/images/theme-ember-mobile.png" alt="余烬主题：模型选择" width="31%" />
  <img src="docs/images/theme-aurora-mobile.png" alt="极光主题：主题切换" width="31%" />
</p>

<details>
<summary>更多操作与主题截图</summary>

选择模型时，可以用手指滑动、鼠标拖动、滚轮或键盘浏览不同服务商的标签。

![模型选择中的供应商导航](docs/images/feature-provider-navigation-desktop.png)

Kimi 还在执行任务时，也可以输入新内容，点“插队”发送。

<p>
  <img src="docs/images/feature-priority-send-desktop.png" alt="桌面端插队发送" width="68%" />
  <img src="docs/images/feature-priority-send-mobile.png" alt="手机端插队发送" width="28%" />
</p>

- 夜幕：[桌面](docs/images/theme-nocturne-desktop.png) · [手机](docs/images/theme-nocturne-mobile.png)
- 极光：[桌面](docs/images/theme-aurora-desktop.png) · [手机](docs/images/theme-aurora-mobile.png)
- 暮色：[桌面](docs/images/theme-twilight-desktop.png) · [手机](docs/images/theme-twilight-mobile.png)
- 余烬：[桌面](docs/images/theme-ember-desktop.png) · [手机](docs/images/theme-ember-mobile.png)
- 矿物青绿：[桌面](docs/images/theme-mineral-desktop.png) · [手机](docs/images/theme-mineral-mobile.png)

</details>

## 升级

先检查是否有新版本，再更新：

```sh
open-kimi-web update --check
open-kimi-web update
```

这只会更新当前使用的 Open Kimi Web，不升级官方 Kimi、不修改会话，也不会自动重启。
更新完成后，停止旧服务，重新运行 `kimi web --host`，再刷新网页。
从源码安装、想切换安装目录或安装方式的用户，请先看[完整升级说明](packages/launcher/README.md#升级)。

## 常见问题

- **手机打不开？** 检查手机和电脑是否在同一网络、防火墙是否放行，以及打开的地址是否与终端一致。电脑 IP 变化后需重启服务。
- **更新后没变化？** 下载新代码不会替换正在运行的旧服务，需要重启 Open Kimi Web 并刷新页面。
- **Tower 没入口？** 这是官方让多个代理分工协作的实验功能，默认关闭。
  [如何开启，有哪些风险](packages/launcher/README.md#推理档位与原生-tower)
- **很大的会话打开仍然慢？** 压缩能减少传输的数据，但电脑重新读取会话、浏览器显示大量内容仍需要时间。
  新版先加载最近消息，也可以用 `--debug` 记录各阶段耗时；这不保证所有大会话都能秒开。
  [如何排查慢在哪里](docs/plans/large-session-debug-log-v1-plan.md)
- **想恢复原来的命令入口？** 运行 `open-kimi-web integrate uninstall`，撤销本工具添加的入口，不卸载任何一方的软件。
  原来已在 PATH 中的 `kimi` 会继续可用；原来只能用完整路径启动的，撤销后仍需完整路径。
- **想换成自己的网页界面？** 用 `--web-dir` 指定网页目录时，不会添加本项目的增强功能。
  这个目录的文件会对外提供访问，不要放登录凭据、配置、日志或备份。

## 更多文档

- [完整安装与命令参考](packages/launcher/README.md) · [更新日志](CHANGELOG.md) · [支持哪些官方版本](UPSTREAM.md)
- [维护与开发](AGENTS.md) · [主题素材](docs/THEME-ASSETS.md)
- [Kimi 插件管理命令](skills/open-kimi-web/SKILL.md)：安装插件不会自动安装或启动 Open Kimi Web 服务。

MIT 许可，见 [LICENSE](LICENSE) 和 [第三方声明](THIRD_PARTY_NOTICES.md)。

[ci-badge]: https://github.com/WilliamLambertCN/open-kimi-web/actions/workflows/ci.yml/badge.svg
[ci-workflow]: https://github.com/WilliamLambertCN/open-kimi-web/actions/workflows/ci.yml
[current-release]: https://github.com/WilliamLambertCN/open-kimi-web/releases/tag/v2.4.1-r2
