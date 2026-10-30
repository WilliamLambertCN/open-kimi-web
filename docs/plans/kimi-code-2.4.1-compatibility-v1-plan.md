# Open Kimi Web 2.4.1-r1：档位顺序、Tower 说明与兼容安装

## 用户要求与已确认事实

1. 修复部分机器出现 low / medium / max / high / xhigh，Max 必须最后。
2. 查明原生 Web Tower 有时有、有时没有的原因，适配必要界面差异。
3. 跟随官方 2.4.1，核对更新，测试并推送发布。
4. README 一键安装应先检测并复用已有 Kimi Code，不能漏检后强行另装。

当前仓库 main=c6de02383cae72e8e0d385b7930e120f31975f8f，版本2.3.1-r2；仅既有未跟踪 .tmp/，不动它。
官方2.4.1的真实tag提交为2c73f3f50af4fa7f2540ca0d2e33b07a1408e3a7；npm engines仍为>=22.19.0。
固定包SHA-512为 z0py3AxbV9ykOB3Pgh2FiycZbMy7XSAXH4Kb1yfyhhmk+l9xH8H9raakVvCGMYLVxxEQGitQLcgOh8clLVYUTw==。

已通过精确官方两版源码及内存复现确认：
- provider已存数组按原顺序加新选项，能得到low medium max high xhigh；原生三个选择器沿数组顺序展示。
  直接修改/models数组会改变官方缺省effort的中位数推导，因此仅规范最终展示选择，不重写元数据或默认选择。
- Tower两版都存在，入口由GET /api/v1/meta中experimental_flags.tower严格true控制；会话chip另须模式已开且非Side Chat。
  实验默认off；环境变量优先于配置。配置热变可让入口出现，但Tower工具在启动时组装，off-start后启用须重启实际后端。
  没有证据表明由账号/供应商控制，不强制开关或伪造meta，不用/tower status作零调用验收。
- 2.4.1删除node-pty及无客户端使用的session terminal；现安装器无条件PTY验证会失败，需按精确身份分流。
  审批/提问使用统一interaction frame及正式interactions回答接口，代理应透明，不新建转换层。
  官方增加30分钟空闲卸载再透明恢复；不能用archive/delete冒充卸载。
- 安装器已有检测，但仅显式/登记目标、原进程PATH和owned，漏掉官方默认bin、uv、自定义安装目录、Windows持久PATH等。
  新开sh/PowerShell又可能丢交互命令环境，且缺少明确复用日志。未知/损坏候选应拒绝，不能变missing后下载。
- cron核心及debug dispatcher与2.3.1相同，2.4.1只能追加精确只读支持，不开放写入。

## 实施顺序与职责

### 1. 固化基线并并行独立范围

退出plan模式后，立即把本计划完整写入docs/plans/kimi-code-2.4.1-compatibility-v1-plan.md，AGENTS链接。
在develop工作，正常合并main，不rebase/reset/force已共享历史。QA仅使用ignored .cache/compat-241系列目录。
不修改兄弟官方源码checkout、用户实际安装/配置/会话/凭据、系统PATH/网络或生产服务；不发付费请求，不代开Tower。

### 2. 档位顺序最小修复

新增独立小型展示排序资源，并登记officialPresentation.mjs与asset IT，置于手机子模型脚本之前。
定量已存在项顺序none→minimal→low→medium→high→xhigh→max；Auto/Off/On保持各入口原模式语义。
未知项原样稳定保留、在最终Max前；不新增支持项、不改变现选、不改变fallback或写入配置。
覆盖官方主模型/状态/手机思考分段、Teleport的官方Settings子模型flyout、OKW手机子模型最终entries。
不修改官方bundle或Vue私有状态；复用真实按钮与事件。原生flyout键盘依赖索引，必须使方向键/Home/End/Enter与视觉顺序一致，
不能仅CSS order或仅视觉通过。observer限制相关容器、幂等收敛，聊天流不反复扫描。
扩充现有手机API/UI/observer/provider保存测试，必要新增一份独立排序资源真实DOM测试，保留保存数组原顺序。

### 3. 一键安装：先检测、精确复用、新版runtime

在scripts/install/独立职责中扩展候选发现，official.mjs保留身份与ownership安全校验：
- 显式override/已登记integration目标优先且冲突拒绝；正常PATH保持实际优先顺序。
- Windows持久Machine/User PATH仅作候选来源，不覆盖环境或修改注册表。
- 有界检查官方安装默认目录、KIMI_INSTALL_DIR/bin、UV_TOOL_BIN_DIR/XDG/default .local/bin、
  Windows APPDATA/npm、所选Node旁标准命令等。用去重后明确目标；多份无优先关系安装需显式override，不猜新旧。
