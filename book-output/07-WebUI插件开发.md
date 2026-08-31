# WebUI插件开发

> ← [LLM 与大模型集成](06-LLM与大模型集成.md) | [目录](README.md) | [dsh-open-editor 实战](08-实战-dsh-open-editor插件开发全过程.md) →

> **参考文档：**
> - [../docs/cookbook/adding-a-settings-card.zh.md](../docs/cookbook/adding-a-settings-card.zh.md) — 设置卡片编写指南
> - [../docs/subsystems/web-client.zh.md](../docs/subsystems/web-client.zh.md) — Web 客户端子系统
> - [../docs/subsystems/conversation.zh.md](../docs/subsystems/conversation.zh.md) — 对话子系统
> - [../docs/subsystems/client-modules.zh.md](../docs/subsystems/client-modules.zh.md) — 客户端模块系统
> - [../docs/web-styling.zh.md](../docs/web-styling.zh.md) — Web 样式参考
---

## 7.1 Web UI 插件概览

### Host 侧 vs Client 侧

Harness Web UI 采用**前后端分离**架构。一个完整的 UI 插件包含两个半侧，住在同一个包里：

- **Host 侧**（Node.js，`src/`）：注册后台服务和数据。Host 拥有权威状态、持久化和访问策略。
- **Client 侧**（浏览器，`src/client/`）：注册 UI 组件。Client 维护 Host 状态的镜像，驱动渲染。

这种分离意味着：你在 Host 侧定义"有什么可配置的"，在 Client 侧决定"怎么让用户配置它"。两个半侧通过命名空间（namespace）配对，互不依赖对方的运行时。

### 客户端模块系统

Host 在启动时将启用了 `dsh.client` 的插件组合成模块图，注入到页面的 `window.__DSH_BOOT__` 中。浏览器侧的模块加载器是一个 lazy CommonJS 表：加载 bundle 时只注册 factory，真正使用时才以同步 `require` 执行。

Client 插件通过 `exports["./client"]` 导出构建后的 bundle，在 `package.json` 中声明 `dsh.client` 即可让模块系统自动发现：

```jsonc
{
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }
  },
  "dsh": { "client": { "platform": "web" } }
}
```

### Hello World：最简 UI 插件

以下是一个完整的 UI 插件示例。Host 侧注册一个命名空间和配置 schema：

```ts
// src/index.ts（Host 侧）
import { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

export const NS = settingsNamespace('my-hello')

export const Config = z.object({
  name: z.string().default('World'),
})

export function apply(ctx: Context, config: z.infer<typeof Config>) {
  // ...
}
```

Client 侧注册一个设置卡片：

```ts
// src/client/index.ts（Client 侧）
import { Context as ClientContext } from '@deepseek-ai/cordis'

export const inject = ['slots', 'settingsScope']

export function apply(ctx: ClientContext): void {
  const scope = ctx.settingsScope.bind({ namespace: 'my-hello' })
  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register({
      name: 'settings.plugin.item',
      key: 'my-hello',
    }, MyCard)
  )
}
```

这就是 UI 插件的基本骨架。接下来我们深入每一层。

## 7.2 注册设置卡片

设置卡片是插件开发者最常见的 UI 需求：让用户通过 Harness 的设置页面配置插件行为。

### 命名空间（namespace）

命名空间是 Host 侧和 Client 侧之间唯一的配对键。它标识用户配置文档中的一个插件专属分节（section），也是卡片在设置页面中的标识。

在 Host 侧创建命名空间：

```ts
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

export const MY_PLUGIN_NS = settingsNamespace('my-plugin')
```

`settingsNamespace()` 构造一个 branded 类型，防止命名空间 ID 与其他类型的 ID 混淆。构造时会校验**小写 kebab-case** 语法。

### Host 侧注册

通过 `installSettingsSection` 在 Host 侧绑定 schema 和配置：

