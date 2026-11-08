# Open Kimi Web 2.4.1-r3 推送与发布

用户明确授权“推送吧，发布”。当前远端 latest 为 v2.4.1-r2，r3 不存在；develop 与 main 均与远端一致。
本次发布已完成的双端分叉菜单、手机置顶，以及工作树内已完成验收但未发布的局域网 CA 与手机证书安装指引。
不纳入原 .tmp/、ignored cache、真实会话、证书或凭据；不改变官方兼容基线 2.4.1。
本计划经工具自动放行，不代表用户逐项审阅；执行范围来自用户的发布授权。

## 执行顺序

1. 本文作为完整发布基线，由 AGENTS.md 链接。
   此次用户授权覆盖功能计划此前不提交／不发布的阶段限制，不包含生产重启、修改设备信任或旧版本。
2. 以 packages/launcher/package.json 与 kimi.plugin.json 为版本入口，同步为 2.4.1-r3。
   更新 README.md、packages/launcher/README.md、skills/open-kimi-web/SKILL.md、UPSTREAM.md 和 CHANGELOG.md。
   按用户追加要求重排 README：界面预览置于最前，一键安装两段在线命令归入“快速上手”，去掉重复介绍。
   保留原截图及历史证据；说明分叉／置顶位置、本来源 pin 与显式 tls setup。
   安装入口继续解析真实 tag SHA 并下载同 SHA 文件，不预写不存在的 SHA。
3. 针对本次将提交的所有文件及新提交历史执行隐私检查，检查真实包清单与内容。
   已通过且未变化的官方 2.3.1／2.4.1 UI、193 UT、5 asset IT、CA 全量门禁不重复验收。
   发布准备运行 lint、typecheck 与实际 test:pack；新版本及插件一致性做必要定向检查。
   根、叶私钥、真实本机地址、个人路径、日志、cache、sourcemap 不得进入提交或包。
4. 使用已核对的 GitHub noreply 身份提交明确文件清单到 develop，推送并建 develop → main PR。
   通过现有 required CI：lint、typecheck、带覆盖率的 UT／IT、pack，保留 70% 行与分支门槛。
   CI 失败只修实际问题，不放宽断言或跳过；不重跑无关浏览器或安装矩阵。
5. 正常 squash 合入 main，显式 noreply 作者，确认 main CI。保持原 develop 工作目录不切换，避免影响使用中的源码服务。
   在 ignored 临时 worktree 从已通过 main 提交生成正式 tgz，核对与候选包必要模块、版本、隐私及差异。
   只从该 main 提交创建 v2.4.1-r3，并发布正式 latest GitHub Release 和 open-kimi-web-2.4.1-r3.tgz。
6. 核对公开 tag 指向、资产原字节及 digest、同 SHA 在线入口；用真实旧 r2 更新检查确认能发现 r3。
   不在本机运行安装器或升级用户安装。新功能与 CA 实体手机安装边界如实写入发布说明。
7. 记录 PR、CI、tag、资产与未验证项，正常同步 main 回 develop 并推送维护记录。
   不移动新旧 tag、不替换旧包；清理本次 worktree、进程、临时 profile，报告下载链接与 update 命令。

## 范围与证据

- [双端会话菜单](session-menu-actions-v1-plan.md)：分叉、手机已置顶区与取消置顶，中英与键盘、窄屏、草稿及上传保护。
  已完成 193 定向 UT、5 资产 IT、真实官方后端 23 项、完整官方 app 的首轮及修后补验。
  原始 125／129、手机 42／43 与桌面 30／31 保留，不改写旧报告；最后两版 Tab／Shift+Tab 18／18。
- [局域网证书](android-lan-ca-v1-plan.md)：显式 setup 保持根稳定、签发网站证书、公开根下载与核对指纹的手机步骤。
  已完成标准 lint、typecheck、2634 UT、642 IT／6 条件跳过、pack、可信 HTTPS／WSS 和 34 项官方 app 界面验证。
- 上述历史证据不代替本次发布所需的实际包、隐私与 required CI，也不等同实体手机安装。

## 不做的事

- 不发布到 npm registry，不移动／删除任何旧 tag、Release 或资产，不重写已有共享历史。
- 不自动升级官方 Kimi、修改 PATH／会话／设备信任，不重启生产，不读取真实用户凭据或会话。
- 不将 localhost／虚构数据截图当成实体安卓 WebAPK 安装验收，不承诺置顶跨设备或 IP 同步。

## 发布记录

### 本地发布准备

