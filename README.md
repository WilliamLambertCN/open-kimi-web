# Open Kimi Web

![20 秒演示：从桌面图标打开，手机发起测试，查看首字延迟、输出速度和本地费用估算](docs/images/mobile-workflow.gif)

手机发任务，电脑跑 Kimi Code。开场取自桌面 Chromium 启动器，随后是手机尺寸的真实网页。用量为演示数据，费用是本地估算。

<details>
<summary>更多界面截图：桌面、手机与五套主题</summary>

下列主题截图使用基于官方 `0.41.0` 的旧版界面，当前按钮和布局细节可能不同；图中均为虚构演示数据。

![夜幕主题：工作区列表与对话界面](docs/images/theme-nocturne-desktop.png)

<p>
  <img src="docs/images/theme-nocturne-mobile.png" alt="夜幕主题：手机对话" width="31%" />
  <img src="docs/images/theme-ember-mobile.png" alt="余烬主题：模型选择" width="31%" />
  <img src="docs/images/theme-aurora-mobile.png" alt="极光主题：主题切换" width="31%" />
</p>

选择模型时，可以用手指滑动、鼠标拖动、滚轮或键盘浏览不同服务商的标签。

![模型选择中的供应商导航](docs/images/feature-provider-navigation-desktop.png)

当前 `2.6.1` 界面：桌面列表可直接切换平铺 / 按项目（虚构演示数据）。

<img src="docs/images/feature-desktop-view-switch.png" alt="桌面列表的平铺与按项目按钮" width="300" />

以下旧版截图包含 OKW 曾添加的“插队”按钮。新版已移除重复按钮，发送与插队使用官方界面。

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

## 快速上手