```ts
import { installSettingsSection } from '@deepseek-ai/dsh-settings'

export const Config = z.object({
  endpoint: z.string(),
  retries: z.number().step(1).min(0).default(3),
  apiKey: z.string().role('secret'),
})

export function apply(ctx: Context, config: z.infer<typeof Config>) {
  let source = () => config

  installSettingsSection(ctx, MY_PLUGIN_NS, Config, config, {
    validate: value => {
      if (!value.endpoint?.startsWith('https://')) {
        throw new Error('endpoint 必须以 https:// 开头')
      }
    },
    setSource: (current) => { source = current },
    onChange: () => { rebuildFromSettings(source()) },
  })
}
```

这里的 `role('secret')` 标记字段为机密值——它永远不会出现在传给浏览器的响应中。`validate` 钩子在 schema 校验之后运行，用于处理跨字段约束。`applies: 'restart'` 可告诉 UI：变更需要重启才能生效。

### Client 侧注册卡片

Client 侧在 `settings.plugin.item` slot 上注册卡片组件：

```ts
// src/client/index.ts
import { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'

export const inject = ['slots', 'locale', 'settingsScope']

export function apply(ctx: ClientContext): void {
  const scope = ctx.settingsScope.bind({ namespace: 'my-plugin' })

  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register({
      name: 'settings.plugin.item',
      key: 'my-plugin',
      locale: 'settings.myPlugin',
    }, MyPluginCard)
  )
}
```

slot 的 `key` 必须与 Host 侧注册的命名空间名称一致。设置页面会读取 Host 服务了哪些命名空间，并为每个命名空间派发 slot 键——只有当卡片注册了该键时才会被渲染。

### 卡片组件

卡片组件接收 scope 快照，用于渲染表单和读写配置：

```tsx
// src/client/card.tsx
import { createElement, useState } from 'react'
import type { SettingsCardProps } from '@deepseek-ai/dsh-client-ui-settings-plugins/client'

export function MyPluginCard({ scope }: SettingsCardProps) {
  const [draft, setDraft] = useState({ ...scope.value })

  const handleSave = () => {
    scope.replace(draft)
  }

  const handleReset = () => {
    scope.replace({})
  }

  return createElement('div', null,
    createElement('h3', null, 'My Plugin 设置'),
    createElement('label', null,
      '端点：',
      createElement('input', {
        value: draft.endpoint ?? '',
        onChange: (e: any) => setDraft({ ...draft, endpoint: e.target.value }),
      }),
    ),
    createElement('label', null,
      '重试次数：',
      createElement('input', {
        type: 'number',
        value: draft.retries ?? 3,
        onChange: (e: any) => setDraft({ ...draft, retries: Number(e.target.value) }),
      }),
    ),
    createElement('button', { onClick: handleSave }, '保存'),
    createElement('button', { onClick: handleReset }, '重置'),
  )
}
```

## 7.3 配置的读写

### ctx.settingsScope 服务

Client 侧通过 `ctx.settingsScope` 与 Host 侧的配置系统通信。它提供类型化的 scope 对象，包含解析后的值、组合 base 层、原始 user 层和 revision。

scope 快照包含：

- `value`：三层叠加后的最终值（schema 默认值 → base → user 覆盖）
- `base`：组合 base 层（通常来自 entry config）
- `user`：用户的原始覆盖层——字段是否被"覆盖"，取决于它是否出现在 `user` 中
- `revision`：单调递增的修订号，用于写入时防冲突

### 读取和修改配置

```ts
// 读取当前值
const current = scope.value    // { endpoint: 'https://...', retries: 5 }

// 逐字段设置
scope.set('retries', 10)       // 存入 user 层

// 字段重置（回到 base / 默认值）
scope.unset('retries')         // 从 user 层移除该字段
```

### 覆盖与重置

`scope.replace(section)` 整体替换 user 分节——缺席的键继承 base 和 schema 默认值。这意味着 `replace({})` 会将所有字段重置为默认值。

`scope.set(field, value)` 只合并一个字段的变更，不影响 user 层中的其他字段。

### 保存时机和 revision 栅栏

每次写入都携带一个 `expectedRevision`。如果从读取到写入之间，另一个操作已经修改了配置，revision 不匹配会拒绝此次写入，防止覆盖用户在其他标签页中做出的变更：

```ts
// 读取时的 revision: 5
const rev = scope.revision

// ... 用户编辑后保存
scope.replace(draft)  // 发送 expectedRevision=5

// 如果此时 revision 已是 6，写入被拒绝
```

