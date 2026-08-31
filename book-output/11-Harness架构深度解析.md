# Harness架构深度解析

> ← [高级能力](10-高级能力.md) | [目录](README.md) | [安全与运行时](12-安全与运行时.md) →

> **参考文档：**
> - [../docs/architecture.zh.md](../docs/architecture.zh.md) — 整体架构文档
> - [../docs/agent-lifecycle.zh.md](../docs/agent-lifecycle.zh.md) — Agent 生命周期
> - [../docs/capability-seams.zh.md](../docs/capability-seams.zh.md) — 能力接缝
> - [../docs/cordis-primer.zh.md](../docs/cordis-primer.zh.md) — Cordis 入门
> - [../docs/event-producer-consumer.zh.md](../docs/event-producer-consumer.zh.md) — 事件生产者/消费者矩阵
> - [../docs/subsystems/core.zh.md](../docs/subsystems/core.zh.md) — 核心子系统
> - [../docs/subsystems/session.zh.md](../docs/subsystems/session.zh.md) — 会话子系统
> - [../docs/subsystems/system-prompt.zh.md](../docs/subsystems/system-prompt.zh.md) — 系统提示词
---

## 9.1 微内核架构

### 什么是微内核

在操作系统领域，微内核（Microkernel）是一种设计理念：内核只做最少的事——进程调度、进程间通信、基本内存管理——操作系统其余的所有功能（文件系统、网络栈、设备驱动）都以用户态服务进程的形式运行。与之相对的是宏内核（Monolithic Kernel），一切都在内核态，一个驱动崩溃就拖垮整台机器。

Harness 采用同样的哲学。**Harness 本身不内置任何能力**——不内置模型适配器、不内置工具系统、不内置文件系统访问、不内置 Agent 主循环。所有这些都以插件的形式挂载到 Cordis 上下文上。Harness 的"内核"就是一个空的 Cordis 容器，加上一套启动流程（Profile 和组合包机制），剩下的全是插件。

这个决策带来的好处显而易见：

- **可替换性**：每个子系统都可独立替换。你说"我不想用内置的 Agent 循环，我想用自己的实现"——可以，只需要注册一个新的 `agentLoop` 服务。
- **可裁剪性**：`web`、`headless`、`sdk`、`sdk-minimal` 这几个 Profile 组合不同的插件集合。sdk-minimal 甚至不加载 dsh-base，只包含最小可用的 SDK 配置。用户不需要的功能可以完全不带。
- **故障隔离**：一个插件崩了（例如某个自定义工具抛出了未捕获异常），不会影响 Agent 循环的运行，更不会拖垮整个进程。

### 与宏内核框架的对比

看看 LangChain 的结构。LangChain 的核心是一个庞大的类层次：`BaseChatModel`、`BaseTool`、`BaseMemory`、`BaseRetriever`……你通过继承这些基类来扩展。想换掉其中的某个组件，你只能继承并重写——但这不改变一个事实：你的新实现仍然运行在 LangChain 框架的编排逻辑里。

这就像把一个宏内核操作系统的驱动程序写成内核模块：虽然你可以独立编译它，但它运行在内核地址空间，受内核调度逻辑的约束。出错了会拖累整个系统。

Harness 的 Cordis 容器更像微内核。插件之间的通信不走继承，走的是**服务接口 + 事件**。一个工具不直接从 `BaseTool` 继承，而是调用 `ctx.tools.register()`。这意味着：工具不需要知道自己被哪个 LLM 适配器使用，也不需要关心 Agent 循环是怎么调度的。注册就是注册，剩下的交给框架。

## 9.2 Cordis 在 Harness 中的角色

Cordis 是 Harness 赖以生存的微内核——但它不是 Harness 团队自己写的，而是以 vendor 方式引入的一个独立插件框架。

### Cordis 提供的三个核心能力

**第一，依赖注入。** 每个插件声明自己需要什么服务（通过 `inject` 字段），Cordis 确保这些服务在插件启动之前就已经就位。如果你需要 `tools` 和 `sessions`，就写 `inject: ['tools', 'sessions']`。不满足的依赖不会加载。这比手动创建和排序对象要安全得多——你不可能在 `ctx.tools` 还没注册的时候就调用 `ctx.tools.register()`。

**第二，事件总线。** 这是最强大的能力。Cordis 定义了五种事件分发模式：

