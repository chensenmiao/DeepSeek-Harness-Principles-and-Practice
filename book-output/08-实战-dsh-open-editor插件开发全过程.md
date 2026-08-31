# 实战-dsh-open-editor插件开发全过程

> ← [WebUI 插件开发](07-WebUI插件开发.md) | [目录](README.md) | [Plugin Builder 实战](09-实战-PluginBuilder预设与需求驱动开发.md) →

> **参考文档：**
> - [../dsh-open-editor/](../dsh-open-editor/) — 本案例源码目录
> - [../docs/subsystems/commands.zh.md](../docs/subsystems/commands.zh.md) — 命令子系统
> - [../docs/subsystems/subprocess.zh.md](../docs/subsystems/subprocess.zh.md) — 子进程服务
> - [../docs/subsystems/slots.zh.md](../docs/subsystems/slots.zh.md) — Slot 插槽系统
> - [../docs/subsystems/web-client.zh.md](../docs/subsystems/web-client.zh.md) — Web 客户端模块加载
---

---

## 8.1 需求分析

### 场景

使用 dsh Web UI 时，你经常需要跳转到本地编辑器查看或修改当前会话的工作目录里的文件。比如：

- Agent 生成了一个项目脚手架，你想在 VS Code 里打开看看。
- 你在调试一个插件，需要频繁编辑工作目录下的代码。
- 你想在终端执行命令，但 Web UI 里的终端不够顺手，不如本地编辑器方便。

每次都要手动记下路径、打开终端、敲 `code <路径>`——虽然只有三步，但一天做几十次就很烦。

### 功能需求

1. 在 Web UI 的会话头部增加一个按钮，点击后用本地编辑器打开当前会话的工作目录。
2. 按钮应显示当前状态（空闲、正在打开、出错）。
3. 错误时按钮显示错误信息，让用户知道发生了什么。

### 非功能需求

1. **不阻塞 UI**：启动编辑器是异步操作，不能卡住浏览器界面。
2. **跨平台兼容**：同一份代码要在 Windows、macOS、Linux 上都能正常工作。
3. **零新增 API**：不修改 dsh 核心代码，不做 typert / tsdown 构建。
4. **可分发**：插件应该能被打包发布，朋友一条命令即可安装。

### 用户故事

> 作为 dsh Web UI 用户，我想在会话头部点击一个按钮就能用本地编辑器打开当前工作目录，这样我就不用手动复制路径到终端了。

---

## 8.2 架构设计

### 架构全景

`dsh-open-editor` 的架构非常简单：

```
┌─────────────────────────────────────────────────┐
│                  Host (Node.js)                  │
│  lib/index.js                                   │
│  ├── 注册 "/open-editor" 斜杠命令               │
│  └── 收到命令 → spawn("code", <cwd>)            │
└──────────────────────┬──────────────────────────┘
                       │ commands Remote (已有)
                       │ ctx.remote.commands.execute()
                       ▼
┌─────────────────────────────────────────────────┐
│                Client (浏览器)                   │
│  lib/client.js                                  │
│  ├── 插槽注入: conversation.session.header.     │
│  │             utilities                        │
│  └── OpenEditorButton 组件                      │
│       ├── 点击时调用 remote.commands.execute()   │
│       └── useState 管理 busy/error 状态          │
└─────────────────────────────────────────────────┘
```

关键设计决策：

**为什么选择这种架构？** dsh Web UI 已经有一个 `commands` Remote 命名空间，Host 侧用它注册斜杠命令，Client 侧通过 `ctx.remote.commands.execute()` 调用。我们完全复用这个机制——不需要新增任何 API，不需要生成 typert 绑定，不需要 tsdown 构建。插件只是一个纯 JS 包和一个手写的浏览器 bundle。

**Host 做什么？** 注册 `/open-editor` 命令。handler 解析会话的工作目录，spawn 本机的 `code` CLI。

**Client 做什么？** 在会话头部插槽注入一个按钮。点击时通过 Remote 调用 `/open-editor` 命令。

