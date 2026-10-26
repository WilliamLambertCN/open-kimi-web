# 供应商模型发现入口修复与 r1 重发

开始时间：2026-10-26T15:38:25+08:00。用户明确要求修复拉取模型后无法选择，并重新发布同一 r1。
本计划由用户任务驱动，auto plan exit 不代表用户另行逐项审核。

## 已确认

- 准确官方 2.3.1 bundle 位于 `.cache/compat-231/official/dist-web/`，模型字段标题改为 `div.pf-label`。
- `providerEnhancements.js` 的 fieldByLabel 仅查 label，enhanceDiscovery 找不到模型字段，未挂载选择／添加控件。
- 模型行 `.pmt > .pmt-grid:not(.pmt-head)` 未改变；官方“获取模型列表”直接追加全部远端模型，不提供按需选择。
- 现有 providerEnhancements／providerObserverScope tests 仍用旧 label 模拟模型字段，漏检新版真实 DOM。
- 新增供应商页同时挂载隐藏 preset 和可见 manual 表单，保存作用域需要完整 app 验证。
- 原 v2.3.1-r1 tag 为 `c9a3e0ce2a71037f510d794303e84ce6bed69209`，Release 可变，资产 id 671704889。
  旧包 8,413,567 bytes，SHA-256：`219349fa92b0f3bb3b59d6283d32dfc76a9e30e419921700a665e75c5e8ec7a8`。

## 实施与授权

1. 在 AGENTS 链接本计划。本次明确重发 r1 授权仅覆盖该版本此前不移动 tag／不替换资产的限制。
   不改其它版本、生产服务、用户实际配置、官方安装或 main／develop 历史。
2. 最小修 providerEnhancements.js 字段定位，兼容当前 div.pf-label 和旧 label，不依赖 Vue 私有实例或构建哈希。
   保留官方原生按钮、表格及保存流程；增强下拉按需添加，不自动保存或覆盖既有能力。
   隐藏双表单、能力缺失先真实复现，影响拉取／选择／保存链路才最小修，不为猜测放宽安全门禁。
3. 补准确 2.3.1 DOM 回归：div 标题含计数／按钮、发现 22 项、只添加所选、重复／失败／禁用及语言切换。
   验证 native input 事件、POST／PUT 内容、隐藏表单作用域；真实 MutationObserver 收敛，不新增请求或持久化凭据。
4. 复用 `.cache/compat-231-ui/runtime.mjs` 的精确完整官方 app 和真实 launcher，做一次定向浏览器验收。
   QA 归档 `.cache/provider-discovery-r1-hotfix/`，用虚构 provider／keys、隔离 HOME 和受控 models HTTP 响应。
   不调用用户截图真实端点。覆盖桌面／320 或 390 手机、Original／Nocturne、长短 ID、中英、选择添加／取消／保存／重开。
   裸官方对照、实际截图及几何断言，不重设计或改无关主题，不以 UT 代替视觉验收。
5. 增量同步 CHANGELOG、README／launcher README、UPSTREAM、AGENTS，写明根因、旧测试漏检及升级方法。
   跑定向 ESLint／UT、必要 asset IT、标准 typecheck／pack；CI 原标准全过、覆盖率门槛不变。
   不重复旧完整 UI／安装矩阵或无变化的全套本地测试。
6. privacy-check 只查实际 diff、新增历史及正式 tgz，不公开 QA、日志、截图、个人路径、凭据或 sourcemap。
   commit／push develop，经 required CI 正常 PR 合入 main，不绕保护或重写分支历史。
7. 准确已验 main 打同版本正式包。先把旧 Release 元数据／包备份到 ignored QA，再仅对本 r1 的 tag 使用
   `--force-with-lease=refs/tags/v2.3.1-r1:<旧SHA>` 精确 CAS 更新；不能无条件强推或影响 main／develop。
   替换同名 r1 tgz、更新说明，记录前后 SHA／digest；同版本替换非原子，失败必须恢复或明确阻塞。
   线上重下核对包、tag、入口及功能资源一致。核对 updater 同版本行为，为原 r1 用户提供真实有效的重装方法，
   不擅自改变全局更新语义、不改用户实际安装，不把同版本 update 判新冒充成功。
