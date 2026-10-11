# Open Kimi Web 一键安装脚本 v1

## 目标与范围（2026-10-10 新要求已覆盖旧边界）

为普通用户提供 Windows PowerShell 与 macOS／Linux sh 本地一键入口，安装 GitHub 正式 launcher Release。
目标不要求预装 Node、npm、Corepack、pnpm、Git 或官方 Kimi；不改变源码开发／更新流程。
当前 Linux 缺官方 native PTY binding 时仍需标准 Python 3／C／C++／make，空 Linux 的零编译依赖目标未解决。
安装器不会 sudo／apt 或自动安装完整工具链；有工具环境的限定 rebuild 通过不代表真正空机器验收。
用户新增要求缺官方 Kimi 时自动安装、npm 优先，并兼容已有 native／npm 安装；已有可用官方安装不升级或覆盖。
Windows 官方 Kimi 仍需要 Git Bash；先检测复用，缺失时准备官方用户目录 portable Git，不覆盖系统 Git。
本方案按用户已要求实现的范围执行，不声称用户已另行显式审阅计划；早期只本地实现。
2026-10-12 用户已授权发布，按[收敛 r10 发布计划](one-click-install-r10-release-v1-plan.md) 执行，不重复既有验收。
执行安装器会准备自有用户目录 runtime、独立官方／launcher npm prefix，并按选项处理用户 PATH 接管。
不要求管理员／sudo，不自动登录或启动生产服务，不读取真实会话、不发付费模型调用或改官方模型配置。
缺 `curl`／`tar`、未知 override、损坏或归属不明的安装必须明确报错，不把准备包当作接管成功。
手机子代理模型补充范围另见[手机子代理模型计划](mobile-subagent-model-v1-plan.md)。

## 已核对的约束

- launcher 的历史最低 Node 为 22；官方 npm `@moonshot-ai/kimi-code@2.1.1` 最低为 22.19.0。
  本轮共享运行时选择需按 Node ≥ 22.19.0 预检，缺合适 Node 时仍用固定官方 `22.23.3` 归档与 SHA-256。
- 官方 postinstall 会迁移旧 Python shim；不能让自动准备过程重命名用户已有命令。
  默认 `--ignore-scripts`，核对 optional native 依赖后真实验证 CLI／Web，不因跳过脚本而省略运行验收。
- Windows npm `.cmd` 不能直接 `spawn`：验证标准 npm shim 的实际 JS 目标，用所选 Node 直调检查，
  接管／运行沿用现有 cmd-aware 机制；持久私有 Node PATH 必须支持 npm shim，不得接管到自身 wrapper。
- integration 的 install／repair 会引用实际 Node 与 launcher；先核对归属，不用 status 退出 0 推断成功。
- 官方 npm prefix、launcher npm prefix、runtime 和 wrapper bin 分离；官方与 launcher 的更新身份不得混淆。
- Windows 只写 User PATH，System PATH 可能遮挡；bash／zsh 按实际 shell 检查 rc，不编辑未知登录 profile。
- 工作树保留其它代理修改和既有 `.tmp/`，不重写共享历史，不改真实用户注册表或生产服务来便利测试。
- 本任务原始计时起点 2026-10-10 17:15:02 +08:00；新范围本轮记录于 19:15:20 +08:00，不重置累计耗时。

## 实施

1. 立即更新本计划正文与 AGENTS，将旧“不安装官方”边界改为缺失时准备；保留下方旧范围验收记录。
   新建手机子代理计划并链接，随后同步 README、launcher README、UPSTREAM、CHANGELOG 和安装 skill。
2. 延续 `scripts/install.ps1`／`scripts/install.sh` 两个薄入口：
   - Windows PowerShell ≥ 5.1；macOS／Linux sh；按实际资产支持 x64／arm64，Linux glibc。
   - 复用可执行 Node ≥ 22.19.0 与配套 npm；否则下载完整官方 Node 分发包到用户目录 runtime。
   - 保留固定 SHA-256、解包前验证、版本／npm 检查、自有 staging 发布与失败清理；不覆盖系统 Node。
   - `--help`／非法参数仍在 bootstrap 前处理；本地完整配套文件优先，revision 选同一不可变归档。