| 模式 | 是否有 await | 顺序 | 是否有返回值 |
|---|---|---|---|
| `emit` | 否 | 观察者模式，不阻塞 | 否 |
| `waterfall` | 否（异步但串行） | 每个监听器依次执行，可修改共享对象 | 是 |
| `parallel` | 是 | 并行执行 | 否 |
| `serial` | 是 | 按序执行 | 是 |
| `bail` | 否 | 按序执行，遇到首个有值的结果就停止 | 是 |

Harness 重度使用 `waterfall`（瀑流事件）来实现策略链。比如工具执行之前，`tools/pre-execute` 是一个 waterfall 事件。监听器可以：允许执行（`allow`）、拒绝执行（`deny`）、请求用户审批（`ask`）。多个监听器通过 `next()` 串联，形成一条决策链。如果审批插件在最前面，它先决定是否 ask；如果 ask 通过或不需要，策略插件再决定是否 deny；全部通过才放行到工具本体。

**第三，生命周期管理。** 每个插件都可以有一个 `apply(ctx)` 函数，在其中注册各种能力和事件监听器。当插件被卸载（热重载、Profile 切换、Agent 销毁）时，Cordis 自动撤销所有 effect。这意味着你在 `apply` 中注册的事件监听器、注册的工具、挂载的路由，在插件卸载时都会被自动清理——不需要手动 `dispose`。

### 为什么选择 Cordis 而不是自己实现

这是一个关键的架构决策。Harness 团队可能自己写一个 IoC 容器，但选择 vendor Cordis 的理由值得理解：

- **Fiber 状态机**：Cordis 的 Fiber 机制管理着插件的挂载、卸载、热重载状态转换。插件不再是"装了就不能拆"的一锤子买卖。开发者修改插件代码后，Cordis 可以卸载旧实例并挂载新实例，而不需要重启进程。这对于开发体验来说是质的飞跃。
- **上下文继承**：Cordis 的 Context（上下文）有层级关系。一个 Agent 的 `agent.ctx` 继承自全局上下文，但又可以注册自己独有的事件监听器和工具限制（`ctx.tools.restrict()`）。子 Agent 的上下文又继承自父 Agent。这种层级关系天然映射了 Harness 的 Scope 子系统。
- **成熟度**：Cordis 是 Koishi（一个聊天机器人框架）的底层引擎，已经在生产环境中运行了多年。它解决的插件热重载、依赖管理、Scope 隔离等问题，恰好也是 Harness 需要解决的。重新发明轮子没有意义。

### 插件的注册和加载机制

当你启动 `dsh --profile web` 时，发生的实际上是：

1. Cordis 读取 `dsh-base` 组合包配置文件，发现有 40 多个插件在列表里。
2. 按照依赖关系排序：`scope` 是最底层，然后是 `session`、`system-prompt`、`tools`、`agent`，再是 `llm` 适配器，最后是 `agent-loop`。
3. 每个插件的 `inject` 声明被检查，确保前置服务已经就绪。
4. 逐个调用 `apply(ctx)`，插件开始注册自己的能力。
5. 所有插件完成加载后，系统进入就绪状态，等待用户输入。

如果某个插件的 `apply` 抛出了异常，Cordis 会：卸载该插件之前注册的所有 effect（反向撤销），然后继续加载下一个插件，或者终止（取决于配置）。这有点像 Linux 内核的模块加载——加载失败不会留下半截状态。

## 9.3 核心子系统全景

Harness 的核心功能分布在 6 个子系统中。让我们逐一深入。

### Session 子系统（ctx.sessions）

Session 是 Harness 的"事件溯源日志"。你的每一次聊天、每一次工具调用、每一次模型的输出，都被记录为一个不可变的 `SessionEvent`，追加入日志。

为什么选择事件溯源而不是直接存消息列表？因为直接存消息列表意味着：一旦消息 A 被写入，你就无法"回溯"到它之前的状态，也无法改变它。但在 Harness 中，上下文压缩（Compaction）需要折叠旧的对话轮次，将其替换为摘要。如果你存的是"消息列表"，替换操作就是破坏性的——你永远失去了原始消息。

事件溯源解决了这个问题。`SessionEventMap` 定义了 12 种核心事件类型：`turn/start`、`turn/end`、`step/start`、`step/end`、`user/message`、`assistant/chunk`、`assistant/message`、`tool/call`、`tool/result`、`request/header`、`request/context`、`session/end-seed`。

