# 第一次给 Open Kimi Web 提 PR

不用先读代理代码。下面两种改动都不涉及网络、模型配置格式或会话存储。挑一个小问题即可。

## 改一处主题颜色：只改 CSS

打开 [themes.css](packages/launcher/src/mobile/themes.css)，搜索要改的 `data-okw-theme`：
夜幕 `nocturne`、极光 `aurora`、暮色 `twilight`、余烬 `ember`、矿物青绿 `mineral`。
例如，觉得极光主题的选中行看不清，就在 `aurora` 块里改 `--okw-selected`，不要在全局改所有主题。
调配色不必替换背景图；[背景素材说明](docs/THEME-ASSETS.md)列出了每套主题的设计参考。

用演示会话切到这个主题，在手机和桌面各看一次选中行与相邻行；再切回原版确认没变。
PR 附同一内容的改前、改后截图，裁掉地址栏，不放真实对话、模型配置或工作区名称。

## 改一句子代理说明：只改文案

打开 [subagentPoolView.js](packages/launcher/src/mobile/subagentPoolView.js)，搜索 `strongText` 或 `fastText`。
每个键各有一份中文和英文文案，两处一起改，不需要调整按钮或派发逻辑。
`strong` 和 `fast` 是按钮名称，带 `Text` 的才是点按钮后填入编辑框的说明。

写出任务的区别，比给模型贴标签有用。例如：“适合批量改名、整理清单；若要判断跨模块行为，交给推理候选。”
不要写私人模型别名，不承诺一定派给某个模型。到「管理候选池」点模板，再手改一句，确认仍可编辑；不用保存个人配置。

## 提交到哪里

Fork 后从 `develop` 切一个分支，PR 的目标也选 `develop`。标题说清楚改哪一处，正文写一句怎样验证。
本地已安装项目依赖的话，在仓库根目录执行对应的一条检查：

```sh
corepack pnpm exec vitest run --config vitest.ut.config.ts packages/launcher/tests/themes.test.mjs
corepack pnpm exec vitest run --config vitest.ut.config.ts packages/launcher/tests/subagentPool.test.mjs
```
