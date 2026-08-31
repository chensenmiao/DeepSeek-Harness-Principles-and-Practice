# Cordis快速上手

> ← [环境搭建与第一个插件](02-环境搭建与第一个插件.md) | [目录](README.md) | [动手写第一个工具插件](04-动手写第一个工具插件.md) →

> **参考文档：**
> - [../docs/cordis-primer.zh.md](../docs/cordis-primer.zh.md) — Cordis 入门
> - [../docs/cordis-api/context.zh.md](../docs/cordis-api/context.zh.md) — Context API
> - [../docs/cordis-api/events.zh.md](../docs/cordis-api/events.zh.md) — 事件 API
> - [../docs/cordis-api/fiber.zh.md](../docs/cordis-api/fiber.zh.md) — Fiber 状态机
> - [../docs/cordis-api/registry.zh.md](../docs/cordis-api/registry.zh.md) — 注册表
> - [../docs/cordis-api/service.zh.md](../docs/cordis-api/service.zh.md) — 服务
> - [../docs/user/develop/basic/config.zh.md](../docs/user/develop/basic/config.zh.md) — 配置校验
> - [../docs/user/develop/framework/index.zh.md](../docs/user/develop/framework/index.zh.md) — 插件与生命周期
---

## 3.1 Cordis 是什么

Cordis 是一个**依赖注入容器 + 事件总线 + 生命周期管理器**——三个角色合在一个框架里。

如果你有 Java 背景，可以把它类比为 Spring 的 IoC 容器：你的插件是 Bean，`ctx` 是 ApplicationContext。如果你偏 Python，它的工作方式类似 `injector` 或 `dependency-injector` 库，静态声明依赖、框架自动注入。

在 DeepSeek Harness 中，Cordis 就是整个应用的**骨架**：

```
Harness 启动
  └── Cordis 创建根上下文
       ├── 加载基础插件（事件总线、日志、工具注册表）
       ├── 加载 LLM 适配器
       ├── 加载 Agent 主循环
       ├── 加载你的插件
       └── ...
```

所有插件以 Cordis 插件的形式挂载在上下文中，插件的生命周期由 Cordis 统一管理。Harness 本身不实现"插件加载"——那是 Cordis 干的事。

> **你不会在这一章学完 Cordis 的全部。** Cordis 有自己完整的 API 体系（上下文、注册表、事件、反射、Fiber……）。但写 Harness 插件只需要掌握 5 个概念，就是下面几节的内容。

## 3.2 Context（ctx）：插件的世界

插件里几乎每一行代码都在操作 `ctx`。`ctx` 是 **Context** 的缩写，它代表"插件所处的运行环境"。

### ctx 是什么

`ctx` 是插件与系统交互的**唯一对象**。它集成了三个角色：

- **依赖容器**：通过 `ctx.tools`、`ctx.llm`、`ctx.sessions` 等属性访问其他服务
- **事件总线**：通过 `ctx.on()`、`ctx.emit()` 等收发事件
- **生命周期管理器**：通过 `ctx.effect()`、`ctx.plugin()` 管理资源和子插件

```ts
import type { Context } from '@deepseek-ai/cordis'

export function apply(ctx: Context) {
  // ctx.tools — 工具注册表，可以注册/查询工具
  // ctx.llm — LLM 适配器，控制模型调用
  // ctx.logger — 日志服务
  // ctx.events — 事件总线（ctx.on/emit 的底层实现）
  // ctx.fiber — 当前插件的运行时实例
  // ctx.registry — 插件注册表

  // 实际打印看 ctx 上有哪些属性
  console.log(Object.keys(ctx))
}
```

`ctx` 是一个 JavaScript Proxy 对象。普通属性读取走服务解析器，所以 `ctx.tools` 不是简单的属性读取——它会经过依赖解析、作用域隔离等逻辑。

### ctx 提供的能力

在插件开发中最常用的 ctx API：

