# open-kimi-web 维护约定

本文件适用于整个仓库。开始修改前先阅读本文件、`README.md`、`UPSTREAM.md`，以及任务涉及目录中的现有实现和测试。
当前工作树中的未提交内容可能来自并行任务；先看 `git status` 和相关 diff，只追加自己的改动，不覆盖或回退他人的工作。

历史 Kimi Code `0.43.1` 适配以
[`docs/plans/kimi-code-0.43.1-compatibility-v1-plan.md`](docs/plans/kimi-code-0.43.1-compatibility-v1-plan.md)
为当时的实施、审查和验收基线。当前本地兼容目标为 `2.5.2`，准确适配证据见 `UPSTREAM.md`、`upstream.json`。
当前正式版本为 `2.5.2-r2`，待发 `2.5.2-r3`；安装器 pin 及 meta 失败 UI fallback 均保持 `2.4.1`。
用户已要求提交发布，按[请求指标 r3 发布计划](docs/plans/request-metrics-2.5.2-r3-release-v1-plan.md)执行。
覆盖下方指标／重启“不提交／不发布”的历史限制；桌面重启放设置→通用，手机不变，本轮不重启生产。

用户于 2026-11-11 选定玻璃 O、银灰 K 与冰蓝碎钻图标并要求发布，按
[`docs/plans/app-icon-2.5.2-r2-release-v1-plan.md`](docs/plans/app-icon-2.5.2-r2-release-v1-plan.md) 执行。
本轮只替换图标、补安全裁切资源及同步版本和文档；未重新生图、升级用户 CLI 或重启生产。
双端三主题 16 项图标／几何检查、21 UT／13 IT、lint／typecheck 及实际 pack 通过；实图与裁切板已查看。
PR #44 及 main required CI 通过，2886 UT／626 IT、28／25 项平台条件跳过，70% 门槛不变。
正式 v2.5.2-r2 固定 dd2ec5a3；包 168 文件／9,025,489 bytes，公开原字节／digest、同 SHA 入口和高清图已核对。
旧 r1 更新器已发现 r2，旧 r1 tag／资产未变；本次提交、squash 和 annotated tag 均使用已确认 GitHub noreply。
本节为发布后记录，不再移 tag／换包；原 .tmp/ 及并行 .gitignore 修改未纳入，完整证据与未验证边界见上述计划。

用户于 2026-11-10 明确要求提 PR、合入 main 并发布，按
[`docs/plans/kimi-code-2.5.2-r1-release-v1-plan.md`](docs/plans/kimi-code-2.5.2-r1-release-v1-plan.md) 执行。
本次授权覆盖下方品牌／兼容及手机目录此前仅本地提交、不推送／不发布的阶段限制，不包含用户 CLI 升级或生产重启。
沿用已完成的默认并发测试、真实后端及实图验收，只补版本、实际包、隐私和 required CI；不绕过门禁或改旧 tag／资产。
提交、squash 与 annotated tag 均使用已确认 GitHub noreply；正式包只从通过 CI 的 main 生成。
PR #42 及 main CI 已通过；正式 v2.5.2-r1 固定 f5d510e3，包 168 文件／8,491,803 bytes。
公开包原字节、digest 与同 SHA 四个在线入口均已核对；真实旧 r3 更新器已发现新版，旧 r3 tag／资产未变化。
本节为发布后记录，不再移动 tag／换包；没有升级用户 CLI 或重启生产，完整证据及未验证边界见上述发布计划。

品牌图标、实际版本、话题标签及官方 2.5.2 兼容按
[`docs/plans/branding-and-2.5.2-compatibility-v1-plan.md`](docs/plans/branding-and-2.5.2-compatibility-v1-plan.md) 实施。
用户于 2026-11-10 追加授权仅本地 Git 提交，覆盖本轮及下方手机目录的“不提交”阶段限制。
不推送、发布、升级用户 CLI 或重启生产；移除 OKW 重复插队逻辑，保留官方发送行为。
准确 npm 后端 23 项与最近页补验 3 项通过；正式手机 API 经真实后端配置保存／清除／回读三项通过。
完整 app 三主题／双端 20 项几何功能检查及 12 张图完成；原报告保留一次 Chrome 瞬时退出未确认，后查已归零。
话题切换／原生改名／历史与旧消息跳转七项功能、子模型／搜索六项、新 WS 同步六项通过，驱动首失败保留。
用户追加要求默认并发门禁必须通过；已确认原 taskkill 超时后父子进程确实存活，不归咎于 PID 查询残影。
Windows 改用原生快照、创建时间与句柄终止／退出确认；保留 3 秒清理期限、未确认错误与安装锁，不增加依赖。
安装器三个短命令探测原各固定等待一秒，改为 0.1 秒轮询，原 15 秒总预算不变，补边界回归。
最终默认并发 2914 项 UT、644 项 IT／6 项平台跳过、lint／typecheck 及实际 pack 全通过，70% 门槛不变。
UT／IT 行与分支为 93.56%／84.86%、84.30%／71.88%；原并发失败保留为修复前证据，准确结果见同计划。

手机消息目录按
[`docs/plans/mobile-conversation-toc-v1-plan.md`](docs/plans/mobile-conversation-toc-v1-plan.md) 实施。
本轮只补手机入口和点选跳转，复用原生消息身份／分页，不全量下载会话，不依赖 Vue 私有状态。
只在本地实现与验收，不提交、推送、发布、升级官方或重启生产；此前 r3 发布授权不延伸到本功能。
精确 2.4.1／2.3.1 的真实 app 分页与跳转各 12／12，WS 同步各 11／11；窄屏、横屏和三主题实图已查看。
跳转使用原生相邻揭示及精确锚点，并等待布局稳定；手动滚动立即取消。顶端可能触发官方一页预取，不宣称绝对零请求。
最多四会话、每会话 2000 项短目录；超过 2 MiB 的响应不额外解析，目录可能缺项，原生正文不截断。
本轮 120 项定向 UT、5 项资源 IT、标准 lint／typecheck 与本地 pack 已通过；历史首败及实际边界见同计划。

用户于 2026-11-08 要求推送并发布，按
[`docs/plans/kimi-code-2.4.1-r3-release-v1-plan.md`](docs/plans/kimi-code-2.4.1-r3-release-v1-plan.md) 执行。
本轮 2.4.1-r3 纳入下方会话分叉／手机置顶及已验收的局域网 CA；覆盖此前不提交／不发布的阶段限制。
沿用已完成的功能与实图验收，仅补实际包、隐私及 required CI；不升级官方、不重启生产、不改旧 tag 或资产。
提交及 squash 显式使用已确认的 GitHub noreply 身份，原 .tmp/、cache、真实数据与私钥不公开。
PR #39 及 main CI 已通过：2744 UT／625 IT 通过，28／23 项平台条件跳过，行及分支 70% 门槛不变。
正式 v2.4.1-r3 固定 e0ec0f92；包 159 文件／8,474,802 bytes，线上原字节与 digest 一致。
真实 r2 更新器已发现 r3，同 SHA 在线入口及 README 顺序已核验，旧 r2 tag／资产未变；准确证据见上述计划。
本节为发布后记录，不再移动 tag／换包；没有升级用户安装、重启生产或替手机导入证书。

