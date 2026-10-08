# 桌面聊天窗格自适应宽度

## 目标

按用户要求，聊天正文列和输入卡片随主聊天窗格自身宽度自适应，大窗格至少占 60%，不按整个屏幕宽度计算。
保留现有主题、字体、头像留白、侧栏与右面板比例。小窗格、手机维持必要边距，不横向溢出。
实现与本地验收已完成；用户追加授权提交并发布 `v2.1.1-r7`，按 develop → main → tag/Release 执行。
发布包含 develop 中已验证的会话体积与消息时间戳；保留既有 `.tmp`，不覆盖旧资产或重写共享历史。

## 已核对事实

官方 2.1.1 的主 `section.con` 已有 `container-type:inline-size` 和 `--read-max:760px`。
`.content-wrap` 与 `.chat-dock` 共享此变量，dock 额外保留官方滚动条宽度补偿。
`.chat` 左右各 20px padding；输入卡片左右共 32px 内缩。只改外层 60% 会使实际可用列略低于 60%。
独立 `.conversation-toc` 仍按全局 760px 定位，必须同步到主阅读宽度，否则会压进正文。
Side Chat 不使用主 `.content-wrap/.chat-dock` 链；不覆盖全局 `.chat` 或 `.composer`。

## 实现

1. 增加独立 `packages/launcher/src/mobile/chatWidth.css`，仅 `min-width:641px` 且 `.app:not(.mobile) > .con`：
   - `--read-max:min(100cqi,max(760px,calc(60cqi + 40px)))`。
   - 保留官方原 760px 基线，小窗格由 100% 与容器上限收紧；宽窗格按自身尺寸增加。
   - 60% 口径为正文列（扣除 chat 左右 padding）和输入卡片，不要求每条短消息气泡本身铺满。
   - 不另设 JS/observer、不改变 scrollbar 补偿，不更改图片尺寸、字体、side/right panel 宽度。
   - 同步主 `.conversation-toc` 的 `--toc-content-max` 到新的 `--read-max`，保留官方边距与 clipped 行为。
2. `officialPresentation.mjs` 登记 CSS 资源和 STYLES，`launcher-official.it.test.mjs` 加载/返回校验。
3. 在既有 `presentationStyles.test.mjs` 增加作用域、容器单位/最小比例、TOC 及移动边界的回归断言。
4. README 记录功能与 r7 安装入口；项目 `AGENTS.md` 链接 `docs/plans/chat-width-responsive-v1-plan.md`。

## 视觉与功能验收

复用 `.cache/session-size-qa/run.mjs` 的真实官方 app、隔离 REST/WS fixture、真实 launcher 与 CDP，
添加宽度专用入口；baseline 只禁用本次 `chatWidth.css`，不混用既有体积 baseline。
使用虚构内容，截图只存忽略 `.cache`，不访问用户真实会话。

- 2560/3840 大屏、1440 常规屏：短/长中文、代码、列表，覆盖 screenshot 的 nocturne 及 original 浅深。
- 真实侧栏收起、右面板开启/关闭和拖动导致主 pane 缩小；记录 `.con`、content-wrap、chat、dock、card、TOC 几何。
- 大窗格正文可用列及输入卡片宽度 / pane >= 60%；窄 pane 在可用区域内，不产生水平溢出。
- 正文与输入沿用官方中心/滚动条对齐方式、TOC 不侵入正文、dock 不遮挡最后消息，发送控件可达。
- 390 手机一份控制，确认几何不变；右侧 Side Chat 的宽度规则不被主 pane CSS 接管。
- 实际查看 baseline/after 图片，不以编译或 CSS 字符串断言代替视觉验收。

## 检查与发布

1. 在最终内容上通过 lint/typecheck/UT/IT/pack；核对 launcher、插件版本、README 与 CHANGELOG。
2. 定向检查待提交内容、相对 main 的新增内容、发布包清单与实际字节；不公开 QA 缓存、截图或个人配置。
3. 打包 `open-kimi-web-2.1.1-r7.tgz`，实际解包资源完成隔离启动及受影响功能的必要定向验证。
4. 提交并推送 develop，创建到 main 的发布 PR，等待 CI 通过后合并；从已验证 main 创建正式 tag/Release。
5. 下载远端资产，核对版本与关键增强文件；main 同步回 develop，不重写历史或覆盖旧发布资产。
6. 关闭本轮 Chrome/launcher/fixture 及子进程，QA 归档于忽略目录；保留既有 `.tmp`。
7. 报告实际测试结果、Release/下载链接、提交与 CI，以及重启 launcher 并刷新页面的升级要求。
