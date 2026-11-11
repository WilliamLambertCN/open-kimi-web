# Open Kimi Web 2.5.2-r2 图标与发布

用户于 2026-11-11 选定冰蓝玻璃 O、官方 K 轮廓的银灰 K 和蓝色碎钻，要求发布 GitHub 新版本。
本计划记录执行基线，不声称用户逐项审阅。当前正式版为 2.5.2-r1，本轮新建 2.5.2-r2，不改旧版本。

## 范围与边界

- 使用选定原图，不重新生成或重绘。统一网页左上角、手机徽标、标签页和安装到桌面的图标。
- 将去除元数据的高清原图保存在 docs/images/app-icon.png；运行时只包含缩小后的 PNG。
  普通图标保留完整方图；另做有留白的 maskable 图标，避免系统圆形裁切截掉 O、K 或碎钻。
- 移除已不再使用的旧 app.svg，更新资源白名单、安装清单和实际包检查，继续拒绝任意资源路径。
- 同步 launcher、插件版本及当前安装文档。首页保留“界面预览→快速上手”和两段系统在线命令，不增加长篇验收。
- 官方兼容目标仍为 2.5.2；缺官方时的安装固定版本及 metadata 失败 UI fallback 仍为 2.4.1。
  不更改模型、会话、任务、更新器或命令接管行为，不升级用户 CLI，不重启生产或修改设备信任。
- 正常 develop → PR → main；不发布 npm registry，不移动旧 tag、替换旧资产或重写共享历史。
  原有 .tmp/ 保留、不读取或提交；本地证据和脚本放 ignored cache，真实数据、密钥和证书不公开。

## 实施与验证

1. 替换 192、512、Apple 180 像素图标，新增独立 maskable 512 图标，安装清单区分 any 与 maskable。
   安装启动背景与新图浅冰蓝底一致，不改主题切换或既有页面布局。
2. 查看缩小至 16／24／32／48／64 像素、圆形及圆角裁切效果。
   在准确官方 2.5.2 app 与虚构 REST／WS 的隔离环境检查桌面、窄屏和受影响三主题实图及针对性布局断言。
   沿用此前无关功能验收，不重复大会话、跨平台安装或实体设备矩阵。
3. 运行 lint、typecheck、定向品牌 UT、PWA／官方资源 IT 及一次标准 test:pack。
   PR 与 main 的 required gate 运行完整 UT／IT、覆盖率及实际打包；行与分支 70% 门槛不变，不绕过门禁。
4. 提交前检查实际 diff、图片及元数据、本次提交身份与公开范围；提交、squash 和 annotated tag 使用已确认 GitHub noreply。
   从通过 required CI 的准确 main 提交在隔离 worktree 用标准 pnpm pack 生成 open-kimi-web-2.5.2-r2.tgz。
   检查真实包清单、源码一致性、图标和安装清单，排除秘密、个人路径、缓存、日志和调试 sourcemap。
5. 新建 v2.5.2-r2，发布非草稿、非预发布的 latest GitHub Release。
   下载公开资产核对原字节与 digest；检查 README 解析 tag SHA 及同 SHA 在线安装入口，旧 r1 更新器应能发现 r2。
   不运行 update 修改用户安装，确认旧 r1 tag／资产未变。发布后证据另作维护 PR，不移动已发布 tag。
6. 正常同步 main 回 develop；清理本轮自有 worktree、进程和临时 profile，保留 ignored 证据，不动原 .tmp/。

## 用户更新与未验证边界

更新后须自行重启 Open Kimi Web 并刷新网页。桌面系统缓存旧图标时，可能还需移除旧快捷方式并重新添加。
图标缩放、裁切和浏览器模拟不等于实体安卓 WebAPK 或 iOS 安装验收；不保证所有系统立即刷新已安装图标。
本轮不重新验证任意大会话、全部安装平台或生产网络，也不把 r1 的功能说成 r2 新增。
项目仍为非官方社区增强，参考官方 K 轮廓不代表 Moonshot AI 背书。

## 执行记录

实际完成后追加本地检查、PR／CI、正式 main／tag、包清单与线上验证；未记录不视为通过。

### 本地发布准备

- 选定原图与公开高清图像素相同；高清图及四份运行时 PNG 均无 EXIF 或其它嵌入元数据。
  普通 192／512、Apple 180 保留方图；maskable 512 将完整方图放入中央安全圆，不截掉选定内容。