3. 为 `scripts/install.mjs` 拆分官方依赖 helpers，保持安全预检与文件边界：
   - 按实际 PATH 顺序识别官方 native／标准 npm shim；明确 override、损坏或未知安装报错，不自动升级或覆盖。
   - 缺失时以所选 Node 的 npm-cli 安装到独立用户 prefix，使用已核实官方 `@moonshot-ai/kimi-code@2.1.1`
     tarball 与固定 SHA-512 integrity；校验具体官方来源，不漂移 latest、不接受任意远程下载参数或关闭 TLS。
   - 默认 ignore-scripts，不执行官方旧 Python 命令迁移；核实 optional native 依赖，验证真实 `--version`、
     `web --help`、真实 PTY spawn／输出／退出与 Web 健康行为、安装记录／归属、重复安装和失败恢复。
   - Linux ignore-scripts 的官方 npm 2.1.1 已实证缺 node-pty binding，Web 健康不能代替依赖验收。
     主体仍为固定 npm 2.1.1 ignore-scripts；已存在 native binding 先真实 PTY probe，不无故重建。
     仅首次自有 dedicated prefix 缺 binding 时，审计固定 node-pty 1.1.0 tarball integrity、安装文件及 lifecycle，
     只执行 `npm rebuild <审计后的 node-pty 绝对目录> --ignore-scripts=false`；禁用 global／bundle rebuild，
     不跑 kimi／其它包脚本。关联 node-addon-api 7.1.1 的构建入口、gyp 与 headers 同样按固定摘要审计。
     使用所选 Node、隔离 npm 配置、显式安全 Python／shell 与有界进程树；成功 PTY 验证后才写官方 ownership record。
     PTY 超时先 kill 并等待退出；无法确认退出时保留 staging／lock，明确提示人工检查，不宣称清理成功。
     Linux 明确检查标准 Python／C／C++ 编译器／make；缺失时报错，不 sudo／apt／下载第三方完整工具链，
     不从另一版本 node_modules 拼接。**本轮不满足真正空 Linux 的零编译依赖一键安装**；此边界需最终明示。
     owned 重复安装重新验证 PTY，失败明确手工 repair，不自动改写；non-owned npm／native 保留、不升级或重建。
     19:59 窄范围实测：同版本官方 linux-x64 native tar.gz 完整 SHA-256 校验通过，归档仅含 `kimi` SEA，
     没有独立 node-pty binding；该 native 的真实 Web terminal 创建返回 envelope code 50001，提示缺 `pty.node`。
     因此 native fallback 不能作为已满足 PTY 的路线。Linux 使用 forkpty；spawn-helper 是 macOS 构建目标，
     不再以 Linux 缺 spawn-helper 单独判定失败，先前观察记录保留为历史。
     20:06 父代理决定不引入庞大第三方工具链，采用限定 node-pty rebuild；必要 Node headers 由所选 npm／node-gyp
     的官方 HTTPS 路径下载，联网失败同样不成功。
     20:24 定向复验：已有 Docker bookworm 标准 build tools＋真实 Node 22.23.3，真实固定官方 npm 2.1.1 安装、
     限定 rebuild、PTY marker／退出、Web meta 200、record／owned 复用通过，临时资源清理，报告归档 ignored cache。
     Windows 真实 official IT 4 项、coordinator／official／PTY 定向 UT 66 项通过；缺 owned binary 明确拒绝且不改 record。
     20:26 真实 npm exact-directory scope IT 1 项通过：只跑指定 node-pty install／postinstall，未跑 root、sibling 或
     nested bundled 同名包。该 fixture scope 证据不冒充实际依赖构建或完整 coordinator／launcher 验收。
     最新全套标准门禁与完整实际 r9 链路由父级继续执行；上述定向结果不表示总任务已完成。
   - Windows 标准 npm shim 先验证 JS 目标，检查用所选 Node 直调；实际运行／接管采用 cmd-aware 机制。
   - 预检安装位置、已有接管、curl／tar 和 shell profile；保持 HOME／OPEN_KIMI_WEB_HOME 安全路径检查。
4. Windows Git Bash helper：
   - 核对官方探测规则，检查 `KIMI_SHELL_PATH` 和已有 Git Bash，并真实验证可运行；未知配置不当作缺失。
   - 缺失时使用 Git for Windows 正式 portable Release，严格验证仓库、同源 URL 与 checksum 后用户目录解包。
   - 只支持已核对的实际官方平台资产；新进程需真正发现 bash，记录自有归属、可逆影响和失败收尾。
     不要求管理员，不覆盖系统 Git；Git Bash 存在不等于官方 Kimi 或接管已通过。