> 非官方社区项目，与 Moonshot AI 无关联。[v2.7.2-r2][current-release] 适配 Kimi Code `2.7.2`，保留 `2.6.0`／`2.6.1` 支持。
> 不自动升级已有官方 Kimi。具体功能和限制见 [兼容说明](UPSTREAM.md#kimi-code-272-adaptation)。

**Windows：打开 PowerShell，粘贴运行。**

```powershell
& {
    $ErrorActionPreference = 'Stop'
    $version = '2.7.2-r2'
    $github = "https://github.com/WilliamLambertCN/open-kimi-web/releases/download/v$version/okw-install-$version.zip"
    $defaultProxy = 'https://ghfast.top'
    $proxy = $env:OPEN_KIMI_WEB_GITHUB_PROXY
    if (-not $proxy) { $proxy = $defaultProxy }
    if ($proxy -ceq '0') { $proxy = '' }
    elseif ($proxy -cnotin @($defaultProxy, "$defaultProxy/")) {
        throw "OPEN_KIMI_WEB_GITHUB_PROXY must be $defaultProxy or 0 (disable)."
    }
    $digest = '8caa23b5bb95690642232dae848cde24cd816d4f948f253ccd5b9790ab05ddfa'
    $stage = Join-Path ([IO.Path]::GetTempPath()) ('okw-install-' + [Guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($stage) | Out-Null
    $archive = Join-Path $stage 'installer.zip'
    $previousDigest = $env:OPEN_KIMI_WEB_INSTALL_SHA256
    function Get-VerifiedInstaller([string] $url, [int] $seconds, [string[]] $redirects = @()) {
        if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
        $ErrorActionPreference = 'Continue'
        $status = & curl.exe -qfsS --proto '=https' --tlsv1.2 --max-time $seconds --max-filesize 2097152 `
            --output $archive --write-out '%{http_code}' @redirects $url 2>$null
        return ($LASTEXITCODE -eq 0 -and $status -ceq '200' -and
            (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -eq $digest)
    }
    try {
        $env:OPEN_KIMI_WEB_INSTALL_SHA256 = '1a4b95390cc9f2d20863303b494adac317e5cc239773429baac706ca9ac6ffbb'
        $follow = @('--location', '--proto-redir', '=https', '--max-redirs', '4')
        $ready = $false
        if ($proxy) {
            $ready = Get-VerifiedInstaller $github 2 $follow
            if (-not $ready) {
                $ready = Get-VerifiedInstaller ($proxy.TrimEnd('/') + '/' + $github) 45
                if ($ready) { Write-Host 'Installer: verified the archive downloaded via the GitHub download proxy.' }
            }
        }
        if (-not $ready) { $ready = Get-VerifiedInstaller $github 45 $follow }
        if (-not $ready) { throw 'Could not download a verified installer.' }
        Expand-Archive -LiteralPath $archive -DestinationPath $stage
        $installer = Join-Path $stage 'scripts/install.ps1'
        $source = [IO.File]::ReadAllText($installer)
        $status = & {
            . ([scriptblock]::Create($source))
            Invoke-OkwInstall @('--version', $version) (Split-Path -Parent $installer)
        }
        if ($status -ne 0) { throw 'The installer did not complete.' }
    } finally {
        $env:OPEN_KIMI_WEB_INSTALL_SHA256 = $previousDigest
        Remove-Item -LiteralPath $stage -Recurse -Force
    }
}
```

**macOS / Linux：打开终端，粘贴运行。**

```sh
(
  set -eu
  version='2.7.2-r2'
  github="https://github.com/WilliamLambertCN/open-kimi-web/releases/download/v$version/okw-install-$version.tar.gz"
  default_proxy='https://ghfast.top'
  proxy=${OPEN_KIMI_WEB_GITHUB_PROXY:-$default_proxy}
  digest='6d2de4138175640c1ba807f7e55bde311312c1494eb568cd292d365f2002e211'
  case "$proxy" in
    0) proxy='' ;;
    "$default_proxy"|"$default_proxy/") ;;
    *) printf '%s\n' "OPEN_KIMI_WEB_GITHUB_PROXY must be $default_proxy or 0 (disable)." >&2; exit 1 ;;
  esac
  export OPEN_KIMI_WEB_INSTALL_SHA256='1a4b95390cc9f2d20863303b494adac317e5cc239773429baac706ca9ac6ffbb'
  stage=$(mktemp -d "${TMPDIR:-/tmp}/okw-install-XXXXXXXX")
  trap 'rm -rf "$stage"' EXIT
  trap 'exit 1' HUP INT TERM
  file=$stage/installer.tar.gz
  verify() {
    if command -v sha256sum >/dev/null 2>&1; then
      hash=$(sha256sum "$file") || return 1
    else
      hash=$(shasum -a 256 "$file") || return 1
    fi
    [ "${hash%% *}" = "$digest" ]
  }
  download() {
    url=$1 seconds=$2
    shift 2
    rm -f "$file" || return 1
    status=$(curl -qfsS --proto '=https' --tlsv1.2 --max-time "$seconds" --max-filesize 2097152 \
      --output "$file" --write-out '%{http_code}' "$@" "$url" 2>/dev/null) && [ "$status" = 200 ] && verify
  }
  from_github() {
    download "$github" "$1" --location --proto-redir '=https' --max-redirs 4
  }
  if [ -z "$proxy" ]; then
    from_github 45 || { printf '%s\n' 'Could not download a verified installer from GitHub.' >&2; exit 1; }
  elif ! from_github 2; then
    if download "${proxy%/}/$github" 45; then
      printf '%s\n' 'Installer: verified the archive downloaded via the GitHub download proxy.'
    elif ! from_github 45; then
      printf '%s\n' 'Could not download a verified installer from GitHub or its download proxy.' >&2
      exit 1
    fi
  fi
  tar -xzf "$file" -C "$stage"
  sh "$stage/scripts/install.sh" --version "$version"
)
```

电脑上已有可用的 Kimi 就继续复用，不重新下载或升级；没有时才下载。损坏或无法识别的安装会报错，不直接覆盖。
脚本按需准备 Node.js、npm 和 Windows Git Bash，需要联网，不用预装 Corepack 或 pnpm。
默认配置命令入口，原来的 CLI、配置和会话继续可用；首次登录由你完成，安装不会启动服务。

安装完成后，新开终端启动：

```sh
kimi web --host
```

手机连接同一局域网，打开终端打印的 **Network** 链接。首次遇到证书警告，先与终端核对 SHA-256 指纹。
**链接含登录凭据（token），拿到它的人能读写文件、执行命令。不要分享。**
默认端口 `48627`，被占用时用 `kimi web --port <port>` 更换。
[npm 安装及更多命令](packages/launcher/README.md#安装)

### 源码安装（Windows PowerShell / macOS / Linux）

需先准备 Node.js ≥ 22、Git、Corepack 和可运行的官方 Kimi；官方 npm 版需 Node.js ≥ 22.19.0，Windows 还需 Git Bash。

```sh
git clone --branch main https://github.com/WilliamLambertCN/open-kimi-web.git
cd open-kimi-web
corepack pnpm install --frozen-lockfile
node packages/launcher/bin/open-kimi-web.mjs integrate install
```

已有源码时，安装直接使用该目录的当前代码，无需构建前端。历史清理前的旧克隆须先备份改动并重新克隆；
然后按[切换说明](packages/launcher/README.md#升级)处理。
安装后新开终端运行 `kimi web --host`；源码目录需要保留，安装不会启动或重启服务，也不升级官方 Kimi。

## 有哪些增强

- **会话导航**：电脑和手机都能浏览或粘贴运行端目录新建工作空间，同一目录已登记时只提示已存在，不再重复添加。
  手机可搜索会话、平铺所有会话并选择排序、为子代理选模型；电脑列表标题旁有平铺／按项目两个按钮，点一下就能换视图。
- **会话菜单**：电脑三个点打开原生 Fork／分叉菜单；手机三个点可分叉、置顶或取消置顶，
  已置顶会话在列表顶部“已置顶／Pinned”区。置顶只留在本浏览器、同一站点，不跨 IP 同步。
  仍可置顶工作区、按最近活动排序，分叉会话保留 `Fork:` 标记；归档会话永久删除前会再次确认。
  [菜单操作与草稿保护](packages/launcher/README.md#会话三个点菜单)
- **阅读与提醒**：聊天区随窗格宽度调整，显示会话记录大小和消息时间，完整预览图片，切换标签先显示加载状态。
  手机可点消息目录跳转旧消息，并显示完成、审批和提问提醒；提问卡片可拉高，发送和插队沿用官方操作。
  手机触摸浏览不再误触悬停提示（2.6.1-r3 起）。
- **模型与主题**：从服务商获取模型后选择添加，调整顺序、能力与思考强度，Max 放最后，不自动改写已有配置。
  可选五套主题或恢复官方外观；电脑从账号菜单、手机从设置进入“氛围主题”。
- **请求与侧聊**：在每次回复或工具过程后查看 TTFT、包含等待的平均 TPS 和缓存命中率；侧聊可单独选模型。
  指标按实际代码结构启用；`2.6.0`／`2.6.1`／`2.7.2` 已适配新版会话接口，见 [兼容说明](UPSTREAM.md)。
- **连接**：HTTPS、Hyper-V 地址识别和传输压缩；源码与 npm 安装均可更新，也能恢复原命令入口。
  手机和电脑都可在设置中重启受管服务；空闲时在原地址重连，不自动重发消息。

启动加 `--scheduled-tasks` 才显示定时任务。官方 `2.4.1`／`2.5.2`／`2.6.0`／`2.6.1`／`2.7.2` 仅可查看任务与已有历史，
不能编辑、暂停或单独选模型，也不能与同一 Kimi 服务的官方 Remote Control 同时开启。[使用限制](packages/launcher/README.md#统一导航与会话搜索)

### 子代理候选池

电脑在“设置 → 智能体与会话 → 子智能体”，手机在会话设置中点“管理候选池”。
可以编辑各候选给主代理的选择说明、手动添加模型和选择默认候选；“大哥 / 小弟”是可改的说明模板，不限制候选数量。
[功能与保存边界](packages/launcher/README.md#子代理候选池与说明)

<p>
  <a href="docs/images/feature-subagent-pool-desktop.png">
    <img src="docs/images/feature-subagent-pool-desktop.png" alt="桌面子代理候选池，虚构模型与说明" width="67%" />
  </a>
  <a href="docs/images/feature-subagent-pool-mobile.png">
    <img src="docs/images/feature-subagent-pool-mobile.png" alt="手机子代理候选池，虚构模型与说明" width="26%" />
  </a>
</p>

## 安装到手机桌面

手机打开会话／工作区列表，点 **安装到桌面**；电脑侧栏也有入口。

- **Android／电脑**：浏览器支持时直接点“安装”，否则按面板提示从浏览器菜单操作。
- **iPhone／iPad**：Safari“分享”→“添加到主屏幕”；若有“作为 Web App 打开”，保持开启。
- 需设备信任的 HTTPS，跳过证书警告不一定能安装。安装后仍需联网访问正在运行的 Kimi，不能离线聊天，登录方式不变。

`2.4.1-r3` 起支持[局域网证书指引](packages/launcher/README.md#局域网证书)：
电脑沿用 Open Kimi Web 的数据目录（未改过就用默认值），运行一次 `open-kimi-web tls setup`，再自行重启服务。
手机核对电脑终端显示的证书指纹，由本人导入根证书，再重开 Chrome；不会自动修改设备信任。
证书可信也不保证所有安卓设备都能安装；局域网和 EasyTier 地址仍分别登录，桌面图标不会自动切换地址。

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

以上安装面板使用虚构数据，不代表实体手机已完成安装。点击可查看原图。

## 模型用量与 API 成本统计

在电脑侧栏或手机会话列表点 **使用统计**，按日期、模型或工作区查看 token、缓存命中和估算费用。
支持自动匹配、批量确认和手填单价；读取本机用量，按 API 单价估算，不是服务商账单。
需用本工具的 `kimi web` 启动，独立 `serve --target` 不提供本机用量。

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

## 升级

```sh
open-kimi-web update --check
open-kimi-web update
```

源码仓库已清理提交历史。旧克隆不能直接快进更新；先保留本地改动，再重新克隆，不要强制覆盖。
一键／npm 安装不受历史清理影响，正常升级即可；部分旧版下载包已撤下，请使用最新版。

只更新当前使用的 Open Kimi Web，不升级官方 Kimi、不修改会话或自动重启。
完成后停止旧服务，重新运行 `kimi web --host`，再刷新网页。
[源码升级、切换安装方式](packages/launcher/README.md#升级) · [下载代理（2.7.2-r2 起）](packages/launcher/README.md#下载代理)

## 常见问题

- **手机打不开？** 核对网络、防火墙和终端地址；电脑 IP 变化后需重启服务。
- **更新后没变化？** 新文件不会替换旧进程，需重启服务并刷新网页。
- **Tower 没入口？** 官方多代理协作实验默认关闭。[开启条件与风险](packages/launcher/README.md#推理档位与原生-tower)
- **大会话仍慢？** 最近页和压缩不消除后端读取、浏览器解析与显示成本，不保证秒开。
  可加 `--debug` 排查。[日志说明](packages/launcher/README.md#慢加载诊断)
- **恢复原命令？** 运行 `open-kimi-web integrate uninstall`，只撤销本工具入口，不卸载软件。
  原 Kimi 已在 PATH 中则继续可用，否则仍需完整路径。
- **自定义网页？** `--web-dir` 不添加本项目增强；目录会对外服务，勿放凭据、配置、日志或备份。

## 第一次提 PR？

[改一处主题配色，或改一句子代理说明](CONTRIBUTING.md)。两种改动都不用碰代理后端。

## 更多文档

- [完整安装与命令](packages/launcher/README.md) · [更新日志](CHANGELOG.md) · [官方版本兼容](UPSTREAM.md)
- [维护与开发](AGENTS.md) · [主题素材](docs/THEME-ASSETS.md)
- [Kimi 插件管理](skills/open-kimi-web/SKILL.md)：安装插件不会自动安装或启动服务。

[![CI][ci-badge]][ci-workflow]
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

MIT 许可，见 [LICENSE](LICENSE) 和 [第三方声明](THIRD_PARTY_NOTICES.md)。

[ci-badge]: https://github.com/WilliamLambertCN/open-kimi-web/actions/workflows/ci.yml/badge.svg
[ci-workflow]: https://github.com/WilliamLambertCN/open-kimi-web/actions/workflows/ci.yml
[current-release]: https://github.com/WilliamLambertCN/open-kimi-web/releases/tag/v2.7.2-r2
