# Open Kimi Web：手机列表恢复与安装自更新 v1

开始时间：沿用本轮原始任务 2026-10-08 21:43:24 +08:00（1791467004762），含等待及暂停。

## 交付范围与既有成果

- 桌面会话体积补齐已实现并完成标准检查、官方 2.1.1 浏览器验收，保留现有未提交改动。
- 本轮继续处理用户新指出的手机平铺/排序缺失，并增加源码及 npm 安装的 `update` 命令。
- 实现阶段未提交、推送或发布；用户于 2026-10-09 明确授权发布，当前继续准备 `v2.1.1-r8`。
  发布只更新项目源码和 GitHub Release，不执行用户安装的真实更新，也不重启用户服务。
- 保持外层增强边界，不修改官方 bundle、Vue 私有状态、后端数据库或官方 Kimi 安装。
- 本计划为实现、审查及验收基线，AGENTS 链接；范围变化先同步本文。

## 已核对事实

- `presentation.js:305-315` 强制切到按工作区，`presentation.css:653-655` 隐藏原生 view-tabs。
  原生手机本来提供平铺/按工作区，原生选择持久化到独立 mobile-switcher-view-mode。
- 官方 2.1.1 手机没有桌面排序菜单；桌面菜单是工作区手动/最近活动，不是会话任意排序。
  手机平铺及工作区内会话仍按更新时间；分组按最近会话。不能把登记顺序标为手动排序。
- 官方 mobile `.mlist > .mgroup` 没有 DOM workspace ID，路径可能缩写并冲突，不能猜身份。
- launcher 为 `packages/launcher`；根 package 为 private pnpm monorepo。CLI 已有前置 integrate dispatch。
- 当前未发布 npm registry 包，npm 安装来自 GitHub Release tgz；稳定版本包括 `2.1.1-rN`。
- 接管 shim 固定引用安装入口；同路径更新不需 repair；当前 cwd/npm 默认 prefix 不代表执行安装。
- npm global 正常不保存 receipt；识别须组合 package manifest、标准布局与该 prefix 的精确 bin 目标。
- 现有 integration/proc runner 不适合更新：batch 字符展开、无输出上限、超时仅杀父进程。

## A. 手机原生视图与展示排序

1. 在 `presentation.js` 删除强制 grouped click、相关 WeakMap/WeakSet、desktop 恢复时的 tab replay。
   保留 sheet 识别及 okw-workspaces class；删除 CSS 的 view-tabs 隐藏规则，沿用原生控件样式。
   不重置旧用户持久化的 grouped 选择；用户可自行切平铺并由官方记忆。
2. 新增独立 `mobileWorkspaceSort.js/css`，在 view-tabs 后提供明确“工作区排序”控件。
   保持 `.actions + .view-tabs` 邻接，避免破坏用量统计入口。
   选项为“最近会话”（默认原生实时顺序）、“工作区名称”、可用时“桌面保存顺序”。
   平铺不显示工作区排序；会话仍由官方更新时间排序，不伪称新增手动拖排。
3. 仅用 CSS order 改现有 grouped 容器的视觉顺序，不重建或移动 Vue 子节点，不改变 API。
   grouped list 专属 column layout 且 group 不压缩；保留折叠、选择、菜单和 show more handler。
   每次使用当前 DOM 子节点顺序作为 recent/tie，非一次性快照。切 flat/desktop 清理自有样式。
4. 排序选择使用独立枚举 localStorage key，不写官方 view/sort/order 键，不保存标题/路径。
   桌面保存顺序只读官方 workspace-order；已有 pin IDs 在可唯一映射时按 pin 序在前，不另存 pin。
   观察成功同源 workspace/fs:home/group 响应，内存只保留身份投影；不解析聊天正文或另建会话状态。
   路径缩写双向唯一才能绑定 ID；同名/缩写冲突、缺数据不猜测，身份依赖模式不可用并清楚提示。
   不从过滤/分页列表清理 pins。CSS 视觉排序不改变 DOM 键盘/阅读顺序，文档明确这个边界。
5. 更新注入清单 `officialPresentation.mjs` 及 launcher-official IT，增加真实 sheet fixture 回归：
   初始 flat/grouped 零合成点击、原生选择不被恢复、存储失败、即刻排序与记忆、唯一映射/冲突、
   pins、实时原生重排、节点身份/折叠/pagination 不变、observer 收敛、streaming 零全局扫描。
6. 复用隔离官方 2.1.1 QA：320/390/640，短长名，Original 浅深及所有受影响主题。
   真实触摸/键盘选择视图及排序、关开/reload 保留、会话选择/show more、断点控制桌面不变。
   baseline 仅禁新增增强并移除旧错误强制逻辑前后对比，实际查看截图及几何，无重叠/横向溢出。