5. 保留 launcher Release 与接管安全边界：
   - 专用 launcher npm prefix，严格 GitHub Release 仓库／tag／资产／digest，隔离危险 npm 配置。
   - 默认拒绝另一源码／prefix、未知／部分接管和降级；显式切换不删除旧安装，日常升级仍用 `update`。
   - 官方／launcher 版本、依赖与身份通过后，核对精确 wrapper、记录 Node、持久 PATH 和遮挡。
     仅安装包、依赖准备完成或 status 退出 0 不等于接管生效；不自动启动服务。
   - bash 优先 `.bash_profile`，仅缺失时 `.bash_login`；只允许空行／整行注释加无条件加载 `.bashrc` 的简单行。
     空文件、条件或未知复杂脚本在接管 preflight 拒绝，提示 `--no-integrate` 或用户手动安排 source 后重试。
   - 输出绝对 Node／入口命令、后续 update／撤销方式；Windows PowerShell 保留 `&`。
     r9 撤销接管不卸载私有 runtime／prefix，Windows 私有 Node PATH 项可能仍需手动移除。
6. 普通用户本地 ZIP 路线优先，手动已有 Node／npm 和开发者源码路线保留；未公开远程入口不编造 URL。

## 验证与安全

- 现有 Vitest 定向 UT／IT 覆盖：缺／旧 Node、无 npm、官方缺失／native／npm、损坏 override、
  不升级已有安装、SHA-512 错误、partial／重复／失败收尾、接管／遮挡和危险 npm 配置。
- Git Bash 覆盖既有复用、缺失 portable 准备、checksum／平台错误、未知 shell override、新进程可发现性和收尾。
- Windows 真实 PowerShell 与原生 WSL Linux 隔离 HOME／prefix：真实官方 npm `2.1.1` 安装、版本与 `web --help`，
  以及可行的 Web 启动／健康检查；不登录、不发模型调用，不拿 fixture CLI 当作新增官方运行链路验收。
- 已有 native 与 npm 两种安装兼容均需实测；复用旧 Node 下载证据可避免重复下载，但新增依赖必须实际验证。
- 不改真实 Windows 注册表；native Linux shell rc 仅在隔离 HOME 使用，Git Bash 不代表原生 Linux／macOS 验收。
- 验收要求定向及标准 lint／typecheck／UT／IT／test:pack 与 diff 检查通过；coverage 纳入安装 helpers，70% 门槛不变。
- 手机视觉与真实官方 config 请求验证由[独立计划](mobile-subagent-model-v1-plan.md)约束，不以 UT 替代实图。
- 收尾清理自己的进程／临时目录，保留必要 ignored 报告和原 `.tmp/`；提交／公开前另做实际范围隐私检查。
- 新范围测试结果完成后单独追加，不把下方旧“官方已预装／fixture”范围的通过计数当成新链路已通过。

## 执行记录：2026-10-10 阶段验证（旧范围）

以下记录产生于“官方已预装／fixture、不自动准备官方 Kimi／Git Bash”的旧范围，按时间保留其通过与失败事实。
上方正文已按用户新要求覆盖旧“不安装官方”的边界；下方结果不证明新增官方 npm、portable Git 或手机控件通过。

- 两薄入口已在 bootstrap 前处理参数。`--help`／`-h` 单独使用或搭配合法 `--revision` 时，
  不选择／下载 Node、不联网、不创建安装目录；非法参数同样在 runtime 准备前退出。
  入口定向 UT 34 项、IT 37 项通过；这是入口范围结果，不是完整标准检查。
- WSL Ubuntu 22.04、Linux x64 glibc 的实际验证分两步完成：
  1. 限制 PATH 使 Node 不可发现，实际 sh 入口下载官方 `node-v22.23.3-linux-x64.tar.gz`，
     固定 SHA-256 校验通过；首次 runtime bootstrap 使用配对 fixture coordinator。
  2. 实际本地配套 `scripts/install.sh --no-integrate` 复用已验证 runtime，
     使用真实 `scripts/install.mjs` 安装线上最新正式 `2.1.1-r9`，没有注入 mock 下载或协调器依赖。
  Node `22.23.3`、npm `10.9.9`、实际 CLI 与 npm bin 帮助、`ws`／`selfsigned` 导入通过；
  已安装包识别为标准 global custom prefix，版本与安装记录一致。
  HOME／prefix／TMPDIR 隔离，官方 Kimi 仅为回应 `--version` 的 fixture，无模型调用。
  未生成 integration state、wrapper 或用户 shell rc；未留下安装 staging／lock。
- Linux 原始证据已读取：`.cache/one-click-install-qa/linux-real/run-report.json` 与
  `.cache/one-click-install-qa/linux-real/verification.json`。
  自有 runtime、prefix 和临时资源已清理，报告保留；npm 的隔离 compile cache 随临时资源清理。
  两次 host launcher 路径／变量错误发生在下载前；首次验收将 npm cache 当作安装器残留，修正断言后通过。
