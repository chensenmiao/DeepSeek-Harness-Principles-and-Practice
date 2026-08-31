# 什么是DeepSeekHarness

> [目录](README.md) | [环境搭建与第一个插件](02-环境搭建与第一个插件.md) →

> **参考文档：**
> - [../docs/architecture.zh.md](../docs/architecture.zh.md) — 整体架构
> - [../docs/capability-seams.zh.md](../docs/capability-seams.zh.md) — 能力接缝
> - [../docs/glossary.zh.md](../docs/glossary.zh.md) — 术语表
> - [../docs/user/guide/index.zh.md](../docs/user/guide/index.zh.md) — Web UI 使用指南
---

## 1.1 LLM 的工具调用能力（回顾）

大语言模型（LLM）本质上是一个文本生成器：你输入一段文本（prompt），它输出一段续写。它能看到你给它的所有上下文，但它看不到数据库、文件系统、互联网——它"活在真空里"。

Function Calling（函数调用）是打破这层真空的第一个机制。OpenAI 在 2023 年率先引入了这个能力，现在所有主流 LLM 都已支持。它的工作方式是：开发者向模型注册一个或多个函数的签名（名称、参数列表、参数类型），模型在生成回复时，如果判断需要外部数据或操作，会输出一个结构化的 JSON 对象来描述"我想调用哪个函数、传什么参数"。

举个例子，一个天气查询的 Function Calling 流程是这样的：

1. 开发者注册 `get_weather(city: string, date: string)` 函数
2. 用户问："北京明天会下雨吗？"
3. LLM 输出：`{"name": "get_weather", "arguments": {"city": "北京", "date": "2026-08-30"}}`
4. 开发者代码收到这个 JSON，调用真实的天气 API
5. 结果返回给 LLM，LLM 据此生成面向用户的回答

这套机制让 LLM 从一个"只会写字的模型"变成了"会调用工具的模型"。它很有效，但局限性也很明显：

- **单次调用**：一次回复只能触发一次函数调用，无法串行执行多个步骤
- **无状态**：每次模型请求都是独立的，没有持久化——关掉终端，对话就丢失了
- **无文件系统**：模型无法直接读、写、编辑文件，所有文件操作都要你手动做
- **无 Shell**：模型不能执行命令、安装依赖、运行测试
- **无子任务能力**：模型不能把一个大问题拆成多个子任务并行处理

简单说，Function Calling 给了 LLM 一只手，但只给了它一根手指。

这一节你学到了：Function Calling 是 LLM 调用外部函数的基础机制，但它只解决了"单次函数调用"这一个问题。

## 1.2 Harness 解决的核心问题

DeepSeek Harness（简称 dsh）是一个面向 LLM 的应用运行时。它的定位是：**给 LLM 装一个操作系统**。

具体来说，Harness 解决了以下五个核心问题：

**1. 扩展能力边界**

Function Calling 只能调用你预先注册的几个函数。Harness 把"能力"的定义放大了：不仅仅是函数调用，还包括文件系统读写、Shell 命令执行、子智能体（Subagent）创建、网络请求等。所有能力都通过统一的接口暴露给 LLM，模型不需要关心背后是本地执行还是远程沙箱。

**2. 管理对话上下文**

对话上下文（Context）的管理是生产级 LLM 应用的痛点。Harness 提供了 System Prompt 的自动组装——多个插件各自贡献 prompt 片段，Harness 将它们合并成完整的提示词发送给模型。当对话长度接近模型窗口上限时，Harness 会自动执行上下文压缩（Compaction），保留关键信息的同时裁剪 token 用量。

**3. 提供安全沙箱和权限控制**

LLM 直接操作文件系统和 Shell 有安全隐患。Harness 内置了多层次的权限模型：沙箱模式（Sandbox）限制进程可执行的范围，审批策略（Approval）让敏感操作需要用户确认，权限预设（Permission Presets）让用户可以一键切换安全等级。

**4. 提供持久化**

Harness 的每次对话交互都被记录为 Session Event（会话事件）流——这是一个只追加的日志。这意味着你可以回放任意一次对话的完整过程，也可以从某个历史点恢复（Fork）继续对话。持久化后端的实现是可替换的（JSONL / SQLite），你可以选择最适合自己场景的方案。

