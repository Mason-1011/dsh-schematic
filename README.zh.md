# dsh-schematic

> 读懂——并亲手改写——你的 DeepSeek Harness 的接线。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Stage](https://img.shields.io/badge/stage-early%20development-orange)](#状态)
[![Built for](https://img.shields.io/badge/built%20for-DeepSeek%20Harness-4f46e5)](https://github.com/deepseek-ai/deepseek-harness)

[English](README.md) | **简体中文**

## 状态

🚧 早期开发——但已经能用。**实时拓扑查看器**(v0.2.x)已交付,每天都在真实 harness 实例上使用;组合工作台与市场面板(v0.3/v0.4)是下一步。已发布到 npm:[`dsh-schematic@0.2.27`](https://www.npmjs.com/package/dsh-schematic),一条命令安装(见[安装](#安装))。GitHub 仓库暂未公开。

## 这是什么

DeepSeek Harness(dsh)用插件拼出整个 agent 产品:每一项能力——模型适配器、工具注册表、乃至主循环本身——都通过服务、`inject` 依赖、类型化事件和可逆效应,挂到一个共享的 Cordis 上下文上。

这些接线只存在于运行中的进程里。`dsh-schematic` 把它画出来。

- **拓扑视图**——已挂载插件的交互式接线图:谁提供 `ctx.fs`、谁注入它、事件在哪些插件之间流动、每条能力接缝在哪。只读,数据来自 loader 自己的插件树。
- **组合工作台**(规划中,v0.3)——编辑接线:换 provider(本机 → 沙箱 → 远程)、启停插件、组装 preset。改动先预览、先校验,再应用。
- **接缝感知市场**(规划中,v0.4)——点一个空着的接缝,看到能填它的插件,直接装到图上。冲突(同键重复注册、缺失 provider)在安装前浮现,而不是装完崩溃。

## 功能

已交付(逐版本细节见[变更日志](CHANGELOG.zh.md)):

**拓扑查看器**——挂载后跑在 `/schematic`。
- 三个标签页:**旅程**(一条消息在运行时流经的阶段卡片及各阶段交换的 ctx 键)、**领域**(放射网状;家族/聚类/核心脊柱卡可展开为作用域视图;分组可 ⊕ 一键打散、全部展开;连线按提供方 → 消费方绘制,悬停卡标明双方与注入的键)、**表格**。
- 每 5 秒刷新并弹变化提示;新插件脉冲高亮;`?tab=`、`?expand=all` 深链。
- 一键中英整页切换——描述由进程内 LLM 批量翻译,标识符保持英文。

**运行时活动**——看工作往哪流。
- 每个回合、模型回复、工具调用、注册表变更、宿主动作、后台任务、服务读取都归因到所属插件;工作流经哪个插件,图就点亮哪个(工具执行/模型流式期间强高亮,之后呼吸光衰减);可折叠的活动时间线记下谁、做了什么、何时、耗时多久。
- 会话选择器默认跟随你正在看的聊天,可过滤 subagent/后台任务。

**输入框旁的星图**——全部展开的网状图缩成浮在聊天输入卡旁的实时缩影。
- 一包一点,确定性力松弛星系排布;随当前会话的真实运行点亮;悬停浮现插件名片,双击打开完整查看页。
- 自由摆放(拖到任意位置,拖回卡片旁自动重新吸合)、自由调大小(视口是唯一上限)、按模块哈希的星野配色、深空底色滚轮随调(或在设置里调)。

**dsh 集成**
- 设置里的"插件拓扑"分区(自绘 Steam 式三节点导航图标),一键新标签页打开查看器,底色滑杆也在这里。
- "对话中询问":查看页里一键把"介绍这个插件"的问题发进一个未分组新会话——第一问由插件代发。

### 生而纯旁观

插件绝不写会话日志(不追加自定义事件类型)、绝不包装或拦截服务返回值、也不给自己的观察者加拓扑边。它展示的一切都读自宿主进程自己的信号——会话事件广播、状态变更、注册表回调、框架的服务读取扩展点。

## 为什么没别人守这层

| 层 | 项目 | 展示什么 |
|---|---|---|
| 配置 | [dsh-blueprint](https://www.npmjs.com/package/dsh-blueprint) | 启动配置 + overlay 校验 |
| 市场 | [zat-dsh-engine](https://github.com/mishibeikejie/zat-dsh-engine)、[dsh-desktop](https://github.com/anywhere-labs/dsh-desktop) | 安装 / 管理插件 |
| 会话 | [dsh-synapse](https://github.com/liangmianya/dsh-synapse)、dsh-flowglass | 对话画布、工具调用流 |
| **拓扑** | **dsh-schematic** | **插件之间如何接线** |

dsh 跑在 Cordis 上,而 Cordis 的论文[《A Programming Paradigm for Spatiotemporal Composability》](https://github.com/cordiverse/paper)证明了合流定理:无论系统在运行中如何重新接线,静止下来的状态永远等同于某次一次性静态组装。dsh-schematic 就是这一定理的界面——把运行中系统的静态等价视图画出来。

agent 已经有自己的"创造模式"(运行中检查、重挂插件的自改工具)。dsh-schematic 是给人用的同一个东西。

## 非目标

- 不做又一个大而全的市场——安装走官方 `dsh plugin` 机制,市场在这里只是图的供给侧面板;
- 不做 ComfyUI 式数据流画布——dsh 的组合是"插座与电线"的依赖注入,不是数据流,节点画布是错误的隐喻;
- 不做会话回放 UI——那一层属于 dsh-synapse 和 dsh-flowglass。

## 环境要求

- 带 web profile 的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)(基于 rc.8 开发)。
- 当前版本的 Chromium / Firefox / Safari(用到 `light-dark()`、`EventSource`)。
- Node ≥ 20 与 npm——只用于构建浏览器产物。

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

**从源码跑**(维护者;GitHub 仓库暂未公开):`npm install && npm run build` 之后,要么把源码目录软链到 profile 的 `node_modules/dsh-schematic`(按名字挂载;用包自带的 bundle 层或手动 insert 二选一,两者同时用会因 loader 条目 id 重复而整树报错),要么用现成示例 [`dev.cordis.yml`](dev.cordis.yml)——端口 3081,从 harness 源码启动(`node --import tsx/esm apps/cli/src/bin.ts --profile web --patch dev.cordis.yml`)。

## 使用

- **查看器**(`/schematic`)——点标签切换,或用 `?tab=journey|domains|table` 深链;`?expand=all` 一次展开全部分组;页头切换中/英。
- **星图**——拖动面板移到任意位置;拖右下角手柄调大小;面板上滚动滚轮调底色(0 = 全透明);悬停圆点看插件名片;双击打开全部展开的查看器。
- **设置** → "插件拓扑"——打开查看器;底色滑杆与滚轮双向实时同步。
- **对话中询问**——查看器里包的详情面板可一键把问题发进新会话,第一问代发。

## 工作原理

一个包,两半:

- **宿主半边**(`src/index.ts`、`src/activity/`、`src/graph.ts`)——一个 Cordis 插件:读 loader 的插件树,进程内订阅会话事件洪流、agent 状态、注册表回调、internal/get 服务读取瀑布,然后在 harness web 服务器上提供 `/schematic`(查看页)、`/schematic/events`(SSE)、`/schematic/mini.json`(轮询的缩影数据)。
- **浏览器半边**(`src/client/`,构建为 `dist/client.js`)——加载进 dsh 的 web SPA:贡献设置分区、替换导航图标、挂载输入卡旁的星图、处理"对话中询问"。独立查看页(`dist/engine.js`)自启动,只与上述宿主路由通信。

## 开发

```sh
npm run build    # esbuild 打包两个浏览器产物
```

`tools/scan.mjs` 从 harness 源码目录渲染静态图(v0.1 的纯静态方案,没有运行实例时仍然好用)。内部的定位与命名决策记录在 [`DECISIONS.md`](DECISIONS.md)。

## 路线图

- v0.3 — 组合编辑 + patch 预览
- v0.4 — 接缝感知市场面板

已交付的逐版本历史见[变更日志](CHANGELOG.zh.md)。

## 致谢

构建于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 与 [Cordis](https://github.com/cordiverse/cordis) 之上;Cordis [论文](https://github.com/cordiverse/paper)的合流定理,是实时接线图能被当作一张稳定原理图来读的原因。

## 许可

[MIT](LICENSE)