- 父级标准 UT：1199 项通过，行／分支覆盖率 86.06%／77.37%，含新增安装脚本覆盖。
  标准 IT：192 项断言通过，**分支覆盖率 67.13% 未达 70% 门禁，命令失败**。
  正在补充实质分支测试，不降低阈值或排除新增脚本；不得据此记录“完整标准检查通过”。

当时剩余验收与交付边界（最终结果在下一节，不覆盖或删除此历史记录）：

- Windows 真实 runtime 下载／Release 安装正在验证；POSIX 实际接管与新 shell PATH 尚未验收。
- macOS、arm64 未验证；WSL Linux 的 package-only 验证不覆盖这些平台，也不代表接管或服务启动通过。
- lint、typecheck、完整 IT 覆盖率门禁、pack 与最终 coordinator 整合结果仍需完成后分别记录。
  本轮没有新增 workflow 验证或线上一行安装验证。
- 安装脚本仍是本地未发布文件，当前 r9 Release／tag 的源码归档不包含脚本。
  普通用户路线是取得包含完整脚本的源码 ZIP 后本地运行，不要求 Git；不提供不存在的当前在线入口。
- `--revision` 是薄入口专用的不可变归档选择；未来线上入口下载地址与参数必须锁同一完整 SHA。
  独立薄入口未传 revision 时解析一次 main，不构成薄入口与 coordinator 同提交的证明。

## 执行记录：2026-10-10 阶段关闭验证（18:17／18:18 标准快照）

以下计数是登录 profile 预检最终收口前已读取的真实日志快照，不代表该收口后的标准测试结果。
保留 1268 项 UT 的历史事实；此后新增测试及最终复跑计数由父级在报告完成后另记，不提前推算。
文档子任务读取报告并作定向文档检查，没有重复执行完整测试或真实安装。

- 父级真实执行的 lint、typecheck 和 `test:pack` 通过；pack 证据为 `.cache/one-click-install-pack.log`。
  打包检查包含 r9 版本、必需文件、update 帮助／安全拒绝与实际静态／API 请求，不是交付包浏览器验收。
- 标准 UT：70 文件／1268 项全部通过，行／分支覆盖率 87.93%／79.09%。
  快照：`.cache/one-click-install-ut-final.log`，开始时间 18:18:20。
- 标准 IT：17 文件中 16 通过／1 跳过，257 项中 255 通过／2 native POSIX 项在 Windows 跳过；
  行／分支覆盖率 85.62%／72.31%。快照：`.cache/one-click-install-it-final.log`，开始时间 18:17:39。
  新 `scripts/install.mjs` 与 `scripts/install/` 模块纳入两套 coverage；行／分支 70% 门槛均保持不变。
  初期 67.13% 的 IT 分支门禁失败已由实质测试补齐后关闭，没有降低阈值或排除新增脚本。
- 原生 Windows x64 PowerShell 5.1：限制 PATH 使 Node 不可发现，实际本地配套入口下载官方
  `node-v22.23.3-win-x64.zip`，固定 SHA-256 校验后解包，Node `22.23.3`／npm `10.9.9` 通过。
  实际 coordinator 无下载 seam 地安装线上正式 r9，CLI 帮助、生产依赖与 global custom-prefix 身份通过。
  此真实链路使用 `--no-integrate`，没有生成 integration state／wrapper 或安装 staging／lock 残留。
  官方 Kimi 为仅回应 `--version` 的原生可执行 fixture；无服务或模型调用。
  报告：`.cache/one-click-install-qa/windows-real/run-report.json`。
- Windows PATH 证据限制：首次安装只比较展开值，未预先捕获 raw User PATH；隔离 USERPROFILE 使
  `%USERPROFILE%` 展开不同，初次 harness 因此误报。受控展开证明与最后只读核验通过，Machine PATH 未变，
  没有 QA 路径留在持久 User PATH；**不据此声称整个真实安装的 raw User PATH 前后逐字一致**。
  Windows 安装 IT 共 2 项，其中接管测试使用隔离 User PATH mock，没有写真实注册表，
  不是新 PowerShell 接管验收。
- 原生 Linux WSL Ubuntu 22.04 x64 glibc：`tests/it/installNativeFixture.mjs` 的 bash 与解包 zsh 验证
  真实线上 r9 的严格 digest 下载、生产 npm 依赖、接管、新交互 shell 的私有 Node／wrapper，
  以及 global 身份、重复安装、记录 runtime 和使用实际 r9 uninstall 移除自有 rc 块，均通过。
  HOME 含 apostrophe，预先存在 `.bashrc`，新 shell 初始 PATH 为 `/usr/bin:/bin`。
  官方 Kimi 是调用裸 Node 的隔离可执行 fixture，不是用户官方安装；未读取真实数据或启动 Web 服务。
  报告：`.cache/one-click-install-qa/coordinator-native/report.json`，由此前已完成的原生运行记录汇总，
  没有为生成报告重跑安装。