8. 记录真实 PR／CI／Release／线上结果，正常同步 main 回 develop，清理自有服务与临时资源。

## 完成标准

- 准确官方 2.3.1 页面发现模型后可操作候选控件，只追加所选模型；保存／重开值和能力不串表单。
- 双端受影响主题实图与针对性断言通过，原生布局、保存及取消语义不退步。
- 正常 CI、隐私和正式包核验通过，修正版仍为 2.3.1-r1，线上来源一致，原 r1 用户有可执行更新方法。
- 不读取真实凭据文件、不重启生产、不动其它 Release 或重写分支历史。
- 用户随后补充 Kimi for Coding 有效 Key 仍报 HTTP 400，明确授权使用环境变量 `KIMI_KEY` 验证。
  仅对官方 Coding 端点发必要的最短验证请求；密钥只在进程内传递，不进参数、日志、截图、fixture、Git 或发布包。
  当前 CLI 子进程未继承该变量，Windows User 环境存在；可仅按该变量名读取并传给隔离诊断子进程。
  不读取用户配置／真实会话，不伪装客户端身份，不自动更换其模型或供应商；先区分服务、协议与增强保存问题。
  此新增明确授权覆盖前文“不发付费模型”在本次最小 Kimi Coding 验证上的限制，非其它服务或无限测试授权。

## Kimi Coding 补充修复范围

- 使用授权环境 Key，直连官方 Coding `/models` 和最短流式对话均 HTTP 200；准确原版 2.3.1、`type:kimi`、low 完成对话。
  同 Key／端点／模型下，把旧增强的全能力、六档 effort 及 xhigh 交给原版后端，复现完全相同的 400 Invalid request Error。
  这是配置／请求参数的实证，不是用户现场配置已读取或精确同因已证明；不宣称 Key、服务或一般代理不可达。
- 完整官方 app 实测确认新建 Custom 保存会取隐藏 preset 行能力，用户取消的 Thinking 保存／重开后复选恢复。
  原报告 11／13，保存与重开两项失败保留；须修正唯一可见提交表单作用域，并仅续验该链路。
- 能力默认不得继续把未知模型宣称为全模态／强制思考／六档。未编辑时保留正式保存体及已知配置，不覆盖原生元数据；
  明确编辑才写对应能力。新行沿用原生保守默认和已确认数据，不靠省略安全门禁解决显示。
- 将较小纯逻辑 helper 放在现有 provider 资源职责中，保持 providerEnhancements.js ≤500 行，新增资源需正式登记与 asset IT。
  补真实 DOM、双表单、未编辑透传、独立能力与档位修改、未知值保留等实质回归。
  README／发布说明给出已保存不支持档位的纠正提示；不新增未规划的自动能力识别或现场配置清洗功能。
- 修后只续必要供应商链路与授权官方最短对话，保留之前基线／UI 矩阵，不重复全部安装或无变化截图。
  不自动清洗用户原配置；已有错误能力／档位需给出准确纠正步骤，不能承诺仅换包即修正已保存污染。

## 阶段证据

- 已最小修改字段查找，接受 `.pf-label, label`，并为候选 select 绑定共享语言可访问名称；未改 CSS 或原生批量按钮。
- 准确 2.3.1 DOM 的 10 项新回归，加既有 provider／observer／response tests：4 文件、28 项通过。
  覆盖 22 候选只加所选、native input、既有能力保留、重复／缺配置／失败／managed、同 tab 语言与真实 observer 收敛。
- 本轮标准 lint／typecheck 与 launcher-official 的 5 项 asset IT 通过；日志归档于 ignored 本轮 QA 目录。
  这些结果早于下方元数据／作用域补充修复，最终相关门禁须覆盖新改动，不据此宣称交付完成。