模型看到的"对话历史"（`deriveMessages()`）是从日志**派生**的，而不是独立存储的。这意味着同样的日志可以派生出不同的历史视图：正常视图、经过压缩的视图、不含工具内容的视图。压缩操作实际上是在日志中追加了一个 `replace` 类型的 surface 操作，而不是直接修改之前的消息。

这个设计还有一个隐藏的好处：**可回放性**。如果你需要复现一次会话的完整过程，只需要从头到尾重放日志。`assistant/chunk` 事件甚至保存了逐 token 的流式输出，供 UI 精确回放。

### Agent Loop 子系统（ctx.agentLoop）

Agent Loop 是驱动 AI 思考和行动的引擎。它是一个"领取输入 → 组装提示词 → 调用 LLM → 分派工具 → 重复或结束"的循环。

具体的流程我们留在 9.4 节，这里只说它的架构角色：Agent Loop 是唯一的具体 `ctx.agentLoop` 实现。扩展插件必须依赖 `@deepseek-ai/dsh-agent`（声明事件和 Agent 接口），而不是直接依赖 `dsh-agent-loop`。这意味着你可以在不涉及 Loop 实现的情况下声明 Agent 的事件监听器。这也让 Loop 实现可以被替换——如果你写了一个自定义的 Loop，只需要实现同样的 `ctx.agentLoop` 接口，注册到 Cordis 中即可。

### System Prompt 子系统（ctx.systemPrompt）

每一个步骤开始之前，系统提示词需要被组装。`ctx.systemPrompt` 维护了一个"提示词片段"注册表。任何插件都可以注册一个 `PromptSection`，指定它的文本内容和排序权重。

组装过程是这样的：

1. 所有片段按 `order` 字段升序排列，同名片段去重（Agent 作用域的覆盖全局的）。
2. 对所有已注册的工具 Schema 进行收集。
3. 触发 `system-prompt/assemble` 瀑流事件，允许监听器修改最终的 assembly。
4. 渲染最终的提示词文本，发送给 LLM。

这个机制的核心价值在于**关注点分离**。文件系统工具不需要关心安全策略的提示词是什么，安全策略插件不需要关心工具的 schema 如何组装。每个插件只贡献自己那一小段，System Prompt 子系统负责将它们拼成完整的提示词。

### Tools 子系统（ctx.tools）

工具注册表是整个系统中最复杂的子系统之一。一个工具的生命周期包括：

1. **注册（register）**：插件调用 `ctx.tools.register(definition)`，传入名称、参数 Schema、执行函数、输出 Schema。
2. **限制（restrict）**：Agent 作用域可以限制对某些工具的可见性。`allow` 列表或 `deny` 列表过滤继承自全局的工具集。
3. **执行流水线**：当 LLM 请求调用一个工具时，执行经过 4 个阶段：
   - `tools/pre-execute`：允许/拒绝/审批请求的三选一决策
   - 单调 Guard：只减不增的预分派安全检查
   - `tools/execute`：环绕分派包装层（超时、重试、度量）
   - `tools/post-execute`：接受/替换/阻止结果
4. **结果通知（`tools/result`）**：最终结果以只读快照推送给监听器。

除了执行流水线，还有一个有趣的设计：**并行工具执行**。一个步骤中可以有多个工具调用并行执行，通过 `isConcurrencySafe()` 标记控制。并发安全的工具（如 `read`）可以同时运行，独占的工具（如 `edit`）则形成屏障。

### Scope 子系统

Scope 是 Harness 最容易被忽视但最重要的底层原语。它的作用是**按 Agent 划分作用域**。

当你有多个 Agent 在同一个进程中运行时（父 Agent + 几个 Subagent），每个 Agent 需要看到不同的工具集、不同的事件、不同的配置。Scope 系统通过 `ScopeKey`（通常就是 Agent 对象本身）来实现这个隔离。

例如：Agent A 注册了一个文件系统工具。如果这个注册是通过 `agentA.ctx.tools.register()` 完成的，那么只有 Agent A 能看到这个工具，Agent B 不行。如果注册是通过全局 `ctx.tools.register()` 完成的，那么所有 Agent 都能看到——但可以通过 `restrict()` 在 Agent 层面做过滤。

Scope 是 Cordis Context 继承机制的应用：`agent.ctx` 的父上下文是全局上下文，但它可以添加自己的服务和事件监听器，这些不会泄漏给兄弟 Agent。

## 9.4 Agent 的完整生命周期

