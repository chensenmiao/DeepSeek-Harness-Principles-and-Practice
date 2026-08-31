# 实战-PluginBuilder预设与需求驱动开发

> ← [dsh-open-editor 实战](08-实战-dsh-open-editor插件开发全过程.md) | [目录](README.md) | [高级能力](10-高级能力.md) →

> **参考文档：**
> - [../.agent-presets/plugin-builder/](../.agent-presets/plugin-builder/) — 本案例源码目录
> - [../.agent-presets/plugin-builder/agent.cordis.yml](../.agent-presets/plugin-builder/agent.cordis.yml) — 预设配置完整源码
> - [../.agent-presets/plugin-builder/skills/cordis-plugin-development/SKILL.md](../.agent-presets/plugin-builder/skills/cordis-plugin-development/SKILL.md) — 插件开发技能
> - [../.agent-presets/plugin-builder/skills/editing-cordis-compositions/SKILL.md](../.agent-presets/plugin-builder/skills/editing-cordis-compositions/SKILL.md) — 编写组合技能
> - [../docs/subsystems/subagent.zh.md](../docs/subsystems/subagent.zh.md) — 子智能体
> - [../docs/subsystems/skills.zh.md](../docs/subsystems/skills.zh.md) — 技能系统
---

## 9.1 Agent Preset 是什么

先快速回顾：Agent Preset 是一个智能体的配置模板。

在 Harness 中，一个"智能体"不是一个固定的二进制——它是组合出来的。创建会话时，你选择一个 Preset，这个 Preset 决定了三件事：
- 这个 AI 助手是什么角色（persona）
- 它能用哪些工具
- 它遵守什么行为规则

### Preset 的文件结构

一个 Preset 就是文件系统中的一个目录，位于 `$DSH_HOME/.agent-presets/<id>/` 下（$DSH_HOME一般是用户目录下.dsh文件夹）：

```
.agent-presets/plugin-builder/
├── preset.yml                    # 元数据（名称、描述）
├── agent.cordis.yml              # 插件组合文件（核心配置）
└── skills/
    ├── cordis-plugin-development/
    │   └── SKILL.md              # 插件开发技能
    └── editing-cordis-compositions/
        └── SKILL.md              # 编写 Preset 的技能
```