用户于 2026-11-07 授权发布新版，按
[`docs/plans/kimi-code-2.4.1-r2-release-v1-plan.md`](docs/plans/kimi-code-2.4.1-r2-release-v1-plan.md) 执行。
本次 `2.4.1-r2` 纳入下方大会话最近页、脱敏调试日志、安装到桌面、普通 CLI 透传及精简文档。
本授权覆盖上述功能先前“不提交／不发布”的阶段限制，不覆盖真实数据公开、生产重启或旧 tag／资产变更。
沿用已有功能及实图验收，不重复浏览器或全平台安装矩阵；必须检查实际发布包、隐私及本次 required CI。
PR #37 及 main CI 已通过；正式 v2.4.1-r2 tag 固定 e8bd89c1，包 148 文件／8,457,469 bytes。
线上包与本地正式资产一致，旧 r1 更新器已发现 r2，同 SHA 安装入口已核验；准确 SHA／digest 见上述计划。
本节是发布后记录，不再移动 tag 或替换资产；没有升级用户安装或重启生产，实体手机安装仍未全面验证。

用户反馈安卓 Chrome 局域网无法安装，按
[`docs/plans/android-lan-ca-v1-plan.md`](docs/plans/android-lan-ca-v1-plan.md) 修复证书与安装引导。
本轮目标为 .3 与 EasyTier，.8 暂不需要；显式 setup 的本地 CA 保持稳定，只续签包含本机地址的服务器证书。
实现与验收已完成；用户随后明确要求直接执行，授权核对实际安装后启用同 home 的 CA，并切换、重启现有服务。
该授权不含修改手机／系统信任、网络或会话，不含提交、推送、发布或改动旧 tag／资产；手机导入仍由本人确认。
CA 私钥不进入请求上下文、下载、日志或包；只提供已验证的根公证书，下载须核对电脑终端指纹。
不把 localhost 安装事件、证书可信或桌面图标等同于安卓 WebAPK 实际安装，不声称单图标自动切换 IP。
准确官方 2.4.1 app 的 34／34 断言与 7 张实图完成，双端／窄屏／短屏／三主题及中英文保持原布局。
真实 HTTPS/WSS 只信任根通过，错误根拒绝；审查补齐未启用 CA 的旧软链接兼容与编码 fragment 的 404 边界。
最终标准 lint／typecheck／2634 UT／642 IT＋6 既有条件跳过／pack 通过，UT／IT 行及分支 70% 门槛不变。
实际包的证书命令与根信任下载已验；浏览器视觉用了隔离 CDP 绕过，不冒充证书受信或实体手机安装。
临时 CA／浏览器 profile 已清理，报告归档 ignored cache；27 个文件与实际包范围隐私检查未发现泄露，未新提交或发布。
用户追加执行后，已核对实际 wrapper 指向本树，在同 home 启用 CA；两实际本机地址的根信任 HTTPS／下载验证通过。
当前对话与服务同宿主，重启须在本轮回复后且正式 API 连续空闲时进行；不得提前称原端口已切换或手机已安装。
实际官方后端仍为 2.3.1，本轮不升级；仅本机双地址验证不代表实体手机或外部网络全链路通过。

本轮双端会话三个点菜单的分叉入口与手机置顶按
[`docs/plans/session-menu-actions-v1-plan.md`](docs/plans/session-menu-actions-v1-plan.md) 实施。
桌面复用原生右键菜单；手机必须通过精确 ID／原生选择后的路由确认身份，不按标题、相对时间或行顺序猜测。
置顶沿用官方浏览器本地 ID 偏好，不改工作区置顶，不承诺跨设备或 IP 同步；不自动重试分叉、信任或接管。
本轮只改本地代码并验收，不提交、推送、发布或重启生产，保留现有 CA 改动。
正式官方 2.4.1 隔离空会话的直接／重启后分叉 23／23，模型及信任写入为零；准确请求与清理见同计划。
完整 app 首轮 125／129，失败项已修后定向补验：手机边界、桌面打开／方向键／Escape 通过，旧报告不改成全绿。
桌面追加 30／31 保留 Tab 焦点首败；最小修复后精确两版真实 Tab／Shift+Tab 18／18，焦点均正确离开菜单。
本轮功能本地验收完成，自有临时数据、浏览器与服务均已清，报告归档 ignored cache；未提交、发布或重启生产。
手机追加补验 42／43，唯一失败是自然冷导航的旧行准备假设未成立；受控身份窗口及真实前端上传双门禁均通过。
置顶会刷新一次并恢复列表，上传未结束先拒绝；草稿、其它 pin 与菜单双向互斥已验证，实体手机和任意大会话不据此保证。
桌面键盘修复只增强三点打开的当前原生菜单，不接管原右键；标准 lint／typecheck、193 定向 UT 与 5 项资产 IT 均通过。

当前用量统计功能按已确认的
[`docs/plans/usage-statistics-v1-plan.md`](docs/plans/usage-statistics-v1-plan.md)
执行；实现、审查、截图和验收以该计划为基线，范围变化先同步文档。

用量定价自动匹配、批量确认与大列表滚动性能按
[`docs/plans/usage-pricing-auto-match-v2-plan.md`](docs/plans/usage-pricing-auto-match-v2-plan.md)
执行；该计划补充并覆盖 v1 中逐模型映射和多层滚动的交互约定。

价格刷新连续性、旧缓存恢复与 r5 发布按
[`docs/plans/usage-pricing-refresh-v3-plan.md`](docs/plans/usage-pricing-refresh-v3-plan.md)
执行；手工设置优先，保留默认来源及失效目录项的最后有效价格，旧包在新包发布成功后移除。

图片完整预览、tab 及时切换反馈与 r6 发布按
[`docs/plans/image-preview-complete-v1-plan.md`](docs/plans/image-preview-complete-v1-plan.md)
执行；保留官方鉴权与状态边界，不把截断图当完整图，不以加载等待阻塞 tab 点击反馈。

手机提问卡片高度与长题干按已确认的
[`docs/plans/mobile-question-height-v1-plan.md`](docs/plans/mobile-question-height-v1-plan.md)
执行；保持既有外观，验证真实题干、拖动档位及选项可达性后发布。

当前会话体积提示按
[`docs/plans/session-size-v1-plan.md`](docs/plans/session-size-v1-plan.md)
执行；只计当前会话各 agent 的 wire 日志体积，不解析全文、不当作 token 上限，保持切换和失败边界。
桌面补齐按 [`docs/plans/session-size-desktop-v2-plan.md`](docs/plans/session-size-desktop-v2-plan.md) 执行，
覆盖 v1 的仅手机版范围；桌面与手机共享请求状态及刷新计时器，保留官方标题结构和空会话入口。
追加消息时间戳沿用官方精确 ID 和正式时间数据，不以当前时间或会话创建时间伪造历史消息时间。

