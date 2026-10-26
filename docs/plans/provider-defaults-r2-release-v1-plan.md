# 2.3.1-r2：恢复用户要求的默认勾选并正式发布

## 用户要求与事实

- 用户明确要求从 r1 升为 r2，便于正常 update；随后明确只允许默认取消视频输入和图片输出，其它恢复原默认勾选。
- 这次恢复新模型默认：image_in、tool_use、thinking、always_thinking 选中；image_out、video_in 不选；
  none、low、medium、high、xhigh、max 全部选中；adaptive_thinking 选中。
- 仅恢复新模型的默认，不批量迁移或重写已有显式配置；保留原 r1 的发现选择入口、唯一可见表单和逐行身份匹配修复。
- 已有真实 Coding 对照是 low 成功、同配置 xhigh 400。修后真实链 thinking:on 未显式指定 effort 成功；
  medium/high/max 未逐档验证。默认勾选只是用户偏好，不保证服务支持；不再把该证据当理由擅自取消其它勾选。
- 不读取真实配置/会话/凭据，不新增付费模型请求，不改系统或用户实际安装，不重启生产。

## 实施步骤

1. 在 develop 工作，先将完整计划落盘到 `docs/plans/provider-defaults-r2-release-v1-plan.md`，在 AGENTS 链接。
   当前 main fff0e930 与 develop 文件树相同；保留原有未跟踪 `.tmp/`，QA 只放 ignored 命名目录。
2. 在 `packages/launcher/src/mobile/providerModelState.js` 恢复上述默认。
   通过已加载的官方模型配置区分已有明确配置与新模型默认来源；新模型实际 POST/PUT 必须与展示的默认及取消结果一致，
   不能只把 UI 勾上而仍保存 native 保守默认。已有明确数组（含空数组）、未知值及 false 不改变；
   已有模型明确编辑仍按字段/选项 delta 合并 native 元数据；managed 行、配置未加载、表单歧义和身份不符仍原样透传。
   在 `providerEnhancements.js` 更新已不准确的默认提示，不重设计 CSS；主文件保持不超过 500 行。
3. 更新现有 `providerSaveMetadata`、`providerDiscoveryCompatibility` 及受影响 provider/locale tests。
   覆盖新行准确默认、实际保存/重开、取消默认项、已有显式空数组/false/未知值、隐藏双表单、排序和 observer 收敛。
   使用项目已有 fixture/依赖，不新增测试框架。跑定向 ESLint/UT，注入清单未变则复用既有 asset 契约，运行必要定向 IT。
4. 沿用准确完整官方 2.3.1 app 及已有受控 REST/WS QA，只续本次默认变化的保存/重开和代表实图。
   检查桌面 Original、320/390 Nocturne、中英提示及长短模型；与裸官方/原 r1 对照布局，不重复旧完整矩阵。
   实际看图并断言 checked 状态、POST/PUT、fresh GET、可达性和无横向溢出。结束清零自有进程/监听，不碰生产。
5. 版本改 `packages/launcher/package.json` 和 `kimi.plugin.json` 为 2.3.1-r2。
   更新根/launcher README 当前入口、固定版本/tgz/current-release、默认说明及正常 r1→r2 update 方法；
   原同 r1 重装说明保留为明确历史或移至既有 CHANGELOG，不再要求升级 r2 重装。
   更新 CHANGELOG 新 r2 条目、UPSTREAM 当前信息、AGENTS；同步当前 `commands/install.md` 和
   `skills/open-kimi-web/SKILL.md` 的过期 r10 当前安装指引，先读其适用 AGENTS，不改历史验收。
   installer 运行逻辑与官方 2.3.1 pin不变；只视必要更新错误示例，不批量替换历史 r1/r10 SHA 和 digest，不动 lockfile。
6. targeted privacy-check 检查实际 diff、新提交身份及最终 tgz；Key 不落盘/回显，QA/日志不公开，无新公开媒体。
   commit 和 GitHub squash 都显式使用已确认 noreply。检查130列、diff check，标准 lint/typecheck/pack；
   required CI 照常跑完整 UT/IT 及原70%行/分支门槛，不重复无变化本地全套/安装矩阵，不掩盖失败。
7. 正常 develop→main PR，required gate通过后普通 squash，不绕保护，不重写共享分支历史。
   已验准确 main 打 `open-kimi-web-2.3.1-r2.tgz`，核对实际包清单、版本、默认/保存资源和实际HTTP资源契约。
   从该 main 新建 v2.3.1-r2 tag及正式非 prerelease/Latest Release，上传唯一准确 tgz。
   不移动 r1、不替换其资产，不发布npm registry，不用本次授权重写其它tag。
8. 线上重新下载核对 tgz字节/digest、tag指向、同SHA安装入口及真实 latestRelease/版本比较识别 r1→r2。
   不重复整包安装或浏览器矩阵；记录公开PR/CI/Release和未验边界，事后文档正常PR，不再次移tag。
   正常同步 main 回develop，检查工作树与自有资源收尾。给用户发布链接和正常update、重启刷新步骤。

## 验收边界

- 所有默认勾选与用户要求一致，保存/重开一致；已有明确设置不被重选，隐藏表单修复不回退。
- 必要页面代表图与定向断言通过，标准CI、实际包及线上来源核验通过。
- 新 r2正式发布且 latest/update识别，无同版本绕路；不影响旧r1、真实用户数据或生产服务。
- 不声称未测的medium/high/max可用，也不把Chrome尺寸模拟写成实体手机/全平台安装验收。