### 为什么不需要构建

第 7 章介绍的 Client 插件使用 TypeScript + JSX，需要 tsdown 编译。而我们这个插件采用**纯手写 CJS 格式**，直接写原生 `React.createElement`，没有 JSX 编译步骤。dsh 的浏览器模块加载器 `window.__ModuleLoader__` 可以直接加载这样的手写 bundle。

这个选择降低了插件的构建门槛——你只需要写两个 js 文件和一个 package.json，不需要配置 TypeScript、tsdown、webpack。

---

## 8.3 Host 侧实现（lib/index.js）

Host 侧代码位于 `dsh-open-editor/lib/index.js`，共 66 行。职责是：注册 `/open-editor` 斜杠命令，收到命令后 spawn 本机 `code` CLI 打开工作目录。

### launchEditor() 函数

我们先看核心函数 `launchEditor`，它负责在操作系统层启动编辑器：

```javascript
// lib/index.js 第 19-40 行

function launchEditor(subprocess, target) {
  return subprocess.resolveExecutable('code')
    .then((code) => {
      const lower = String(code).toLowerCase()
      const isCmdShim = lower.endsWith('.cmd') || lower.endsWith('.bat')
      const argv = isCmdShim
        ? ['cmd.exe', '/d', '/c', code, target]
        : [code, target]
      try {
        const handle = subprocess.spawn({
          argv,
          cwd: target,
          stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
          graceMs: 5000,
        })
        return { ok: true, pid: handle.pid }
      } catch (err) {
        return { ok: false, error: String(err && err.message ? err.message : err) }
      }
    })
    .catch((err) => ({ ok: false, error: String(err && err.message ? err.message : err) }))
}
```

**逐行解读：**

`subprocess.resolveExecutable('code')` —— 使用 dsh 的子进程服务解析 `code` 的完整路径。`code` 是 VS Code / Qoder / Cursor 等编辑器的 CLI 命令，需要在系统的 PATH 环境变量里能找到。

`isCmdShim` 判断——Windows 上 `code` 命令实际上是一个 `.cmd` 或 `.bat` 脚本（垫片 shim）。Node.js 的 `child_process.spawn` 无法直接执行 `.cmd/.bat` 文件，会抛出 `EINVAL` 错误。这是 Windows 平台的一个常见陷阱。解决方法是：通过 `cmd.exe /d /c` 来间接启动。`/d` 禁用注册表 AutoRun，`/c` 执行命令后终止。

非 Windows 平台（macOS / Linux）上，`code` 是真正的可执行文件，直接 spawn 即可。

`subprocess.spawn()` 的参数：
- `argv`：命令和参数数组。
- `cwd: target`：将子进程的工作目录设置为目标目录（实际上也是编辑器的目标目录）。
- `stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }`：完全忽略子进程的 IO，不等待它输出任何东西。这是**非阻塞 spawn** 的关键——我们不收集 stdout/stderr，也不等进程退出。
- `graceMs: 5000`：子进程的优雅关闭超时（5 秒），但因为我们从不主动关闭它，这个值只在清理时有用。

返回值：成功返回 `{ ok: true, pid: ... }`，失败返回 `{ ok: false, error: ... }`。两级 `.catch()` 确保不管是 `resolveExecutable` 失败还是 `spawn` 失败，都返回一致的错误对象。

### 插件注册

```javascript
// lib/index.js 第 43-64 行

export const name = 'dsh-open-editor'
export const inject = ['commands', 'subprocess']

export function apply(ctx) {
  ctx.commands.register({
    name: 'open-editor',
    description: 'Open the session working directory in your local editor (VS Code / Qoder / code CLI)',
    handler: async (invocation) => {
      const target = invocation.agent?.session?.header?.cwd
      if (!target) {
        return { kind: 'error', text: 'open-editor: no session working directory to open' }
      }
      const result = await launchEditor(ctx.subprocess, target)
      if (!result.ok) {
        return { kind: 'error', text: `open-editor: ${result.error}` }
      }
      return { kind: 'success', text: `Editor opened in ${target}` }
    },
  })
}

export default { name, inject, apply }
```