主聊天窗格自适应宽度按
[`docs/plans/chat-width-responsive-v1-plan.md`](docs/plans/chat-width-responsive-v1-plan.md)
执行；按窗格自身宽度计算，不使用 viewport 比例，保留官方滚动条补偿与手机、Side Chat 边界。

手机原生平铺入口与展示排序、源码及 npm 安装自更新按
[`docs/plans/mobile-list-and-self-update-v1-plan.md`](docs/plans/mobile-list-and-self-update-v1-plan.md) 执行。
恢复原生视图偏好，排序只改变展示；更新必须识别实际执行安装，不改另一份安装、官方 Kimi 或接管状态。

大会话局域网加载性能修复与 r9 发布按
[`docs/plans/large-session-lan-performance-v1-plan.md`](docs/plans/large-session-lan-performance-v1-plan.md) 执行。
先分层对比官方基线与增强版；保留原生最近页、历史分页和增量语义，不以截断日志或另一套会话状态代替优化。

一键安装脚本的实施基线与阶段证据见
[`docs/plans/one-click-install-v1-plan.md`](docs/plans/one-click-install-v1-plan.md)。
用户已授权 r10 发布；按[收敛发布计划](docs/plans/one-click-install-r10-release-v1-plan.md) 执行，
沿用已有验收，不重复本地全套测试、UI 矩阵或跨平台组合；保留实际包检查、隐私检查及 required CI。
r10 时 README 顶部只留短在线安装命令，固定已发布 r10 SHA；此为历史约定，当前入口来源按下方 2.4.1 计划。
用量截图继续两栏缩略展示并链接原图，不因版本适配替换既有图片。
以本地入口和同一不可变提交的完整脚本为交付边界；目标不要求预装 Node／npm／Corepack／pnpm／Git 或官方 Kimi。
r10 历史实现缺官方时 npm 优先准备固定 `@moonshot-ai/kimi-code@2.1.1`；本轮新装 pin 见下方，已有可用安装不升级。
官方 npm 需要 Node ≥ 22.19.0；专用 `home/official` 与 launcher prefix／runtime／wrapper 分开。
固定真实 tarball／SHA-512、默认 ignore-scripts，避免官方 postinstall 迁移用户旧 Python 命令；归属不明／partial 不自动续装。
以下为 r10 历史验收：Windows 完整场景验证真实官方 2.1.1、实际 r9 cmd wrapper／managed Web、重复复用和 uninstall；
接管仍用注册表 seams。该阶段 Windows User／Machine raw PATH 字节值前后相等；Git Bash PTY 与 portable 下载／初始化分别通过，
缺 Git portable 与完整 coordinator 不是同一次组合验收。Linux 现有 Docker bookworm 标准工具环境完整 sh／r9／新 bash、
真实 PTY／managed Web／重复复用／uninstall 通过；WSL 缺 make／C++ 明确失败，不记 full 通过。
legacy 官方安装先真实 PTY probe；Linux 缺 binding 时只审计固定 node-pty 1.1.0／node-addon-api 7.1.1，
限定审计后的绝对 node-pty 目录 npm rebuild，只跑其 install／postinstall，不跑根 kimi 旧 Python 迁移或其它包脚本。
审计补齐 noexcept.gypi，构建环境过滤所有 MAKE 前缀及 FLAGS 控制变量；真实 make／audit 窄验证通过，不冒充重跑 PTY。
legacy rebuild 需 Python 3、C／C++ 编译器和 make；不 sudo／apt 或自动准备完整工具链，不作为新版新装的必需前提。
PTY 成功才写 legacy ownership record；owned 重复 probe，损坏拒绝不自动 rebuild；non-owned 安装保留不重建。
旧 Linux 使用 forkpty，spawn-helper 为 macOS 目标；缺 binding 与 native fallback 失败保留为历史，Web 200 不能代替 PTY。
不自动登录、启动生产服务、读取真实会话或发付费调用；此前仅本地实现的范围现纳入已授权 r10 发布，r9 不包含它们。
旧 fixture 与 expanded2 保留为历史；PTY／UI／i18n 改动后的 final3 标准门禁已完成，父级确认五项命令均 exit 0。
lint／typecheck 通过；UT 79 文件／1412 项通过，Lines 88.77%／Branch 80.21%；IT 19 文件通过／1 跳过，
308 项通过／2 个 Windows 上的 native POSIX tests 跳过，Lines 84.94%／Branch 71.07%，70% 门槛未降低。
本地 pack 的 version／静态资源／API 代理通过，IT 另验证实际更新身份；仍非发布，根安装脚本不在 launcher tgz。
日志与范围集中见安装计划 final3 记录；macOS／arm64、Windows 真注册表／新终端接管仍未全面验证。
bash 登录 profile 以 `.bash_profile` 优先、仅缺失时选 `.bash_login`；除空行／整行注释外只接受无条件加载
`.bashrc` 的简单 source／`.` 行，空文件、仅注释、条件或未知脚本在接管 preflight 拒绝，不改 profile。
用户可选 `--no-integrate` 或手动安排加载后重试；标准门禁通过不等于所有平台或场景已验收。

手机子代理默认模型与思考强度补充及同轮英文夹中文反馈按
[`docs/plans/mobile-subagent-model-v1-plan.md`](docs/plans/mobile-subagent-model-v1-plan.md) 实施，现纳入已授权 r10 发布。
官方 `2.1.1` MobileSettingsSheet 不含该字段，且无已确认的完整 Settings 公开打开动作；使用最小独立手机控件。
读取官方 config／models，仅 POST `/api/v1/config` 的 `secondary_model`，合并 models 池，不覆盖主模型／其它配置。
Auto 合法提交 `defaultEffort: ''`，按全局思考设置／模型默认。r10 当时的官方版本不能清除已配置模型，
空模型／null 无效，merge 省略字段不能清除；准确 `2.5.2` 的原生 null 例外见下方当前适配事实。
不使用 Vue 私有状态、切换 breakpoint 或另存 localStorage。
用户新增要求沿用主模型选择 UI，实施范围已增补同一计划：官方 ModelPicker 未公开导出，
复用 sheet／搜索／供应商 chips／两行模型列表及分段思考的结构与 token，不用 Vue 私有实例或主模型写入回滚。
旧原生 SELECT／编号／常驻详情及 focused 108 断言／28 图仅属历史；新 UI 实图发现碰撞身份与分段密度问题后已修。
同供应商同名长 alias 前置真实唯一差异，完整值用于保存；分段密度与准确官方 Settings 对齐。
最新定向 64 项 UT、完整官方 app 199／199 断言／23 图通过，父级查看七张代表图；七外观样例覆盖 320／390／640。
修后标准 lint／typecheck／UT 79 文件 1430 项／IT 308 项及 pack 通过，IT 两项 Windows native POSIX 跳过；详情见手机计划。
实体手机、OS 软键盘与真实磁盘持久化仍未验证；发布不会自动重启生产，实际发布状态见 r10 计划。
共享 locale 以官方 kimi-locale 为准，不以根 lang 代替；themes／presentation／session／usage／provider 等增强已适配。
本次覆盖的英文系统 text／title／aria／placeholder 单语言，用户模型／provider 中文保留；同 tab 切换保留草稿、不新增请求。
准确官方 app i18n 主矩阵 41 断言／25 图与 provider 2 断言／1 图通过；父级代表英文主题图已查看。
13 文件／176 项定向 UT、5 项 asset IT 和此前子代理 46 项 UT 是阶段结果；新选择器最新为上方 64 项。
子代理完整官方 app 原生六次切语言为 38／44 断言通过、3 图；系统文案、草稿、错误、回读与无额外请求通过。
6 项 strict 绝对 scrollTop 失败原报告保留；另行裸官方对照 21／21、6 图通过，子代理可视锚定 <0.6px，无需产品补丁。
父级已看英文错误草稿／缺供应商两图；不把该报告写成全 44 项通过，也不把原 focused 108 当作动态语言证据。
现有计划增补请求，不声称用户另行确认新计划；本地标准通过不扩大为全英文、全平台或已发布验收。