- 完整官方 app 首轮：裸官方／旧 r1 对照 20／20、编辑发现链路 106／106、可见 chooser 视觉矩阵 38／38、
  边界 17／17 通过。覆盖 1280／390／320、Original／Nocturne、中英长短 ID；父级实际查看三张代表 chooser 图。
  共 4／16／12／1 图归档；新建 Custom 保存作用域另报 11／13，失败两项保留，不能称全部通过。
  原 r1 的已有模型能力复选框在准确 DOM 本来正常，未将该部分误归因为 div selector；CSS 未变化。
  手机是打开完整原生设置后 resize／touch，不代表手机冷入口或实体机；保存重开是正式 method-aware fixture，非真实磁盘。
  全部自有 Chrome 子树、WS 和监听残留 0；仅续有代码变化的保存／重开，不重跑旧矩阵。
- 授权 Key 验证：直连官方 `/models` 200，最短 SSE 200 并正常 DONE；准确原版 2.3.1 low 完成。
  旧全能力／六档元数据相同，仅 effort low→xhigh 时 completed→failed，末错误为 400 Invalid request Error；
  原全元数据 low 再验证 completed，排除“全能力配置必然失败”的过强推断。
  诊断沿官方 type:kimi 和真实客户端身份，Key 仅来自命名 User 环境并传子进程，未读取配置或真实会话。
  原版 provider POST 实际 201、模型列表返回 alias model 字段，最早 driver 的200／id假设失败报告保留，未发模型请求。
  隔离进程正常关闭、自有监听为零，含环境引用的临时 home 已清理；尚需修后 enhanced 保存→真实 Coding 全链路验证。
- 16:20 完成隔离同版本重装实测：先用真实安装 coordinator 安装备份的原 r1，再在相同 prefix 安装候选新包。
  两次 archive SHA-256 校验、真实 npm 替换、installed CLI／更新身份与运行依赖检查通过，脚本从 label-only 变为兼容标题。
  真实 updateMain 在同版目标下返回 already-current，replacement／verify 均未执行；已据此修正升级说明。
  Release metadata／download 为虚构受控 seams，官方发现／准备和系统 PATH 持久化未运行；不是新增安装平台矩阵。
  自有 scratch 已清理，用户实际安装与生产服务不变；正式最终包如继续变更，须确认该修复仍随包交付。
- 增量文档和新增测试／计划未发现秘密、个人绝对路径、截图中的真实服务端点或 sourcemap；新增行均不超过 130 字符。
  最终提交历史及正式包仍须在实际发布范围确定后核对；QA 截图不公开。
- 元数据／作用域修复已完成：新增 47 行 providerModelState helper，主增强 494 行；未知行 UI 沿官方 manual 默认，
  保存不凭空填字段。明确编辑逐选项合并，仅改对应组；未编辑优先保留原生值，原生省略才补明确已知配置。
  保存仅限唯一实际可见、身份及模型行完全对应的表单；hidden ancestor、歧义、身份／行不匹配均保留原请求。
  定向 provider UT 6 文件／55 项、5 asset IT、定向 ESLint 和 diff check 通过；保留排序、managed 与 observer 门禁。
- 修后标准 lint／typecheck／test:pack 通过；pack 实际安装版本、依赖、静态及 API 代理正常，不重复完整安装矩阵。
- 17:09 修后最短真实链通过：launcher 实际注入 provider helper／增强资源，隐藏 preset 做不同编辑后，可见 manual
  原生 POST 保持完整原样，官方返回 201；随后同 launcher→准确未修改 2.3.1→官方 Coding，thinking:on 完成 1 次最短对话。
  Key 仅用环境引用；无新增 efforts、无隐藏表单串值。浏览器 DOM 部分用 jsdom 及显式布局模拟，不冒充完整 app 实图。
  首次 driver 缺本地 jsdom 解析失败保留，未启动后端／未发模型；修正为锁文件已有依赖路径后通过。
  正常 shutdown、自有进程／监听均零，隔离 home 已删除；完整 app 的保存／重开续验仍需独立完成。
- 首次 required CI 未通过，未合入 main 或发布：localeUi 的手动资源列表漏新 helper，归档 all-scripts 测试仍断言 33 而非 34。
  原失败日志／CI 链接保留，不以重复重跑掩盖；仅同步两处测试装载与真实新默认／正式提交身份，未改产品或放宽门禁。
  续验 2 文件／21 项及受影响 ESLint 通过；新 CI 须重新通过完整标准命令和覆盖率门槛。