三个文件分别回答三个问题：
- **preset.yml**：这个预设叫什么、用来干什么（展示在预设选择器中）
- **agent.cordis.yml**：这个助手拥有哪些能力（工具、技能、提示词等的完整组合）
- **skills/***：按需加载的知识和规范（AI 在需要时才读取的技能文件，不占用上下文预算）

### 为什么要做 Preset

没有 Preset，每个会话都是一样的助手——同样的工具、同样的人格、同样的行为模式。Preset 让你能做到：

1. **角色隔离**：一个会话是"代码审查助手"，另一个是"数据分析师"，它们看到的工具集完全不同
2. **行为定制**：通过 persona 提示词强制工作流（比如"不写文档不准写代码"）
3. **工具裁剪**：数据分析预设不需要 Shell 工具，代码审查预设不需要网络搜索

### 安装位置和选择

安装预设只需要把目录放到 `$DSH_HOME/.agent-presets/` 下。重新打开 Harness Web UI，创建新会话时就能在预设选择器中看到它。

> **为什么放在用户目录而不是部署目录？** 部署目录下的预设是随 Harness 发布的，每次升级会被覆盖。你自己的预设放在用户目录，属于你自己，不会丢失也不会被升级冲掉。

## 9.2 Plugin Builder Preset 的设计

Plugin Builder 预设是为一个非常具体的场景设计的：**让 AI 助手帮你写 Harness 插件**。

### 为什么需要专门的预设

你可能会说："让 AI 直接写插件不就好了？"

在第 3-7 章你可能会这么做。但面向生产环境的插件开发有几个痛点：

- AI 容易闭门造车——它可能猜测 API 签名而不是去查运行时
- AI 喜欢跳过需求沟通——用户的模糊需求被直接转化为代码，结果完全不对
- AI 没有工作流意识——它不知道写插件需要 inspect、define、run、验证这几个步骤
- 多个 AI 会话互相干扰——一个会话定义的插件被另一个会话意外停止

Plugin Builder 就是为了解决这些问题而生的。

### 从哪里来：从 `cordis` 预设复制

Plugin Builder 不是从零写的。它是从名为 `cordis` 的预设复制后修改得到的。

`cordis` 预设是 Harness 自带的、具备完整工具集和 model 能力的预设——包含 Shell 工具、文件系统工具、子代理、工作流引擎等一切能力。Plugin Builder 继承了所有这些能力，在此之上增加了：

1. 一个强制需求文档流程的 persona
2. 一组 Cordis 自检和插件管理工具（`tool-cordis` 工具集）
3. 两个技能文件（插件开发规范和 Preset 编写规范）

为什么要抄而不是自己写？因为"能做插件开发的助手"和"能做任何编程任务的助手"之间的区别不在工具集上——区别在于行为约束和工作流。你能用 C 语言写 Web 服务器，但更好的做法是用框架。从 `cordis` 复制后修改，相当于用了一个成熟的框架，而不是从裸机开始。

### 核心能力

Plugin Builder 预设提供了四个核心能力层次：

1. **运行时检查**——通过 `cordis_inspect_list` 和 `cordis_inspect_query` 查询当前运行时的服务、事件、槽位、工具签名。AI 不猜 API，它直接读运行时的真实接口。
2. **动态插件实验**——通过 `cordis_define`、`cordis_run`、`cordis_stop`、`cordis_undefine` 在正在运行的 Harness 实例上动态定义、运行、停止、删除插件。不需要重启，不需要修改部署文件。
3. **需求文档流程强制**——persona 中嵌入了五步流程，AI 在选择这个预设后，必须遵循"先写文档、确认后再实现"的工作流。
4. **技能辅助**——两个技能文件在 AI 需要时提供详细的开发规范和 Preset 编写指南。

### 两平面规则在预设设计中的应用

第 3 章提到的"两平面规则"（Host 组合 vs Agent 预设）在 Plugin Builder 中体现得非常清晰。

在 `agent.cordis.yml` 中，有些行属于 Host 平面，有些属于预设平面：

- **Host 平面**：Shell 工具（`tool-bash`、`tool-pwsh`）、文件系统工具（`tool-fs`、`tool-fs-search`）、后台作业控制（`tool-jobs`）、目标管理（`tool-goal`）。这些工具注册到全局工具注册表，对所有会话可见。
- **预设平面**：Persona 配置、Cordis 自检工具集（`tool-cordis`）、技能加载工具（`tool-skill`）。这些只在这个会话中生效。
- **隔离域**：计划模式（`planMode`）、压缩策略（`compaction`）、工作流引擎（`workflowEngine`）放置在有 `isolate` 域的 group 中，为每个会话创建独立的服务实例。

判断一行属于哪个平面的规则很简单：**如果这个服务有其他会话的消费者，它就属于 Host 平面；如果只有本会话需要它，它就在预设平面。**

`agent.cordis.yml:26-27` 的 persona 配置把这条规则讲得很清楚：

> A row that publishes a service belongs in the host composition, or inside an `isolate` realm if the preset genuinely owns that service and nothing outside one agent reads it.

## 9.3 需求文档驱动的插件开发流程

Plugin Builder 预设最核心的设计不是工具集，而是**它让 AI 承担了一个"负责任的工程师"角色**。这个角色通过 persona 中嵌入的**五步流程**来强制。

### 五步流程

persona 配置（`agent.cordis.yml:33-42`）包含了以下内容。这是 AI 在 plugin-builder 模式下工作时的行为准则：

**第一步：需求沟通**

AI 不能直接开始写代码。它必须先与用户交流，了解：

- 插件要解决什么问题
- 目标平台是什么（Host / Client / 两者）
- 需要的能力是什么（Service / Event / Slot / Tool / 主题）
- 生命周期是什么（临时运行时扩展还是持久能力）
- 验收标准是什么

AI 用 `ask_user_question` 工具提出明确问题，直到需求清晰。

**第二步：规范核对**

需求明确后，AI 加载 `cordis-plugin-development` 技能文件。这个技能文件告诉 AI：

- 怎么用 `cordis_inspect_list` 和 `cordis_inspect_query` 查询运行时接口
- 每个 API 的确切签名和用法
- 编写插件的规范和约束

AI 用 inspect 工具核对插件要依赖的每个 Service、Event、Builtin、Slot、主题 token 或 Tool 的确切签名，确认需求符合插件编写规范。

**第三步：编写需求文档**

AI 将需求整理为结构化文档，包含：

- 背景与目标
- 功能需求
- 平台选择（Host / Client / 两者）
- 涉及的服务、事件、槽位、工具列表
- 接口设计
- 边界情况与失败模式
- 验收标准
- 假设

文档是结构化、可评审的。AI 把完整的文档呈现给用户。

**第四步：用户确认**

AI 等待用户明确同意需求文档。用户提出修改意见时，AI 更新需求文档并再次提交确认。用户拒绝时，AI 不进入实现。

**第五步：实现**

仅在用户同意需求文档后，AI 才按技能文件和需求文档进行实现：`cordis_define` → `cordis_run` → 处理审批与异步结果 → 必要时 `cordis_stop` / `cordis_undefine`。

### 为什么需要这样的流程

你可能觉得这太繁琐了。但想想没有这个流程会发生什么：

- 用户说"帮我写个插件"，AI 直接动手写——然后用户说"不，我不是这个意思"
- AI 猜了一个 API 签名——结果运行时签名不匹配，白写
- 用户说"实现这个功能"——AI 实现了，但用户其实只想要一个初步方案先看看
- 多个需求混在一起——AI 做了 A 和 B，但用户只想要 A

需求文档流程解决了这些问题：

1. **避免盲目编码**：先确认"做什么"，再确认"怎么做"。两个问题分开决策。
2. **确保质量**：inspect 查询保证了代码和运行时一致，不靠猜测。
3. **建立共识**：需求文档是用户和 AI 之间的契约，双方同意了再动工。
4. **提供回退依据**：如果实现走偏了，可以回到需求文档说"这个和需求不一致"。

### 缩短流程的条件

Persona 也允许一种例外情况：**如果用户需求本身已经非常明确并直接给出了完整需求**，第 1 步（需求沟通）可以缩短。但即使如此，AI 仍然必须产出需求文档并取得用户明确同意后才能进入实现。实现过程中若需求发生变化，AI 回到第 3-4 步更新需求文档并重新确认。

### 看 persona 配置

这个流程是怎么写入 AI 的行为的？很简单——通过 persona 配置：

```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: |-
      You are a coding agent powered by the {{model}} model...

      ## 插件需求文档流程（强制）

      本模式是插件制作模式。当用户请求创建插件（或修改、扩展插件）时，必须先完成需求文档流程，之后才能进入实现：

      1. 需求沟通：先与用户交流...
      2. 规范核对：加载 `cordis-plugin-development` 技能...
      3. 编写需求文档：将需求整理为结构化需求文档...
      4. 用户确认：等待用户明确同意需求文档...
      5. 实现：仅在用户同意需求文档后...
```

Persona 文本就是系统提示词的一部分。这些规则对 AI 来说是硬约束——不是因为代码强制的，而是因为 AI 会按照提示词行事。这不是技术上的强制，而是**工作流设计上的强制**。

## 9.4 独占性设计分析

Plugin Builder 预设中有一个隐含但重要的问题：**为什么不能有两个聊天框同时使用 Plugin Builder？**

### 问题观察

Harness 允许你打开多个会话。每个会话可以选不同的预设。如果你打开两个会话，两个都选 Plugin Builder，会怎样？

答案是：**会互相干扰**。

一个会话定义的插件可能被另一个会话意外停止。一个会话的 `cordis_inspect_query` 结果可能因为另一个会话的动态修改而失效。

### 技术原因

Plugin Builder 使用的 `tool-cordis` 工具集修改的是**正在运行的 Harness 实例的状态**：

| 工具 | 作用 | 影响范围 |
|---|---|---|
| `cordis_define` | 定义新插件 | 全局注册表 |
| `cordis_run` | 运行插件 | 全局运行时 |
| `cordis_stop` | 停止插件 | 全局运行时 |
| `cordis_undefine` | 删除插件定义 | 全局注册表 |

这些工具的操作对象是同一个运行时实例。当会话 A 定义了一个叫 `my-plugin` 的插件，会话 B 调用 `cordis_undefine` 时——即使 B 想删的是自己定义的 `another-plugin`——A 的插件仍然可能受到影响，因为 `cordis_undefine` 也可能被错误调用。

### 设计决策，不是技术限制

这是一个重要的认知点：**独占性不是技术限制，而是工作流设计决策**。

技术上可以让 `tool-cordis` 的每个操作用 session ID 来隔离——让一个会话看不到另一个会话定义的插件。但这是否值得？

从设计角度看，独占性有它的合理性：

1. **反馈路径清晰**：你在这个会话里定义、运行、看到结果。如果另一个会话同时操作同一个运行时，错误反馈会变得混乱——"这个错误是我的操作导致的还是另一个人的？"
2. **调试难度降低**：共享运行时状态下，非确定性问题会成倍增加。独占让每个会话的因果关系保持简单。
3. **插件开发的"创作"属性**：写插件本质上是一种创作活动——你创造、测试、修改、迭代。创作需要专注和隔离，就像你不会让两个人同时编辑同一个文件。

这不是说"共享永远不好"。当你做数据分析时，多个会话共享同一个数据集是有价值的。但插件开发不同——你操作的是运行时状态，不是只读数据。

选择独占性就意味着——**如果你需要同时在两个上下文中测试插件**，你应该在一个会话中完成测试后再切换到另一个，或者使用不同的预设。设计决策应该和场景匹配，而不是追求"更多并发"。

### agent.cordis.yml 中的独占性体现

在 `agent.cordis.yml` 中，`tool-cordis` 这一行没有任何 `isolate` 域配置：

```yaml
- id: tool-cordis
  name: '@deepseek-ai/dsh-tool-cordis'
```

它直接注册在预设的根作用域中，作用于全局运行时。这本身就是设计选择——如果它应该被隔离，就会放在 `isolate` 域中。但不放，因为它的语义就是"操作全局运行时"。

## 9.5 cordis-plugin-development 技能详解

技能文件（SKILL.md）是一个 YAML frontmatter + Markdown 的文件。AI 在需要时通过 `tool-skill` 工具加载它。

Plugin Builder 预设通过以下配置加载技能文件：

```yaml
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    customSkillDirs:
      - !!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"
```

这告诉 Harness：这个预设的 `skills/` 目录下包含按需加载的技能文件。`baseUrl` 是预设目录的位置，所以无论预设安装在哪里都能正确解析。

### 技能文件的结构

`cordis-plugin-development/SKILL.md` 开头是 YAML frontmatter：

```yaml
---
name: cordis-plugin-development
description: Create, modify, debug, or extend dynamic Cordis Plugins...
---
```

技能文件的 YAML frontmatter 只包含 `name` 和 `description`。`name` 是 AI 通过 `tool-skill` 搜索时的关键词，`description` 告诉 AI 这个技能用于什么场景。

### 标准开发工作流

技能文件定义了写插件的标准步骤。以下是从文件中提取的核心工作流：

1. **inspect_list**：调用 `cordis_inspect_list` 获取当前 Host 和 Client 上的所有 Provider、方法和 schema。这一步是冷启动——不假设任何 API 签名的知识。
2. **inspect_query**：选择最小的一组 `cordis_inspect_query` 调用，精确读取实现会用到的 Service、Event、Builtin、Slot、主题 token 或 Tool。
3. **define**：编写纯 JavaScript 代码，然后调用 `cordis_define` 定义新的 Package。
4. **run**：调用 `cordis_run` 激活 Package。

技能文件中写得很清楚：不等待同一轮次中的用户审批或浏览器异步结果。`cordis_run` 返回 `awaiting-approval` 或 `starting` 后，AI 结束当前的工具调用流程，等待系统通过状态更新报告最终结果。

### 平台选择

技能文件用一个表格指导 AI 如何选择平台：

| 需求 | 首选平台 | 先检查的内容 |
|---|---|---|
| 文件、命令、进程、网络 | Host | fs、bash、subprocess 等服务 |
| 智能体、会话数据、Host 生命周期 | Host | 相关 Service 和 Event |
| 注册动态 Tool | Host | Builtin 中的 harness，以及 Tool 列表 |
| 页面主题、布局 | Client | Theme token 和 Client 服务 |
| 设置页面、侧边栏、输入区域 | Client | Slot 子树 |

原则是：尽量靠近数据所有者。如果 Slot props 已经提供了对话快照，就不要通过 Host 再取一次。

### Provider 导航

技能文件详细描述了如何导航 Cordis 的 Provider 体系：

- **Service**：`Service.listService`+ `service` 参数查询具体方法的签名、访问规则和参数/返回值
- **Event**：`Event.listEvents` 列出所有事件及调度模式，查询具体事件的 listener 签名
- **Builtin**：`Builtin.listBuiltins` 列出语言内置符号（如 `harness`），这些不能通过 `ctx.get()` 获得
- **Slots**：`Slots.listSubTree` 获取槽位树，每个槽位的用途、类型、作用域、注册键、替换风险
- **Theme**：`Theme.listTokens` 获取主题 token
- **Tool**：`Tool.listTools` 获取当前智能体可见的工具 schema

这些 Provider 的名字和方法必须来自 `cordis_inspect_list` 的结果，不能猜测。

### 执行环境约束

代码运行在特定环境中，有明确的约束：

```js
// 正确：纯 JavaScript，不使用 JSX
return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    slots.inject('tool.view.cordis', () => slots.register(
      { name: 'tool.view.cordis', key: 'self' },
      () => React.createElement('div', null, 'Hello'),
    ))
  },
}
```

**不能用的东西：**
- `import`、`require`、TypeScript、JSX、装饰器
- 未通过 `Builtin.listBuiltins` 确认的全局变量
- 猜测的 `window`、`document`、`process`、`Buffer`、`fetch`

Client 侧的 React 代码必须用 `React.createElement(...)`，不能用 JSX。

### 存取服务

技能文件强调了 `ctx.get()` 和 `inject` 的区别：

- **`ctx.get(name)`**：默认方式，读取可选能力。返回 `undefined` 时优雅处理。
- **`inject: ['requiredService']`**：在服务是硬依赖且插件必须在服务出现后才能激活时使用。

```js
// 推荐：ctx.get() + 存在性检查
return {
  apply(ctx) {
    const service = ctx.get('serviceName')
    if (service === undefined) return
    service.someMethod()
  },
}

// 硬依赖：inject
return {
  inject: ['requiredService'],
  apply(ctx) {
    ctx.requiredService.someMethod()
  },
}
```

不要因为懒写 `undefined` 检查就用 `inject`。Guard 会拒绝未声明的依赖访问。

### 副作用管理

每个贡献（事件监听器、Service 订阅、UI 注册）在插件停止、更新或删除时必须被移除：

```js
return {
  apply(ctx) {
    const service = ctx.get('serviceName')
    if (service === undefined) return
    ctx.effect(() => service.subscribe((value) => {
      console.log(value)
    }))
  },
}
```

`ctx.effect()` 接收一个返回 disposer 的函数。插件停止时自动调用所有 disposer。

### 版本管理与审批

技能文件详细描述了版本模型：

- **Plugin**：由 `pluginId` 标识的稳定实例
- **Package**：由 `packageId` 标识的不可变代码版本
- **pluginRunId**：每次激活尝试的唯一 ID

选择 `cordis_run` 模式：

| 当前状态 | 目标 | mode |
|---|---|---|
| 无当前版本 | Plugin 下任意 Package | `run` |
| 有当前版本 | 同一个 Package | `run` |
| 有当前版本 | 不同 Package | `update` |
| Update 失败 | `nextPackageId` | `update` 重试 |
| Update 失败 | `currentPackageId` | `run` 回滚 |

失败后：先 inspect 读取源码和诊断，修正后定义新的 Package（不覆盖失败的那个），再用正确的 mode 运行。

## 9.6 editing-cordis-compositions 技能详解

第二个技能文件用于一个不同的场景：编写和验证 Agent Preset 本身。

### 两平面决定规则

这个技能文件非常详细地阐述了"两平面规则"的决定方法。规则的核心不是"感觉上像什么东西"——而是**"是否必须被共享"**。

**Host 组合**包含：
- 注册表本身（`tools`、`systemPrompt`、`agents`、`sessions`）
- 跨会话的能力（持久化、会话查询、存储、设置、凭证、遥测）
- 沙箱、审批、权限系统
- 模型路由
- 子代理注册表和 spawn/fork 后端

**Agent 预设**包含：
- 当前会话贡献给这些注册表的能力：工具插件、persona、prompt sections
- 压缩策略

**最核心的规则**：如果一个服务的消费者在 Agent 平面之外，它就不能移进预设。

`editing-cordis-compositions/SKILL.md:24` 用 `subagents` 作为实例解释了这一点：

> `subagents` is the worked example: the registry answers cross-session queries for the host api-proxy, so a per-session copy both starves that host row — it waits forever for a service nothing provides — and collides on the second session, since a provider name registers once. The preset contributes the delegation *tools*; the registry and its backends stay host-side.

翻译过来：子代理注册表为 Host 的 api-proxy 服务跨会话查询。如果把它放进预设，第一个会话没有注册表可用（因为 Host 在等一个不存在的服务），第二个会话试图注册同名 provider 时会冲突。预设贡献的是**使用注册表的工具**，而不是注册表本身。

### 编写 Preset 的标准步骤

技能定义了一套标准步骤：

1. **从 copy 开始**：用 `ctx.agentPresets.copy(from, id, name?)` 复制整个预设目录。不要用手动复制——`copy()` 会自动验证 id 格式、检查冲突、回滚失败、正确放置到用户根目录。

2. **编辑 preset.yml 的 description**：`copy()` 保留了源预设的 description，但你可能需要改。description 展示在预设选择器中。

3. **编辑 agent.cordis.yml**：逐行编辑，记住两平面规则和隔离域规则。

4. **挂载验证**：用 `standingKeyFor(id)` 挂载验证。它会真实编译并挂载预设的插件子树，检测四类错误：
   - 包未解析（`Cannot find package …`）
   - 配置无效（`invalid config`）
   - 行未激活（`waiting for <service>`）
   - 服务发布到根 realm

5. **交给用户真实会话测试**：`standingKeyFor` 只验证挂载，不验证 AI 行为。只有真实会话才能显示预设产生的工具列表和提示内容。

### realm 隔离规则

最常犯的错误在 realm 隔离上。

规则：**发布服务的行不能松散地放在预设的根作用域中。**

原因是：没有 `isolate` realm 的服务注册在进程全局作用域中。当第二个会话挂载同一个预设时，它会尝试注册同名服务——冲突了。

判断一行是否发布服务不能靠名字猜测。技能文件推荐的方法：

> Read it off the live runtime instead: `cordis_inspect what:"services"` lists every service with the fiber that owns it, so a service attributed to a fiber other than the row you are adding is one that row consumes rather than provides.

当预设确实拥有一个服务时，把 provider 和所有消费它的行放在同一个带 `isolate` 的 group 中：

```yaml
- id: delegation
  name: cordis:group
  group: true
  isolate:
    workflows: true
  config:
    - id: workflow-worker-thread
      name: '@deepseek-ai/dsh-workflow-worker-thread'
    - id: tool-workflow
      name: '@deepseek-ai/dsh-tool-workflow'
```

`isolate: { workflows: true }` 创建了一个每个会话私有的 realm。消费方在 group 外面时就解析到 Host 的注册表——这不包含预设发布的服务，因此不激活。

### 最常犯的错误

技能文件明确指出了一条常见陷阱：

> A consumer left outside the group resolves the host's registry, which the preset did not populate, and then contributes nothing.

翻译：消费方在 group 外面时解析到 Host 的注册表——这不包含预设发布的服务——然后就什么也不贡献。

这个问题非常隐蔽。因为 AI 在写 `agent.cordis.yml` 时，可能直觉地觉得"这个工具应该在根作用域"，但如果这个工具消费的是预设发布的服务，它必须在隔离域中。

检查方法就是 `standingKeyFor()`——它会告诉你哪些行没有激活。

## 9.7 编写自己的 Preset

前面花了大量篇幅讲 Plugin Builder 的结构和原理，现在你可以动手创建一个自己的 Preset 了。

### 从现有的 preset 复制

```javascript
// 在 cordis_mount 中执行
const result = await ctx.agentPresets.copy('standard', 'code-review-assistant', '代码审查助手')
// result 包含新预设的路径
```

`copy(from, id, name?)` 的参数：
- `from`：源预设的 id（如 `standard`、`cordis`、`plugin-builder`）
- `id`：新预设的 id（必须匹配 `[a-z0-9][a-z0-9-]*`，会成为目录名）
- `name`（可选）：新预设的显示名称。不传则保持原名

`copy()` 会做这几件事：
1. 复制整个预设目录（agent.cordis.yml、preset.yml、skills/）
2. 验证 id 格式
3. 检查是否有已存在的预设使用这个 id
4. 写入 preset.yml（保留源描述，去除 roster order）
5. 返回新预设的路径

### 修改 persona

编辑 `agent.cordis.yml` 中的 persona 配置，告诉 AI 它的角色：

```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: |-
      You are a code review assistant. Your job is to review code diffs,
      identify potential issues, and suggest improvements.

      ## 工作流程

      1. 当用户提交代码审查请求时，先理解变更的上下文
      2. 逐文件检查变更，关注：正确性、安全性、性能、可维护性
      3. 按严重程度分类问题：阻塞性、重要、建议
      4. 每个问题附带具体行的引用和改进建议
      5. 总结审查结论
```

Persona 文本是系统提示词的一部分，直接影响 AI 的行为模式。

### 增减工具

根据你的场景决定需要哪些工具。代码审查助手需要的工具和 Plugin Builder 不同：

**需要的：**
- `tool-fs`、`tool-fs-search`：读取源代码文件
- `tool-bash`/`tool-pwsh`：执行测试
- `tool-web`：可能需要查文档
- `tool-ask-user`：与用户交互

**不需要的：**
- `tool-cordis`：代码审查助手不需要修改运行时
- `subagent` 相关：不需要委托子任务
- `workflow`：不需要工作流引擎

删除不需要的行即可。

### 配置隔离域

如果预设要发布自己的服务，必须配隔离域。但对大多数预设来说，你只是在消费 Host 层面的服务，不需要配隔离域。

如果你确实需要发布服务，记住两点：
1. Provider 和所有消费者放在同一个带 `isolate` 的 group 中
2. `isolate` 的值用 `true`（创建私有 realm）而不是字符串（共享 realm，仍然会冲突）

### 验证

```javascript
// 在 cordis_mount 中执行
try {
  await ctx.agentPresets.standingKeyFor('code-review-assistant')
  // 挂载成功
} catch (error) {
  // 挂载失败，error.message 包含失败原因
}
```

`standingKeyFor()` 会真实挂载预设的所有插件行，并检查：
- 包是否可解析
- 配置是否有效
- 所有行是否都激活了
- 服务是否发布在正确的 realm 中

通过验证后，`standingKeyFor()` 会保持挂载状态——验证通过意味着创建成功。

### 完整示例：代码审查助手预设

整个流程的组合：

1. 复制：`ctx.agentPresets.copy('standard', 'code-review-assistant', '代码审查助手')`
2. 修改 `preset.yml` 的 description 为 "专门进行代码审查的助手——分析 diff、检查安全性、性能问题和代码质量"
3. 编辑 `agent.cordis.yml`：
   - 重写 persona 为代码审查角色
   - 删除 `tool-cordis` 行
   - 删除子代理相关行（subagent、workflow）
   - 保留文件工具、Shell 工具、提问工具
4. 用 `standingKeyFor('code-review-assistant')` 验证
5. 创建新会话，选择"代码审查助手"预设，验证工具列表

完成后的预设结构：

```
.agent-presets/code-review-assistant/
├── preset.yml
└── agent.cordis.yml
```

一个只有 50 行配置文件的预设，就能把一个通用的 AI 助手专精化为代码审查专家。

## 9.8 本章小结

Agent Preset 是自定义 AI 助手行为的最直接方式。Plugin Builder 不是 Harness 中唯一有用的预设，但它是一个优秀的参考案例——因为它说明了怎么通过 Persona 配置、工具组合和技能文件三个维度来定制一个助手。

本章的核心收获：

1. **Agent Preset = 智能体的配置模板**。选择不同预设 = 选择不同助手角色和工具集。一个预设由 preset.yml、agent.cordis.yml 和 skills/ 三个部分组成。

2. **Plugin Builder 从 `cordis` 复制后修改**。它继承了完整工具集，增加了需求文档流程和 Cordis 开发工具。从成熟预设起步比自己从头写更可靠。

3. **需求文档流程强制了"先沟通后实现"**。五步流程（需求沟通→规范核对→编写文档→用户确认→实现）避免了盲目编码，确保了用户和 AI 之间的共识。

4. **独占性是工作流设计决策**。Plugin Builder 的 tool-cordis 工具集操作全局运行时，两个并发会话会互相干扰。这不是技术限制，而是为了保持反馈清晰和因果关系简单的设计选择。

5. **技能文件提供深入的专业知识**。`cordis-plugin-development` 技能覆盖了插件开发的完整工作流、平台选择规则、Provider 导航、执行环境约束和版本管理。`editing-cordis-compositions` 技能阐明了 Preset 编写的两平面规则和 realm 隔离规则。

6. **编写自己的 Preset 是一个标准流程**：copy → 改 persona → 增加工具 → 配隔离域 → 验证 → 测试。20 分钟就能创建一个可用的专用预设。

从下一章开始，我们将深入 Harness 的高级能力，探索子代理、工作流引擎和事件系统的进阶用法。
---
← [dsh-open-editor 实战](08-实战-dsh-open-editor插件开发全过程.md) | [返回目录](README.md) | [高级能力](10-高级能力.md) →