- PowerShell只解析明确Application或已支持标准npm shim；未知ps1/函数/带参wrapper不执行，明确报错及override方法。
- 找到损坏/不支持/冲突候选时停止；仅所有候选确实不存在才下载官方包。
- 复用日志明确区分installer源码、Node runtime、OKW release与Official Kimi；输出已复用且不下载/升级官方CLI。

固定官方2.4.1 URL/integrity与network窄allowlist；保留旧2.3.1和2.1.1精确owned身份及旧PTY验证，损坏不自动rebuild。
新2.4.1按已验证身份做真实Node child_process shell probe，不装回node-pty；保留Windows Git Bash前提与ignore-scripts。
不将任意缺node-pty当成功，不降低shim/entry摘要、包身份、partial拒绝或超时进程树清理要求。
扩充installOfficial/Entrypoints/coordinator已有tests；有效外部安装断言官方下载0但允许下载OKW/runtime。
隔离真实新安装与重复复用验证一次，Windows及可用Linux环境用正式入口/虚构home，不改用户安装或真实持久PATH。
若某平台被标准环境阻挡，修标准路径并明确未验，不偷偷改交付范围或重跑无变化矩阵。

### 4. 2.4.1协议与元数据适配

officialBundle fallback改2.4.1，保留显式frontend→meta→fallback及基于实际frontend的scroll guard判定。
cron READ精确追加2.4.1、WRITE不变；前后端fallback/中英文原因同步，未知及2.4.0/2.4.2/modified仍拒绝。
保留鉴权、loopback、RC互斥、encoded debug阻断及route/transport双写gate，实际验证409前无mutation/cold restore。
现有completion/question/timestamp/tab反馈只按准确2.4.1 DOM/interaction shape定向补测，不另维护后端。
隔离backend核对meta/config/profile/status、工作区/信任、transcript分页与WS，Tower off-start/live-enable/restart/on-off，
使用正式session status不发prompt；官方idle reclaim用已有test seam加速，仅测试回环，不向浏览器暴露debug。
按真实结果才追加upstream.json liveTested；保留旧protocolBaseline/contracts历史，不冒称重捕全部协议。

### 5. 一次必要双端实际app验收

复用已有CDP/真实createLauncher QA工具，但资源必须是SRI核对的精确官方2.4.1，与裸官方同场景对照。
只做受影响组合：桌面Original、390/320受影响主题，中英、长短模型；乱序及未知effort、当前值、点击及键盘、保存重开。
Tower meta false/true、主composer与Side Chat区别、active chip/关闭/手机开关可达；不强制显示不存在能力。
准确新版interaction审批/提问、结束/重复/重连、提醒定位和导航键盘隔离；针对性断言加代表实图，父级实际看图。
保留原失败报告，只续未完成部分，不用UT/编译冒充视觉验收。全部自有Chrome子树/服务/WS/监听清零。

### 6. 版本、说明、门禁与发布

版本统一2.4.1-r1：launcher/plugin manifests、upstream.json、README/launcher README、UPSTREAM、CHANGELOG、
commands/install.md和project skill。README仍顶部两段系统在线命令，解析真实新tag SHA并下载同SHA脚本/revision。
明确2.3.1→2.4.1更新：2.3.2/2.3.3委派/Swarm改变，2.4.0导入、provider refresh、Tower每任务模型/并发、
30分钟空闲卸载与Plan用户显式开启，2.4.1 Read默认100000字符/约25000token、提示词精简及Web修复。
只把官方功能当上游变化，不声称OKW新造；不全局替换历史/fixture，不改变用户默认勾选。

定向ESLint/UT/asset IT，标准lint/typecheck/pack；完整UT/IT及各行/分支70%由required CI执行，不降阈值或盲调超时。
targeted privacy-check审实际diff、新提交身份、公开包清单/源码/静态范围，QA/真实配置/日志/map不公开；无变化媒体不重扫。
commit/tag/GitHub squash显式使用已确认noreply。正常develop→main PR，required gate通过后普通squash，main CI通过再正式pack。
从准确已验main新建v2.4.1-r1 tag、非draft/非prerelease Latest Release，唯一open-kimi-web-2.4.1-r1.tgz，不npm publish。
不移动旧tag、不替换旧资产、不重写其它历史。线上重新下载核对bytes/digest/tag与同SHA入口，实际旧r2更新器识别新版。
发布证据写同计划并正常docs PR，不因证据移动tag/换包；同步main回develop，清理自有临时资源，保留原.tmp/。
最终给Release/包链接、正常update与手动重启刷新步骤，解释Tower真实条件及未读现场/实体手机/平台边界。