**5. 插件化架构**

这是最核心的设计决策：Harness 本身不内置任何能力，所有能力都是插件。模型适配器是插件，工具注册表是插件，文件系统提供方是插件，甚至 Agent 的主循环（Agent Loop）本身也是插件。这意味着你可以替换任何一个组件而不影响其他部分——换一个文件系统提供方从本地换成远程沙箱，不必改任何工具代码。

这种架构在 Harness 中有一个专门的术语叫 **Seam**（能力接缝）。一个 Seam 由三个角色组成：Service Definition（接口定义）、Service Provider（接口实现）、Consumer（消费该接口的模块）。比如文件系统这个 Seam，`ctx.fs` 是接口定义，`fs-local` 和 `fs-sandbox` 是两个提供方，`tool-fs` 是消费方。替换提供方就能改变整个产品的行为。

这一节你学到了：Harness 围绕能力边界、上下文管理、安全沙箱、持久化和插件化这五个核心问题来设计。

## 1.3 Harness 的核心能力一览

Harness 提供的能力以插件形式组织，下面列出最常用的一组：

**工具系统（Tool System）**

这是 Function Calling 的增强版。工具（Tool）注册在 `ctx.tools` 上，每个工具有名称、参数 schema 和实现函数。工具注册表负责 schema 的收集、向模型呈现，以及在执行时协调权限检查、审批和结果回传。常用的内置工具包括文件读写（`read`、`write`、`edit`）、搜索替换、代码执行等。

**Shell 执行**

通过 `ctx.shell` Seam，LLM 可以运行 Bash 或 PowerShell 命令。执行器支持超时控制、输出大小限制、后台任务。在沙箱模式下，Shell 命令会被包装（Wrapped）以限制其可执行范围。

**文件系统**

通过 `ctx.fs` Seam，LLM 可以读取、写入和编辑工作区文件。文件系统提供方可以是本地文件系统、沙箱文件系统或远程（如 E2B）文件系统。

**Subagent（子智能体）**

这是 Harness 最强大的能力之一。LLM 可以创建一个子智能体，给它分配独立的任务，子智能体有自己的对话历史和工具集。多个子智能体可以并行工作，结果在主会话中汇总。Subagent 的实现有多种提供方：进程内创建（In-Process）、进程外 SDK、甚至通过 ACP（Agent Communication Protocol）与其他产品对接。

**Workflow（工作流）**

Workflow 是 Subagent 的上层编排器。它允许你定义一个 YAML 工作流脚本，包含多个步骤（Step），每个步骤可以调用不同的 Agent 或工具。Agent Team（智能体团队）是其实验性演进，引入了持久化的团队名册和共享消息队列。

**Web UI / API / SDK**

Harness 提供了多种交互方式：
- **Web UI**：通过 `dsh web` 启动浏览器界面，适合日常使用
- **Headless**：通过 `dsh --profile headless` 一次性运行一个任务并退出
- **SDK**：通过 `dsh --profile sdk` 启动 JSON-RPC 服务器，让外部应用编程调用 Harness 能力；支持 TypeScript 和 Python SDK
- **ACP**：通过 `dsh --profile acp` 启动 ACP 服务器，用于自动化场景

这一节你学到了：Harness 的核心能力包括工具系统、Shell、文件系统、Subagent、Workflow 和多种交互方式，所有能力都是可替换的插件。

## 1.4 一个真实的场景：自动代码审查助手

假设你有一个 GitHub 仓库，希望每次 PR 创建时自动对代码进行审查。这个场景如果用 Harness 来实现，流程如下：

**触发**：GitHub Webhook 配置为在 `pull_request.opened` 事件时向 Harness 的 Webhook 端点发送通知。

**创建会话**：Harness 的 Webhook Runtime 收到通知后，创建一个新的 Session（会话），设置工作区为 PR 对应的仓库目录。

**获取上下文**：Agent 读取 PR 描述、变更文件列表和 diff 内容——这些是通过文件系统工具完成的。