- 最终输出使用所选 Node 与 launcher 的绝对路径；Windows PowerShell 命令带 `&`，可复制执行。
  installer 独立验证精确 wrapper、实际 shell 的 rc 和持久 PATH，不以 `integrate status` 退出 0 推断接管成功。
  r9 的 status 仍按首个已存在 rc 诊断，多 rc 的 zsh 场景可能错误警告；应结合目标和新 shell 实际命令判断。
  Windows 私有 Node 的 User PATH 项在 r9 `integrate uninstall` 后保留，无需时需用户手动移除；
  撤销接管不卸载专用 npm prefix／runtime，不删除官方 Kimi、旧源码或其它安装。

未验证与发布边界：

- macOS、arm64、Windows 真实注册表／新 PowerShell 接管未验证；原生 Linux 结果不扩大为这些平台通过。
- 未验证真实官方 Kimi 交互或 Web 服务启动；未新增 workflow／CI 运行或公开在线入口验收。
- 脚本仍是本地未发布文件，当前 r9 Release／tag 不含脚本；没有提交、推送、发布或可用在线一行安装地址。
  用户需取得同一提交的完整本地脚本文件；未来在线 URL 与 `--revision` 必须锁定相同完整 SHA。

## 执行记录：2026-10-10 登录 profile 预检收口

- 已读取最新 `scripts/install/persistentPath.mjs` 与 `scripts/install.mjs`：接管 preflight 先调用实际
  shell targets，在 Release metadata／tgz 下载及 npm 执行之前验证登录 profile。
  bash 优先检查 `.bash_profile`；它缺失时才检查 `.bash_login`，不越过已有高优先级文件去选另一份。
- 已存在 profile 除空行／整行注释外，只接受无条件 `source` 或 `.` 行，目标为 `~/.bashrc`、
  `"$HOME/.bashrc"` 或 `"${HOME}/.bashrc"`；原 profile 保持不变，安装器不编辑它。
  空文件、仅注释、条件加载和复杂未知脚本均明确拒绝，提示 `--no-integrate`，或由用户手动安排简单加载后重试。
  拒绝发生在 Release／npm 前，不输出接管成功或 `integrated: true`；不将运行时 bootstrap 误称为完全无下载。
- 父级补验结果：原生 WSL 已知简单 source profile，使用实际持久 PATH 逻辑后，bash `--login -ic` 通过，
  没有新增下载；这不是再次运行整个 Release 安装，也不扩展为未知复杂 profile 可自动接管。
- 上节 70 文件／1268 项 UT 和 257 项 IT 是收口前实际通过的历史快照，初期覆盖率门禁关闭事实保留。
  收口后的标准 lint／typecheck／UT／IT／pack 已全部复跑通过：UT70文件1272项，IT16文件通过＋1文件跳过，
  255项通过＋2项原生POSIX在Windows跳过，共257项。UT行／分支88.20%／79.58%，IT85.58%／72.13%。
  新安装脚本纳入UT／IT覆盖率，无新排除、降门槛或依赖；标准日志归档ignored .cache。
  自有Windows／Linux临时runtime、prefix、fixture、stage及WSL工具已清理，必要报告归档ignored目录。
  macOS／arm64、Windows真实接管及在线未公开状态不变；未提交、推送、发布本轮改动。

## 执行记录：2026-10-10 19:15 新范围同步

- 用户新增缺官方 Kimi 自动准备、npm 优先、兼容已有 native／npm、Windows Git Bash 检测／portable 补齐，
  并要求手机子代理模型与思考强度入口；正文已替换旧“不安装官方”的约束，AGENTS 已同步。
- 新建 `mobile-subagent-model-v1-plan.md` 并链接；它是实施基线，不声称用户另外显式审阅。
  官方 GET／POST config 只改 `secondary_model`，合并 models 池并保留其它配置，协议与清除语义先核对。
- 安装实现、真实官方 npm／Git Bash 运行、手机协议与实图、定向及标准检查由实现任务完成后追加。
  旧标准结果和 fixture 验收保留作历史，不覆盖或冒充本新增范围的结果；当前没有新测试数字或通过声明。
- 本文档任务只改文档，不修改源码／配置，不提交、推送、发布；在线入口与当前 r9 内容保持未包含新范围。

## 执行记录：2026-10-10 新范围早期阶段证据（历史，非最终验收）

以下保留当时运行结果与真实失败；PTY 限定 rebuild、手机 focused 和当前交付边界见下一节。