## 完成标准

- 已有任意顺序的支持档位在相关双端入口Max最后，其余强度稳定排序；当前值、键盘、保存和未知值不退步。
- Tower显示/启用机制用精确源码与隔离真实接口说明，受影响界面不遮挡、不伪造总开关或已启用状态。
- 一键安装可识别并复用已有受支持Kimi，官方下载0；只有明确缺失才装固定2.4.1，损坏/冲突明确拒绝。
- 新官方runtime、interaction与cron只读安全边界完成必要实测；未验项如实记录，required CI与实际包/线上来源全部通过。
- 2.4.1-r1正式发布推送且update可发现，旧版本不动，用户安装与生产保持不变。

## 执行记录（2026-10-31，发布前）

### 已确认身份与实现

- 在 develop 实施；原 .tmp/ 保留，未改兄弟官方源码 checkout、用户安装或生产服务。
- 官方 annotated tag 1fc1d165c83b175873a46897e1e9db73dc70c984 解引用至上述 2c73f3f 提交，GitHub API 已核。
- 精确 npm 包 18,742,688 bytes，SRI 与 registry 一致；ignore-scripts 隔离安装后 CLI --version 为 2.4.1。
  安装后 package.json、dist/main.mjs 和 dist-web/index.html 与原 tgz 字节相同；无 node-pty 依赖。
- 独立 effortOrder.js 仅规范按钮和最终 entries；原生子模型 flyout 的方向键／Home／End／Enter 随展示顺序。
  手机追加不支持的当前值后才排序；不改 API 元数据、默认推导、保存数组或 r2 默认。
- 安装候选扩展与精确 shell runtime 已实现；未知脚本／函数、坏首个 PATH、partial owned 和歧义仍拒绝。
  新版 child_process shell probe；旧 owned 2.1.1／2.3.1 仍用 PTY，损坏不自动重建。
- 2.4.1 cron 精确只读，双写 gate 与 debug／RC 路径隔离保留；未知版本仍拒绝。

### 定向测试与标准本地检查

- effort／手机子模型／provider 保存及 all-script observer：6 文件／126 项 UT 通过；受影响 ESLint 通过。
- 安装器 8 文件／228 项 UT、43 项薄入口 IT、73 项本地 TLS network IT、4 项 synthetic discovery IT 通过。
  后者另 4 项真实安装检查未在该命令中执行，不能计为已验；由后续真实安装验收覆盖。
- cron／frontend fallback：5 文件／226 项 UT；cron client／route／inventory 与 presentation assets：4 文件／52 项 IT 通过。
  初次定向 UT 被应用退出中断，期间发现旧 capability 数组和只读文案断言未同步；修正断言后上述独立运行通过。
- plugin manifest／CLI：2 文件／16 项 UT 通过；README 两端在线命令语法、同 SHA 合同和相对链接检查通过。
- 标准 corepack pnpm lint、typecheck、test:pack 均 exit 0；pack 冒烟真实安装并验证 2.4.1-r1 bin、静态和 API。
  完整 UT／IT 及独立行／分支 70% 门禁留 required CI，不借用历史通过记录。

### 准确后端定向验收与边界

证据归档在 ignored .cache/compat-241-official/；不纳入 Git、静态服务或发布包。
backend-protocol 与 interaction-qa 成功运行合计 60 个命名检查组、77 次 HTTP、7 个 WS、7 个后端生命周期。
检查组不等于底层 assert 数量；所有后端正常关闭，进程、监听及 WS 残留为零。

- meta 为 2.4.1／v2；鉴权保留；debug 未鉴权 401，未显式启用 debug 时 404。
- 虚构 workspace 默认不信任，显式 trust 后重启持久化；正式 profile／status 和空 transcript 分页形状通过。
- Tower off-start 热改 true 后 meta 入口为 true，但 profile 启用 code 50001／restart；同 home 重启后开关成功。
  单项实验环境变量优先 config／master，config false 优先 master true；无 prompt、TowerInit、.git 或 .tower 生成。