## B. `open-kimi-web update`

### 对外命令

- `update`：更新实际执行的安装；`update --check`：只检查并列出准确目标/版本/命令；`update --help`。
- 0=成功/已最新/检查完成，1=网络/识别/安全拒绝/安装/验证失败，2=参数错误。
- 不加 force、任意 URL、自动提权、切换渠道或重启选项，不使用不存在的 npm @latest。
- 修改 `cli.mjs` 早期分发及 `args.mjs` help；缺服务依赖时 check/help 仍可运行。

### 安装识别

1. 从自身模块及 bin realpath 推导 package，不从 cwd/PATH 猜安装。
2. source：精确 monorepo packages/launcher、root package/lock、Git root。
3. npm global：标准 Windows prefix/node_modules 或 POSIX prefix/lib/node_modules，manifest/bin 正确，
   package 非 link，目标 prefix 自己的 shim/symlink 精确指向当前入口。支持自定义 prefix。
   Windows 只解析已知 npm cmd-shim 文本，未知模板拒绝，不执行 batch 解释。
4. npm local：简单 owner/node_modules 直接依赖，manifest 和 v2/v3 lock 类别/版本/bin 一致，
   owner .bin 精确指向当前入口，保留 dependencies/devDependencies 类别并更新 manifest/lock。
   明确拒绝 transitive、workspace、link、mixed-manager、shrinkwrap 冲突、陈旧证据及含官方 Kimi 的 owner。
5. npx lifecycle/_npx/cache、任意解压目录、身份冲突均拒绝并给明确安装/手工操作建议。
   不静默改成更新另一份 global 安装。

### source/main 更新

- 只接受官方仓库精确 HTTPS/SSH origin、main 且 tracking origin/main，干净树及无进行中 Git 操作。
  staged、tracked、untracked、develop、detached、错误 origin、领先/分叉都拒绝；不 stash/reset/clean/rebase。
- check 用有界 ls-remote，不 fetch 或安装；实际更新 fetch 无 tags/submodules，冻结 fetch SHA，
  验证祖先关系并在修改前复查 HEAD/branch/dirty，merge --ff-only 精确 SHA。
- 验证目标 manifest 的 Node 门槛，然后 corepack pnpm install --frozen-lockfile。
  不装全局工具、不改官方 Kimi。source main 可能领先最新 tgz，输出区别，不能伪装为同一渠道。

### npm 更新

- 固定 GitHub latest release API，有界响应、deadline、拒绝 redirect；验证非draft/prerelease，
  精确 vX.Y.Z[-rN]、asset 名、唯一 HTTPS 官方仓库 URL，无凭据/query/hash。
- 数字比较含 r10>r9、不降级、不在缺资产/坏release时回退旧包；网络/限流明确错误。
- 以已识别 scope/prefix 安装该固定 tgz；local 显示 manifest/lock 会更新，保留依赖类别。
  ignore-scripts/no-audit/no-fund/engine-strict，不删除用户 dev deps，不执行 owner 生命周期。
- npm/Corepack 通过正向验证 manifest.bin 的 JS CLI，由当前 Node shell:false argv 调用，
  不把路径/URL拼成cmd命令。支持Windows空格、&、%等路径；未知工具wrapper明确拒绝。
- npm 显式固定 replace-registry-host=never；local 额外 location=project、save=true，
  避免已有配置改下载 host、安装模式或保存行为；替换前及 fresh 验证核对 scope、root、owner／prefix 和 local 类别。

### 执行与失败

- 独立小模块 `src/update/{updateMain,installation,githubRelease,sourceUpdate,npmUpdate,process}.mjs`，
  需要时拆 tool resolver/lock，保持职责小，不引入依赖、配置框架或更新数据库。
- 实际更新以安装外 exclusive lock 串行，同一安装不能并发；check 不写锁。进程输出有界、deadline。
  自有子树取消/timeout：POSIX独立process group，TERM 后有界宽限再 KILL，不能因父先退出跳过仍存活的 group；
  Windows精确PID taskkill /T，只清自己的存活树，不追杀已退出／可能复用的 PID。
  不按进程名或端口杀用户服务；异常脱离父进程不能假称无条件收尾保证，明确错误及边界。
  父先退出且后代收尾无法确认时，返回明确 cleanup 未确认状态并保留安装锁，提示核实原 updater 后手工移除。
- 更新前加载所需实现，避免替换目录后混用新旧动态 imports。新进程读取同入口 --version、依赖可用性，
  source再验证commit。不从当前进程模块缓存验证新版本。