| API | 用途 |
|-----|------|
| `ctx.on(event, handler)` | 注册事件监听器 |
| `ctx.plugin(plugin, config)` | 加载子插件 |
| `ctx.effect(factory)` | 注册带清理的资源 |
| `ctx.get(name)` | 从容器读取服务（不要求 inject） |
| `ctx.logger(name)` | 获取具名日志记录器 |
| `ctx.provide(name, value)` | 注册一个服务实现 |

### 重要：不要存 ctx 的引用

这是新手最容易踩的坑：

```ts
// ❌ 危险：把 ctx 存在模块级变量中
let savedCtx: Context

export function apply(ctx: Context) {
  savedCtx = ctx
}

// 在另一个函数中使用 savedCtx
export function doSomething() {
  // 此时插件可能已经卸载，savedCtx 对应的 Fiber 已被 dispose
  savedCtx.on('some-event', handler) // 可能抛出 INACTIVE_EFFECT 错误
}
```

**原因：** `ctx` 绑定到当前插件的 Fiber 生命周期。当插件卸载时（配置变更、HMR、依赖消失），该 Fiber 被 dispose，关联的 ctx 失效。在该 ctx 上注册新资源会抛出 `INACTIVE_EFFECT`。

**正确做法：** 只在 `apply` 函数的作用域内使用 `ctx`，需要延期使用的通过 `ctx.effect()` 注册回调。如果你确实需要跨生命周期保存 ctx，用 `ctx.root`（根上下文，贯穿整个应用生命周期）：

```ts
// ✅ 安全：root 上下文贯穿整个应用生命周期
const rootCtx = ctx.root
rootCtx.on('some-global-event', handler) // 应用退出前都有效
```

但 `ctx.root` 上注册的资源不会被自动清理（因为没有 Fiber 管理它），所以一般只用于全局事件。

### 这一节你学到了什么

- `ctx` = 依赖容器 + 事件总线 + 生命周期管理器，三者合一
- 通过 `ctx.<serviceName>` 访问其他插件提供的能力
- **不要存 ctx 引用**——它绑定到当前 Fiber 的生命周期，跨生命周期使用可能导致 `INACTIVE_EFFECT` 错误
- 需要全局上下文的插件用 `ctx.root`，但记得手动清理

---

## 3.3 依赖注入（inject）

### 问题场景

你的插件需要调用 LLM 发送消息、或者通过文件系统读写文件。`ctx.llm` 和 `ctx.fs` 是由其他插件提供的服务——你不能假设它们已经就绪。

### 解决方案：声明 inject

```ts
import type { Context } from '@deepseek-ai/cordis'

// inject 数组声明这个插件需要的服务
export const inject = ['tools', 'llm']

export function apply(ctx: Context) {
  // 当 apply 被执行时，ctx.tools 和 ctx.llm 一定可用
  // Cordis 保证：所有 inject 中声明的服务都已就绪
  console.log('tools available:', !!ctx.tools)
  console.log('llm available:', !!ctx.llm)
}
```

这和使用 IoC 容器的模式一样：
- Python 的类型注解：`def __init__(self, tools: ToolService, llm: LLMService)`
- Spring 的构造函数注入：`public MyPlugin(ToolService tools, LLMService llm)`

Cordis 的 inject 就是同一个模式的 TypeScript 实现，只不过注入的 key 是字符串而非类型。

### 多个依赖和可选依赖

```ts
import type { Context } from '@deepseek-ai/cordis'

// 声明多个依赖——数组中的每一项 Cords 都会确保可用
export const inject = ['tools', 'llm', 'sessions', 'fs']

export function apply(ctx: Context) {
  // 所有四个服务现在都可用
  ctx.tools.register({...})
  ctx.llm.sendMessage(...)
}

// 可选依赖：如果你只是"可能需要"某个服务，不声明 inject，
// 在运行时通过 ctx.get() 安全读取
export function applyWithOptional(ctx: Context) {
  // ctx.get('fs') 返回服务值或 undefined
  // 第二个参数 strict=false：即使提供方 fiber 不活跃也返回
  const fs = ctx.get('fs', false)
  if (fs) {
    // 文件系统可用
  } else {
    // 文件系统未提供，降级处理
  }
}
```