定时任务与统一导航按用户最新收回决定及
[`docs/plans/scheduled-tasks-management-v1-plan.md`](docs/plans/scheduled-tasks-management-v1-plan.md) 实施。
不维护修改版 Kimi 后端、不加引擎，不改任务日志、不向浏览器／局域网开放通用 debug、不让 AI 代执行假管理。
原版精确 2.1.1／2.2.0 的受控 supervisor→公开 HTTP 链已隔离实测，每版 58 公开请求、27 native 辅助请求通过。
真实分页 20＋2（含归档）、原 sid 冷读不恢复、显式恢复后增删、关闭再恢复同 task ID 与完整内容通过，模型调用 0。
两版正常 shutdown、自有进程／端口残留 0；spawn seam 仅换测试端口，未碰生产 58627。
DST、创建回包一致性、慢正文未鉴权占额、合法路径内部双点／换行标题误拒已修并有回归；证据集中在计划。
此前阶段标准 lint／typecheck／1891 UT／512 IT＋2 Windows POSIX 跳过／pack 通过，覆盖率阈值未降低。
UT Lines／Branch 91.38%／82.56%，IT 85.07%／72.06%；当时本地包仍 r10 仅作冒烟，不是本轮 2.3.1-r1 结果。
2.2.0 使用 2.1.1 静态 UI 验受限协议；整体 UI／迁移／fork、真实 RC relay、实体手机及其它平台未据此宣称兼容。
按计划新增受控同实例显式 `kimi web --scheduled-tasks` 及受限 HTTP/UI，默认不开启，不改生产；不假定多 CLI。
该模式禁止直接 RC 入口，外部 target 不开放新增管理接口；冷会话须明确恢复确认，不为列表隐式唤醒任务。
官方 Remote Control 直接连接 native origin，debug 与 RC 不互斥；外层拦截不能承诺同实例 RC 的调试隔离。
完整管理仍暂缺，不能伪造原生没有的编辑、暂停和任务模型语义；未验证不挂假管理入口。
保留手机搜索、双端导航统一与 Hyper-V 修复；此前后端实验验收不能当作原数据管理或当前交付完成。
双端入口为新建会话、新建工作空间、定时任务、搜索、使用统计；完整 2.1.1 app 交互 53／53 断言通过。
实图发现窄屏长标题叠字与主题透底，已用禁收缩／两行预览／主题叠加不透明基底修复，选中详情保留全文。
320／390／1280／1440 与 Original／Nocturne／Aurora 修后图已查看；完整记录与像素 QA 的失败／修正见计划。
原任务目录按正式 v2 全会话分页和受控 home 的有界只读 main wire 投影；历史只据真实触发／结束事件，缺证据标未知。
搜索沿用正式官方索引，不另建会话数据库；冷读扫描成本和不完整状态必须明示。
桌面工作区创建不切换当前会话，导航弹层隔离原生 QuestionCard 全局按键；关闭还原 inert 和焦点。
不改写用户现有安装或自动重启生产；此前阶段撤掉修改版后端及其专属管理链路，不提交／不发布限制已由下方授权覆盖。

网络访问链接与 TLS SAN 不再按 Hyper-V／vEthernet 名称排除地址；保留回环、internal 和 IPv6 link-local 过滤。
此改动只涉及软件地址枚举，不能改用户的网卡、桥接、RSC、路由或自动重启生产。

当前用户授权双端工作空间路径修复、官方 2.3.1 适配及 `2.3.1-r1` 发布，按
[`docs/plans/kimi-code-2.3.1-workspace-release-v1-plan.md`](docs/plans/kimi-code-2.3.1-workspace-release-v1-plan.md) 执行。
开始时间 2026-10-24T14:50:33+08:00；本次授权覆盖前述不提交／不发布的阶段边界，不覆盖生产重启或旧资产删除。
双端统一导航、手机官方索引搜索与 Hyper-V 软件枚举修复纳入本次发布；不改系统网卡、不升级用户实际官方 CLI。
双端共享直接路径表单；手机 capture 绑定原生第二个 newrow 的身份，保留新会话动作，不移动或克隆 Vue 节点。
路径 trim 后去一对匹配外引号，只注册运行端已有绝对目录；不 mkdir、不自动 trust、不切路由或清空草稿。
工作空间定向 71 UT＋lint；选中官方 UI ≥2.3.0 不注入旧 scrollTop guard，旧 2.1.1／2.2.0 保留。
frontend 传实际 `officialWebVersion`，fallback 2.3.1；此适配定向 89 UT＋5 asset IT＋lint，不是新版完整验收。
官方 2.3.1 常规图片及 PDF 原生走鉴权 download／Blob，SVG 仍可能 fs:read；32 MiB 仅限制增强 fallback。
缺官方安装 pin 2.3.1；已知 owned 2.1.1 校验 version／integrity、package 身份及 entry／shim digests 后复用，未知拒绝。
README 仍只用两段系统在线命令；从新 tag commit API 解析并校验真实 40 位 SHA，下载同 SHA 入口后传同 revision。
不伪造待建 tag 的 SHA、不复用旧 r10 SHA、不直接执行可变名称入口；固定 launcher `--version 2.3.1-r1`。
保留官方 trust、会话锁、retry／takeover 与模型确认，不关锁、不自动接管；cron 默认关闭且显式 opt-in，未知版本拒绝。
精确 2.1.1／2.2.0 保留显式恢复确认后的写能力；本轮精确 2.3.1 适配限定只读任务／历史，不承诺新版完整管理。
真实双 backend 验证：正式 prompt 遇别进程持锁返回 HTTP 200／code 40931，direct debug cron add／remove／flush 却 code 0。
debug 先仅存内存，B 正常关闭可在 A 仍持锁时落盘，stale 40932 后 direct debug 也可落盘；不误写为关闭必丢失。
缺少同时保证 ownership／freshness／durable receipt 的原子入口；已实现 transport／route 双 gate，在 debug mutation 前拒绝写入。
2.3.1 UI 已有中英只读原因、隐藏 restore／new、禁用 remove；不为只读唤醒冷会话，用户仍可主动打开原会话。
只读定向 UT／IT／lint 与真实 createLauncher 补验通过：read true／write false，创建／删除 409 read-only-version。
无 mutation／outcomeUnknown、无冷会话恢复，wire 前后原字节相同；raw # RC GET／POST 返回 404 且不触上游。
真实双端路径提交、原生 trust 明确确认及重启 workspace ID／信任持久化通过；路由／草稿保留，非法路径拒绝且不 mkdir。
完整官方 app＋虚构 REST／WS 功能断言通过；手机预览透底、子模型旧文案及路径身份／locale 已最小修复并定向验收。
预览只补 mobile 容器不透明底，保留 Original／主题 token 与几何；官方信任／retry／takeover／模型确认实图无遮挡。
手机排序旁观成功同源 POST 单 workspace 回包及共享 locale；不新请求、不存路径、不放宽冲突身份识别。
标准 lint／typecheck／UT／pack 与独立标准 IT 通过，UT／IT 行及分支 70% 门槛不变；准确数量、覆盖率与日志见本轮计划。
首次并行 UT／IT／pack 的 4 项 IT 超时保留；未改代码或提高 timeout，定向单 worker 及独立标准 IT 均通过，不臆断原因。
真实固定 npm 2.3.1 安装、CLI／PTY／鉴权 Web、owned 复用与损坏拒绝通过，未碰用户实际安装。
PR #29 与 main required CI 已通过，正式 v2.3.1-r1 tag 指向 c9a3e0ce；发布包 130 文件／8,413,567 bytes。
线上 tgz 与本地正式资产原字节相同，同 SHA 在线入口及 latestRelease 已核验；准确公开链接／digest 见本轮计划。
上轮发布后证据另作 docs 更新，未移动 tag 或替换资产；实体手机／软键盘及全平台未全面验收。

