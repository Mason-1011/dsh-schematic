# dsh-schematic

> 同时面向人类与 Agent 的 DeepSeek Harness 控制面。

[![npm](https://img.shields.io/npm/v/dsh-schematic.svg)](https://www.npmjs.com/package/dsh-schematic)
[![CI](https://github.com/Mason-1011/dsh-schematic/actions/workflows/ci.yml/badge.svg)](https://github.com/Mason-1011/dsh-schematic/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Built for DeepSeek Harness](https://img.shields.io/badge/DeepSeek_Harness-plugin-4f46e5)](https://github.com/deepseek-ai/deepseek-harness)

[English](README.md) · **简体中文**

你的 Agent 不是黑盒。它是一张由模型、工具、记忆、安全策略、工作流和服务接线组成的实时网络。人需要看见并塑造它，Agent 也需要安全、结构化地操作它。

**dsh-schematic 让人类和 Agent 共用同一套控制面。** 人类使用全屏可视化工作区，Agent 通过 dsh 原生工具完成同样的持久化操作；双方共享实时状态、校验规则、变更预览、备份和受保护写入管线。

```sh
dsh plugin --profile web add dsh-schematic
dsh web
# 打开 http://127.0.0.1:3080/schematic
```

![dsh-schematic 的实时插件拓扑与组合工作台](docs/assets/dsh-schematic-demo.gif)

## 一套系统，两类操作者

| 人类操作者 | Agent 操作者 | 共同底座 |
| --- | --- | --- |
| 可视化探索拓扑、编辑蓝图、编排活动，并逐项审查改动。 | 在对话中通过 `schematic_*` 工具检查、组合、切换、整理和恢复。 | 同一张运行图、同一组存储、同一套校验与安全边界。 |

界面里每个会持久化的操作，都有对应的模型操作能力。这不是另一套“AI 自动化模式”：人和 Agent 可以随时接力，不需要在两种配置体系之间翻译意图。

## 三个工作区，回答三个问题

| 工作区 | 它回答什么 | 你可以做什么 |
| --- | --- | --- |
| **系统** | 我的 Agent 此刻到底由什么组成？ | 浏览实时拓扑或组件清单，检查依赖，配置、启停插件，并替换能力提供方。 |
| **蓝图** | 如何让这套组合可复用？ | 按能力组装，自动保存本地草稿，导入/导出 YAML，查看偏离，并安全切换整套插件组合。 |
| **活动** | 刚才发生了什么，是谁做的？ | 跟随会话事件与请求 Journey，按自己的理解编排信号分组与主/旁路，过滤噪声并检查失败或耗时。 |

它既是可观测控制台，也是组合工作台：先把系统看明白，再动手改变它。

## 为什么它不太一样

- **图就是操作界面。** 选中节点或接缝就能原地处理，不必在几份互不相干的 YAML 里来回寻宝。
- **活动跟着责任方走。** 模型调用、工具执行、工作流、注册表变化和失败都会归因到真正负责的插件。
- **蓝图描述能力，不保存脆弱快照。** 保存成员正列表，明确处理后来出现的插件，并单独决定蓝图是否搭载 Schematic。
- **每个危险改动都必须先接受审查。** 写入前展示结构警告、成员差异以及受管块的精确 YAML。
- **高压下也保持可读。** 事件风暴合并为计数行，内部 service-read 噪声被过滤，动画遵守 `prefers-reduced-motion`。
- **中英文都是一等公民。** 插件描述通过宿主配置的模型路由翻译，标识符始终保持原样。
- **人类操作与 Agent 操作保持对称。** 界面和 `schematic_*` 工具共享计划、校验、确认门槛、备份与陈旧状态保护。

## 改接线，不靠祈祷

所有写操作都走同一条受保护管线：

```text
选择改动 → 计算差异 → 组合干跑 → 审查警告
        → 备份完整 patch → 原子写入 → 验证热重载
        → 成功，或自动回滚
```

Schematic 只写当前 profile `cordis.patch.yml` 中标记清楚的受管块，以及 `~/.dsh/schematic/` 下属于自己的数据。它不会改写 bundle 层、manifest、会话日志或 profile 根配置。待应用期间源文件如果发生变化，写入会立即停止，绝不覆盖。

编辑默认关闭，也可以通过 `config.edit.enabled=false` 完全禁用。视口窄于 768 px 时三个工作区仍可浏览，但所有写操作都会禁用并解释原因。

## 经得住现实变化的蓝图

蓝图不是整棵插件树的冻结副本。它记录你想要的可选成员、成员配置、保存时见过的世界，以及是否继续搭载 Schematic。

因此，Harness 升级后蓝图也不会轻易报废：

- 新插件会成为未管理项，必须明确选择**保持 / 停用 / 纳入**；
- id 改绑或包名变化只会报告，不会暗中修改；
- 成员包缺失时拒绝整次切换，并给出安装命令；
- 受保护核心不进入成员列表，只有专用的 Schematic 搭载开关是明确例外；
- 偏离状态复用切换时的同一份物化计划，因此“当前”真的意味着已经无事可做。

蓝图以可读的 schema-2 YAML 存在 `~/.dsh/schematic/blueprints/`。旧 schema-1 预设会幂等迁移，原文件完整保留为只读备份。

## Agent 使用的是同一套控制面

启用编辑后，dsh-schematic 会注册覆盖网页持久化操作的模型工具；活动编排工具始终可用：

- `schematic_plugins`——检查组合树和可用能力；
- `schematic_blueprint_list`——列出蓝图和当前偏离；
- `schematic_blueprint_save` / `schematic_blueprint_switch`——组建、保存、预览、备份并安全切换；
- `schematic_blueprint_manage`——查看、复制、重命名、更新、导入导出、纳入未管理项或删除；
- `schematic_system_compose`——查看、预览、应用、回滚或清理当前系统组合变更；
- `schematic_activity_layout`——通过对话协作编排活动分组、顺序、主/旁路、说明、颜色与插件归属。

于是，“帮我保存一套精简的编程配置，切过去，再按职责整理运行信号”可以是一句对话，而不是一次配置文件考古。Agent 可以先检查、展示与人类界面相同的预览，在必要时请求确认，最后把结果留在界面中供人继续审查。

<details>
<summary><strong>展开查看完整能力</strong></summary>

### 实时拓扑

- 可缩放、平移、聚类的依赖图，直接读取 loader 正在运行的插件树。
- 拓扑与组件清单共用搜索、能力筛选和状态筛选。
- 上下文面板集中展示状态、能力、依赖、来源、近期活动、配置、提供方替换和蓝图归属。
- 内部 fiber 失败会传导到可见插件单元，系统稳定后自动恢复。
- 输入框旁提供可拖动、缩放的星图，真实 service access 会点亮消费方 → 提供方路径。

### 运行时活动

- 跟随会话的实时事件、subagent/后台筛选、请求 Journey、历史回放和插件统计。
- 对模型回复、工具调用、工作流、宿主动作、注册表变化、后台任务和失败进行责任归因。
- 计数行合并与尾随归属重建，避免宿主事件突发把观察器本身变成性能热点。

### 组合工作台

- 在上下文中启停插件、编辑配置、替换接缝提供方。
- 图上幽灵预览、逐条目差异、精确 YAML 行差异和结构感知警告。
- Harness 原生干跑、时间戳备份、原子受管块写入、热重载验证与回滚。
- 亮暗主题、语义化控件、键盘操作、可见焦点、ARIA 与减少动画支持。

</details>

## 环境要求

| 组件 | 支持范围 |
| --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | `>=0.1.0-rc.8`，web profile |
| `@deepseek-ai/cordis` | `^4.0.1` |
| `@deepseek-ai/cordis-plugin-include` | `^1.0.6` |
| 浏览器 | 当前版本 Chromium、Firefox 或 Safari |
| Node.js | 从源码构建时需要 `>=22.19`；CI 覆盖 Node 22 与 24 |

## 安装与更新

这个包本身就是 dsh bundle，官方插件命令会同时安装依赖并注册到指定 profile：

```sh
# 安装
dsh plugin --profile web add dsh-schematic

# 更新
dsh plugin --profile web update dsh-schematic

# 移除
dsh plugin --profile web remove dsh-schematic
```

安装后重启 profile，打开 `/schematic`。设置中还会出现**插件拓扑**入口，聊天输入框旁也会挂载实时星图。其他 profile 只需替换命令中的 profile 名称。

## 架构

一个 npm 包里包含互相配合的两部分：

- **宿主插件**——读取 Cordis loader 树，订阅运行时活动，提供实时图和 SSE/JSON 接口，注册蓝图工具，并持有受保护的组合写入管线。
- **浏览器应用**——独立的「系统 / 蓝图 / 活动」界面，加上设置集成和输入框旁星图。前端不依赖运行时框架，发布 bundle 由 esbuild 构建。

这里画的是依赖注入拓扑，不是数据流。它展示运行中 Cordis 系统稳定后的静态等价结构——也是 Cordis 论文 [*A Programming Paradigm for Spatiotemporal Composability*](https://github.com/cordiverse/paper) 中 resting-state 结论的实际界面。

## 开发

```sh
npm install
npm run check
```

`npm run check` 会执行 TypeScript 校验、Node 测试和全部生产构建。缺陷报告与 PR 约定见 [CONTRIBUTING.md](CONTRIBUTING.md)，逐版本历史见 [CHANGELOG.zh.md](CHANGELOG.zh.md)。

## 路线图

- 接缝感知的供给侧面板：从需要能力的位置发现可用提供方。
- 蓝图成员缺失时的安装交接。
- 更深入的活动查询，但不会把 Schematic 做成对话回放产品。

如果 dsh-schematic 让你的 Agent 更容易理解、调试或信任，欢迎给仓库一个 ⭐。这会帮助更多 DeepSeek Harness 开发者发现它。

## 许可

[MIT](LICENSE)