**`inject` 声明依赖**：`['commands', 'subprocess']`。这告诉 Cordis 框架：本插件启动前，`commands`（命令注册表）和 `subprocess`（子进程服务）必须已就绪。`ctx.commands` 和 `ctx.subprocess` 会在 apply 运行时自动注入。

**`ctx.commands.register()`** 注册一个名为 `open-editor` 的斜杠命令。注意这里的 name 是 `open-editor`（无斜杠前缀），dsh 框架会自动将其映射为 `/open-editor`。description 是展示给用户的帮助文本。

**handler 解析 `invocation`**：`invocation.agent?.session?.header?.cwd` 是一个可选链表达式，安全地读取调用上下文的会话工作目录。

- `invocation` 是命令调用的上下文对象。
- `invocation.agent` 是调用该命令的 agent 实例。
- `agent.session` 是当前会话。
- `session.header.cwd` 是会话头里记录的工作目录。

如果 `cwd` 不存在（比如会话没有关联的工作目录），返回 error 结果。

**命令返回值**：dsh 命令 handler 返回固定格式：`{ kind, text }`。`kind` 取 `'success'` 或 `'error'`，`text` 是用户可见的消息。

**为什么 `inject` 在变量声明而不是参数里？** Cordis 采用声明式依赖注入。`inject` 数组告诉框架"我需要这些服务"，框架在调用 `apply` 前将它们挂到 `ctx` 上。这是第 3 章介绍过的模式。

---

## 8.4 Client 侧实现（lib/client.js）

Client 侧代码位于 `dsh-open-editor/lib/client.js`，共 113 行。它是一份**手写的 CommonJS bundle**，遵循 dsh 浏览器模块加载器的 `window.__ModuleLoader__.load()` 格式。

### 模块加载格式

```javascript
// lib/client.js 第 19-24 行

window.__ModuleLoader__.load({
  id: "dsh-open-editor",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    // ... 插件的 inject + apply ...

    module.exports = { inject: inject, apply: apply };
    return module.exports;
  },
});
```

**为什么要有这种格式？** dsh 在构建 Web 页面的模块图时，需要一种 lazy 加载机制。`window.__ModuleLoader__` 是 dsh 提供的浏览器端模块加载器。`load({ id, factory })` 调用将模块注册到模块表中，但不会立即执行 factory。只有其他模块 `require("dsh-open-editor")` 时，factory 才被执行。

**`id` 必须等于包名**，因为模块图按 npm 包名索引。如果你改了 `package.json` 的 `name`，必须同步改这里的 `id`。

**`factory` 接收 `require` 函数**——这是模块表中的同步 require，不是 async import。factory 内部需要手动创建 `module` 和 `exports` 对象，模拟 CJS 环境。`Symbol.toStringTag` 设置为 `"Module"` 是为了让框架识别这是一个 ES module 风格的导出。

### 依赖注入

```javascript
// lib/client.js 第 29-32 行

var inject = ["slots", "remote", "remote.commands"];

var commandsRemote = null;
```

Client 侧的 `inject` 声明了三个依赖：
- `slots`：插槽注册服务，用于向会话头部注入组件。
- `remote`：Remote 命名空间入口。
- `remote.commands`：commands Remote 命名空间——这是 Host 侧 `commands` 服务的浏览器代理。

`commandsRemote` 变量在模块作用域中缓存，`apply` 时初始化一次，按钮点击时使用。

### OpenEditorButton 组件

按钮组件用原生 `React.createElement` 编写，无 JSX：

