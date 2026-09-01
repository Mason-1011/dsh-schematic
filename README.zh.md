# dsh-schematic

> 读懂——并亲手改写——你的 DeepSeek Harness 的接线。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-schematic.svg)](https://www.npmjs.com/package/dsh-schematic)
[![CI](https://github.com/Mason-1011/dsh-schematic/actions/workflows/ci.yml/badge.svg)](https://github.com/Mason-1011/dsh-schematic/actions/workflows/ci.yml)
[![Built for](https://img.shields.io/badge/built%20for-DeepSeek%20Harness-4f46e5)](https://github.com/deepseek-ai/deepseek-harness)

[English](README.md) | **简体中文**

看清一轮 DeepSeek Harness 对话里谁提供每项服务、谁处理每个运行时事件、时间花在哪——然后直接在图上改写这些接线。

```sh
dsh plugin --profile web add dsh-schematic
```

![dsh-schematic:查看实时拓扑、找到插件,再把图切换成编辑器](docs/assets/dsh-schematic-demo.gif)

## 状态

**v0.3.0 现已发布。**实时拓扑查看器与组合工作台均已交付,并以 [`dsh-schematic@0.3.0`](https://www.npmjs.com/package/dsh-schematic) 发布到 npm。preset 工作台与接缝感知市场面板计划在 v0.4 交付。

## 这是什么

DeepSeek Harness(dsh)用插件拼出整个 agent 产品:每一项能力——模型适配器、工具注册表、乃至主循环本身——都通过服务、`inject` 依赖、类型化事件和可逆效应,挂到一个共享的 Cordis 上下文上。

这些接线只存在于运行中的进程里。`dsh-schematic` 把它画出来。

- **拓扑视图**——已挂载插件的交互式接线图:谁提供 `ctx.fs`、谁注入它、事件在哪些插件之间流动、每条能力接缝在哪。数据来自 loader 自己的插件树。
- **组合工作台**(v0.3.0)——**在图上直接**编辑接线:启停插件、改条目配置、按接缝换 provider(本机 → 沙箱 → 远程)。每个改动先以幽灵节点 + YAML diff 预览,先走一遍与启动完全相同的组合干跑,先备份,再经 harness 自己的热重载生效——一键可回滚。
- **preset 工作台 + 接缝感知市场**(规划中,v0.4)——组装 preset;点一个空着的接缝,看到能填它的插件,冲突在安装前浮现。

## 功能

已交付(逐版本细节见[变更日志](CHANGELOG.zh.md)):

**拓扑查看器**——挂载后跑在 `/schematic`。
- 三个标签页:**旅程**(一条消息在运行时流经的阶段卡片及各阶段交换的 ctx 键)、**领域**(放射网状;家族/聚类/核心脊柱卡可展开为作用域视图;分组可 ⊕ 一键打散、全部展开;连线按提供方 → 消费方绘制,悬停卡标明双方与注入的键)、**表格**。
- 每 5 秒刷新并弹变化提示;新插件脉冲高亮;`?tab=`、`?expand=all` 深链。
- 失败传导到单元级——内部子孙 fiber FAILED 会把整个条目单元在图上标红(面板携带裁剪后的失败原因),恢复后下一次落定即清除。
- 一键中英整页切换——描述由进程内 LLM 批量翻译,标识符保持英文。

**运行时活动**——看工作往哪流。
- 每个回合、模型回复、工具调用、workflow 运行、注册表变更、宿主动作、后台任务、服务读取都归因到所属插件;工作流经哪个插件,图就点亮哪个(工具执行/模型流式期间强高亮,之后呼吸光衰减);可折叠的活动时间线记下谁、做了什么、何时、耗时多久。
- **结构变化也是事件**(v0.3.1)——插件挂载/卸载、接缝换提供方、键变得未解析、单元翻入/翻出失败:每次落定的结构变化都落成时间线行并写入日记,「我应用那次改动的时候接线动了什么」事后可查。
- 会话选择器默认跟随你正在看的聊天,可过滤 subagent/后台任务。
- **回放**——时间线的"回放"开关经宿主自己的只读历史 RPC 向前翻页读取会话持久日志,每一事件走同一个直播折叠逻辑重新归因,并归并日记里的 live-only 行:查看页开着之前谁干了什么,一样看得见。
- **统计**——插件级监控表,累计本实例观察窗内的计数:行数、工具调用与失败、工具耗时(总和+最大)、LLM 完成数,以及各插件此刻在飞的任务。

**输入框旁的星图**——全部展开的网状图缩成浮在聊天输入卡旁的实时缩影。
- 一包一星,确定性力松弛星系排布;默认只留稀疏弧形的“引力骨架”,不把全部边铺成线团;悬停一颗星时展开它的一跳星座。
- 真实 service access 会点亮准确的消费方 → 提供方航道,发出一颗沿线光子,随后留下按频率增强的短暂余辉;没有可信第二端点的事件只点亮所属星体,不伪造连线。
- 自由摆放(拖到任意位置,拖回卡片旁自动重新吸合)、自由调大小(视口是唯一上限)、随明暗主题切换的玻璃星空底色滚轮随调(或在设置里调)。

**组合工作台**(v0.3.0)——页头的 ✎ 开关,**默认关**:关着就是原来的纯观察查看页;打开,图就变成编辑器。
- **一切先预览。**排队的改动先在图上渲染成幽灵(将消失的加删除线+降透明度,将到来的虚线+`?`),抽屉里展示逐条目 diff、受管块 YAML 修改前后的行级 diff,以及结构感知的警告(某服务键即将失去唯一提供方、你的改动丢掉了哪个配置字段、哪处 `!!js` 表达式会被整体替换冻结成字面量)。
- **写入前先干跑。**每次应用都重跑一遍 harness 启动时走的同一套离线组合;非法批次直接拒绝(422),文件一个字节不动。重复条目 id 在计划期就拒掉——loader 遇到会拒绝整棵树。
- **启停与配置。**插件详情面板新增:来源层、保护徽章、启用/停用开关、预填当前 YAML 的行内配置编辑器(丢字段会点名;`!!js` 值在被替换冻结前会警告)。
- **按接缝换提供方。**聚类卡列出该接缝的全部在册提供方与候选(在树/已安装/目录),一键换:同批停旧插新。未安装的包给可复制的安装命令文本(v0.3.0 不代装)。
- **安全落地。**只写 profile `cordis.patch.yml` 里版本化受管块(块外字节逐字保留);每次应用先落一份全文件时间戳备份,文件被别人改过就拒写(409)。harness 约 1–2 秒热重载;被 harness 拒绝的重载保持旧树继续跑,横幅报错 + 一键回滚。停用 schematic 自己属危险级:要逐字输入条目 id 确认,横幅附手工恢复步骤。
- **清空**一键撤销全部 schematic 改动(整块连标记删掉),文件恢复到逐字节原样。

**dsh 集成**
- 设置里的"插件拓扑"分区(自绘 Steam 式三节点导航图标),一键新标签页打开查看器,底色滑杆也在这里。
- "对话中询问":查看页里一键把"介绍这个插件"的问题发进一个未分组新会话——第一问由插件代发。

### 写什么——以及绝不碰什么

观察侧的一切保持构造上的只读:插件绝不写会话日志(不追加自定义事件类型)、绝不包装或拦截服务返回值、也不给自己的观察者加拓扑边。它确实提供一个真实的 ctx 服务——`schematic`,把查看器渲染的同一份实时图递出去(`ctx.schematic.graph()`)。那是能力,不是观察边:注入它的消费方在图上如实地表现为接到了查看器上。

工作台(v0.3.0)只写两样东西,都落在路径明示的地方:
- profile `cordis.patch.yml` 里的**受管块**——`# >>> dsh-schematic v1` 与 `# <<< dsh-schematic v1` 之间的行;标记外的每一个字节逐字保留,写块之前必先落全文件时间戳备份;
- 插件自己的 `~/.dsh/schematic/` 目录——观察日记与这些 patch 备份。

绝不写:会话日志、manifest、bundle 层、`dsh.profile.bundles`、profile 根 `cordis.yml`(那是 `dsh plugin` 命令的地盘)。组合编辑默认关闭,插件自身配置可一刀关死(`config.edit.enabled=false`);工作台的每次写入都走 harness 自己的 patch 文件热重载——被拒绝的重载保持旧树继续跑,一键回滚文件。

## 为什么没别人守这层

| 层 | 项目 | 展示什么 |
|---|---|---|
| 配置 | [dsh-blueprint](https://www.npmjs.com/package/dsh-blueprint) | 启动配置 + overlay 校验;其 v0.6.0 起也写受管块 overlay |
| 市场 | [zat-dsh-engine](https://github.com/mishibeikejie/zat-dsh-engine)、[dsh-desktop](https://github.com/anywhere-labs/dsh-desktop) | 安装 / 管理插件 |
| 会话 | [dsh-synapse](https://github.com/liangmianya/dsh-synapse)、dsh-flowglass | 对话画布、工具调用流 |
| **拓扑** | **dsh-schematic** | **插件之间如何接线——以及在这张活图上结构感知地编辑接线** |

启停插件、写受管块 overlay 都已被做烂;没人做的是**把图当编辑器**——在看得见两端的接缝上换提供方,写入之前有幽灵预览和组合干跑。

dsh 跑在 Cordis 上,而 Cordis 的论文[《A Programming Paradigm for Spatiotemporal Composability》](https://github.com/cordiverse/paper)证明了合流定理:无论系统在运行中如何重新接线,静止下来的状态永远等同于某次一次性静态组装。dsh-schematic 就是这一定理的界面——把运行中系统的静态等价视图画出来。

agent 已经有自己的"创造模式"(运行中检查、重挂插件的自改工具)。dsh-schematic 是给人用的同一个东西。

## 非目标

- 不做又一个大而全的市场,也不做安装器——安装走官方 `dsh plugin` 命令;v0.3.0 只递给你命令文本,市场(v0.4)才是图的供给侧面板;
- 暂不做 preset 组装——v0.3.0 编辑的是活接线;preset 与市场一起在 v0.4 交付;
- 不做 ComfyUI 式数据流画布——dsh 的组合是"插座与电线"的依赖注入,不是数据流,节点画布是错误的隐喻;
- 不做会话回放画布——时间线的回放是插件归因("谁干了什么"),不是读对话的方式;消息级回放属于 dsh-synapse 和 dsh-flowglass。

## 环境要求

| 组件 | 支持范围 |
|---|---|
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | `>=0.1.0-rc.8`(已验证至 `0.1.1-rc.2`),web profile |
| `@deepseek-ai/cordis` | `^4.0.1` |
| `@deepseek-ai/cordis-plugin-include` | `^1.0.6` |
| 浏览器 | 当前版本 Chromium、Firefox 或 Safari(用到 `light-dark()`、`EventSource`) |
| Node.js | `>=22.19` 与 npm,仅从源码构建时需要;CI 覆盖 Node 22 与 24 |

## 安装

已发布到 npm。包自带 dsh bundle 声明,装完即自动注册——不用手改任何 profile 配置。

1. 装进你的 web profile(需要 [`dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh) 和 `pnpm` 在 PATH 上):
   ```sh
   dsh plugin --profile web add dsh-schematic
   ```
   这条命令会在 profile 目录(`~/.dsh/profiles/web`)里执行 `pnpm add dsh-schematic`,并把包加进 profile 的 bundle 层。
2. (重)启动 web profile,打开查看器:
   ```sh
   dsh web    # 然后访问 http://127.0.0.1:3080/schematic
   ```
3. 完成。你会得到:`/schematic` 的查看器、SPA 设置里的"插件拓扑"分区、输入卡旁的星图——浏览器产物都在包里。

其他 profile 同理(`dsh plugin --profile tui add dsh-schematic`)。升级是 `dsh plugin --profile web update dsh-schematic`,卸载是 `dsh plugin --profile web remove dsh-schematic`(remove 会同时把它从 bundle 层里摘掉)。

**从源码跑**(维护者):克隆[公开仓库](https://github.com/Mason-1011/dsh-schematic),执行 `npm install && npm run build`。之后要么把源码目录软链到 profile 的 `node_modules/dsh-schematic`(按名字挂载;用包自带的 bundle 层或手动 insert 二选一,两者同时用会因 loader 条目 id 重复而整树报错),要么用现成示例 [`dev.cordis.yml`](dev.cordis.yml)——端口 3081,从 harness 源码启动(`node --import tsx/esm apps/cli/src/bin.ts --profile web --patch dev.cordis.yml`);开发实例的会话根已隔离到 `~/.dsh-schematic-dev/`,开发实例的重启与被杀都碰不到你的正式会话。

## 使用

- **查看器**(`/schematic`)——点标签切换,或用 `?tab=journey|domains|table` 深链;`?expand=all` 一次展开全部分组;页头切换中/英。
- **星图**——拖动面板移到任意位置;拖右下角手柄调大小;面板上滚动滚轮调底色(0 = 全透明);悬停星体看插件名片与一跳航道;双击,或聚焦后按 Enter/空格,打开全部展开的查看器。
- **设置** → "插件拓扑"——打开查看器;底色滑杆与滚轮双向实时同步。
- **时间线**——"回放"开关向前翻页所选会话的历史;"统计"开关换成插件级计数表(只在打开时轮询)。
- **工作台**——页头 ✎ 切换编辑模式(默认关)。编辑模式下:插件面板提供启停与行内配置编辑;聚类卡提供按接缝换提供方;抽屉预览排队批次(条目 diff + YAML diff + 警告),应用/回滚/清空都在这里。危险操作(停用 schematic 自己)要逐字输入条目 id 确认。停用条目在节点离开图后始终可恢复——卸载行上的 ⏻、"已停用"筛选 chip 的常驻列表、未解析键弹窗,都经同一预览排队启用;它们谁也不会替你打开编辑模式。
- **对话中询问**——查看器里包的详情面板可一键把问题发进新会话,第一问代发。

## 工作原理

一个包,两半:

- **宿主半边**(`src/index.ts`、`src/activity/`、`src/graph.ts`、`src/compose/`、`src/service.ts`)——一个 Cordis 插件:读 loader 的插件树,进程内订阅会话事件洪流、agent 状态、注册表回调、internal/get 服务读取瀑布,然后在 harness web 服务器上提供 `/schematic`(查看页)、`/schematic/events`(SSE)、`/schematic/mini.json`(轮询的缩影数据)、`/schematic/history`(分页回放)、`/schematic/stats.json`(观察窗插件级计数),以及工作台路由(`/schematic/compose.json` GET + `/compose/preview|apply|rollback|clear` POST);`src/service.ts` 另把实时图作为 `schematic` ctx 服务提供给注入它的兄弟插件(`ctx.schematic.graph()`)。工作台从 loader 树推导 profile 的 patch 文件路径,候选改动经 `@deepseek-ai/dsh-app-boot` 自己的组合函数干跑,只写受管块(YAML 往返全部走 `@deepseek-ai/cordis-plugin-include` 的方言,`!!js` 表达式逐字保留;两者运行时从 profile 解析,以 peerDependencies 声明)。
- **浏览器半边**(`src/client/`,构建为 `dist/client.js`)——加载进 dsh 的 web SPA:贡献设置分区、替换导航图标、挂载输入卡旁的星图、处理"对话中询问"。独立查看页(`dist/engine.js`)自启动,只与上述宿主路由通信。

## 开发

```sh
npm run build    # esbuild 打包两个浏览器产物
```

`tools/scan.mjs` 从 harness 源码目录渲染静态图(v0.1 的纯静态方案,没有运行实例时仍然好用)。内部的定位与命名决策记录在 [`DECISIONS.md`](DECISIONS.md)。

## 参与贡献

欢迎提交 issue、兼容性报告与范围清晰的 pull request。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md);报告 bug 时请附 DSH 版本、profile、复现步骤及相关浏览器/宿主日志。

## 路线图

- v0.4 — preset 工作台(组装命名的接线方案并相互切换)+ 接缝感知市场面板(图的供给侧;冲突在安装前浮现)

已交付的逐版本历史见[变更日志](CHANGELOG.zh.md)。

## 致谢

构建于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 与 [Cordis](https://github.com/cordiverse/cordis) 之上;Cordis [论文](https://github.com/cordiverse/paper)的合流定理,是实时接线图能被当作一张稳定原理图来读的原因。

## 许可

[MIT](LICENSE)
