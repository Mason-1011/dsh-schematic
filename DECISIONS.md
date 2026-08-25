# 决策记录

项目内部文档,记录做过的定位/命名决策与理由,避免结论漂移。日期均为 2026-08。

## D1 — 包名:`dsh-schematic`

- 候选淘汰史:`dsh-factory`(被活跃项目占用,且对方用法更符合 factory 本义)、`dsh-forge`(npm 抢注 + 5 个同名仓库)、`dsh-studio` / `dsh-architect`(npm 0.0.1 抢注)、`dsh-blueprint`(被活跃邻居占用)、`dsh-composer`(生态内 "composer" 已专指聊天输入框)、全称 `deepseek-harness-*`(破坏 `dsh-*` 命名约定,发现性打折)。
- 胜出理由:产品重心是"看懂并操作接线",schematic(接线图/原理图)精确命名了护城河;npm + GitHub 双空闲(2026-08-25 验证);`-builder` 后缀在生态内已开始泛化,不可独占。
- 语义分工:包名 schematic(拓扑)/ tagline 借 builder 语义 / 市场功能页未来可叫 Atlas。

## D2 — 定位:四层竞品地图中的"拓扑层"

配置层(dsh-blueprint)、市场层(zat-dsh-engine、dsh-desktop)、会话层(dsh-synapse、dsh-flowglass)均有人守,唯拓扑层空白。理论背书:Cordis 论文的合流定理保证"运行中系统的静态等价视图"存在,本产品把它画出来。叙事:agent 有 creative mode(自改工具),dsh-schematic 是人的 creative mode。

## D3 — 非目标

不做通用市场(安装走官方 `dsh plugin`,市场只是供给侧面板);不做 ComfyUI 数据流画布(DI 组合不是数据流,隐喻错);不做会话回放(synapse/flowglass 的地盘)。

## D4 — 构建顺序

静态拓扑(扫描仓库)→ 实时拓扑(挂载为插件读 loader)→ 组合编辑(patch 预览)→ 接缝感知市场。图数据一律从 loader/inventory 层取,不把 dsh 专属概念焊进内核——保留"可视化任何 Cordis 应用"的可能性。

## D5 — 工作约定

本仓库为独立兄弟仓库,与 deepseek-harness 主仓库互不推送;harness 远程一律不 push。npm 发布与 GitHub 仓库创建用 Mason-1011 凭据手动执行。