用户此次明确要求修复供应商发现模型后无选择入口，并重新发布同一 r1，按
[`docs/plans/provider-model-discovery-r1-hotfix-v1-plan.md`](docs/plans/provider-model-discovery-r1-hotfix-v1-plan.md) 执行。
本次仅对 v2.3.1-r1 授权精确 lease 移 tag／替换同名资产，覆盖上轮该版本不变更限制；其它版本和分支历史不动。
官方 2.3.1 模型标题是 div.pf-label，旧 label-only 查找漏挂增强选择器；保留原生批量拉取及正式保存流程。
必须验证真实新 DOM、双表单作用域及双端主题实图；不以旧测试或旧整套验收冒充本次通过。
同版本 npm update 会跳过，已隔离验证原 prefix 重装，须提供原 r1 用户准确步骤；不自动改用户安装或重启生产。
用户追加 Kimi for Coding HTTP 400 排查并授权用环境变量 KIMI_KEY：仅官方端点最短必要调用，密钥不落盘、不回显。
按同一计划增补范围执行，不读取真实配置／会话、不伪装客户端身份，问题明确前暂停 r1 发布。
实测同 Key／模型／全能力配置，low 完成而 xhigh 复现完全相同 400；不得继续默认全能力／六档或未编辑就覆盖原生字段。
完整 app 已确证隐藏 preset 串 Custom 保存；已最小修唯一可见及身份／行匹配，按编辑字段合并，保存／重开续验见计划。
新增 providerModelState helper 已登记，主增强 494 行；55 定向 UT／5 asset IT 与标准 lint／typecheck／pack 通过。
实际资源保存→准确官方 2.3.1→Coding 的最短 thinking:on 对话完成，密钥只用环境引用，自有进程／端口清零。
已有污染配置不自动清洗，需明确纠正步骤；不把复现同错当作已读取并确认用户现场全部原因。
保存作用域 19／19、metadata 已执行 32／32 后驱动失败保留、独立 adaptive／rename 15／15；代表图和边界见热修复计划。
PR #31 及 main 标准 CI 已通过；同 r1 已重发，tag 固定 5b626e3f，新包 131 文件／8,414,834 bytes，线上字节及入口一致。
事后记录不再次移动 tag／换包；同版须原 prefix 重装并重启刷新，原有错误档位须手动纠正，不再重复无变化矩阵。
本轮 squash 默认作者含学校邮箱，历史未获重写授权；后续提交和 squash 必须显式使用已确认 noreply，准确隐私边界见计划。

用户随后要求恢复默认勾选并正式发布 r2，按
[`docs/plans/provider-defaults-r2-release-v1-plan.md`](docs/plans/provider-defaults-r2-release-v1-plan.md) 执行。
新模型仅图片输出、视频输入默认不选，其它能力、六档 effort 与自适应思考默认选中，覆盖上一轮保守默认要求。
展示与保存须一致；已有显式数组（含空数组）、未知值和 false 不自动改写，保留唯一可见表单及逐行身份安全门禁。
已实测 low 成功、xhigh 400；修后 thinking:on 未显式 effort 成功，其它档位未逐档验证，不擅自把偏好当服务保证。
本轮不新增付费请求或读取真实配置；新建 r2 tag／正式 Release，不移动 r1 或换其资产，正常 update 后手动重启刷新。
新行按来源区分并保存所见选择，已有模型保留 native／明确配置和选项 delta；晚到 saved 记录不触发新默认覆盖。
8 文件／99 项定向 UT、5 asset IT、标准 lint／typecheck／pack 通过；本轮完整 app 保存／重开与四张代表图已核对。
桌面20／20、手机续验28／28、320窄屏11／11通过；原baseline差异与手机驱动超时保留，不重复旧矩阵或冒称全绿。
虚构 REST／WS 与 resize／touch 不代表真实用户磁盘或实体手机；准确边界见本轮计划，不借旧结果。
PR #33及main required CI通过，r2 tag固定6562db37；正式包131文件／8,415,233 bytes，线上字节／digest及同SHA入口一致。
真实r1包更新器已发现r2，原r1 tag／资产未变化；本节事后记录不再移tag或换包，正常同步main回develop。

用户当前要求推理档位 Max 最后、查明 Tower 显隐、跟随官方 2.4.1 与安装器复用已有 Kimi，按
[`docs/plans/kimi-code-2.4.1-compatibility-v1-plan.md`](docs/plans/kimi-code-2.4.1-compatibility-v1-plan.md) 执行。
目标正式版本为 2.4.1-r1；仅规范 effort 展示，不重排官方元数据或改变默认值，不强制开启 Tower。
安装发现补齐受支持的现有命令来源；新版无 node-pty，按精确官方身份验证运行时，旧版仍保留 PTY 边界。
Windows HOME／USERPROFILE 默认目录均参与去重／歧义判断；旧 POSIX Python 只接受有界标准 console entry，仍验 Web 能力。
真实 uv／官方 Python 1.51.0 已补验；弃用1.52.0无 Web 能力仍拒绝，详情与首失败见同计划，不扩大为全平台保证。
手机强提醒window capture隔离Escape／Tab及其它modal内按键，保留按钮默认click和关闭后原生快捷键；47项定向及完整app续验通过。
重连重建pending DOM仍可能再提醒，不宣称跨重建去重；真实backend正向审批、实体手机等未验，首失败与图见同计划。
本轮授权正常提交、推送与新版本发布，不移动旧 tag／资产，不升级用户实际 CLI 或重启生产。
PR #35及main required CI已通过，2154 UT／545 IT通过、28／23平台条件跳过；行／分支70%门槛不变，准确覆盖率见计划。
正式v2.4.1-r1 tag固定beac8c68；包132文件／8,418,868 bytes，线上字节／digest／同SHA入口及真实r2更新发现已核。
旧r1／r2 tag和资产未变；本节发布后证据不再移动tag／换包，main正常同步回develop。

