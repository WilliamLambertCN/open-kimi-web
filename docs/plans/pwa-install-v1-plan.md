# Open Kimi Web 安装到桌面（PWA）v1

开始时间：2026-11-07T12:00:14+08:00。
计划提交时间：2026-11-07T12:04:04+08:00。
累计耗时：3 分 50 秒｜当前阶段：规划完成｜有效进展：已确认官方缺口、原生鉴权和安装边界。
本计划由工具自动放行，非用户逐项审阅；实施授权来自用户“帮我添加这个功能”的请求。

## 目标与边界

为当前官方增强模式提供手机保存到桌面、独立窗口打开的网页 App 功能。
Android 支持浏览器原生安装提示；iPhone／iPad 提供添加到主屏幕步骤；桌面也有同一入口。
沿用现有主题、导航和官方认证，不另做前端、不增加依赖或后端引擎。
本轮本地实现和验证，不提交、推送、发布、改版本号或自动重启生产服务。
保留既有大会话与 debug 日志的所有未提交改动，不处理原有 `.tmp`。

## 已确认事实

- `packages/launcher/src/officialPresentation.mjs` 精确控制增强资产和 HTML 注入。
- `mobile/navigation.js` 已统一桌面与手机入口，可扩展一个安装动作；现有弹层有主题、焦点和 inert 处理。
- 准确官方 2.4.1 `dist-web/index.html` 无 manifest、Apple 安装元数据或 service worker 注册。
- 官方自身保存有期限的凭据，并有原生 token 输入对话框；PWA 无须另存凭据。
- 当前 Chromium 安装不强制要求 service worker；选择不注册 SW，不引入离线缓存。
- 可安装要求可信 HTTPS，开发时 localhost 是例外；局域网 HTTP 或未信任的自签证书不能保证安装。
- 没有可直接复用的 OKW 自有安装图标，需要新增简单原创品牌图形，不冒用官方 logo。

## 实现步骤

1. 将完整计划保存为 `docs/plans/pwa-install-v1-plan.md`，在 `AGENTS.md` 链接并注明本地交付边界。
2. 在 `packages/launcher/src/mobile/` 新增静态 `manifest.webmanifest`、自有图标源和 PNG。
   - 名称 Open Kimi Web，稳定 `id`、`start_url`、`scope` 均为 `/`，`display: standalone`。
   - 提供 192／512 PNG、适当 maskable 安全区和 180 Apple 图标。
   - 只含公开静态字段，不含当前会话、主机、URL 参数、fragment、token 或用户信息。
   - 在 `officialPresentation.mjs` 登记精确资产白名单与 MIME，注入 manifest／apple-touch 元信息。
   - 保留上游 viewport、主题颜色；不修改官方缓存；自定义 `--web-dir` 不注入、不覆盖其 manifest。
3. 新增独立 `pwaInstall.js`、必要的 view helper 与 `pwaInstall.css`。
   - 双端统一在使用统计后增加“安装到桌面 / Install app”；不改变其它动作顺序。
   - 复用既有导航、主题 token 和弹层视觉；不使用 Vue 私有状态。
   - 捕获 `beforeinstallprompt`，只在明确用户点击后调用 prompt，防重复调用。
   - 正确处理取消、失败、等待安装及 `appinstalled`，不将 accepted 冒报为安装完成。
   - iOS／iPadOS 显示分享→添加到主屏幕；无安装事件的浏览器说明菜单安装及支持限制。
   - 不安全上下文显示可信 HTTPS 提示，不伪造安装按钮或自动修改证书信任。
   - standalone／iOS standalone 状态隐藏安装入口；状态变化保持幂等，避免观察器循环。
   - 中英文一致，支持 Escape、焦点循环、关闭还原焦点和背景 inert；不触发原生聊天快捷键。
   - 不新增 token 存储、不注册 service worker、不缓存会话／API／图片、不改官方登录生命周期。
4. 定向验证与实际交付检查。
   - 新增既有 Vitest/jsdom 测试：安装事件、主动点击、取消／异常／重复点击、独立模式、语言、焦点。
   - 导航测试覆盖双端顺序、原生节点身份及真实 MutationObserver 收敛。
   - 更新 `tests/it/launcher-official.it.test.mjs` 验证真实 HTTP 清单、PNG 尺寸、MIME、无凭据及 custom opt-out。
   - 更新 `scripts/pack-smoke.mjs` 必需资源及实际包资源服务断言。
   - 使用准确官方 2.4.1 完整 UI 和虚构 REST／WS，在隔离 Chrome profile 中验证根启动、原生登录、安装清单。
   - 用真实浏览器安装能力检查，不把合成安装事件当作 OS 安装完成；可行时验证独立窗口启动。
   - 实图覆盖窄手机／常见手机／桌面、中文／英文及 Original／Nocturne／Aurora，检查长说明和短状态无溢出。
   - 自有测试仅回环临时端口，不访问真实会话、凭据、生产服务；产物归档 ignored `.cache/pwa-install-qa/`。
   - 实体 Android／iOS 无法执行时明确记为未验，不声称全平台安装成功。