现在我们把这 6 个子系统串起来，看看一条用户消息是如何变为最终响应的。

### 从用户消息到最终响应

Harness 将一个交互拆分为两个层次：**Turn（轮次）** 和 **Step（步骤）**。

- 一个 Turn 从用户输入开始，到 Agent 不再需要做任何工作为止。
- 一个 Step 是"一次 LLM 调用 + 该调用触发的所有工具调用"。

一个 Turn 可以由多个 Step 组成。例如：用户说"帮我分析这段代码并写一个测试"。Step 1 中 LLM 调用了 `read` 读取代码；Step 2 中 LLM 看到了文件内容后调用了 `write` 写入测试；Step 3 中 LLM 检查了测试通过。这三个 Step 属于同一个 Turn。

### 详细的 Step 流程

```
用户消息 → [Agent.inbox]
  → [inbox/inserted] 事件
  → 唤醒 Agent Loop（如果空闲）
  → [turn/start] 写入日志
  → 从 inbox 领取消息：[inbox/claimed] 事件
  → [agent/pre-step] 瀑流事件（监听器可以拒绝或修改进入步骤的消息）
  → [step/start] 写入日志
  → [user/message] 写入日志（已确认的消息）
  → 组装 System Prompt：[system-prompt/assemble] 瀑流事件
  → 从 Session 日志派生消息历史（deriveMessages）
  → [agent/request] 瀑流事件（可以替换模型配置）
  → [llm/stream] 瀑流事件（流式获取模型输出）
  → [assistant/chunk]* 逐 token 写入日志
  → [assistant/message] 写入日志（组装后的完整消息）
  → 解析工具调用：分类 executionMode
  → 循环处理每个工具：
    → [tool/call] 写入日志
    → [tools/pre-execute] 瀑流 → 单调 Guard → [tools/execute] 瀑流 → [tools/post-execute] 瀑流
    → [tool/result] 写入日志
  → [step/end] 写入日志
  → 检查是否还有未完成的工作
    → 有 → 下一个 Step
    → 无 → [agent/turn-stopping] 序列事件
  → [turn/end] 写入日志
```

### Hook 机制

Harness 还定义了几种钩子（Hook），作为特定平台桥接的扩展点。目前内置了 Claude Code 和 Codex 两个钩子桥接层。它们通过监听 `agent/pre-step`、`agent/request`、`tools/pre-execute` 等事件，将 Harness 的事件翻译成对应平台的原生决策语义。

钩子与普通监听器的区别在于：普通监听器是"观察并轻微修改"，钩子是"接管并完全替代"。当一个钩子桥接层被激活时，它会拦截 `agent/pre-step` 的决策，用自己的原生决策来代替 Harness 的内置逻辑。这本质上是一种适配器模式，只是被 Cordis 的事件系统包装得很自然。

## 9.5 能力接缝（Capability Seam）

### Seam 的设计思想

你已经在前面几节中多次接触到 Seam 这个词。正式定义是：**一个 Seam 是一项可替换的能力，包含三个角色——接口定义（Service Definition）、提供方（Service Provider）、消费方（Consumer）。**

Seam 的命名很形象：就像一件衣服的接缝处，你可以把不同颜色的布料缝合在一起。在 Harness 中，你可以换掉文件系统提供方、换掉 Shell 执行器、换掉持久化后端，而不影响消费这些服务的工具。

### 为什么需要 Seam

考虑一个常见的需求：你希望 AI 不要直接操作用户的本地文件系统，而是通过一个远程沙箱来读写文件。

如果你在 LangChain 里做这件事，你需要：

1. 写一个 `RemoteFileTool` 替代原来的 `FileTool`。
2. 在所有引用了 `FileTool` 的 Chain 中替换为 `RemoteFileTool`。
3. 如果工具内部直接调用了 `fs.readFileSync`，你还得改工具代码。

在 Harness 中，你只需要：

1. 注册一个实现了 `ctx.fs` 接口的远程文件系统提供方（如 `fs-e2b`）。
2. 在配置中把 `fs-local` 替换为 `fs-e2b`。
3. 所有消费 `ctx.fs` 的工具——`tool-fs`、`tool-bash`、`tool-terminal`——自动使用远程实现。

这就是 Seam 的价值：**替换一个提供方，改变整个产品**。文件系统、Shell、子进程、Subagent……它们都在同一个 Seam 接口之后。换掉 `ctx.subprocess` 的提供方，所有 spawn 子进程的操作（bash、terminal、LSP、子 Agent）都会自动切换到远程沙箱。