## 7.4 对话界面的定制

除了设置卡片，你还可以定制 Harness 对话界面中的消息渲染。Harness 的 Conversation 子系统把持久化的 Session 事件组装成浏览器可以消费的 target snapshot。

### ConversationNodeDefinition

要自定义消息渲染，需要注册一个 `ConversationNodeDefinition`。它定义了三件事：

1. **匹配规则**：哪些事件属于同一个业务实体
2. **状态折叠**：多条事件如何合并为最终状态
3. **视图数据**：如何从状态生成渲染所需的数据

以下是一个代码审查插件的例子，它把 `review/start`、`review/progress` 和 `review/end` 事件折叠成一个可渲染的节点：

```ts
const reviewDefinition: ConversationNodeDefinition<ReviewState> = {
  kind: 'review-job',
  target: 'chat',

  // match 是身份提取器：返回 (id, role) 或 null
  match: (event) => {
    if (event.type === 'review/start') {
      return { id: String(event.data.reviewId), role: 'start' }
    }
    if (event.type === 'review/progress' || event.type === 'review/end') {
      return { id: String(event.data.reviewId), role: 'update' }
    }
    return null
  },

  // start：从 start 事件构造初始状态
  start: (_context, match) => ({
    title: match.event.data.title,
    completed: 0,
    status: 'running' as const,
  }),

  // update：把后续事件合并到状态中
  update: (context, match) => {
    if (match.event.type === 'review/progress') {
      return { ...context.state, completed: match.event.data.completed }
    }
    if (match.event.type === 'review/end') {
      return { ...context.state, completed: 100, status: 'completed' as const }
    }
    return context.state
  },

  // 高频可见 delta 使用 animation-frame 节流
  publication: match =>
    match.event.type === 'review/progress' ? 'animation-frame' : 'immediate',

  // 构建视图数据
  buildViewNode: (context) => {
    if (!context.state) return null
    return {
      key: context.key,
      kind: 'review-job',
      target: 'chat',
      anchorSeq: context.start?.event.seq ?? 0,
      location: { kind: 'unresolved' },
      visibility: 'visible',
      data: { title: context.state.title, completed: context.state.completed },
    }
  },
}
```

### 自定义消息渲染

注册 Definition 后，再注册对应的 React 渲染组件：

```ts
export const inject = ['uiConversation', 'slots']

export function apply(ctx: ClientContext): void {
  ctx.uiConversation.events.register(reviewDefinition)

  ctx.slots.inject('conversation.chat.node', () =>
    ctx.slots.register({
      name: 'conversation.chat.node',
      key: 'review-job',
    }, ReviewNodeView)
  )
}
```

渲染组件只消费 `node.data`，不扫描 Session 事件窗口：

```tsx
function ReviewNodeView({ node }: ChatNodeViewProps<'review-job'>) {
  const text = node.data.summary ??
    `${node.data.title}: ${node.data.completed}%`
  return createElement('p', null, text)
}
```

### 工具调用的 UI 卡片

工具调用在 Harness 中会被折叠成 `tool-call` 类型的节点。你也可以为自定义工具调用提供专门的 UI，方法类似——注册一个 `kind` 匹配工具调用事件的 Definition，然后注册对应渲染组件。

## 7.5 样式的定制

### CSS Modules + clsx

Harness Web UI 的组件样式使用 **CSS Modules**，依赖 `clsx` 工具拼接类名：

```tsx
import styles from './card.module.css'
import clsx from 'clsx'

function MyCard({ active }: { active: boolean }) {
  return createElement('div', {
    className: clsx(styles.card, active && styles.active),
  }, '...')
}
```

```css
/* card.module.css */
.card {
  padding: 16px;
  border-radius: 8px;
}
.active {
  background: var(--dsw-alias-bg-active);
}
```

### 语义 token 系统

Harness 定义了 `--dsw-*` 语义 token 体系。功能组件必须使用语义别名，不得直接引用静态色板值或硬编码颜色字面量：

```css
/* ✅ 正确：使用语义 token */
.my-element {
  color: var(--dsw-alias-text-primary);
  background: var(--dsw-alias-bg-secondary);
}

/* ❌ 错误：硬编码颜色 */
.my-element {
  color: #333;
  background: #f5f5f5;
}
```