### 不声明 inject 会怎样

```ts
import type { Context } from '@deepseek-ai/cordis'

export function apply(ctx: Context) {
  // 没有声明 inject: ['tools']，直接访问 ctx.tools
  // 如果 tools 服务还未就绪，ctx.tools 是 undefined
  // 调用 ctx.tools.register() 会抛出 TypeError
  ctx.tools.register(...) // ❌ TypeError: Cannot read properties of undefined
}
```

**原则：** 只要访问 `ctx.<name>` 对应的服务，就在 `inject` 中声明它。这不是可选的最佳实践，而是必选的正确性要求。

### inject 的底层机制

```ts
// inject 声明后，Cordis 的工作流程：
// 1. 插件注册到 registry，状态变为 PENDING
// 2. Cordis 检查 tools 和 llm 是否已提供
// 3. 如果未就绪 → 保持 PENDING，等提供方加载完成后自动触发
// 4. 如果已就绪 → 状态变为 LOADING，执行 apply
// 5. 如果依赖的服务被卸载 → 插件自动卸载（ACTIVE → DISPOSED）
// 6. 如果依赖的服务重新提供 → 插件自动重新加载
```

这就是**依赖驱动的加载**：插件启动顺序由依赖图决定，而非配置文件中列的先后顺序。两个不互相依赖的插件甚至可以并发加载。

### 这一节你学到了什么

- `inject` 数组声明插件需要的服务，Cordis 保证它们就绪后才执行 `apply`
- 可选依赖通过 `ctx.get(name, false)` 在运行时安全读取，不返回 undefined
- 不声明 inject 直接访问服务会导致运行时报错
- 依赖驱动的加载：依赖图决定插件加载顺序，而非 YAML 排列顺序

---

## 3.4 事件系统

Cordis 的事件系统可以让插件之间解耦通信。它的核心 API 只有两个方向：

- **发送端**：`ctx.emit()` / `ctx.waterfall()` / `ctx.parallel()` / `ctx.serial()` / `ctx.bail()`
- **接收端**：`ctx.on(event, handler)`

### 基础用法：监听事件

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'event-listener'

export function apply(ctx: Context) {
  // ctx.on 注册事件监听器，返回资源释放函数
  // 不需要手动调用这个函数——插件卸载时框架自动清理
  const dispose = ctx.on('session/created', (session) => {
    // 每当新会话创建时，这个回调会被调用
    ctx.logger('event-listener').info('new session:', session.id)
  })

  // ctx.once 只触发一次
  ctx.once('ready', () => {
    ctx.logger('event-listener').info('system ready')
  })
}
```

`ctx.on()` 的第一个参数是事件名，第二个参数是监听函数。监听函数在对应事件分发时被调用。

### 五种分发模式

不同事件使用不同的分发模式。模式决定了监听器的执行方式和返回值处理。

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dispatch-demo'

export function apply(ctx: Context) {
  // ── emit：广播——所有监听器都会收到，不等待，不收集返回值 ──
  // 适用于"通知"类事件，比如会话创建、用户登录
  ctx.emit('session/created', { id: 's-001' })
  // 所有监听 session/created 的插件都会收到通知

  // ── waterfall：瀑布——每个监听器包裹下一个，类似洋葱模型 ──
  // 每个监听器接收 (...args, next)，调用 next() 委托给下一个
  // 适用于需要"拦截并包装"的场景，比如权限检查
  // 注意：waterfall 不返回 Promise，但它通常会有一个 next 回调

  // ── parallel：并行——所有监听器并发执行，都完成后继续 ──
  // 适用于互相独立的监听任务，比如并发写日志、并发通知
  // 返回 Promise<void>，等所有监听器 settle 后兑现

  // ── serial：串行——按注册顺序执行，支持异步，直到某个监听器返回非空值 ──
  // 适用于"第一个能处理的就处理"的场景，比如事件路由

  // ── bail：竞速——同步执行，直到某个监听器返回真值 ──
  // 适用于"谁能处理谁来"的同步场景
}
```

