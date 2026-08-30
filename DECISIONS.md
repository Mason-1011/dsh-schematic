# 决策记录

项目内部文档,记录做过的定位/命名决策与理由,避免结论漂移。日期均为 2026-08。

## D1 — 包名:`dsh-schematic`

- 候选淘汰史:`dsh-factory`(被活跃项目占用,且对方用法更符合 factory 本义)、`dsh-forge`(npm 抢注 + 5 个同名仓库)、`dsh-studio` / `dsh-architect`(npm 0.0.1 抢注)、`dsh-blueprint`(被活跃邻居占用)、`dsh-composer`(生态内 "composer" 已专指聊天输入框)、全称 `deepseek-harness-*`(破坏 `dsh-*` 命名约定,发现性打折)。
- 胜出理由:产品重心是"看懂并操作接线",schematic(接线图/原理图)精确命名了护城河;npm + GitHub 双空闲(2026-08-25 验证);`-builder` 后缀在生态内已开始泛化,不可独占。
- 语义分工:包名 schematic(拓扑)/ tagline 借 builder 语义 / 市场功能页未来可叫 Atlas。

## D2 — 定位:四层竞品地图中的"拓扑层"

配置层(dsh-blueprint)、市场层(zat-dsh-engine、dsh-desktop)、会话层(dsh-synapse、dsh-flowglass)均有人守。2026-08 复查:启停/装卸已被 ≥5 个工具做烂,dsh-blueprint v0.6.0 起也写受管块 overlay(预览令牌+409+备份)——"拓扑层空白"不再成立。真正的空白是**结构感知的组合编辑**:在活图上按接缝换提供方、改条目配置、看幽灵预览。定差异位为一句话:**图就是编辑器**。理论背书不变:Cordis 论文的合流定理保证"运行中系统的静态等价视图"存在,本产品把它画出来并让它可编辑。叙事:agent 有 creative mode(自改工具),dsh-schematic 是人的 creative mode。

## D3 — 非目标

不做通用市场(安装走官方 `dsh plugin`,市场只是供给侧面板);不做 ComfyUI 数据流画布(DI 组合不是数据流,隐喻错);不做会话回放(synapse/flowglass 的地盘)。

## D4 — 构建顺序

静态拓扑(扫描仓库)→ 实时拓扑(挂载为插件读 loader)→ 组合编辑(patch 预览)→ 接缝感知市场。图数据一律从 loader/inventory 层取,不把 dsh 专属概念焊进内核——保留"可视化任何 Cordis 应用"的可能性。

## D5 — 工作约定

本仓库为独立兄弟仓库,与 deepseek-harness 主仓库互不推送;harness 远程一律不 push。npm 发布与 GitHub 仓库创建用 Mason-1011 凭据手动执行。

## D6 — v0.3 组合编辑机制(2026-08-30)

- **写入面**:只写 profile 用户层 `cordis.patch.yml` 里 `# >>> dsh-schematic v1` / `# <<< dsh-schematic v1` 围出的受管块——标记外字节逐字保留,应用=备份→拼接→校验→原子写,吃 harness 自带 watchUserPatches 热重载(约 1–2 秒生效,失败保旧树)。不碰根 cordis.yml、bundle 层、`dsh.profile.bundles`(那是 `dsh plugin` 命令的专属面)。
- **为什么不是别的**:RPC 面没有组合编辑入口("文件是唯一的组合编辑器",官方刻意);`ctx.loader.create/update` 未文档化且不落盘;dynamicCordisRunner 是会话内存态,与组合正交。
- **校验即应用前干跑**:进程内调用 dsh-app-boot 的 composeEntries(与 boot 完全等价);harness 拒绝(如双注册服务键)时旧树保持,失败横幅+一键回滚。
- **依赖零新增**:js-yaml / cordis-plugin-include / dsh-app-boot 从 profile 锚点 createRequire 解析,package.json 只声明 peerDependencies。
- **诚实边界进文案**:幽灵新增模块的 provides/inject 要 import 才知道(虚线+`?`);消费方崩溃还是降级是插件自身逻辑,不算得出。
- preset 推 v0.4 与市场合流;装新包不进应用回路,只提示 `dsh plugin add` 命令文本。
