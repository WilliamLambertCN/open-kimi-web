# 请求指标、侧聊选模与服务重启 · 2.5.2-r3 发布计划 v1

## 目标与授权

用户要求提交并发布此前已完成的请求指标、侧边聊天选模和一键重启，随后指定桌面重启入口放在“设置 → 通用”。
本次目标为 GitHub 正式版本 `2.5.2-r3`：提交 develop、提出并合并 main PR、通过 required CI、发布新 tag 与包。
本授权覆盖两个功能计划原先“不提交／不发布”的阶段限制，不包括升级用户官方 CLI、重启生产或修改旧 tag／资产。

功能和历史证据以以下计划为准：

- [请求指标与侧聊选模](request-metrics-sidechat-v1-plan.md)
- [服务重启及首次启用失败记录](service-restart-v1-plan.md)

## 实施范围

1. 桌面“重启服务”移入官方设置的“通用／General”面板；手机仍放在会话设置。
   只改变语义标签匹配，不改重启协议、鉴权、空闲检查、worker 或主题样式。
   以准确官方 `2.5.2` 的真实 DOM 为依据，不使用 Vue 私有状态或压缩符号。
2. 请求指标按精确 session／agent／step 展示在对应回复、工具或思考条目后，历史采用相同规则。
   平均 TPS 为 output／(TTFT＋stream)，包括首次等待、不包括工具及其它请求；缓存命中率只计算已读缓存。
   缺失数据不伪造为零，结构不匹配不退回回复末尾堆叠，不新增全量会话下载。
3. 侧聊选模只作用于当前精确 agent 的原生发送；不改主模型、全局子模型或官方信任和并发规则。
4. 纳入已验收的 Windows 安装器／supervisor 原生子进程清理与同实例登记端口重读修正。
   保留原超时、默认并发和覆盖率要求，不用跳过测试或放宽门槛掩盖失败。
5. 更新 launcher、插件和当前文档版本及两段在线安装命令为 `2.5.2-r3`。
   官方兼容目标仍为 `2.5.2`，缺官方安装 pin 和 meta 失败 UI fallback 仍为 `2.4.1`。
   保留 r2 图标及历史验收，不重新生图或扩大首页篇幅。

## 验证与发布顺序

1. 先补入口位置的单元测试：中文／英文、General 与 Agent 面板隔离、切换和重挂不重复、未知标签不猜测。
   跑受影响测试与 lint／typecheck。用完整官方 app、虚构数据和受控状态比较桌面三主题基线，补验手机入口未变。
   检查真实截图、面板几何、可达性、确认取消和焦点；不在此次位置变更中重跑真实服务重启。
2. 沿用已通过且未变的平均 TPS／缓存、侧聊、生命周期和视觉验收，不重复整套浏览器及安装矩阵。
   新入口与版本的结果单独记录，不将旧测试数量冒充本轮结果。
3. 对实际待提交 diff、新文件、待推送历史及实际打包内容做定向隐私检查。
   不纳入并行 `.gitignore`、原 `.tmp/`、ignored cache、真实会话、密钥或个人路径。
   确认 sourcemap、日志和调试数据未进入包，提交与 tag 使用已确认 GitHub noreply 身份。
4. 明确选文件提交到 develop 并正常推送，PR 合入 main 前及 main 合入后 required CI 必须通过。
   CI 执行标准 lint、typecheck、UT、IT 和 test:pack，不 admin bypass、不强推、不降低门槛。
5. 从通过 CI 的准确 main 在隔离 worktree 执行标准 pnpm pack，核对真实包与公开范围。
   创建 annotated `v2.5.2-r3` 和 GitHub latest Release，只上传新版本 tgz，不发布 npm registry。
6. 公共下载核对包原字节／digest、同 SHA 在线安装入口和 README，实际旧 r2 更新器应发现 r3。
   对照旧 r2 tag／资产 metadata 保持不变。事后记录走单独维护 PR，不移动已发布 tag 或替换包。
7. 正常同步 main 回 develop，保留并行改动，移除自己创建的 worktree、profile 和临时运行目录。

## 假设与边界

- 用户要求的是 GitHub 发布，与项目现有发行方式一致；本次不增加 npm registry 发行渠道。
- 手机入口按最新要求保持不变，桌面只放通用，不保留 Agent 面板的重复入口。
- 发布不会热替换用户已运行的进程，安装新版后仍需用户自行重启服务并刷新网页。
- 首次生产切换曾在停止阶段失败且缺具体异常，不把隔离重启通过写成该现场故障已修复。
- 平均 TPS 不是纯解码速度，也不保证与未公开计算方式的后台数值完全一致。
- 未全面验收实体手机、其它官方版本和所有宿主平台；不将仿真或单平台结果扩展成保证。

## 执行记录

### 桌面通用入口补验

- 按准确官方 `2.5.2` 的全量语义 panel 顺序，将标签匹配改为“通用／General”，不改重启逻辑或 CSS。
- 新增三项回归覆盖 General／Agent 可见性切换、中文重挂和未知标签拒绝；该文件17项 UT 通过。
- 标准 lint、typecheck 与 diff 检查通过。
- 完整官方 app、虚构 REST／WS 与受控重启状态：1440×960 Original 中文、1280×720 Nocturne 英文、
  1440×960 Aurora 中文及390×844 Nocturne 英文，共32项断言通过。
  原设置窗格／导航／输入区几何偏差小于1px，General 有且仅有一个入口，Agent 无可见重复入口。
  确认文案换行、按钮可达、Tab、Escape取消及焦点恢复通过，手机仍在原会话设置。