实际开发中你很少需要主动分发事件（那是框架作者的事），更多的是**监听事件**。但理解五种模式能帮你更快读懂框架代码。

| 模式 | 异步？ | 执行顺序 | 有返回值？ | 典型用途 |
|------|--------|---------|-----------|---------|
| `emit` | 否 | 按注册顺序 | 否 | 通知广播 |
| `waterfall` | 否 | 按注册顺序（包裹链） | 是（next 返回值） | 中间件拦截 |
| `parallel` | 是 | 并发 | 否 | 独立并行任务 |
| `serial` | 是 | 按注册顺序依次 | 是（首个 bail 值） | 事件路由 |
| `bail` | 否 | 按注册顺序 | 是（首个真值） | 策略选择 |

### 实用场景：监听 tools/pre-execute 做权限控制

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'permission-checker'

// 这个插件依赖 tools 服务
export const inject = ['tools']

export function apply(ctx: Context) {
  // tools/pre-execute 是一个 waterfall 事件
  // 在每个工具执行之前触发
  // 监听器可以允许、拒绝或修改工具调用

  ctx.on('tools/pre-execute', (call, next) => {
    // call 结构：{ name: string, args: Record<string, any> }

    // 拒绝危险工具
    if (call.name === 'shell.exec') {
      const command = call.args.command as string
      if (command.includes('rm -rf') || command.includes('sudo')) {
        // 不调用 next() 直接返回 = 阻止执行
        // 框架根据返回值生成错误消息
        return { deny: true, reason: '高危命令被禁止' }
      }
    }

    // 允许执行：调用 next() 继续向下传递
    return next()
  })
}
```

这个例子中：
- `ctx.on('tools/pre-execute', handler)` 注册一个 waterfall 监听器
- 监听器检查工具调用的参数，决定是拒绝还是放行
- `next()` 调用链上的下一个监听器，不调用则中断链

作为插件作者，你大部分时间只需要 `ctx.on(event, handler)` 来监听事件。需要主动分发时，根据场景选择对应的模式。

### 这一节你学到了什么

- 事件系统是插件间解耦通信的机制：`ctx.on()` 监听，`ctx.emit()`/`ctx.waterfall()` 等分发
- 五种分发模式：emit（广播）、waterfall（中间件）、parallel（并发）、serial（串行）、bail（竞速）
- `ctx.on()` 注册的监听器在插件卸载时自动移除
- waterfall 模式适合做中间件——调用 `next()` 委托，不调用则阻止

---

## 3.5 自动清理（ctx.effect）

你在第 2 章已经用过 `ctx.effect()`。这一节深入它的语义和追踪范围。

### effect 的语义

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'effect-demo'

export function apply(ctx: Context) {
  // ctx.effect() 接受一个工厂函数
  // 工厂函数立即执行
  // 工厂函数可以返回一个"清理函数"
  // 清理函数在以下时机被执行（逆序）：
  //   1. 插件卸载（配置变更、HMR、依赖消失等）
  //   2. 手动调用返回的 dispose 函数

  ctx.effect(() => {
    // —— 初始化阶段（插件加载时执行）——
    console.log('effect: setting up')
    const connection = createConnection()

    // —— 返回清理函数（插件卸载时执行）——
    return () => {
      console.log('effect: tearing down')
      connection.close()
    }
  })
}

function createConnection() {
  console.log('connection created')
  return { close: () => console.log('connection closed') }
}
```

加载时的输出：
```
effect: setting up
connection created
```

卸载时的输出：
```
effect: tearing down
connection closed
```

### 实际例子：定时器和网络连接

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'resource-manager'

