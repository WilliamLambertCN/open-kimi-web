# Open Kimi Web 2.5.2-r1 推送与发布

发布流程为 develop 经 PR 合入 main。本次发布从 develop 经 PR 合入 main。
远端 latest 为 v2.4.1-r3，尚无 v2.5.2 tag；采用已验证的官方兼容基线 2.5.2，发布新版本 2.5.2-r1。
本计划记录执行基线，不声称用户逐项审阅；授权来源为用户的明确发布要求。

## 范围与授权

- 发布已本地提交的手机消息目录、App 品牌与版本、话题标签、官方 2.5.2 适配、重复插队逻辑移除及 Windows 清理修复。
- 本次授权覆盖下方功能计划此前“不提交／不推送／不发布”的阶段限制，不扩展到生产重启或用户实际 CLI 升级。
- 不修改安装器缺官方时的 2.4.1 固定版本，也不修改 metadata 失败时的 2.4.1 UI fallback。
  已有可用 Kimi 继续复用；安装和 update 不自动把用户的官方后端升级为 2.5.2。
- 不发布 npm registry，不移动、删除或替换任何旧 tag、Release、资产，不重写共享历史。
- 原 .tmp/ 不读取、暂存或清理；ignored cache、真实会话、凭据、证书私钥和本地 QA 资料不公开。

## 执行顺序

1. 本文由 AGENTS.md 链接。版本入口 packages/launcher/package.json 与 kimi.plugin.json 同步为 2.5.2-r1。
   同步根与 launcher README、插件 skill、UPSTREAM 和 CHANGELOG；保留历史验证记录，不把旧结果写成本轮通过。
   首页维持“界面预览→快速上手”，只在快速上手保留两段系统在线安装命令，继续用真实 tag SHA 获取同提交入口。
2. 沿用已经通过的默认并发完整 UT／IT、真实官方后端及双端三主题实图，不重复全套本地测试或浏览器矩阵。
   对版本和插件一致性做必要定向检查，运行 lint、typecheck 与新版本实际 test:pack。
   定向检查将推送的新提交、文档和正式包内容，排除秘密、个人路径、日志、缓存与调试 sourcemap。
3. 用已核对的 GitHub noreply 身份提交版本准备，推送 develop 并建 develop → main PR。
   等待 required gate：lint、typecheck、带覆盖率的完整 UT／IT、pack；行与分支 70% 门槛不变。
   如失败，修实际根因，不放宽超时、断言、覆盖率或跳过范围，不使用 admin 绕过。
4. 用相同 noreply 身份正常 squash 合入 main，确认 main CI 成功；保持当前 develop 目录，不切换生产可能使用的工作目录。
   从通过 CI 的 main 提交在 ignored 临时 worktree 用标准 pnpm pack 生成正式 tgz。
   核对正式包的版本、范围、必要模块与隐私；若相对候选包有差异，解释实际差异，不重复整包安装矩阵。
5. 仅从上述 main 提交创建 annotated v2.5.2-r1，发布正式非草稿、非预发布的 latest GitHub Release。
   资产固定为 open-kimi-web-2.5.2-r1.tgz；上传前完成实际包审查，不用旧版本包改名。
6. 核对公开 tag、资产原字节及 digest、README 的 tag SHA 与同 SHA 在线入口。
   使用校验过的旧 r3 包原版 latestRelease() 真实联网确认发现新版本，不运行 update 来修改用户安装。
   核对旧 r3 tag 与资产未变化；发布说明明确手动重启、实际后端版本及未验证边界。
7. 记录 PR、CI、main SHA、tag、正式包与线上验证；事后记录另作维护 PR，不移动新 tag 或替换已发布包。
   正常同步 main 回 develop，清理本轮 worktree／解包目录／自有进程，保留 ignored 验证证据。

## 已有验收

- [手机消息目录](mobile-conversation-toc-v1-plan.md)：复用原生消息 ID 与历史分页，精确跳转、主题和窄屏检查已完成。
- [品牌与 2.5.2 适配](branding-and-2.5.2-compatibility-v1-plan.md)：准确 npm 后端 23 项、配置保存／清除／回读 3 项、
  最近页补验 3 项通过；完整 app 双端三主题 20 项几何检查及 12 张图、标题与历史 7 项、子模型／搜索 6 项、WS 6 项通过。
- 默认并发 Windows 标准门禁已通过：2914 UT，644 IT／6 项既有平台跳过，lint、typecheck、test:pack。
  UT 行／分支覆盖率 93.56%／84.86%，IT 84.30%／71.88%，没有提高超时或降低门槛。
- Windows 原 taskkill 超时后父子进程确实存活；改用原生快照、创建时间与句柄确认，保留三秒期限与未确认时的锁。
  真实三代进程及独立服务存活验证通过。sh 短命令探测改为 0.1 秒轮询，15 秒总预算不变。