5. 收尾。
   - 更新 README、launcher README、CHANGELOG、相关使用 Skill 及 AGENTS 的安装能力与边界。
   - 运行标准 lint、typecheck、UT、IT、pack 各一次；保留 70% 行／分支覆盖门槛，不重复无变化旧验收。
   - 检查实际新资产和包不含秘密／路径／sourcemap，查看新图标和代表截图。
   - 检查 diff、行长和工作树；正常关闭自有测试进程，保留明确归档的无隐私 QA 证据。

## 验收标准

- 增强模式的 Android／桌面浏览器可识别合法 PWA 清单、图标和干净启动地址。
- 双端同一入口可触发可用的原生安装提示，否则提供准确手动安装／HTTPS 提示。
- 独立窗口不重复显示安装入口；安装交互不破坏现有导航、会话或草稿。
- 根启动沿用官方认证；缺失／过期凭据由原生登录处理，不泄露或复制 token 到安装元数据。
- 自定义前端保持原样；没有新增离线缓存、SW 或生产进程变更。
- 标准测试和本轮实际浏览器证据如实记录；未测实体手机和 OS 行为明确说明。

参考：https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable

## 本轮实施与验证记录

- 已新增清单、192／512 安装 PNG、180 Apple PNG 与原创 SVG 图标源；只将必要静态资源登记到精确 HTTP 白名单。
  注入 Apple／PWA 元信息，保留官方 viewport、主题与自定义前端 opt-out；未增加依赖、SW 或离线缓存。
- 安装交互拆为 `pwaInstall.js`、`pwaInstallView.js`、`pwaInstall.css`，通过既有导航注册。
  原生 prompt 只在用户点击时同步调用；取消／失败可重试，accepted 不冒报完成，appinstalled 后隐藏入口。
  支持 iOS／iPadOS 指引、可信安全上下文判断、中英切换、焦点／inert 还原及观察器收敛。
- README、launcher README、CHANGELOG、项目 Skill 已说明本地未发布、可信 HTTPS、官方登录和自行重启边界。
  保留本轮开始前所有低带宽／debug 日志改动；没有提交、推送、发布、改版本或生产重启。

### 自动测试与实际包

- 定向 `navigation.test.mjs`＋`pwaInstall.test.mjs`：26 项通过。
- 定向 `launcher-official.it.test.mjs`＋`launcher-pwa.it.test.mjs`：12 项通过。
  真实 HTTP 检查清单、GET／HEAD、PNG 尺寸／MIME、非法方法／资源、无凭据反射及自定义前端保持原样。
- 初次标准 UT 有 1 项旧固定脚本数量断言失败（35→37）；同步新增两项资源后，定向 observer 10 项通过。
  标准 UT 重跑为 111 文件／2527 项通过，Lines 93.27%、Branch 84.54%，70% 门槛未调整。
- 标准 lint、typecheck 通过。对应日志为 `.cache/pwa-install-qa/lint.log`、`typecheck.log`、`ut-final.log`。
- 标准 `test:pack` 通过：实际 pack／临时安装、CLI version、静态／API／debug 及 PWA HTTP 资源检查通过。
  日志 `.cache/pwa-install-qa/pack.log`；包沿用本地版本号 2.4.1-r1，仅为验证，不是重发该 Release。
- 两次标准 IT 均在既有更新进程测试的 PID 等待失败：626 项通过、1 项失败、6 项条件跳过。
  失败在 `tests/it/update-process.it.test.mjs` 的退出父进程／后代保持 stdout 场景；独立该文件通过。
  保留 `it.log`、`it-final.log` 和 `it-update-process.log`，未以定向通过替代全套结果。
- 已证实 fixture 启动竞态：并发诊断的 PowerShell 子进程就绪耗时 1194–1622ms，12／12 超出原约 1 秒等待。
  普通 Node 父退出后 Windows worker 也退出，不能直接替换；Windows worker detached 后 12／12 保留 stdout，
  PID 在 290–479ms 就绪。证据 `.cache/pwa-install-qa/process-timing-report.json`。