export function apply(ctx: Context) {
  // —— 示例 1：定时器清理 ——
  ctx.effect(() => {
    const timer = setInterval(() => {
      // 定期执行某些任务
      console.log('polling...')
    }, 10000)

    // 返回清理函数：卸载时清除定时器
    // 如果不返回清理函数，定时器会继续运行（内存泄漏 + 重复执行）
    return () => clearInterval(timer)
  })

  // —— 示例 2：WebSocket 连接 ——
  ctx.effect(() => {
    const ws = new WebSocket('wss://example.com/events')

    ws.onopen = () => console.log('connected')
    ws.onmessage = (msg) => console.log('received:', msg.data)

    // 返回清理函数：卸载时关闭连接
    return () => {
      ws.close()
      console.log('websocket closed')
    }
  })

  // —— 示例 3：多个清理操作放在一个 effect 中 ——
  // 如果需要确保清理顺序，把相关操作放在同一个 effect 中
  ctx.effect(() => {
    const resourceA = acquireResourceA()
    const resourceB = acquireResourceB()

    // 清理函数中，先释放 B、再释放 A
    // 因为清理是按逆序执行的
    return () => {
      resourceB.release()
      resourceA.release()
    }
  })
}
```

### 哪些操作会被自动追踪

以下操作不需要手动 `ctx.effect()`——Cordis 内部已经包装好了清理逻辑：

| 操作 | 清理时机 |
|------|---------|
| `ctx.on(event, handler)` | 卸载时自动移除监听器 |
| `ctx.plugin(childPlugin)` | 卸载时递归卸载子插件 |
| `ctx.tools.register(tool)` | 卸载时自动撤销工具注册 |
| `ctx.provide(name, value)` | 卸载时自动取消注册 |
| `ctx.llm.registerAdapter(...)` | 卸载时自动撤销适配器 |

这些方法的底层都调用了 `ctx.effect()`。所以你能享受到自动清理的好处，而不需要手动写 `removeListener()` 或 `unregister()`。

### 什么时候需要手动 ctx.effect()

需要手动 `ctx.effect()` 的场景：

1. **原生 Node.js 资源**：`setInterval`、`setTimeout`、文件句柄、网络套接字
2. **第三方库资源**：进程（`child_process`）、监听端口（`server.close()`）
3. **有清理顺序要求的资源**：A 释放必须在 B 释放之前完成

**原则：** 如果你的插件创建了任何"不归 Cordis 框架管理的资源"，都应该用 `ctx.effect()` 注册清理逻辑。

### 这一节你学到了什么

- `ctx.effect(factory)` 注册带自动清理的资源：factory 在加载时执行，返回的清理函数在卸载时逆序执行
- 框架 API 的注册（`ctx.on`、`ctx.plugin`、`ctx.tools.register` 等）自带清理，无需额外包装
- 原生资源（定时器、连接、进程）需要手动用 `ctx.effect()` 注册清理逻辑
- 有顺序依赖的清理步骤放在同一个 effect 中

---

## 3.6 插件配置（Config + Schema）

简单插件不需要配置。但大多数真实插件需要让使用者传入参数——API Key、超时时间、行为开关等。

### 定义 Config 类型和 Schema

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

// 1. 导出 Config 接口（TypeScript 类型）
export interface Config {
  greeting: string      // 必选，用户在 cordis.yml 中必须提供
  maxRetries: number    // 必选
  verbose?: boolean     // 可选（? 标记）
}

// 2. 导出同名的 Config Schema（运行时校验规则）
//    Schema 定义默认值、类型校验、必填约束
export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  maxRetries: Schema.number().default(3),
  verbose: Schema.boolean().default(false),
})

// 3. apply 接收第二个参数：经过校验后的配置对象
export const name = 'configurable-plugin'

export function apply(ctx: Context, config: Config) {
  // config 的类型由 Config 接口推导，是类型安全的
  console.log(config.greeting)   // 用户传入的值，或 'Hello'
  console.log(config.maxRetries) // 用户传入的值，或 3
  console.log(config.verbose)    // 用户传入的值，或 false
}
```

关键点：
- **`Config` 既是类型（interface），也是值（Schema）**——TypeScript 允许同名的类型和值共存，Cordis 利用这一点在加载时做类型检查 + 运行时校验
- Schema 的 `.default()` 设置默认值，当用户在 YAML 中未提供该字段时使用
- `apply` 的第二参数 `config` 的类型来自 `Config` interface

### 在 cordis.yml 中传入配置

```yaml
- insert:
    - id: my-greeter
      name: '/path/to/configurable-plugin.ts'
      config:
        greeting: '你好'
        maxRetries: 5
```