- 已核对 `scripts/install/official.mjs`：固定官方 2.1.1 tarball／SHA-512，ignore-scripts 安装至专用 `home/official`；
  native／标准 npm 已有安装复用不升级，Windows canonical cmd shim 验证、精确版本解析、统一 PATH 环境，
  owned 入口／shim digest 核验已实现。坏 override、未知归属与 partial 明确拒绝，不自动 resume 或覆盖。
- 已读取 `.cache/one-click-install-qa/official-report.json`：Windows x64 与原生 WSL Ubuntu 22.04 x64
  实际 coordinator 准备真实官方 2.1.1、安装／接管实际 r9、官方 Web page／meta 200；Linux 重复安装通过。
  Windows 使用 User PATH／注册表模块 seams，没有写真实注册表；该报告只证明 CLI／Web 健康，不证明 PTY 或 TUI。
- 已读取 `.cache/one-click-official-qa/preparation-report.json` 与 `linux-official-only-report.json`：
  Windows PowerShell 的版本／Web help、真实 Git Bash PTY spawn／输出／退出、Web 健康／config／列表和未鉴权 401
  通过，npm／native 发现复用不升级；raw User／Machine PATH 不变，无注册表写入。
  当时原生 WSL 的版本／help、Web 200／401 与 npm 复用通过，但 ignore-scripts 的 node-pty 实际 require／spawn 失败。
  报告观察为缺 binding／spawn-helper；后续核对 Linux 使用 forkpty，spawn-helper 是 macOS 目标，不能单独据其缺失判失败。
  Linux binding 缺失与真实 PTY 失败仍是真实历史，不能把 Web 200、旧 fixture 或 CLI help 扩大为 shell 工具可用。
  此 official-only 报告的 fullModeExecuted 为 false，不否定上一份 coordinator 报告的已执行路径。
- 已读取 `.cache/git-bash-qa/portable-real/report.json`：Windows x64 真实下载官方
  `PortableGit-2.56.0.2-64-bit.7z.exe`，60,027,568 bytes 与固定 SHA-256 校验后，SFX 解包、白名单初始化、
  Bash／cygpath／git init 和 status、owned 重复复用无下载通过；raw User／Machine PATH 与隔离启动配置不变。
  自有进程、runtime 与下载 asset 已清理，保留 ignored 报告。
- Git SFX 的真实初次失败保留在 `initial-sfx-failure.json`：该官方 7-Zip 26.03 fork 支持 `-y`／`-o`，
  不支持初始 `-gm2`／`-nr`／`-InstallPath`；未在期望目录解包，不能把进程退出 0 当作成功。
  修正先验证原官方整个 asset，再保留 exe module 与 7z payload，仅替换内嵌 config 的
  `RunProgram=usr\bin\true.exe`，以 `-y -o"<stage>/unpacked"` 执行。
  true.exe 是子程序；默认 git-bash.exe／post-install.bat 未运行，随后另用隔离 HOME／config、
  `--noprofile --norc` 显式执行五个核实白名单 `.post` 初始化脚本，不能声称完全不启动子程序。
- 父级阶段结果：完整 lint／typecheck 通过；首次扩展 UT 有 4 项因并行 SFX fixture 中间状态失败。
  已读取 `.cache/one-click-install-ut-expanded.log` 确认失败，父级随后报告 42 项 Git UT 与 43 项 IT 定向通过。
  不预填最终总数或覆盖率；后续 expanded2 快照与最新改动复跑边界见下一节。
- 当时手机已有独立实现与阶段交互证据，供应商／长菜单与 Auto 尚待补验；最新 focused 的关闭结果见
  [手机计划](mobile-subagent-model-v1-plan.md)，不覆盖或删除早期失败。
- macOS／arm64、Windows 真注册表／新终端接管、完整 TUI／工具／clipboard 未全面验证；不登录或发模型调用。
  安装器与手机控件仍本地未发布，r9 不含新增范围，无在线一行入口；文档更新不改源码／测试／配置／workflow。

## 执行记录：2026-10-10 限定 PTY rebuild 与 focused 收口

- 已读取最新 `pty.mjs`、`ptyAudit.mjs`、`ptyProbe.mjs` 与 official 接口：主体仍是固定 npm 2.1.1 ignore-scripts。
  新自有 prefix 先实际 PTY marker／退出 probe；仅 Linux 缺 binding 时审计固定 node-pty 1.1.0 的 lifecycle／构建文件，
  node-addon-api 7.1.1 的入口／gyp／headers 同样固定摘要核验，然后只对该绝对依赖目录 npm rebuild。
  scope 只跑 node-pty install／postinstall，global／bundle／workspaces 禁用，不跑根 kimi 旧 Python 迁移或其它包。
  PTY 验证成功才写 ownership record，owned 重复再 probe，坏 binary 拒绝且不改 record／不自动重建；non-owned 安装保留。