### 文件系统 Seam 的实例分析

文件系统 Seam 是理解 Seam 最好的入口。它的三个角色分别是：

- **接口定义**：`ctx.fs`，由 `@deepseek-ai/dsh-fs` 包声明，定义了 `readFile`、`writeFile`、`editFile`、`listFiles`、`glob` 等方法。
- **提供方**：`fs-local`（本地文件系统）、`fs-sandbox`（沙箱模式限制写入路径）、`fs-e2b`（E2B 远程沙箱）。
- **消费方**：`tool-fs`（文件操作工具）、`tool-str-replace-editor`（搜索替换编辑器）。

此外还有配套插件 `fs-observation-policy`，它不是消费方，而是通过监听 `fs/*` 事件（如 `fs/write-intent`、`fs/edit-intent`）来贡献基于观测状态的检查逻辑。例如：检测到 AI 正在修改一个 Git 仓库中刚刚生成的某个文件，这可能是"先写后读"的反模式，观测策略会拒绝这次写入。

### 如何创建自己的 Seam

如果你在自己的插件中需要定义一个新的能力接缝，遵循三个步骤：

**第一步：声明接口。** 创建一个 Service 类，定义方法签名。例如：

```ts
import { Service } from '@deepseek-ai/cordis'

export interface MyService {
  doSomething(input: string): Promise<string>
}

export const inject = ['myService']
```

**第二步：实现提供方。** 编写至少一个 Service 实现。注意：接口定义和提供方应该在独立的包中，这样消费方只依赖接口包，不依赖具体提供方。

**第三步：在消费方中通过 `ctx` 引用接口。** 消费方声明 `inject: ['myService']`，然后使用 `ctx.myService.doSomething(...)`。

**第四步（可选）：添加事件。** 如果其他插件需要在这些能力执行前后附加策略（类似 `fs/observation-policy`），在接口方法执行前后触发相应的 Cordis 事件：

```ts
ctx.emit('my-service/before-do', { input })
const result = await doSomething(input)
ctx.emit('my-service/after-do', { input, result })
```

这样其他插件就可以通过 `ctx.on('my-service/before-do', handler)` 来附加逻辑，而不需要修改你的接口或实现。

## 9.6 事件驱动架构

### 事件在哪里

如果你仔细阅读了前面的内容，你会发现：**事件实际上承载了 Harness 的绝大多数逻辑**。子系统之间几乎没有直接的方法调用。Session 系统不直接调用 Agent Loop，而是通过 `agent/*` 事件来通知。Tool 执行不直接调用策略逻辑，而是通过 `tools/*` 事件来分发。

这种设计让 Harness 具有了高度的可扩展性。要添加一个新的策略（比如"每次写文件前先检查磁盘空间"），你只需要监听一个事件，而不是修改任何已有的代码路径。

### 五种分发模式的应用场景

在实际代码中，Harness 对五种模式的使用非常讲究：

- **`emit`（广播通知）**：最常用的模式。`session/event` 是日志事件的广播，`tools/result` 是工具结果的广播。多个监听器可以独立处理同一事件，互不干扰。一个监听器的失败不会影响另一个。

- **`waterfall`（瀑流链）**：用于决策链。`agent/pre-step` 就是典型的 waterfall——每个监听器可以修改 `messages` 然后 `next()`，或者直接返回 `reject` 终止决策链。`tools/pre-execute` 也是 waterfall，监听器返回 `allow`、`deny` 或 `ask`。

- **`parallel`（并行）**：用于需要所有监听器都完成、但彼此独立的场景。`session/flush` 是 parallel 事件——多个持久化后端需要同时将缓冲的事件写入存储，每个完成后才算数。用 parallel 而不是 emit 是因为 `flush` 需要等待所有后端完成才能继续。

- **`serial`（序列）**：用于需要顺序执行、且上一步的输出影响下一步的场景。`agent/turn-stopping` 是 serial 事件——监听器依次执行，检查是否应该停止当前轮次。

- **`bail`（短路）**：用于"第一个有结果的就用"的场景。Harness 内部不常用，但在自定义插件中很有用——比如"多个提示词片段提供方，只要第一个有内容的就用来做系统提示词"。

### 重要事件