- 版本与插件均已同步为 `2.4.1-r3`，官方基线不变；按用户追加要求重写 README 顺序，保留原图与安全安装命令。
- 本次标准 lint、typecheck、13 项插件一致性 UT 和 `test:pack` 通过。
  实际包内新菜单及 CA 模块齐全，已验证 version、PWA 资源、CA setup／status／复用／disable、
  只信任根的 HTTPS 下载、静态资源、API 代理和脱敏日志；没有重跑已通过的浏览器矩阵。
- 源码／正式测试／pack 检查共 33 文件未发现真实凭据、个人路径、真实会话或 sourcemap；
  鉴权字段、虚构 fixture 与运行时生成的证书不属于硬编码秘密。
- 文档及版本清单 11 文件定向检查未发现真实凭据、个人路径或设备地址；没有新增或修改公开图片。
  根 README 共 203 行，界面预览最前，安装与启动归入快速上手；115 项本地链接／锚点无错误，原图引用保留。
- 标准 pnpm pack 生成候选包，共 159 文件／8,476,028 bytes；11 个新增运行模块均在包中，内容与源码一致。
  SHA-256：`a89fc84254fa02c0711c9758f4cbc0bfa69f2ccaea55c80270bac3949b23e981`。
  包内无私钥、证书文件、日志、测试、缓存或调试映射；pnpm 正常移除打包脚本并保留空 scripts 对象。
  核对脚本最初漏计此空对象、文档扫描的转义表达式有误，纠正检查后通过，未改产品绕过。
- 增改行长、diff 空白检查通过；推送前已核对新增提交身份及 44 文件清单，未纳入原 .tmp/ 或 ignored cache。

### CI 与线上发布

- [PR #39][release-pr] 正常 squash 合入 main；[PR CI][pr-ci]、develop CI 及 [main CI][main-ci] 均通过。
  标准 lint、typecheck、UT、IT、test:pack 全部成功，没有降低 70% 行／分支门槛或扩大跳过范围。
  UT：118 文件、2744 项通过、28 项平台条件跳过；行覆盖率 93.37%，分支覆盖率 84.91%。
  IT：30 文件通过、1 文件跳过，625 项通过、23 项平台条件跳过；行覆盖率 85.16%，分支覆盖率 72.95%。
- [v2.4.1-r3][release] 于 `2026-11-08T07:48:03Z` 正式发布，为 latest，非草稿／预发布。
  annotated tag object：`24c1291f704dfb0d5c664385832983250efff416`。
  固定指向通过 CI 的 main commit：`e0ec0f9223322445320cde99eaa551e7a0076104`。
- [正式 tgz][asset] 从上述 main 提交在隔离 worktree 用标准 pnpm pack 生成，159 文件／8,474,802 bytes。
  SHA-256：`19ca7f1df4ac90bb673cec8d3ff8b0f575191e6aa80c4126c46ce158c08d537c`。
  包内容与 main 一致；相对候选包有 30 文件仅换行不同，没有语义差异。候选包未上传。
  公开下载包与本地正式包原字节相同，GitHub asset ID 723285038、size 及 digest 一致。
- 真实旧 r2 包已按原公开 SHA-256 校验；用包内原版 `latestRelease()` 进行真实网络检查，
  成功发现 r3 精确资产地址，版本比较为新版；没有运行更新来修改用户安装。
- README tag commit API 返回上述 main SHA；同 SHA 的 install.ps1、install.sh、install.mjs 和 README 原字节一致。
  公开 README 先预览后快速上手、两段安装命令均固定 r3；未运行安装器或关闭 TLS 校验。
- 原 r2 tag object／目标、资产 ID、大小、digest、更新时间保持不变；未修改其它旧 tag 或资产。
  新提交、tag 与 squash 作者为已确认 noreply，不重写旧公开历史；本轮无真实会话、CA 私钥或测试日志公开。
- 发布后仅补维护记录，不移动 r3 tag 或替换包；正常同步 main 与 develop。
  报告归档 ignored .cache/release-2.4.1-r3/，没有本轮后台任务或生产重启。
  实体手机、系统软键盘、任意大会话及全部安装平台仍未全面验收；CA 导入与服务重启仍由用户决定。

[release-pr]: https://github.com/WilliamLambertCN/open-kimi-web/pull/39
[pr-ci]: https://github.com/WilliamLambertCN/open-kimi-web/actions/runs/42459847523
[main-ci]: https://github.com/WilliamLambertCN/open-kimi-web/actions/runs/42460011585
[release]: https://github.com/WilliamLambertCN/open-kimi-web/releases/tag/v2.4.1-r3
[asset]: https://github.com/WilliamLambertCN/open-kimi-web/releases/download/v2.4.1-r3/open-kimi-web-2.4.1-r3.tgz
