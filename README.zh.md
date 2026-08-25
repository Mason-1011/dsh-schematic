# dsh-schematic

> 读懂——并亲手改写——你的 DeepSeek Harness 的接线。

🚧 早期开发中。当前版本仅占位名称;首个功能版本 v0.1 开发中。

## 这是什么

DeepSeek Harness(dsh)用插件拼出整个 agent 产品:每一项能力——模型适配器、工具注册表、乃至主循环本身——都通过服务、`inject` 依赖、类型化事件和可逆效应,挂到一个共享的 Cordis 上下文上。

这些接线方式只存在于运行中的进程里。`dsh-schematic` 把它画出来。

- **拓扑视图**——已挂载插件的交互式接线图:谁提供 `ctx.fs`、谁注入它、事件在哪些插件之间流动、每条能力接缝在哪。只读、零风险,数据来自 loader 自己的插件树。
- **组合工作台**——编辑接线:换 provider(本机 → 沙箱 → 远程)、启停插件、组装 preset。改动先预览、先校验,再应用。
- **接缝感知市场**——点一个空着的接缝,看到能填它的插件,直接装到图上。冲突(同键重复注册、缺失 provider)在安装前浮现,而不是装完崩溃。

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

## 路线图

- v0.0.x — 占位名称、定位文档(当前)
- v0.1 — 静态拓扑:扫描 harness 仓库,从 `inject` 声明渲染插件依赖图
- v0.2 — 实时拓扑:作为插件挂载,运行时读取 loader / 插件清单
- v0.3 — 组合编辑 + patch 预览
- v0.4 — 接缝感知市场面板

## 安装

尚未发布功能版本。v0.1 发布后:

```sh
dsh plugin add dsh-schematic
```

## 许可

[MIT](LICENSE)