- 上述结果不代替本次 required CI 或正式资产检查；历史首次失败原记录保留，不改写成首次全绿。

## 未验证与不承诺

实体手机、系统软键盘、任意 400–500 MB 会话及全部安装平台未全面验收；不承诺巨大单轮秒开。
任务列表只读，不新增编辑、暂停或独立 cron 模型；搜索正文须明确启用官方索引，不自动扫描全部历史。
生产服务、官方 CLI、设备信任、会话和系统网络均不由本轮发布自动修改。

## 发布记录

准备、CI、正式包及线上验证结果在实际完成后追加；未记录的检查不视为通过。

### 本地发布准备

- launcher 与插件版本同步为 2.5.2-r1；首页仍为 203 行，预览最前，快速上手两段命令固定新 tag 与同 SHA 入口。
- lint、typecheck、13 项插件一致性 UT 与 2.5.2-r1 实际 test:pack 通过，不重复已通过的完整本地 UT／IT 和实图。
  实际解包确认 Windows 原生源码、品牌、目录和 PWA 资源；真实 runner 超时清理、可信 HTTPS 与静态／API 验证通过。
- 版本和文档 11 文件定向检查通过；136 项本地文件与引用检查通过，修正了准备阶段漏加的新计划引用。
  未新增媒体，未发现本轮新增真实凭据、个人路径、私钥或 sourcemap；原 .tmp/ 和 ignored 证据不公开。
- 标准 pnpm pack 的候选包范围为 168 文件，11 个必要模块均包含，清单及内容与源码一致，包中不含测试、日志或缓存。
  此为发布前记录；候选包不上传，正式结果见下方。

### 正式发布与线上核验

- [PR #42](https://github.com/WilliamLambertCN/open-kimi-web/pull/42) 已通过 required gate 并 squash 合入 main。
  develop、PR 和 main 的 CI 均通过，没有使用 admin 绕过：
  - [develop CI](https://github.com/WilliamLambertCN/open-kimi-web/actions/runs/42791419763)
  - [PR CI](https://github.com/WilliamLambertCN/open-kimi-web/actions/runs/42791430748)
  - [main CI](https://github.com/WilliamLambertCN/open-kimi-web/actions/runs/42791904406)
- Ubuntu CI：2886 UT／625 IT 通过，28／25 项平台条件跳过；UT 行／分支覆盖率 93.39%／84.93%，
  IT 为 85.07%／72.92%。lint、typecheck、实际包验证通过，70% 门槛不变，不提高超时或扩大跳过范围。
- 正式 main 提交为 `f5d510e371b7faf4f0ab1abf72674a35fd4a0806`。
  annotated tag `v2.5.2-r1` 的对象为 `5c6b926fc60bd39d66a30958e52279e6b35d6d6d`，准确指向该提交。
  提交作者、squash 作者和 tagger 均为已确认的 GitHub noreply；GitHub 合并提交者使用其正常 noreply。
- 正式包从该 main 提交的隔离 worktree 用标准 pnpm pack 生成：168 文件、8,491,803 bytes，11 个必要模块齐全。
  SHA-256：`2909bec8db7b2b8ac35a19829b541bd70c9261fa84957e5de94cf7267210dbd0`。
  与候选包逐项比较，40 文件仅 Git 换行不同，其余内容一致；正式清单及文件与 main 源码相符。
- [正式 Release](https://github.com/WilliamLambertCN/open-kimi-web/releases/tag/v2.5.2-r1)
  发布于 2026-11-10T17:40:48+08:00，为非草稿、非预发布的 latest。
  唯一资产 `open-kimi-web-2.5.2-r1.tgz`，资产 ID `730883077`；公开下载的原字节、大小与 GitHub digest 均与正式包一致。
- README 和三个在线安装脚本已按同一 tag 提交逐字节核对。
  首次核验把 Windows worktree 的 CRLF 与 Git 原始 LF 直接比较而失败；已确认仅换行差异，改为核对 tag 的 Git 对象后通过。
  首页顺序、两段系统命令及版本引用正确，没有执行这些在线脚本来改用户安装。
- 从旧 r3 正式包校验、解包后调用其原版 latestRelease()，真实联网发现 2.5.2-r1 及准确资产地址。
  旧 r3 的 tag 对象、目标提交、Release、资产 ID／大小／digest／更新时间均未变化。
- 新公开提交、文档与正式包的定向隐私检查未发现本轮新增凭据、个人路径、私钥、调试 sourcemap 或真实会话。
  没有新增媒体；不把 ignored 日志、检查脚本、旧包解包目录或原 .tmp/ 提交，不扩称已重审全部旧历史。
- 未升级用户实际官方 CLI、运行 update 修改安装或重启生产；上方实体手机、任意大会话及全平台边界保持不变。
  本节为发布后记录，另走维护 PR，不移动新 tag 或替换已发布资产；main 以普通 merge 同步回 develop。