- 查看了 16／24／32／48／64 像素、圆形与圆角裁切板，以及准确官方 2.5.2 app 的六个双端三主题样例。
  同场景以旧 r1 图案为基线，16 项功能／几何断言通过，12 张对照图归档；本轮六张新图及必要基线已实际查看。
  320 像素 Original 长标题原有截短未变化；本轮不扩大为标题布局修复或实体手机验收。
- lint、typecheck、21 项品牌／插件 UT、13 项 PWA／官方资源 IT 和标准 test:pack 通过。
  实际安装包可返回新图标与清单；Windows 清理、可信 HTTPS、静态与 API 原有包检查也通过。
- 候选包包含 168 文件，16 个必要模块齐全，包与当前源码相符；旧 SVG 已移除，高清原图不进入运行时包。
  对实际 diff、图像／元数据及包内容的定向检查未发现新增凭据、个人路径、私钥、调试 sourcemap 或真实会话。
  本地链接检查首次把 JavaScript 正则误当 Markdown 链接；限定 Markdown 后通过，没有改产品代码绕过检查。
- 原有功能验收沿用 [r1 发布记录](kimi-code-2.5.2-r1-release-v1-plan.md)，本轮完整 UT／IT 由 required CI 再检查。
  自有 Chrome 进程树、监听和 profile 均已清理；原 .tmp/ 保留，线上核验和正式包结果仍待实际完成。

### 正式发布与线上核验

- [PR #44](https://github.com/WilliamLambertCN/open-kimi-web/pull/44) 已通过 required gate，正常 squash 合入 main。
  develop、PR 和 main 的 CI 均通过，没有使用 admin 绕过：
  - [develop CI](https://github.com/WilliamLambertCN/open-kimi-web/actions/runs/42976490269)
  - [PR CI](https://github.com/WilliamLambertCN/open-kimi-web/actions/runs/42976555576)
  - [main CI](https://github.com/WilliamLambertCN/open-kimi-web/actions/runs/42976925467)
- main CI：2886 UT／626 IT 通过，28／25 项既有平台条件跳过；UT 行／分支覆盖率 93.39%／84.93%，
  IT 为 85.13%／72.94%。lint、typecheck、实际包验证通过，70% 门槛不变，不提高超时或增加跳过。
  CI 摘要脚本首次未识别日志转义后的颜色码，修正解析后与原始日志核对；没有失败测试或产品修补。
- 正式软件提交为 `dd2ec5a34db476c68f6910785ac61d9484c77a4e`。
  annotated tag `v2.5.2-r2` 对象为 `ef374986110ee8b0806814cca8d27695408d86fd`，准确指向该提交。
  本次提交作者、squash 作者和 tagger 均为已确认 GitHub noreply；GitHub 合并提交者使用其正常 noreply。
- 正式包从通过 CI 的 main 隔离 worktree 用标准 pnpm pack 生成：168 文件、9,025,489 bytes，16 个必要模块齐全。
  SHA-256：`9f8e5ee8f273bdd8d832968a02659ec567801ac2cdd8338890324b4beb215a0e`。
  包与准确 main 源码一致，四份图标尺寸、元数据及安装清单通过检查；与候选包仅 40 文件换行不同。
- [正式 Release](https://github.com/WilliamLambertCN/open-kimi-web/releases/tag/v2.5.2-r2)
  发布于 2026-11-11T15:09:01+08:00，为非草稿、非预发布的 latest。
  唯一资产为 `open-kimi-web-2.5.2-r2.tgz`，资产 ID `734524303`；公开下载的原字节、大小及 digest 与正式包一致。
- README、三个在线安装脚本和公开高清图已按 tag 同一 SHA 与 Git 对象逐字节核对；两段系统命令指向新 tag 和版本。
  从已校验的旧 r1 正式包调用原版 latestRelease()，真实联网发现 r2 及准确下载地址，未运行 update 修改用户安装。
  旧 r1 的 tag 对象、目标提交、Release 及资产 ID／大小／digest／更新时间均未变化。
- 本次公开 diff、图片／元数据、提交身份、发布说明和真实包定向检查未发现新增隐私泄露。
  不扩大为全部旧历史已审计或清理；原 .tmp/、并行任务的 .gitignore 修改及 ignored 证据均未纳入本轮提交。
  无用户 CLI 升级、生产重启或设备信任修改；上方实体手机、系统图标缓存和全平台未验证边界不变。
- 构建 worktree、旧更新器解包目录和自有浏览器进程已清理，证据保留在 ignored cache。
  本节为发布后记录，另走维护 PR；不移动已发布 tag 或替换包，main 通过普通 merge 同步回 develop。