- idle 默认 1,800,000 ms，sweep 60,000 ms；0 禁用。原生 closeIfIdle(sid,0) 加速真实卸载，profile 不恢复，WS 透明恢复。
  远未来 fixture cron 保留会话，移除该 fixture 任务后可回收；未等待自然 30 分钟 timer。
- 原生 background AskUserQuestion 通过官方 debug-only seam 提供真实 AbortSignal，正式问答／dismiss／ended 通过；
  重连重发同 pending，wrong-session 40404、wrong-kind／answers 与 dismissed 同传 40001、重复结束 40902。
  suppressTerminalNotification 避免 background 完成触模型；wire 无 llm.request、prompt.submitted、turn.started。
- 正向 approval／rejection 未由真实后端验收：所需 AbortSignal 方法无法经 JSON RPC 构造，未以错误调用伪造 pending。
  UI 协议 fixture 验收须与此边界区分；busy 和 pending-only 回收条件未单独隔离，非空多页历史和真实模型流未覆盖。
- 首次 protocol 驱动误断言 transcript.turns；仅改为真实 items 后通过，失败报告及清理证据原样保留。
  未重捕全部历史 contracts，不把 npm 运行结果记为 source-checkout live-tested commit。

### 准确 launcher → 2.4.1 cron 只读验收

- 复用已核官方包，实际 createLauncher 直连隔离官方后端，启用 scheduledTasks 和准确 presentation，首次运行 exit 0。
  launcher-cron-readonly 完成 53 个命名检查组；公开 HTTP 43 次、native fixture／核验 15 次、内部 upstream 46 次且全 GET。
  这些观察口径不相加；另有一个真实代理 WS，非协议 mock 或只测 imports。
- 原生创建远未来 fixture task，flush 后正常 close 落盘；冷 inventory 返回相同 task ID／完整内容、loaded false。
  冷 history 是真实未触发的空历史；live list 409 not-loaded，不自动恢复，无 snapshot／status／resume，wire 原字节不变。
- capabilities read true／write false，writeVersions 仍仅 2.1.1／2.2.0；冷／live 各两次 create／remove 均 409 read-only-version。
  写拒绝仅有 meta／RC guard GET，没有 addTask／removeTasks 或 agentCronService 调用，也没有 outcomeUnknown。
- 缺失／错误 auth 401；普通、编码、双编码、编码分隔符及 dot-segment debug 与 RC 路径 GET／POST 共 22 次全部 404。
  拦截前后内部请求数与真实官方 HTTP 日志请求数均不变，证明未转发上游。
- 只有明确 WS subscribe_v2 才恢复原会话；随后 live list 与原 task 一致，inventory 标 loaded true。
  最终 wire 仅 metadata、runtime.set_binding、cron.add；无模型／prompt／cron 触发或删除。
- 正常关闭 launcher／WS／backend，进程／监听／WS 残留零，无强杀；没有重做双后端锁或 approval seam。
  证据归档同 ignored 目录 cron-summary.json 与 launcher-cron-readonly-2026-10-30T17-52-16-842Z/results.json。
  不据空历史声称非空执行历史／分页或浏览器视觉已覆盖。

### 发布范围隐私检查（阶段）

- 检查实际 tracked 新增行及七个新文件，不扫描原 .tmp/ 或真实配置；未发现新增凭据、个人路径或调试 sourcemap。
  路径形态唯一命中是计划中的 ArrowUp／ArrowDown 文本，不是 home 路径。既有公开媒体未变化，不重复截图隐私扫描。
- 本轮尚无未推送提交；旧 develop 远端可达历史不在本次重写授权内。后续 commit／squash／tag 明确用 noreply。
  已记录线上旧 r1／r2 tag／Release／asset 身份供新版本发布后比对，不移动旧 tag 或替换旧包。
- 实际包和新增提交仍须发布前检查；不能据阶段文本检查宣称最终 tgz 或线上已完成。

### 真实安装与复用验收

- 当前 install-official 与 install IT 独立单 worker 运行，2 文件／10 项全通过，约 45 秒。
  复用缓存准确 2.4.1／legacy 2.3.1 archive，仍验证精确 URL／SRI；CI 默认网络路径未改。
  覆盖真实 ignore-scripts npm、CLI／shell、鉴权 Web 200／未鉴权 401、owned 重用、修改 entry 拒绝和 updater identity。
  旧 2.3.1 真实 PTY 通过，禁用 binding 后拒绝且不重建／改 record，恢复后可复用；不将新版无 PTY 当通用成功。