本轮 5 Mbps 大会话调查与修复按
[`docs/plans/large-session-low-bandwidth-v2-plan.md`](docs/plans/large-session-low-bandwidth-v2-plan.md) 执行。
用户授权指定真实会话的隔离测试，不提交 Git、不推送、不发布；不修改原会话或重启生产。
报告只保留无正文统计，真实数据副本仅放 ignored cache 并在测试完成后删除，不以历史 gzip 验收代替本轮复现。
同一真实响应的工具默认展开已测出约 6.15 万 DOM 节点及 2.2 秒长任务；无偏好默认改回折叠，已有值不迁移。
最近页只在增强 UI 精确 2.3.1／2.4.1 的无 cursor main page_size=10 请求中改为 1，响应、历史页和 WS 不改。
短首屏原生自动预取存在 following／sentinel 边界，保留“加载更早消息”按钮，不冒称上滚自动分页全面通过。
原会话仅只读；真实恢复测试在无网、只读挂载、tmpfs 派生副本的容器内进行，不接管生产或发模型请求。
准确2.4.1真后端／launcher／Chrome在共享5Mbps下完成cold→reset→live、原生旧页、输入和30秒保持；模型调用0。
标准lint／typecheck／2241 UT／583 IT及pack通过，6项既有条件跳过、70%门槛不变；首失败和覆盖率见本轮计划。
只证实305.5MB授权样本的首屏与渲染改善，未复现原虚拟LAN完全打不开，不承诺任意500MB或巨大单轮可用。
测试副本与内部ID staging已删除，原11个wire及state统计未变，自有容器／QA进程残留0；不提交、不自动部署。

本轮用户追加“仍需几十秒、排查并加 debug log”，按
[`docs/plans/large-session-debug-log-v1-plan.md`](docs/plans/large-session-debug-log-v1-plan.md) 执行。
按用户追加要求推荐 `--debug`，保留 `--debug-log` 别名；两者只开 OKW 日志，不开官方调试接口。
用户要求保留直接 CLI 使用习惯：wrapper 先判定首参数是否为 web，非 web 命令全部交给原 CLI。
不得用 OKW 的 debug／scheduled-tasks 校验拦截普通 CLI 参数或提示词；保留原 argv、工作目录、环境和退出码。
日志默认关闭，仅固定脱敏字段和分阶段统计，不记录正文、凭据、真实 ID／路径／IP 或原始错误。
不启用官方 debug，不提交／发布／升级官方或重启生产；日志功能验证不等于现场慢加载根因已确认。
双入口与真实传输链 30 项 IT 通过；审查补齐 HTTP 终态后晚事件抑制及 WS 协议错误终态分类。
最终标准 lint／typecheck／2483 UT／613 IT＋6 条件跳过／pack 通过，70% 门槛不变。
实际本地包开启日志、静态和 API 调用通过；首次既有安装测试超时及未改 timeout 的重跑证据见计划，不能冒称线上已生效。

手机安装到桌面功能按
[`docs/plans/pwa-install-v1-plan.md`](docs/plans/pwa-install-v1-plan.md) 实施。
只增强官方模式的 manifest、安装图标与双端入口；自定义 `--web-dir` 保持原样。
不注册 service worker、不新增离线会话缓存、不把 token 或当前会话写入安装元信息；继续使用官方登录。
可信 HTTPS 与浏览器支持是安装前提，不自动修改证书信任；本轮不提交／发布或重启生产。
准确官方2.4.1完整app的26／26主矩阵与7／7补验通过；真实Chromium安装资格无错误，点击原生prompt保留用户手势。
同主题入口前后主布局不变，320／390／1440及三主题实图已查看；iOS／不安全上下文／standalone仅模拟，不冒充OS安装。
2527 UT、627 IT＋6条件跳过、lint／typecheck及实际pack通过，UT／IT行与分支70%门槛不变。
两次IT首败为旧Windows测试fixture启动竞态，最小修fixture同步／清理而非放宽timeout；额外负载失败与证据见计划。
无新增凭据存储、SW或CacheStorage，自有浏览器／服务监听已清；实体手机、系统安装与跨浏览器凭据共享未验。

本轮每次模型调用的 TTFT／TPS 与侧边聊天选模按
[`docs/plans/request-metrics-sidechat-v1-plan.md`](docs/plans/request-metrics-sidechat-v1-plan.md) 本地实施与验收。
使用官方 step timing／usage，逐调用显示，不用整个 turn 耗时推算；不扫描真实历史或新增全量下载。
侧聊选择只作用于精确目标 agent 的原生发送，不改主模型或全局 secondary_model，不绕过信任、锁或错误流程。
身份取原生 typed btw panel 快照并联合校验可见 tab，不把 panel tab ID 当 agent ID；切会话先失效再绑定。
明确选模只保留本页最多64项，刷新跟随主模型；沿用兼容思考档位，不兼容时交官方 on／off 推导。
准确2.5.2原版后端经本地虚构provider实际调用，主／侧选模与原生timing公式8项通过，未启debug或付费服务。
完整官方app双端／320窄屏／短横屏三主题主矩阵49项与补验8项通过，代表实图已查看；仿真不等于实体手机。
标准lint／typecheck／3002 UT／646 IT＋6条件跳过／实际pack通过，UT／IT行及分支70%门槛不变。
全套首败暴露旧资源数量断言及Windows安装器taskkill超时，按计划修正；不增加timeout、跳过测试或降低并发。
安装器复用现有创建时间＋原生句柄清理，真实自有子进程退出、独立服务未动；不公开子进程stderr。
上述8项真后端及49／8项UI为首版阶段记录，不代表本轮布局和TPS口径仍沿用旧实现。
用户反馈末尾堆叠和TPS偏高后，同计划改为每个精确step位置一行，过程计时不打断官方activity分组。
仅准确2.5.2且全部语义结构校验通过才静态适配；不依赖压缩符号、Vue私有状态，不启debug或改官方缓存原文件。
用户对账后最新要求采用全程平均TPS：output／(TTFT＋stream)，标明平均值，不计工具或其它调用，不重复加思考token。
同一行增加缓存命中率：inputCacheRead／全部输入token，新写缓存不算命中；缺字段显示—，按同计划补定向与实图验收。
历史按相同身份重渲染，无渲染frame或被官方去重的调用不造孤立行；结构不符不退回末尾堆叠。
逐调用布局阶段的9项后端、六组主题、10项折叠、3075 UT／668 IT与包检查均为历史，不当作当前公式的新验收。
首段后口径阶段66项定向UT及9项后端通过；用户随后提供后台数值，已只读核对对应调用用量、计时及内容类型。
407.5由官方546／1.340精确复现，且记录含思考；后台37.0高度吻合全程分母，未取得后台算法或原始计时。
用户现改用包含等待的平均值并增加缓存命中率：本次77项定向UT、lint／typecheck与准确2.5.2后端26项检查通过。
两次本地high调用验证75%／0%命中、平均值和历史；双端三主题六组及长短内容实图已查看，首轮驱动失败保留。
独立step-metrics-v2路径、原生分组及CSS未变；本次不重打包或重跑旧全套，自有进程、监听与运行目录已清。
未提交、推送、发布或生产重启；不把平均值当纯解码速度，未解决首次生产重启或保证其它版本／实体手机。