- 不改 integration state/wrapper/PATH/certs/cache/官方会话，也不自动 repair/重启。
  输出需停止旧launcher再启动并刷新。更新非原子：Git推进或npm部分完成后失败明确阶段、当前事实、恢复命令，
  不自动回滚、不声称原安装未变。

### 测试与文档

- UT：release/版本/host/asset/timeout，source safety，各安装布局/模糊/npx，CLI参数及缺依赖，
  runner注入安全/有界输出/timeout/cancel、锁、部分失败与新进程校验。
- IT：隔离临时Git真实fastforward/拒绝路径，真实npm临时global prefix及local包替换，
  Windows正向JSCLI/特殊字符路径，更新后的launcher实际静态/代理调用；不更新本工作树或用户全局安装。
  sentinel核对integration/官方数据及独立服务不变，自有测试树停止。网络只用测试注入fixture，不提供生产任意URL。
- 扩展一次 pack smoke 确认 shipped update 与实际安装可用；标准 lint/typecheck/UT/IT/pack通过，70%不降低。
- 实现阶段更新 README、launcher README、CHANGELOG未发布、plugin skill命令说明及AGENTS链接，保留 r7 历史事实。
  获得发布授权后升级 launcher／plugin 为 r8，并整理当前文档和固定 tgz 安装 URL；不改写历史发布宣称。
- 最终交付区分本地实现、实际发布和已验边界，短复盘手机问题及需要重启旧 launcher。

### r8 发布流程（2026-10-09 用户授权）

1. 核对 origin/main、origin/develop 与 GitHub latest，确认当前最新为 r7，使用新版本 `v2.1.1-r8`。
2. 保留既有 `.tmp/`，只提交本轮实现、测试、计划和版本文档；提交身份沿用 GitHub noreply，不公开本机配置的私人邮箱。
3. 对实际提交内容、将新增的提交及实际 tgz 做定向隐私检查；不重复扫描未变化的截图，不附带 ignored QA 产物。
4. 在 r8 发布候选运行标准 lint、typecheck、UT、IT、pack；推送 develop，通过 PR 的 Ubuntu CI 后合入受保护 main。
   main 保持可发布，tag 必须来自 main；不绕过保护、不强推或重写共享历史。
5. 从验证后的 main 打包，核对包内版本、资源和发布清单；创建正式 r8 Release，并附精确 tgz、设为 latest。
6. 下载线上资产并与上传包比较；隔离安装实际下载包，验证版本、update 检查／已最新路径及静态／API 服务。
   用户安装和服务不变；不重复已完成的手机截图矩阵。同步 main 回 develop，核对远端 tag、CI 和临时进程收尾。

## 执行记录（2026-10-09，未发布）

- 手机恢复及独立排序代码已实现；父代理实跑 4 文件／65 项定向 UT、5 项注入 IT 通过。
  覆盖真实 observer 收敛、主／侧聊流式输出零全局查询和标题扫描；仅枚举偏好写入浏览器存储。
- 桌面保存顺序的部分列表边界已补验：保存项在前、新项按实时原生顺序在后，置顶优先，不猜身份。
- 旧 workspacePins 对官方 workspaces 响应过滤 missing pin IDs 的既有行为未修改；新 sorter 不发该请求、不写 pins。
- 完整官方 2.1.1 app、虚构 REST／WS 和隔离 home 的手机矩阵完成：
  320／390／640 × 短长名 × Original 浅深及五主题，共 42 组／1596 项矩阵断言通过。
  初轮矩阵后 close helper 超时，不能称整轮首次通过；持久化／原生 handlers 29 项、保存顺序 15 项、
  桌面／断点 15 项及关闭原生 picker 补图 46 项定向通过。保存顺序 setup 曾被官方初始化覆盖，失败报告保留。
  父已看全部主题代表实图及 desktop baseline／current：未见排序布局退步，原生分页、折叠与会话选择继续可用。
- 实图发现新排序未按 kimi-locale 选中文，已改合法官方 locale 优先并补 9 项 UT（排序 UT 共39项）。
  浅色 flat 与语言修正已定向补验，详见下方记录；未重跑已完成矩阵，真实实体手机和 OS picker 尚未验收。
- 自更新首次完成 68 项定向 UT 和 9 项真实隔离 IT：源码 fast-forward／Corepack frozen install，
  npm 自定义全局 prefix 及本地生产／开发依赖 r9→r10，特殊字符路径、生命周期禁用、当前入口及 REST／静态启动验证。
  失败后实际 HEAD／磁盘版本、恢复提示、超时／取消自有子树与独立服务和 sentinel 保持不变均已验证。
- 早先标准 lint、typecheck、64 文件／975 项 UT、10 文件／86 项 IT、test:pack 通过，作为当时的检查记录保留。
  当时 UT 行／分支 87.11%／79.24%，IT 87.39%／74.72%；后续修正的最终结果见下方。