- Windows x64／Node 24.14.0 的 PowerShell missing、owned-repeat、hint、off-PATH、坏 owned 五场景通过。
  另以与生产入口原字节相同的 -File 脚本验证已知 uv 目录命令复用，并验证无 hint 的 active PATH 标准 npm 命令。
  missing 仅读取一次准确官方缓存；所有复用官方包读取零；坏 owned 在读取 Release／官方包前拒绝。
- 现有 golang:1.26-bookworm Docker／Linux x64 无初始 Node／npm；标准薄入口真实下载并校验私有 Node 22.23.3。
  同五场景全部通过，新 2.4.1 shell probe 无 legacy 编译要求；不 pull 镜像、装 OS 包、sudo 或改 profile。
  初次 Git Bash 路径转换使 Docker exit 127，设标准 MSYS_NO_PATHCONV 后通过；CRLF 工作树 sh 首次 exit 2，
  仅 QA 副本恢复 Git index 的交付 LF 后通过，保留原失败日志，不改产品换行规则。
- 薄入口相邻 QA adapter 只提供缓存传输与空持久 PATH seam，随后调用生产 installMain；发现、digest、npm、owned 均真实执行。
  本组使用经线上 digest 比对的旧正式 2.3.1-r2 launcher 包，只验证当前安装器，不冒充新 r1 tgz／线上 revision 验收。
  Windows integration 用 PATH seams，不读取真实注册表／profile；macOS／arm64、真实 Windows 接管仍未全面覆盖。
- 自有 Windows 子进程与命名容器零残留，runtime prefixes／容器 scratch 已清理；仅 ignored 证据与 compile cache 归档。
  总索引 .cache/compat-241-install/qa-summary.json；首个独立 IT 日志 install-it-first.log。无模型调用或生产重启。

- pack 必需资源清单追加 effortOrder.js 后，最终本地 lint／typecheck／test:pack 再次全部 exit 0。
  真实安装新 2.4.1-r1 包，bin 版本、update 帮助及安全拒绝、静态 no-cache 和 API 代理通过；临时包与服务已清理。
  证据为 ignored .cache/compat-241-release/local-gate.log，不作为正式 main 包或线上发布证据。

### 独立审查后续补齐

- 首个实现提交 67ae69a 已正常推送 develop，并建立 PR #35 开始 required CI；未合并或发布。
  新增提交 author／committer 均显式 noreply，未暂存原 .tmp/ 或 QA。
- 只读独立审查发现三个明确触发点：POSIX IT 的旧 shell wrapper fixture 与新安全门禁冲突，
  POSIX Python／uv console entry 被误拒绝，Windows HOME≠USERPROFILE 时漏掉后者的默认官方目录。
  既有真实 npm／owned 场景通过不能覆盖这些路径；原负责安装器的 agent 定向修复和补验，不降低脚本身份校验。
- 补齐方案：POSIX IT 改标准 npm manifest／entry／可执行 symlink，保持真实 discovery／integration；
  仅识别有界的官方 Python console entry 并继续 CLI／Web 能力验证，不放行任意 wrapper；
  Windows HOME 和 USERPROFILE 的默认 bin 都纳入去重／冲突判定，只有确实缺失才下载。
  本段先记录发现与实施边界，不预写修复通过。

### 双端页面验收与新增阻挡项

- 准确官方完整 2.4.1 app 以 officialPresentation false／true 同场对照；主 composer、状态、默认设置、Teleport secondary、
  390 Nocturne 英文与 320 Aurora 中文长 alias 已完成点击、键盘、保存重开、Auto、未知项及不支持的当前值检查。
  完整 app 暴露中文手机行名为“思考强度”，已补精确识别并通过 11 项 effort UT；此前中文遗漏报告保留。
  API supportEfforts 原序不变，无显式默认时原版和增强均按原数组中位数选 Max，未改变默认推导。
- Tower meta false／true、双端 Add／手机 Settings、chip 开关与 Side Chat 边界通过；320 长 alias／运行草稿下关闭、stop、插队可达。
  没有点击发送或启动真实 Tower。档位特别多时原生分段的挤压／裁字裸官方同样存在，不擅自扩大为共享 CSS 重设计。