```javascript
// lib/client.js 第 38-91 行

function OpenEditorButton(props) {
  var sessionId = props && props.sessionId;
  var state = react.useState({ busy: false, error: null });
  var view = state[0];
  var setView = state[1];

  var onClick = function () {
    if (view.busy || commandsRemote === null) return;
    setView({ busy: true, error: null });
    Promise.resolve(commandsRemote.execute(sessionId, "/open-editor", []))
      .then(function (res) {
        if (!res) return { ok: false, error: "failed to open editor" };
        if (!res.ok) return { ok: false, error: (res.error && (res.error.message || res.error.code)) || "failed to open editor" };
        if (res.value === undefined || res.value === null) return { ok: false, error: "/open-editor command not found" };
        var result = res.value.result;
        if (!result) return { ok: false, error: "no command result" };
        if (result.kind === "error") return { ok: false, error: result.text || "command failed" };
        return { ok: true };
      })
      .catch(function () {
        return { ok: false, error: "failed to open editor" };
      })
      .then(function (outcome) {
        setView({ busy: false, error: outcome.ok ? null : outcome.error });
      });
  };

  return react.createElement(
    "button",
    {
      type: "button",
      onClick: onClick,
      disabled: view.busy,
      title: view.error ? view.error : "Open in editor",
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        cursor: view.busy ? "default" : "pointer",
        border: "1px solid rgba(127,127,127,0.35)",
        background: "transparent",
        color: "inherit",
        borderRadius: 6,
        padding: "3px 9px",
        fontSize: 12,
        lineHeight: "16px",
        opacity: view.busy ? 0.6 : 1,
      },
    },
    react.createElement("span", { "aria-hidden": "true", style: { fontSize: 13, lineHeight: 1 } }, "\u2328"),
    view.busy ? "Opening\u2026" : "Editor",
  );
}
```

**状态管理**：`react.useState({ busy: false, error: null })` 返回一个数组，解构为 `view`（当前状态）和 `setView`（更新函数）。这是 React Hooks 的手写等价写法。

**点击处理 `onClick`**：
1. 如果按钮正在忙或 `commandsRemote` 还没初始化，直接 return（防抖）。
2. 设置 `busy: true`，清空错误。
3. 调用 `commandsRemote.execute(sessionId, "/open-editor", [])`——第一个参数是会话 ID，第二个参数是命令名（带斜杠前缀），第三个参数是命令参数数组（这里为空）。
4. 返回的 Promise 经过多层检查：检查 Remote 调用本身是否成功、命令是否存在、命令结果是否有效。
5. 最终更新状态，显示错误或清空错误。

**为什么 `Promise.resolve()` 包裹 `commandsRemote.execute()`？** 因为 `commandsRemote.execute()` 可能同步返回（如果 Remote 实现是同步的）也可能返回 Promise。`Promise.resolve()` 统一包装确保 `.then()` 链始终可用。

**组件渲染**：用 `react.createElement("button", ...)` 创建按钮元素。内联样式匹配 Web UI 的整体视觉风格——透明背景、继承字体颜色、圆角边框。按钮内容是一个键盘图标（`\u2328`，即 `⌨`）加文本。忙碌时文本变为 "Opening…"，按钮半透明且禁用。

### 插槽注册

```javascript
// lib/client.js 第 95-108 行

function apply(ctx) {
  var slots = ctx.get("slots");
  if (slots === undefined) return;
  var remote = ctx.get("remote");
  if (remote === undefined || remote.commands === undefined) return;
  commandsRemote = remote.commands;

  slots.inject("conversation.session.header.utilities", function () {
    return slots.register(
      { name: "conversation.session.header.utilities", id: "open-editor", order: 0 },
      function (props) { return react.createElement(OpenEditorButton, props); },
    );
  });
}
```

**`ctx.get("slots")`** 和 **`ctx.get("remote")`** 是 Cordis 上下文的方法，用于获取声明在 `inject` 数组中的服务。如果服务不存在（比如在旧版 dsh 上），`ctx.get()` 返回 `undefined`，插件安全退出——这是向后兼容的防御性编程。

**`slots.inject()`** 是一个**延迟注入**：它的回调在插槽系统准备好渲染时才会执行。回调内部调用 `slots.register()` 注册实际组件。参数：
- `{ name, id, order }`：`name` 是插槽名，必须与要注入的插槽一致；`id` 是注册的唯一标识；`order` 决定组件在插槽内的排列顺序（0 表示最前）。
- 第二个参数是一个工厂函数：接收插槽传递给组件的 props，返回 React 元素。