字段说明：
- `config` 是 YAML 对象，对应插件的 `Config` 类型

配置变更时发生了什么？

```yaml
# 修改前
config:
  greeting: '你好'
  maxRetries: 5

# 修改后（保存文件后触发 HMR）
config:
  greeting: 'Hello'
  maxRetries: 10
```

当 HMR（热模块替换）检测到 `cordis.yml` 变更后：
1. Cordis 卸载旧插件实例（自动清理所有注册资源）
2. 用新配置校验 schema
3. 加载新插件实例（执行 apply，传入新 config）

由于所有注册都是自动清理的，热替换后不会残留旧实例的注册。

### 严格校验示例

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export interface Config {
  apiKey: string              // API Key 必填
  timeout: number             // 超时时间
  mode: 'fast' | 'accurate'  // 只能是这两个字面量之一
}

export const Config = Schema.object({
  apiKey: Schema.string().required(),  // required() = 用户必须提供
  timeout: Schema.number().default(30000),
  mode: Schema.union(['fast', 'accurate']).default('fast'),
})

export const name = 'llm-client'

export function apply(ctx: Context, config: Config) {
  // config.apiKey 一定是 string，不会 undefined
  // config.mode 一定是 'fast' 或 'accurate'
  // 配置不合法时，插件根本不会加载到这里
}
```

`Schema.string().required()` 表示用户必须在 YAML 中提供该字段。如果用户未提供 `apiKey`，Cordis 会在加载时直接报错，插件不会进入 `apply`。

### 设计原则：凡事可配置

Harness 的一个约定：**不同部署可能需要采用不同值的参数，都定义为配置字段**。

```ts
// ❌ 错误：硬编码不可配置
const TIMEOUT = 30000

// ✅ 正确：通过配置暴露
export interface Config {
  timeoutMs: number
}
export const Config = Schema.object({
  timeoutMs: Schema.number().default(30000),
})
```

检验标准：能否在 `cordis.yml` 中改变这个值，而不需要修改代码？

### 这一节你学到了什么

- 导出 `Config` 接口定义类型，导出同名 Schema 定义校验和默认值
- `apply(ctx, config)` 的第二参数是经过校验的配置对象，类型安全
- 通过在 `cordis.yml` 的 `config` 字段传入配置
- 配置变更触发 HMR：自动卸载旧实例 → 校验新配置 → 加载新实例
- Schema 的 `required()` 强制用户提供，`default()` 设定缺省值

---

## 3.7 本章小结

你现在掌握了 Cordis 框架中写插件必需的 5 个概念：

| 概念 | 一句话总结 | 核心 API |
|------|-----------|---------|
| **Context** (ctx) | 插件的运行环境，集成容器 + 事件 + 生命周期 | `ctx.on()`、`ctx.plugin()`、`ctx.effect()` |
| **依赖注入** (inject) | 声明需要的服务，Cordis 保证就绪后才执行插件 | `export const inject = ['tools']` |
| **事件系统** | 插件间通过事件解耦通信，5 种分发模式 | `ctx.on()`、`ctx.emit()` |
| **自动清理** (effect) | 所有注册的资源在卸载时自动回收 | `ctx.effect(() => cleanup)` |
| **配置** (Config + Schema) | 让使用者通过 `cordis.yml` 传入参数 | `Config` interface + Schema |

**你现在能做到的是：**
- 看懂一个内置插件的源码结构，理解它各部分的作用
- 知道 `inject`、`config`、`effect`、`event` 在插件中扮演什么角色
- 对生命周期有清晰的认识：加载 → 依赖就绪 → apply → 运行 → 卸载 → 自动清理

### 下一章预告

第 4 章你会写第一个真正的工具插件——注册一个自定义工具让 LLM 调用，并把它打包发布。这是你从"理解原理"走向"干活"的关键一步。
---
← [环境搭建与第一个插件](02-环境搭建与第一个插件.md) | [返回目录](README.md) | [动手写第一个工具插件](04-动手写第一个工具插件.md) →