**运行检查**：Agent 执行 Shell 命令运行 linter（如 ESLint）和类型检查（如 TypeScript 编译），获取输出结果。

**生成审查意见**：Agent 分析变更代码和 lint 结果，生成结构化的审查意见（问题列表、严重程度、修改建议）。

**输出结果**：审查意见通过 GitHub API（通过工具系统注册的函数）作为 PR 评论提交。

在这个过程中，Harness 扮演的角色是一个**连接器**——它连接了 GitHub（Webhook 接收 + API 调用）、本地文件系统（读取代码）、Shell（运行检查）和 LLM（分析代码生成意见）。每段能力都是一个插件，你可以替换 GitHub 为 GitLab、替换本地文件系统为远程沙箱、替换检查工具为其他 linter，而不需要改其他代码。

注意，这个场景中不需要手动实现任何 Function Calling 逻辑。Agent 根据 System Prompt 自动决定什么时候该读取文件、什么时候该运行命令、什么时候该调用 API。你只需要告诉它"审查这个 PR"，剩下的由 Agent 自主完成。

这一节你学到了：Harness 通过连接 Webhook、文件系统、Shell 和 LLM 能力，可以自动化完成代码审查这样复杂的多步骤任务。

## 1.5 快速体验：5 分钟运行 Harness

现在我们来实际运行一次 Harness，看看它怎么工作的。

**前置条件**

- Node.js 18 或更高版本
- pnpm（包管理器）
- 一个 DeepSeek API Key（如果你没有，也可以用其他兼容 OpenAI 接口的 API）

**第一步：克隆并安装**

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
```

**第二步：启动 Web UI**

```bash
pnpm dsh web
```

启动后终端会打印访问地址，默认是 `http://127.0.0.1:xxxx`。注意：`dsh` 进程会把启动时所在的目录作为默认的文件系统位置。

**第三步：配置模型**

打开浏览器访问终端打印的地址。在 Web UI 中：
1. 点击左下角的设置图标
2. 选择"模型"选项卡
3. 输入你的 DeepSeek API Key 并保存
4. 模型路由会立即可用，不需要重启服务器

**第四步：选择工作区**

1. 点击"选择工作区"
2. 添加你刚才克隆 `deepseek-harness` 的目录
3. 选中它作为工作区

选中工作区之前，会话输入框是不可用的。

**第五步：发送消息**

在聊天输入框中输入：

> 列出当前目录的文件结构

点击发送，观察 AI 的响应。你会看到：
1. Agent 接收你的消息
2. Agent 决定调用文件系统工具来列出目录
3. 工具执行结果返回给 Agent
4. Agent 基于结果生成回答

整个过程在 Web UI 中可视化了——你会看到工具调用步骤的展开和结果。

如果遇到权限问题，Web UI 会弹出审批请求，你可以选择批准或拒绝。

> **提示**：如果你没有 GPU 或不想等构建，也可以使用 `dsh --profile headless` 以一次性任务模式运行，或者用 `dsh --profile sdk` 启动 SDK 服务器从代码中调用。但这些都需要在配置文件中预先填写 API Key。

这一节你学到了：通过 5 步操作，你就启动了一个真实运行的 LLM Agent 环境，可以直接观察 AI 调用工具的全过程。

## 1.6 本章小结

一句话总结：**DeepSeek Harness = LLM 的操作系统**。

它不是又一个聊天机器人前端，而是一个面向 LLM 的应用运行时——它把文件系统、Shell、工具、子智能体等能力组织成可替换的插件，通过统一的接口暴露给 LLM，让 LLM 从一个"会说话的模型"变成"能干活的 Agent"。

学完本章，你应该能回答以下问题：
- Harness 是什么：一个基于插件架构的 LLM 应用运行时
- 为什么需要它：Function Calling 太单薄，生产级 LLM 应用需要文件系统、Shell、持久化、权限控制
- 它的核心能力有哪些：工具系统、Shell 执行、文件系统、Subagent、Workflow、Web UI / API / SDK
- 怎么启动它：`git clone && pnpm install && pnpm run build && pnpm dsh web`
---
[返回目录](README.md) | [环境搭建与第一个插件](02-环境搭建与第一个插件.md) →