**目标插槽：`conversation.session.header.utilities`**。这是 dsh Web UI 为会话头部预留的实用工具插槽，位置在右上角，和下载日志按钮同级。注册在这个插槽的组件会显示为会话头部的一排按钮。

### 为什么不写 TypeScript/JSX

这个问题在第 7 章也有讨论，但这里值得再强调：`dsh-open-editor` 是一个**零构建插件**。纯手写 CJS 格式意味着：
1. 不需要 tsdown、webpack、esbuild 等构建工具。
2. 不需要 tsconfig.json、babel 配置。
3. 开发时修改 `lib/client.js` 后，只需刷新浏览器（实际上需要重开会话让模块图重新组合，但不需要构建步骤）。
4. 调试更方便——浏览器里看到的就是你写的代码，没有 sourcemap 对不上的问题。

什么时候应该选择构建？当你的 Client 侧代码变得复杂时——比如有多个组件文件、用了 JSX、需要类型检查。但对于这种一个文件、一个组件、全部 API 调用就一个 `execute()` 的插件，手写更简洁。

---

## 8.5 包结构与分发

### package.json 分析

```json
{
  "name": "dsh-open-editor",
  "version": "0.1.0",
  "description": "dsh web plugin: a session-header button that opens the current session working directory in your local editor",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    },
    "./client": {
      "default": "./lib/client.js"
    },
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {
      "inject": [
        "@deepseek-ai/dsh-api-remotes",
        "@deepseek-ai/dsh-client-ui-conversation"
      ],
      "platform": "web"
    },
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  },
  "files": [
    "lib/index.js",
    "lib/client.js",
    "lib/types",
    "cordis.patch.yml"
  ],
  "peerDependencies": {
    "@deepseek-ai/cordis": ">=1.0.0"
  },
  "license": "MIT"
}
```

重点字段解释：

**`"type": "module"`**——Host 侧代码使用 ES module 语法（`export` / `import`），这个是 Node.js 的 ESM 标记。

**`exports` 映射**：
- `"."`（根）→ `lib/index.js`，是 Host 侧入口。
- `"./client"` → `lib/client.js`，是 Client 侧入口。dsh 构建模块图时通过这个路径找到浏览器 bundle。
- `"./package.json"` → `./package.json`，允许其他工具读取包元数据。

**`dsh.client` 配置**——这是 dsh 识别浏览器半边的关键：
- `"inject"` 数组声明了 Client 侧需要哪些 dsh 浏览器模块作为外部依赖。`@deepseek-ai/dsh-api-remotes` 提供 Remote 命名空间，`@deepseek-ai/dsh-client-ui-conversation` 提供会话 UI 插槽。
- `"platform": "web"` 标记这是一个 Web 平台插件。

**`dsh.bundle.patch`**——`"./cordis.patch.yml"` 告诉 dsh 启动器：安装本包时自动应用这个 patch 文件。

**`files`**——限制 npm publish 发布的文件，只包含运行所需的文件，排除 README、测试等。

**`peerDependencies`**——`@deepseek-ai/cordis` 是唯一必须的 peer 依赖。dsh 本身已包含 Cordis，所以用户不需要手动安装它。

### cordis.patch.yml

```yaml
# cordis.patch.yml
- insert:
    - id: open-editor
      name: dsh-open-editor
```

这是一个**组合层 patch**，作用是在 web profile 的组合层配置中自动插入一行插件声明：
- `id`：插件实例的唯一标识，用于区分同一插件的多个实例。
- `name`：插件包名，与 `package.json` 的 `name` 一致。

当用户通过 `dsh plugin --profile web add <path>` 安装插件时，启动器读取 `package.json` 的 `dsh.bundle.patch` 发现这个 yml 文件，将其合并到 web profile 的组合层配置中。这意味着**用户不需要手动 `--patch`**，一行命令即可完成安装。