- 新 flat interaction 的批准／拒绝、answers／dismiss、ended／重复、导航键盘与长提问高度操作已验；
  但 completionModal 的 Escape 穿透到官方全局监听，会误发审批 rejected 或问题 dismissed，原报告分别 39／40、11／12。
  必须补 window capture 级别的定向键盘隔离，不用 dialog bubble 阻止来假定安全；只续该缺口，不重跑其它已绿矩阵。
- 重连原生重建同 pending card 时现 DOM WeakSet 会再次提醒一次，尚未按 interaction ID 去重。
  本轮保留事实，不宣称跨重建强提醒去重已修；不为了该观察新增另一套 interaction 状态库。
- 原始非 probe 累计 275 项断言、262 通过、13 失败、45 图，含 7 项驱动假设、1 项已修中文遗漏、
  3 项原生 chat-scroll 延迟 mutation 及 2 项未修 Escape，不是唯一通过率或全绿。observer 定向诊断另 9／9 通过。
  初次 auth 输入焦点驱动 timeout 与原失败报告保留；16 个 run 的155个进程 identity／所有端口复核零残留。
- 父级实际查看裸／增强桌面主模型、Teleport、中文320设置与子模型、长别名运行 Tower、390 Tower chip、审批提醒及长提问代表图。
  本轮浏览器是完整官方 app＋fictional REST／WS，不是真实 backend 正向审批、实体手机、OS 软键盘或用户磁盘持久化验收。
- 首次 required CI 在 UT 停止：frontend.test 的 metadata 缺失期望仍是旧 fallback 2.3.1。
  仅同步为已实施的 2.4.1，并补新 backend／显式 pin 保留旧 UI 的回归；原 CI 失败日志归档，不降低门槛或假报通过。

### 安装审查修复与实际 Python 补验

- 三个审查缺口已完成最小修复；父级审查新增代码／测试和实际证据，不把首轮 npm 场景当作 Python 复用证明。
  Windows HOME／USERPROFILE 默认 bin 均参与去重／歧义判断，不猜优先级；已有命令不被下载或覆盖。
- 新 officialPython.mjs 最多实际读取 4097 字节，只接受不超过 4 KiB 的完整 uv／pip／简单 console-entry 模板。
  已核 entry-point 为 kimi_cli.__main__:main 和旧 kimi_cli.cli:cli；绝对、无参数 Python shebang 须指向存在且可执行的 native 文件。
  继续真实 --version／web --help；仅含模块子串、插入行、未知 body、env python、带参解释器、shell trampoline 不执行。
- installOfficialDiscovery／installOfficialPython／installOfficial 3 文件77项 UT 通过；最终有界读取重构后 Python 13项复验及 ESLint 通过。
  POSIX IT 改标准 npm manifest／entry／symlink，不再用任意 shell wrapper 绕过身份检查；两个现有 fixture 调用点同步。
- 在既有 agent-eval-lab-browser:1.63.0 镜像中真实 npm／discovery／integration／quoted HOME／新 bash／重复安装通过：
  POSIX IT 1项通过、zsh因镜像缺失跳过；Python IT 4项通过，使用真实解释器和确定性 fixture module。
- 另从已核 PyPI wheel SHA-256，以真实 uv 0.10.8 在既有 Python 3.12.3 中安装官方 kimi-cli 1.51.0；
  六个动态组通过，覆盖 off-PATH／override／hint／PATH／原位复用、注入拒绝、缺解释器拒绝和含引号 npm fixture。
  复用时官方 CLI 下载0，真实 console entry 原字节不变。不是仅 magic bytes fixture，也未重跑先前全部安装矩阵。
- 最新 Python 1.52.0 为弃用包，--version 成功但 web --help 仅迁移提示，实际验证后正确拒绝；不承诺所有 Python 版本可用。
  未做真实 pipx 安装、旧 cli:cli 全依赖运行、macOS／arm64。没有下载新镜像、安装 OS 包或读取用户配置／注册表。
- 首个 ESLint 复杂度／行长失败、UT 71通过／6失败的跨平台 PATH fixture 错误、uv wheel QA 解包目录错误均保留；
  修相应测试／QA 驱动后通过，不降低门槛。证据索引为 ignored .cache/compat-241-install/review-summary.json。
  自有进程／命名容器0，scratch已清理；实际 Python tool／依赖及IT缓存明确归档在同 ignored 目录，不公开。
- frontend fallback 已补精确2.4.1／显式旧UI pin及旧backend pin新版用例，定向1文件28项UT通过；仍须重新跑 required CI。

交互隔离及 required CI 完成前不合并或发布；正式包和线上结果仍待后续记录。