### 禁止 Tailwind 的原因

Harness 有意不使用 Tailwind。主要原因有二：

1. **主题一致性**：语义 token 系统确保所有组件共享同一套颜色、排版和间距体系。任何引入外部框架的做法都可能绕过这套体系，导致界面碎片化。
2. **包大小**：Harness 的客户端采用按需加载的模块系统，Tailwind 的大尺寸 CSS 产物会破坏启动性能。

功能组件 CSS 中不得包含主题选择器（如 `@media (prefers-color-scheme: dark)`）——明暗主题的覆盖归主题包所有。

### 字体与排版

字体大小必须与行高配对。已有的排版角色使用主题变量：

```css
.heading {
  font-size: var(--dsw-font-size-lg);
  line-height: var(--dsw-line-height-lg);
}
```

源码文本、终端输出和 diff 行中需要保留列结构的内容**不得换行**，并使用共享滚动条样式。

### 动画与可访问性

添加过渡动画或仅悬停可见的控件时，保留清晰可见的键盘焦点和 `prefers-reduced-motion` 行为。React 内联样式可以传递组件局部自定义属性值，但不得编码主题分支。

## 7.6 前端打包与构建

### Client bundle 的结构

Client bundle 必须输出为 loader 的 lazy-CJS factory 产物。本仓库内使用 `tsdown` 和共享预设：

```ts
// tsdown.config.ts
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-my-plugin')
```

以下条件缺一不可：

- bundle 必须通过 bundle 纯净度门禁（拒绝跨插件的值导入）
- `exports["./client"]` 必须指向构建后的 bundle
- `dsh.client` 声明必须与 package.json 中的 `exports` 一致

### 浏览器模块加载机制

启动时序如下：

1. Host 将组合后的 `WebBootGraph` 写入 `window.__DSH_BOOT__`
2. 模块加载器创建 lazy CJS 表（只注册 factory，不执行）
3. bootstrap 阶段的 bundle 在 Vite entry 之前执行
4. application 阶段的 bundle 预加载，但延迟执行
5. Cordis service injection 决定激活顺序
6. `ui-renderer` 挂载根组件树

### 调试 UI 插件

开发环境下，HMR（热模块替换）由 `dsh-client-hmr` 提供。它在 Host 侧轮询 bundle 文件变化，检测到变更后通过 SSE 广播新 revision 给浏览器。浏览器侧的模块加载器只替换变更的 bundle factory，保持应用状态不丢失。

`ctx.clientModules.rebuilt(id)` 是 bundle 内容变化到达图的唯一入口，重新哈希后根据需要重组模块图。

### 包边界规则

功能插件包可以通过 `import type` 共享声明，但不得运行时导入或转发另一个功能插件的运行时值。跨包行为使用 Cordis service，跨包 UI 使用 Slots。这条规则确保每个插件 bundle 可独立加载和版本化。

## 7.7 本章小结

本章覆盖了 Harness Web UI 插件的完整开发路径：

1. **架构理解**：区分 Host 侧（服务端权威状态）和 Client 侧（浏览器视图），理解命名空间的配对机制
2. **设置卡片**：在 Host 侧注册 schema 和业务逻辑，在 Client 侧注册卡片组件和表单
3. **配置读写**：使用 `ctx.settingsScope` 读取解析值、修改 user 层、理解 revision 栅栏的防冲突作用
4. **对话定制**：通过 `ConversationNodeDefinition` 注册自定义消息渲染，把持久化事件折叠为可渲染的 UI 节点
5. **样式系统**：遵守 CSS Modules + `clsx` 规范，使用 `--dsw-*` 语义 token，了解不使用 Tailwind 的原因
6. **打包构建**：掌握 `tsdown` 配置、模块加载机制和 HMR 调试

下一章将深入介绍如何为 Harness 添加自定义的 LLM 后端支持，让插件的 AI 能力不再局限于内置的模型提供方。
---
← [LLM 与大模型集成](06-LLM与大模型集成.md) | [返回目录](README.md) | [dsh-open-editor 实战](08-实战-dsh-open-editor插件开发全过程.md) →