- 只修改该测试 fixture：Node 父进程等 worker 写好 PID 再退出，Windows worker detached、POSIX 保留进程组。
  PID 等待前登记清理，等待 task 结束再清理晚到 worker／释放锁；追加确认父已退出的断言。
  未改产品更新逻辑、1 秒 PID 等待或 1500ms 进程期限，也未跳过测试。
- 修后定向 3／3、第三项六份并发 6／6 通过。额外诊断同时跑六份完整文件时，第三项全通过，
  但一份原有第一项在 alive 检查失败；保留 `it-update-process-load-4.log`，不称该轮负载全部通过。
  本次没有扩大修改其它更新行为；该人工并发负载边界不等于标准运行失败。
- 最终标准 `corepack pnpm test:it` 独立执行 exit 0：27 文件通过／2 文件条件跳过，627 项通过／6 项条件跳过。
  Lines 84.53%、Branch 71.83%，70% 门槛未调整；日志 `.cache/pwa-install-qa/it-verified.log`。
  收尾 lint／typecheck 与 diff 检查通过，日志 `lint-final.log`、`typecheck-final.log`。
  已清理由先前失败遗留且身份与创建时间匹配的两个 fixture worker；最终定向检查该测试进程残留为零。

### 准确官方 2.4.1 浏览器证据

- 完整官方 app＋当前 launcher＋虚构 REST／WS，隔离 Chrome 156；主矩阵 26／26 断言、9 张截图通过。
  证据目录 `.cache/pwa-install-qa/run-2026-11-07T04-21-15-809Z/`。
- 根 URL 无 fragment 登录成功，刷新复用官方 credential store；清单解析和 Chromium 安装资格检查均无错误。
  原生 `beforeinstallprompt.isTrusted` 为 true；manifest 的 id／start_url／scope 均为根路径。
  service worker registrations 与 CacheStorage 均为零，无配置／模型写入。
- 320 Original 中文、390 Nocturne 英文、390 Aurora 中文入口和安装弹层无水平溢出、未超出视口。
  代表实图已查看；关闭恢复焦点与 inert，observer 无循环，自有 Chrome／服务／监听全部关闭。
- 首次 QA 驱动因原生 onboarding 重现而失败，修为点击原生 Skip；另一次因手机菜单英文 selector 失败。
  失败报告保留，不当作产品通过。主矩阵早期 desktop baseline／enhanced 未同主题，不据此声称同主题对比。
- 补验只覆盖上述缺口，未重跑完整矩阵：7／7 断言、4 张截图通过。
  证据目录 `.cache/pwa-install-qa/supplemental-2026-11-07T04-32-01-262Z/`。
  同一 Original／light、相同内容，安装入口关闭／开启两图已查看，composer／侧栏／原入口几何完全相同。
- 实际鼠标点击安装按钮，原生受信事件的 prompt 调用 1 次，userActivation 为 true，无同步异常或拒绝错误。
  没有接受系统安装，choice 仍未决；不据此声称桌面快捷方式或 OS 独立窗口已安装成功。
- 补验以明确模拟的 iOS／不安全上下文／standalone 检查指引与隐藏状态，320 英文长指引无溢出，实图已查看。
  模拟不等于 Safari 或实体手机验收；补验自有进程／监听残留为零。

### 隐私与剩余边界

- 检查范围：本轮 PWA JS／CSS／manifest／图标、资源白名单及实际临时安装包，不重复审计未变化旧功能。
- 未发现新资产含真实凭据、个人绝对路径或 sourcemap；PNG 只有 IHDR／IDAT／IEND，无私有元数据。
  新图标与代表截图已实际查看；截图只有虚构演示数据，QA 留在 ignored cache，不进入包。
- 无需隐私修复；没有改官方凭据生命周期，没有另存 token，清单和安装启动地址不含会话或凭据。
- 未验证实体 Android／iOS 安装、系统独立窗口启动及跨浏览器凭据共享；未修改证书信任、OS 快捷方式或注册表。
  真实局域网 HTTPS 信任取决于设备配置，不把 localhost 安装资格推广为 LAN HTTP 可安装。
  本轮未发布，未检查或修改线上服务和 Git 历史；标准检查最终结果见上方，不扩大为实体安装验收。

收尾记录：2026-11-07T12:39:02+08:00，累计 38 分 48 秒。
本地实现、标准检查、实际包与浏览器边界验证已完成；实体 OS 安装仍未验证，不自动替换当前运行服务。