- 恢复 flat 后审查发现浅色模式的副标题、时间、菜单和选中底色用了白色常量；已换官方语义 token 并补样式回归。
- 生产 latest API 仅查询到正式 r7，没有执行生产 tgz 升级或更新真实用户安装。
  POSIX 有布局、证据和 TERM／process group UT，但未在真实 POSIX host 验证更新或收尾。
  Git fixture 的依赖精简为离线安装，完整运行依赖由 npm 包测试验证；异常脱离父进程的后代不作无条件清理保证。
- 语言与 flat 定向补验：locale 未完成段15项、关闭 picker补图11项通过；flat同次浏览器数据43项修正验证通过。
  原始颜色字符串／metadata 预期错误报告保留，不重跑矩阵、不把历史失败抹成首次通过。
  父实际查看中文／英文 closed图及 Original 浅深、Nocturne flat：metadata、时间和菜单可见且无重叠。
  320 Original 浅色的第二 newrow 白底白字进一步改为 muted token，三组动作定向检查19/19通过，父已查看实图。
  最终报告 `.cache/mobile-list-qa/run-2026-10-09T02-42-39-300Z/report.json` passed:true；没有执行创建或破坏性菜单操作。
  全部自有 Chrome、WS、launcher/API 与端口已清理；15 个自有 profile 已删，报告／截图／log保留于 ignored QA目录。
- 自更新审查新增 npm 配置覆盖、fresh local 类别竞态、父先退出遗留后代及 POSIX TERM 宽限四项，已修正并局部复核关闭。
  定向自更新 91 项 UT／12 项真实隔离 IT 通过；Windows 父先退出的真实 fixture 验证未确认收尾时保留锁，随后精确清理。
- 最终标准检查首次复跑：lint、typecheck、65 文件／1007 项 UT 通过，UT 行／分支 87.58%／79.64%。
  IT 的两项 npm 配置反证因 Windows 大小写环境键别名失败：pnpm 的大写配置覆盖了 fixture 的小写配置。
  已按大小写不敏感规则过滤继承的 npm_config_*，加入合成大写键回归；保留真实 Config／Pacote 反证及全部原断言。
- 修正仅涉及该 IT 后，标准 lint、typecheck、11 文件／89 项 IT、test:pack 通过，IT 行／分支 87.43%／74.87%。
  UT 对应源码未再变化；未降低门槛或增加覆盖率排除。实际包包含排序及 update 资源，缺服务依赖仍可 help，
  未知参数和任意解压目录拒绝，安装后 REST／静态冒烟通过；隔离安装、临时服务和目录均已收尾。
- 实现阶段 README、launcher README、skill 与 CHANGELOG 已说明未发布、安装识别、非原子失败及收尾未确认时保留锁的边界。
  当时本地实现、审查及标准验收完成，尚未提交、推送或发布；后续发布记录见下方。

## r8 发布验收记录（2026-10-09）

- launcher 和 plugin 版本已整理为 `2.1.1-r8`，兼容基线继续为官方 `2.1.1`。
  Windows 发布候选完整标准链通过：lint、typecheck、65 文件／1007 项 UT、11 文件／89 项 IT、test:pack。
  UT 行／分支 87.58%／79.64%，IT 87.43%／74.87%，门槛保持不变。
- 实现提交 `196bc3a313f1f138bd80178c275e1f8b0c4618e9` 已推送 develop，使用 GitHub noreply 身份。
  [PR #24](https://github.com/WilliamLambertCN/open-kimi-web/pull/24) 按 main 保护流程验收，不绕过 gate。
- [Ubuntu CI](https://github.com/WilliamLambertCN/open-kimi-web/actions/runs/37879364663) 完整标准链通过。
  UT 65 文件、1006 项通过／1 项 Windows-only 跳过；IT 10 文件通过／1 文件跳过，87 项通过／2 项 Windows-only 跳过。
  UT 行／分支 87.31%／79.79%，IT 86.11%／73.95%；源码／npm 隔离替换、Config／Pacote 反证及 POSIX process-group 收尾通过。
  此记录补齐此前仅有 POSIX UT 的边界，不等于生产用户升级已验证。
- 实际提交及 100 文件候选 tgz 已定向检查：不带真实配置、凭据、个人路径、调试 sourcemap 或 QA 产物。
  既有 `.tmp/` 保留并排除；未变化的历史媒体不重复扫描。最终发布包从 main 重打包并核对线上下载资产。
- 当前版本不自动升级用户安装、不 repair 或重启服务；实体手机、物理系统 picker 和生产用户升级仍未验证。