### 安装方式

**从本地目录安装（开发/分发无需发布）：**
```sh
dsh plugin --profile web add ./dsh-open-editor
```

**已经发布到 npm 后安装：**
```sh

dsh plugin --profile web add dsh-open-editor
```

### 卸载

```sh
dsh plugin --profile web remove dsh-open-editor
```

---

## 8.6 质量保证

### 边界情况处理

**code CLI 不在 PATH 上：** `subprocess.resolveExecutable('code')` 会抛出错误，被 `.catch()` 捕获，返回 `{ ok: false, error }`。Client 按钮上会显示错误信息。用户看到错误后可以安装 VS Code 或将其 CLI 加入 PATH。

**session 没有 cwd：** `invocation.agent?.session?.header?.cwd` 为 `undefined`，handler 立即返回 `{ kind: 'error', text: 'open-editor: no session working directory to open' }`。

**并发点击：** `onClick` 的第一行 `if (view.busy || commandsRemote === null) return;` 确保正在处理时不发起第二次请求。按钮在 busy 期间也设置了 `disabled: true`，防止用户从 UI 层面重复点击。

**`commandsRemote` 未初始化：** 如果 `remote.commands` 在 apply 时不可用（比如旧版 dsh），`commandsRemote` 保持为 `null`，`onClick` 直接返回。按钮存在但点击无反应——至少不会崩溃。

### 跨平台测试

**Windows：** `code` 命令解析为 `Code.cmd` 或 `Code.bat`，通过 `cmd.exe /d /c` 启动。需要确保 `code` 在 PATH 中（VS Code 安装时通常会自动添加，但命令行版需要手动操作："Install 'code' command in PATH"）。

**macOS：** `code` 是捆绑在 `/usr/local/bin` 的 shell 脚本，可直接 spawn。如果用户没有安装 `code` CLI手动安装（VS Code 菜单栏选择 "Shell Command: Install 'code' command in PATH"），resolveExecutable 会失败。

**Linux：** 类似 macOS，`code` 是 shell 脚本或符号链接。部分发行版可能需要手动设置。

### 测试清单

| 场景 | 预期结果 |
|------|----------|
| code 在 PATH 上，正常打开 | 按钮显示 "Editor opened in /path" |
| code 不在 PATH 上 | 按钮显示错误提示 |
| session 无 cwd | 按钮显示 "no session working directory" |
| 快速多次点击按钮 | 只有第一次生效，后续被 busy 状态拦截 |
| 安装后首次打开 Web UI | 按钮出现在会话头部 |

---

## 8.7 本章小结

通过 `dsh-open-editor` 这个真实插件，我们完整走了一遍 Web UI 插件的开发链路：

1. **需求分析**：明确用户场景，区分功能需求和非功能需求。
2. **架构设计**：复用已有的 `commands` Remote 命名空间，Host 负责 OS 交互，Client 负责 UI 呈现。
3. **Host 实现**：66 行代码注册 `/open-editor` 命令，处理 Windows 垫片和非阻塞 spawn。
4. **Client 实现**：113 行手写 CJS bundle，用 `React.createElement` 构建按钮组件，通过插槽注入会话头部。
5. **包结构与分发**：`package.json` 声明客户端配置和 bundle patch，`cordis.patch.yml` 自动挂载插件，一键安装和卸载。
6. **质量保证**：处理 PATH 缺失、无 cwd、并发点击等边界情况。

这个插件的核心设计哲学是**零新增 API** 和**零构建**。它没有引入任何新的通信机制，只是把已有的拼图拼在一起——这是 dsh 插件系统的设计目标之一：允许用小体量的代码实现真实价值。

你现在已经掌握了编写一个完整 Web UI 插件的所有技能。下一章我们将通过另一个真实案例深入更复杂的主题：agent 能力注入和消息渲染。
---
← [WebUI 插件开发](07-WebUI插件开发.md) | [返回目录](README.md) | [Plugin Builder 实战](09-实战-PluginBuilder预设与需求驱动开发.md) →