会话设置一键重启按
[`docs/plans/service-restart-v1-plan.md`](docs/plans/service-restart-v1-plan.md) 本地实施。
用户授权启用当前 `kimi web --host` 服务；首次切换须由独立任务等待本轮结束与连续空闲，不在当前回复中强杀。
仅重启受管实例，固定同配置、鉴权与端口，拒绝忙时、跨站与重复执行；不启debug或让网页指定启动命令。
浏览器原生重连，不自动重发或强刷草稿；本轮不提交、推送、发布、升级CLI或改网络。
准确2.5.2隔离后端实际连续重启两次、同端口／鉴权／会话／工作区／草稿与WS重连11项通过，无付费或debug。
完整app双端三主题六种尺寸布局与取消36项、忙时拒绝及重连动作通过，实图已查看；保留动画取样和Escape首败。
Windows新实例须detached，否则worker退出会带掉新前端；新增真实进程IT防止只靠mock漏验。
官方登记端口先于实际绑定，冲突后变端口时只重读同server_id／PID／started_at；验证与鉴权仍失败即拒绝。
标准lint／typecheck／3058 UT／654 IT＋6平台条件跳过／实际pack通过，UT／IT行与分支70%门槛不变。
标准IT首败为旧taskkill探测超时；生产兜底与fixture改用现有原生清理，不增timeout、不降低并发或条件跳过。
临时测试树和监听已清，首轮清理误匹配PowerShell自身的报告保留，修后归零。
首次启用任务已在stopping阶段失败退出，未到启动新服务；ignored状态为failed、operation-failed-details-not-logged。
用户已手动恢复，本轮不再次重启生产、不重跑硬编码旧PID的临时任务；不把GET能力可用当作重启成功。
现场停止异常细节未保存，不能归因为管理员派生失败，也不能用11项隔离重启通过声称首次迁移问题已修复。
当前事实、失败时间及恢复边界见重启计划末节；此前waiting-for-idle只是过时过程状态。

## 项目边界

- 本项目是官方 Kimi Code Web 和后端外层的轻量增强，不维护另一套会话前端、会话数据库或模型配置真相源。
- 官方后端负责会话、工作区、供应商、模型配置和文件历史。launcher 负责进程编排、HTTPS、访问链接、
  同源静态资源、REST/WS 代理及少量受限的私有转发端点。`packages/launcher/src/mobile/` 只负责
  官方页面上的展示和交互增强。
- 默认模式下载并服务官方 npm 包中的 `dist-web`。`--web-dir` / `OPEN_KIMI_WEB_DIR` 直接服务用户提供的构建，不注入本项目的展示脚本、主题或私有 UI 功能。
- 不在 DOM 补丁中重建官方状态管理。能调用官方 API 或复用官方表单提交时，继续让官方后端成为唯一真相源。

## 官方 2.5.2 与历史版本适配事实

- 当前兼容目标是 Kimi Code `2.5.2`，本轮发布目标 `2.5.2-r3`；正式状态与线上证据见本轮发布计划和 Release。
  `UPSTREAM.md`、`upstream.json` 和本轮计划区分源码审计、真实 npm 后端与虚构 API 的完整 app 验收。
  0.41.0 协议快照未重捕；下列旧版行为保留为历史，不是新版保证。
- 精确 `2.5.2` 新增只读任务和最近页支持；不为列任务调用已删除的 GET `/status` 或恢复冷会话。
  原生 agent／usage／goal／todo／task 独立 WS 帧直接透传，不补造旧 transcript 状态。
- 全文搜索默认关闭时给出中英开启方法及扫描成本，不自动启用；普通标题筛选不受影响。
- 手机全局子模型控件不因模型池只有一项隐藏。仅成功同源精确 `2.5.2` meta 允许显式提交 `secondary_model: null`，
  按真实省略 section 的回包验证跟随主模型；旧版限制保留，不写 force／primary 或改主模型。
- 注入代码不得依赖 Vue 的 `data-v-*`、构建哈希文件名或压缩变量名。使用稳定的语义类名、可见结构和
  官方请求结果。`2.1.1` 供应商表单使用 `.pf`、`.pf-field`、`.pmt` 与 `.pmt-grid`；
  归档设置页仍使用 `.archive-list`、`.archive-card`、`.archive-row`、`.archive-name`、
  `.archive-time` 与 `.archive-workspace .path`；上游变更时重新核对。
- 归档列表可使用 v2 `GET /api/v2/sessions?meta.archived=true`，条目包含 `id`、`workspace` 和 `meta`。
  保留 v1 `GET /api/v1/sessions?archived_only=true` 兼容，不能只监听其中一个版本。
- 官方 `2.1.1` 仍提供 `POST /api/v1/sessions/{session_id}:delete`。永久删除必须调用该正式接口，
  继续让官方服务负责关闭会话并清理会话数据。
- 按用户最新要求，发送、排队和插队由官方处理；不再注入自定义按钮、发送意图或自动 steer 请求。
  旧版精确 prompt ID 的实现及验收仅为历史，不恢复合成快捷键或重复操作。
- 浏览器不得访问通用 debug dispatcher。`/api/v1/debug` 及其子路径必须在代理层返回 404；
  launcher 不得为永久删除常态开启 `--debug-endpoints` 或维护另一个删除协议。
- 外部 `--target` 不支持官方正式删除接口时，必须显示清楚的错误，不能只从页面隐藏条目或误报成功。

## 注入层和功能归属

- `packages/launcher/src/officialPresentation.mjs` 是注入资源清单。新增独立 JS/CSS 时同时登记 `FILES` 与
  `SCRIPTS`/`STYLES`，并更新 `tests/it/launcher-official.it.test.mjs`。需要拦截官方启动请求的脚本
  必须排在官方 module script 之前。
- 优先把一个功能放在独立 JS/CSS 中。不要把无关逻辑继续堆进 `presentation.js`、`presentation.css` 或 `providerEnhancements.js`。
- `providerSorting.js` 只维护供应商表单中的视觉顺序，并把顺序交回官方表单保存；不能另建模型配置存储。鼠标和触摸都必须可用，拖拽不能打乱每行模型能力配置。
- `workspacePins.js` 只在当前浏览器保存经过校验的工作区 ID。不得把工作区名称、路径或会话内容写入 `localStorage`；置顶排序只影响展示。
- `archivedSessionDelete.js` 只增强已归档页中能与官方响应唯一对应的会话行。确认对话框必须包含会话标题
  并明确不可撤销；取消不发请求，重复点击只发一次，失败保留行并显示可读错误，成功后移除或刷新行。
  不得记录标题、ID、路径或把它们写入浏览器存储。