**`session/event`**：这是整个 Harness 最核心的事件。每一次 `Session.append()` 都会触发这个事件。它承载了全部的对话日志。监听这个事件的服务包括：持久化后端（将事件写入磁盘）、实时 UI 更新（将事件推送到浏览器）、遥测记录（将事件发送到监控后端）、Token 计量（统计每次模型的 token 用量）。

**`tools/pre-execute` / `tools/execute` / `tools/post-execute`**：这是工具执行的三个关键扩展点。它们组合在一起，构成了一条完整的策略链。

**`llm/stream`**：这是模型流式输出的关键事件。监听 `llm/stream` 可以：修改流式输出（如过滤敏感内容）、记录 token 级的使用量、在流式输出完成时触发自定义逻辑。

**`agent/pre-step` / `agent/request` / `agent/request-error`**：这是 Agent 循环的三个主要控制点。`pre-step` 决定"模型能看到什么"，`request` 决定"模型用什么配置调用"，`request-error` 决定"调用失败后该怎么办"。

### 事件的持久化与会话回放

`session/event` 之所以是 `emit` 而不是 `waterfall`，是因为它**不能阻塞**。Session 的 `append()` 是同步操作——事件写入日志后立即返回。持久化后端（如 `session-persistence-sqlite`）在后台异步处理事件的持久化写入，不影响主流程。

这带来的结果是：如果持久化写入失败，事件日志的内存副本仍然完好。用户可以重试持久化，或者重新从内存中读取日志。这种"先写入内存再异步持久化"的设计，让 Harness 即使在持久化暂时不可用的情况下也能继续工作。

会话回放就是简单地重新加载 `SessionEvent`，重新调用 `deriveMessages()`。由于所有模型调用、工具结果都以事件的形式记录在日志中，回放可以精确重建对话的每一个细节——包括逐 token 的流式输出（通过 `assistant/chunk` 事件）。

## 9.7 本章小结

Harness 的架构建立在 5 个关键设计决策之上。理解了这些决策，你就理解了整个框架的灵魂。

**1. Cordis 作为微内核。** 这是第一位的决策。没有 Cordis，就没有依赖注入、事件总线、生命周期管理这三个基础能力。Harness 选择 vendor 一个成熟的框架而不是自己造轮子，让它能够专注于 Agent 业务逻辑的开发。

**2. 事件溯源作为会话存储模型。** 对话日志不是"消息列表"而是"事件序列"，派生历史是纯函数。这让压缩、回放、Fork 等操作变得自然且安全。

**3. 事件驱动 + 瀑流链作为扩展机制。** Harness 几乎没有硬编码的策略逻辑。安全策略用 `tools/pre-execute` 实现，上下文压缩用 `agent/pre-step` 实现，用户审批用 `tools/pre-execute` + `approval/request` 实现。想加一个新策略？监听一个事件就行。

**4. Seam 作为可替换能力的接口模式。** 文件系统、Shell、持久化、Subagent——每个核心能力都是一个 Seam。替换提供方不需要修改消费方代码。这保证了 Harness 可以从本地单进程扩展到远程分布式部署，而不改变任何工具代码。

**5. Scope 作为多 Agent 隔离的基本单位。** 同一个进程可以运行多个 Agent，它们共享一组全局能力，但各自拥有独立的作用域上下文。工具可以按 Agent 注册、限制和访问，事件可以按 Agent 过滤。

### 这些决策如何影响插件开发

作为插件开发者，你不需要在日常开发中思考这些架构决策，但它们构成了你编写的每一行代码的"潜规则"：

- **当你需要添加能力时**：注册到 `ctx.*`，而不是继承某个基类。你的能力自动成为 Seam 的一部分，可被替换和扩展。
- **当你需要拦截流程时**：监听对应的事件，而不是覆写循环的某个方法。多个拦截器可以共存，互不冲突。
- **当你需要在多个 Agent 之间隔离时**：在 `agent.ctx` 上注册，而不是在全局 `ctx` 上注册。Scope 系统会自动处理好隔离。
- **当你需要持久化状态时**：使用 Session 日志的事件扩展示范，扩展 `SessionEventMap`，而不是另起炉灶存数据库。

如果你理解了这些潜规则，你写出的插件就不再是"在 Harness 上勉强能跑"的代码，而是"和 Harness 同构的、充分利用了框架能力"的代码。这是从"会用 Harness"到"精通 Harness"的关键一步。
---
← [高级能力](10-高级能力.md) | [返回目录](README.md) | [安全与运行时](12-安全与运行时.md) →