- 12张基线／入口／确认图均已实际查看；报告归档 ignored cache 的
  `request-metrics-sidechat-qa/service-general-20261112/report.json`。
  未发送重启 POST 或配置写入；自有 Chrome 树、监听、profile 已清，不重跑未变生命周期或生产重启。

### 版本与公开范围检查

- launcher 与插件均为 `2.5.2-r3`，首页两段在线命令、launcher 文档及插件 Skill 使用同版 tag／安装目标。
  当前文档的本地链接已核对；历史版本、官方安装 pin 和 UI fallback 不变。
- 最终位置变更与版本的标准 lint、typecheck、13项插件结构 UT、实际 `test:pack` 通过。
  包内版本、资源、命令、更新清理、PWA、本地 CA、脱敏日志及 HTTP 代理实际调用通过；没有重复旧浏览器矩阵。
- 对62个本次待公开文件的新内容检查凭据、个人路径、内部地址、sourcemap 与发布边界，未发现新增泄露。
  检查发现六处超长行，已仅换行修正；没有新增公开媒体。并行 `.gitignore` 与 ignored 资源不提交。
  旧历史不是本次全量审计范围，不声称已清理既有作者邮箱；新 commit／squash／tag 使用 GitHub noreply。

### PR 与准确 main 门禁

- develop 提交 `b5dc75e5eba50f58f3b4585e6434b0390a6d084f`，经
  [PR #46](https://github.com/WilliamLambertCN/open-kimi-web/pull/46)正常 squash 合入 main。
  发布提交为 `ef589f1941cfc9e5583caa57d2460d3804d97211`，产品树与已验证 PR 一致。
- [PR CI](https://github.com/WilliamLambertCN/open-kimi-web/actions/runs/43145964812)与
  [准确 main CI](https://github.com/WilliamLambertCN/open-kimi-web/actions/runs/43146298108)全部通过：
  frozen install、lint、typecheck、UT、IT 和实际 test:pack，无 admin bypass。
- main 的133个 UT 文件／3061项通过、28项平台条件跳过；33个 IT 文件通过／2个文件条件跳过，
  649项通过／25项平台条件跳过。UT 行／分支92.61%／84.18%，IT为84.04%／71.95%。
  原70%门槛、默认并发和超时保持不变；这不是旧阶段数量。
- develop commit、squash作者与tagger使用已确认 GitHub noreply；GitHub committer为正常noreply。
  不重写已共享历史，不重新输出旧私人邮箱。

### 正式包与线上核验

- 从准确 main 的独立 worktree 用 frozen install 和标准 pnpm pack 生成唯一正式包，产品文件与该树逐内容比对一致。
  pnpm只移除源码专用prepack／postpack hooks，包内其余manifest字段一致，不手改发行包。
- 实际包186个文件、176个文本文件完成秘密、个人路径、内部地址、sourcemap、日志和缓存检查，未发现新增泄露。
  真实资源验证准确2.5.2逐step适配、平均／缓存公式、桌面General入口及map拒绝；没有付费调用或生产请求。
- [正式 Release](https://github.com/WilliamLambertCN/open-kimi-web/releases/tag/v2.5.2-r3)
  于 `2026-11-12T03:14:12Z` 发布为latest、非draft、非prerelease，不发布npm registry。
  annotated tag对象 `8dee447a78d5334fa91dfe24f7c6210096422769` 指向上述准确main。
- 资产 `open-kimi-web-2.5.2-r3.tgz`，ID `737868086`，大小 `9,050,925` bytes。
  SHA-256：`f2b9c33fea84d28ffd4f4d0012a0226cf566d449f7c5bbc0157f7e760c5d2fbb`。
  公开下载的原始字节、大小和GitHub digest与本地正式包完全一致。
- commit API将新版tag解析至准确SHA；该SHA的README、install.ps1、install.sh、install.mjs与Git blob原字节一致。
  首页两段在线命令均使用r3及同revision；未为检查安装命令而修改用户安装。
- 已下载的真实旧r2包先核对既有digest，再调用包内 `latestRelease()`，实际发现 `2.5.2-r3`。
  旧r2 tag对象／指向SHA以及Release／资产ID、大小、digest、时间metadata与发布前一致，没有替换旧包。
- 核验脚本首败保留：Git Bash tar把Windows冒号路径当远端、pnpm移除源码pack hooks、checkout的CRLF与线上Git LF比较。
  仅修核验驱动的相对路径／明确manifest归一规则／改比Git blob，产品和正式tgz未改，不把首败覆盖为全绿。
- 报告、首次驱动失败和公开核验结果归档 ignored cache 的 `request-metrics-sidechat-qa/release-r3/`。
  包审查短服务、解包目录及独立worktree已清；git remove未删尽的本轮依赖目录已定向移除。
  本轮没有升级用户CLI或重启生产；发布后用户仍须终端重启旧服务并刷新。