- 页面 Bearer token 只在当前运行内存中沿用，不写日志、不回显、不另行持久化。模型发现 endpoint 的 API Key 也遵守同一规则。
- `MutationObserver` 回调中的 DOM 增强必须幂等；文本、属性和顺序未变化时不重复写入。
  涉及观察器写入的回归必须验证真实 DOM mutation 会收敛，不能只靠空 `observe()` 的 fake DOM。
  无限回调的测试保护须在 observer 回调内部断开；外部 timer timeout 可能被微任务循环阻塞。

## 进程和运行时检查

- 拉取代码、切换提交或更新远端 `main` 不会热替换已经运行的 launcher 或 Kimi 后端。用户可见功能缺失时，
  先核对 `HEAD`/`origin/main`、进程启动时间、监听端口、首页是否注入目标资产、资产是否返回 200，
  再判断代码失效。
- 验证官方行为时使用仓库内明确命名的临时 `KIMI_CODE_HOME` 和虚构数据。不得读取、打印或截图用户真实会话、工作区路径、token 或账号信息。验证结束后停止自己启动的服务并删除自己的临时目录。
- 不随意终止无法确认归属的进程。只清理由当前任务启动，或已明确属于测试的 PID/端口。

## 开发流程

### Clean Code

- 新增或修改的手写源码、测试、配置与文档，每行不得超过 130 个字符。
- 上游生成的契约快照、锁文件和第三方资源保持其生成格式；不得为满足行长限制手工改写生成内容。
- 优先通过拆分表达式、参数和段落控制行长，不使用禁用规则或压缩可读代码绕过限制。

1. 明确用户可见触发条件、期望结果、失败行为和版本边界。
2. 检查工作树、相关注入清单、当前官方 bundle/源码、运行进程及已有测试；先取得事实再改代码。
3. 选择最小职责层：视觉问题放独立 mobile 资源；同源安全边界放 launcher；持久数据变更调用官方后端。
4. 保留并行修改。共享清单只追加自己的资源，修改前重新读取最新文件。
5. 更新或新增能复现真实触发条件的定向测试。修复 API 版本问题时，测试必须使用真实 wire shape，而不是只验证自创 fixture。
6. 运行最少必要校验并记录结果。完成后检查 `git diff --check` 和 `git status --short`，清理临时进程与数据。
7. 除非任务明确要求，不提交、不推送、不发布。

README 保持简短：按用户最新要求先放界面预览，再在“快速上手”里给两段系统安装命令及启动方法。
只留必要的增强功能概览、截图、升级和常见问题，不在“快速上手”外重复安装说明。
使用 humanizer-zh 优化文字，用动作说明用户能做什么，把压缩的术语展开为通俗句子，不为缩短篇幅堆砌名词。
详细命令链接到 launcher README，兼容细节到 UPSTREAM，历史和验收不堆在首页。
保留既有图片，新功能补真实界面图；新增 App 图须区分安装面板与实体安装结果，未发布功能明确标注。
`develop` 的未发布内容仅在确有必要时维护于 CHANGELOG 顶部，准备发布时整理成对应版本条目。

### KISS 分支模型

- `main` 始终保持可发布，是所有正式 tag 的唯一来源。
- `develop` 是日常集成分支。功能和修复在 `develop` 完成定向验证后合入 `main`。
- 只有改动较大、需要独立评审或会阻塞 `develop` 时，才创建短期 `feature/*` 或 `fix/*`；完成后及时合并并删除，不把它们当长期分支。
- 不设置长期 `release/*` 分支。发布直接从已验证的 `main` 打 tag；发布完成后把 `main` 同步回 `develop`，避免版本记录和修复漂移。
- 采用该模型不代表改写既有历史。不得为整理分支而 rebase/force-push 已共享历史；历史重写仍需明确授权。

## KISS 验证规则

- 优先运行受影响文件的 ESLint、对应单元测试，以及注入清单变化时的一份 `launcher-official` 集成测试。
- CI 中 UT 与 IT 的独立覆盖率报告均要求行覆盖率不低于 70%、分支覆盖率不低于 70%。覆盖率不足时优先补充失败路径、安全边界和真实分支的测试，不得降低门槛或用复制实现凑数。
- 完整 UT/IT、coverage、打包或安装冒烟只在跨层改动、发布准备、CI 故障复现或用户明确要求时运行。覆盖率不足时补有意义的测试或按既有规则排除由定向 UT 独占的文件；不得降低阈值。
- 不重复做浏览器 E2E、截图对比、整包安装、逐文件 SHA256 或没有新证据价值的相同测试。一次真实浏览器/临时服务验证足够时，做完即停。
- 测试必须覆盖实质风险。破坏性 UI 至少覆盖取消、确认成功、后端失败、重复点击和作用域限制；纯样式或可逆小改不为覆盖率机械复制实现。

## 发布前隐私与安全检查

提交、推送、发布包或部署前，对实际公开范围做一次有针对性的检查；相关内容没有变化时不重复扫描。

- 检查待提交 diff、发布文件清单、构建产物和将推送的提交历史，而不只看 `.gitignore`。
- 检查 `.map`、`sourceMappingURL`、内联 sourcemap、`sourcesContent`/`sourceRoot`；默认不公开调试 sourcemap。
- 检查真实 `.env`、`.npmrc`、token、Cookie、API Key、私钥、证书容器、日志、备份和缓存。不得在命令输出或报告中复述疑似秘密。
- 检查真实用户名、个人绝对路径、内部地址、工作区名和敏感业务内容；示例使用相对路径、环境变量或通用占位符。
- 实际查看准备公开的截图、图片和录屏，核对地址栏、账号、路径、会话、模型/服务配置及相关元数据。
- 核对 npm `files`、静态服务范围和发布产物，不把隐藏配置、调试映射、缓存或备份带出。
- 已进入 Git 历史的敏感信息要区分“当前文件已清理”和“历史已重写”。只有明确授权才能重写历史或强推，并使用 `--force-with-lease`；真实凭证泄露时提醒撤销或轮换。

## 用户可见 Bug 事件复盘

每次修复用户已经遇到的 Bug 后，在任务报告、PR 描述或维护记录中使用下面的短模板。内容必须来自本次证据，不包含真实 token、私人会话、个人路径或不必要的内部信息。

```md
### 事件：<一句话描述用户可见问题>

- 影响：<谁在什么操作下看到了什么>
- 触发条件：<版本、模式、入口和必要前置条件>
- 根因：<代码原因；若包含旧进程/旧缓存，分别写清>
- 证据：<真实请求/DOM/状态码/进程时间等最小充分证据>
- 修复：<改动层和最终行为>
- 回归验证：<定向测试及一次必要的真实验证>
- 运维动作：<是否需要重启 launcher、清缓存、迁移或无需动作>
- 剩余边界：<未验证版本、外部 target 限制或无>
```

不要只写“已修复”。复盘必须能解释为什么原测试没发现、这次测试如何覆盖真实触发条件，以及用户是否需要重启正在运行的旧进程。