## 阶段记录

- 两处版本 manifest 已同步 `2.3.1-r2`，真实 launcher `--version` 返回相同版本，插件版本匹配；未更改 lockfile 或官方 pin。
- 根／launcher README、UPSTREAM、CHANGELOG、安装 command 和项目 skill 已更新当前 r2 入口及正常升级说明。
  保留 tag API 校验真实 SHA、同提交入口／revision，不复用旧 r10 SHA；原 r1/r10 记录及精确来源保留。
  六份文档的 78 个本地／仓库文件链接目标检查通过，安装命令静态断言一致，未宣称待验和未发布项目已经完成。
- 文档、manifest、AGENTS 和新计划的 targeted diff 隐私检查未发现凭据、个人路径、邮箱或调试映射，130 列及 diff check 通过。
  仅检查本轮新增内容，未重复未变化媒体或全历史扫描；产品改动和正式包仍需完成后另查。
- 发布前已记录原 r1 Release，确认线上 tag／target 仍为 `5b626e3fa94c5016c0c8d6d3ff248ed514b491ca`，
  包 digest 为 `f9b93346c510508c98a0b181796e870178799925629f079ee14a42c5a60516cb`。
  实际 updater 版本比较确认 `2.3.1-r2` 大于 `2.3.1-r1`；待正式发布后续验真实 latest 发现，不以静态比较冒充更新完成。
- 双端 QA 先完成只读基线：准确完整官方 2.3.1、固定 `fff0e9302e0cb4d8b2f1e2c12bb3eca366424704` 的 r1 两份 provider JS，
  实际 HTTP 字节匹配；裸官方桌面 Original 英文短模型、r1 同场景及390 Nocturne 中文长模型三图已检查，无写入或模型请求。
  原基线报告 24／25，不能称全过：驱动错误要求裸官方 630px 与既有 r1 626px 表单完全等宽；左锚点、footer／Save 已对齐。
  原报告不改，仅用已有几何证据另行复核，允许既存差异的替代断言通过，见 ignored QA 的 `baseline-review.json`。
- 本地标准 lint／typecheck／test:pack 均 exit 0，日志归档 ignored `.cache/provider-defaults-r2-release/`。
  pack 实际安装返回 `2.3.1-r2`，依赖、更新帮助、安全拒绝、静态 no-cache 与 API 代理通过；这是阶段冒烟，不是正式包发布。
  不重复本地全量 UT／IT／安装矩阵；最终 required CI 仍需全部完成。
- 产品已恢复默认，helper 52 行、增强主文件 498 行。create 区分无 saved record 的新行与已有记录缺字段，
  新行实际提交采用所见选择，保留 native 未知值；已有模型未编辑沿 native／明确保存值，编辑仍逐选项合并。
  晚到配置取得已有记录后改用已有字段语义，不用新行默认覆盖未编辑字段；原可见表单、provider／行身份门禁未变。
- 先改回归复现 4 项失败，保留 `.cache/provider-defaults-r2-product-before.log`，未以测试期望绕过真实保存。
  最终 8 文件／99 项定向 UT、受影响 ESLint、diff check 全通过；覆盖所有默认逐项取消、全部取消、主动选择原不选项、
  POST／PUT／重开、未知值、显式空数组／false、late config、排序、隐藏双表单、语言刷新与 observer 收敛。
  证据为 ignored `provider-defaults-r2-product-targeted-verified.log` 和 `provider-defaults-r2-product-eslint-final-verified.log`。
  独立 `launcher-official` 1 文件／5 项 IT 全通过；未改注入顺序或其它资源契约，本轮无付费模型请求。
- 完整官方 2.3.1 app 的本轮必要续验已完成：desktop 20／20、mobile-save 28／28、narrow 11／11，三阶段 exit 0。
  mobile 首阶段已执行19／19后，驱动点击被 sticky footer 遮挡，未发 PUT 即 timeout；原 exit 1 报告和失败图保留。
  只修 QA 滚动定位并重建未保存草稿，mobile-save 仅补取消／保存／回读／重开；不重复已过布局默认或改产品绕过失败。
- 桌面真实 POST 仅保存可见 Custom 行、不混 hidden preset；手机唯一 PUT 保存五行，长新行完整默认、短新行取消 image_in／max。
  三个旧模型的未知值、空数组／false、native low-only 原样保留；fresh authenticated GET 均 HTTP 200／code 0，与写入一致。
  官方表单重开逐行13个 checkbox 一致；320英文 Cancel 无保存。证据集中于 ignored `provider-defaults-r2/final-verification.json`。
- 父级已实际查看1280 Original英文、390 Nocturne中文长模型／取消后重开及320 Nocturne英文四张最终 PNG。
  无横向溢出，fieldset／13个checkbox／Save可达，r2与固定r1几何一致；不把旧baseline24／25或mobile驱动失败写成全过。
  完整 Settings 由桌面打开后 resize／touch，只用虚构 loopback REST／WS，不代表实体手机、冷入口或用户真实磁盘配置验收。
  自有 Chrome 整棵子树、全部测试监听／launcher／WS 已清零；未访问真实配置／会话／凭据或生产端口。