- 实际构建依赖标准 Python 3、C／C++ 编译器和 make；使用所选 Node、隔离 npm 配置、显式安全 shell／Python。
  本机 WSL 缺 make／C++ 明确失败，**空 Linux 仍非零编译依赖一键安装**；不 sudo／apt 或自动安装完整工具链。
  早期官方同版本 native fallback 缺 pty.node 的失败保留正文，不将其描述为解决路线。
- 已读取 `.cache/one-click-official-qa/pty-rebuild-real-report.json` 与对应真实 runner：在已有
  golang 1.26 bookworm Docker 标准工具环境、Node 22.23.3，实际 npm 准备→审计／限定 rebuild→真实 PTY→Web meta 200，
  report 的 pty／web／record／ownedReuse／cleanup 均 true，无模型调用。该 helper QA 不冒充完整 r9 coordinator 复跑。
  正文已记录 Windows 实际 PTY 与重复 owned binary 缺失拒绝 IT、66 项定向 UT 和 exact-directory scope IT 通过；
  scope fixture 只证明 lifecycle 范围，不替代本条实际依赖构建证据。
- expanded2 标准检查曾全部通过；已读取其 UT／IT／pack 日志确认历史快照，不在本条抄作最终计数。
  当时 PTY helpers、UI 和随后 i18n 改动后仍需完整标准门禁；最新结果见本计划末尾 final3 记录。
- 当时手机 44 项定向 UT 与准确完整官方 app focused 108 断言／28 图通过，父级代表菜单／详情／Auto 图已查看。
  供应商分组／编号消撞、完整身份、长 popup、显式 Auto／全池 On、桌面回读和 observer 已定向关闭，
  旧七主题矩阵不冒充最新全量重跑；详见[手机计划](mobile-subagent-model-v1-plan.md)。
- 当时用户新增英文界面夹中文反馈，独立 i18n 尚待修复；后续主矩阵 41 断言／25 图及 provider 2 断言／1 图通过。
  系统文案与子代理同 tab 动态语言的最新结果、strict scroll 观察项见[手机计划](mobile-subagent-model-v1-plan.md)。
  macOS／arm64、真 Windows 注册表／新终端、实体手机和真实磁盘持久化未全面验证；最终标准不沿用旧全绿。
  当前无发布／推送／提交、线上一行入口或 production 服务修改。

## 执行记录：2026-10-10 21:24 安装 review 两项安全收口

- review 确认限定 lifecycle scope 本身没有绕过，问题是构建输入隔离不完整：GYP 提前解析的 noexcept.gypi 未审计，
  以及 MAKEFILES 可让 make 先加载外部 mk。已补 node-addon-api 7.1.1 官方 tarball 中 noexcept.gypi 固定 SHA-256，
  同其它文件执行 regular-file／链接检查；缺失、改写或链接在 GYP 执行前拒绝。
- buildEnv 过滤全部 MAKE 前缀变量，并保留原有 FLAGS 过滤；覆盖 MAKEFILES／MAKEFLAGS／GNUMAKEFLAGS／MFLAGS、
  MAKEOVERRIDES／MAKELEVEL／MAKE_RESTARTS／MAKE_TERMOUT／MAKE_TERMERR，然后只设置已选标准 MAKE 可执行文件。
- scoped ESLint 与 PTY UT 3 文件20项通过，真实 npm exact-directory scope IT 1项通过；门槛未降低。
  复用已校验缓存官方 tarball 和已有 Docker bookworm 工具环境，未重跑在线安装或引入工具链。
- 实际完整 audit 对原官方文件通过，对 noexcept.gypi 改写／缺失／符号链接分别拒绝，恢复后通过。
  真实 GNU make 正向对照确认注入 mk 会执行 marker；使用生产 buildEnv 输出运行同一 make 时 marker 不再生成。
  报告 `.cache/one-click-official-qa/pty-review-boundary-report.json`；临时资源清理，无模型调用。
  该窄范围输入验证使用模拟 PTY 状态，不冒充再次真实 PTY／官方构建或完整 coordinator 验收。
  空 Linux 与未测平台边界不变；最新标准门禁见末尾记录。

## 执行记录：2026-10-10 最新真实完整安装场景

- 已读取 `.cache/one-click-official-qa/final-scenario-report.json`：Windows x64 与 Linux x64 现有标准工具环境
  完整场景通过，bare WSL 预期拒绝通过但 full 未通过；这些结果与旧 helper-only QA 分开，不抹掉此前真实失败。
- Windows 原生 PowerShell、Node 24.14.0／npm 11.9.0，初始 PATH 无 Kimi；实际配套 install.ps1 --no-integrate
  下载并安装正式在线 r9、真实固定官方 2.1.1 ignore-scripts，无下载 seam；真实 node-pty marker／退出 0 通过。
  将自有 npm 放入 PATH 后重复 coordinator，官方 manifest／入口／shim 的 digest、size、mtime 不变。
  接管使用显式模块 registry PATH seams，实际安装的 r9 cmd wrapper 子进程、managed Web 和 uninstall 通过；
  官方／managed meta／config／list 200、无 token config 401、launcher root／config／list 200。
  新一轮 raw User／Machine PATH 字节值前后相等，未存储或打印值；不是实写注册表／新终端验收。
  managed wrapper 前端使用支持的 --port 0，不占用生产默认端口，隔离 backend 等待鉴权 meta ready。
- Linux x64 复用已有 golang:1.26-bookworm 镜像，Node 22.23.3／npm 10.9.9、Python 3.11.2／C/C++ 12／make 4.3。
  实际配套 install.sh --no-integrate 下载正式在线 r9、固定官方 2.1.1 后审计 exact-directory rebuild；
  真实 binding／/bin/sh marker／退出 0 通过，重复安装官方指纹不变。隔离 bash rc／profile、真实新 login interactive bash、
  私有 Node PATH 持久化、实际 wrapper help／version／managed Web 与 r9 uninstall 通过；HTTP／鉴权检查同上。
  仅使用既有标准工具，不 apt、不修改镜像或下载第三方工具链；自有进程组／runtime／prefix／config 与临时 container 清理，
  镜像 identity 不变，repository bind mount 只读。
- 原生 WSL Ubuntu 22.04 x64 的实际完整 sh 入口在审计 PTY 准备时报缺 make、退出 1，宿主也缺 C++。
  fullPassed=false、expectedRejectionVerified=true；未尝试安装工具链，自有 runtime／prefix／config 与进程清理，不能记 full 成功。
- 本轮未重复早期完整 Node bootstrap、official-only 或 Windows portable 的真实下载／解包。
  portable artifact QA 与缺 Git 的 Windows full coordinator **不是同一次组合场景**；不把分开证据合并为已验收组合。
  21:24 review 的 audit／MAKE 输入窄验证也不是重跑此 PTY full；标准 counts／coverage／pack 见下一节。
  空 Linux 零编译依赖一键、macOS／arm64、真 Windows 注册表／新终端仍未验证或未满足；无登录／真实配置读取／模型调用。

## 执行记录：2026-10-10 final3 最新标准门禁

- PTY／UI／i18n 最新产品改动后的 lint、typecheck、UT、IT、test:pack 均实际 exit 0，父级确认随后未改产品。
  lint／typecheck 结果来自父级执行确认；本次文档收口直接核对下列三份日志，不重跑标准链。
- `.cache/one-click-install-ut-final3.log`：79 文件／1412 项 UT 通过，Lines 88.77%／Branch 80.21%。
- `.cache/one-click-install-it-final3.log`：19 文件通过／1 文件跳过，308 项通过／2 项跳过（总 310）。
  仅 Windows 上的 `tests/it/install-posix.it.test.mjs` 两个 native POSIX tests 跳过；Lines 84.94%／Branch 71.07%。
  UT／IT 的 70% 行与分支门槛未降低；真实官方 CLI／PTY／Web／owned reuse、坏 binding 拒绝及 exact-directory scope 通过。
- `.cache/one-click-install-pack-final3.log`：本地 `open-kimi-web-2.1.1-r9.tgz` 内容／无测试文件检查、version、
  无 runtime deps 的 update help／危险参数拒绝、实际首页 no-cache／healthz 代理通过；IT 另验证实际安装的更新身份。
  根目录 `scripts/install*` 不打进 launcher tgz；这是当前本地产物检查，不是发布或新脚本已进入线上 r9 的证据。
- 本地标准门禁完成，不代表所有平台、全英文场景或实体手机通过；子代理裸官方对照确认视觉锚定不退，
  无需产品补丁，原六项 strict scrollTop 失败保留，详见[手机计划](mobile-subagent-model-v1-plan.md)，final3 仍适用。
  空 Linux、macOS／arm64、真 Windows 注册表边界仍保留；父级确认 task-owned 406.5MiB 已清理，无残留进程／container，报告保留。
  无提交、推送或发布；线上版本仍为 `v2.1.1-r9`，官方兼容基线仍为 `2.1.1`，不存在新增脚本的一行在线安装入口。
