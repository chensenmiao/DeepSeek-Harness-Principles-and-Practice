# dsh-open-editor

在 dsh Web 页面右上角（session log 下载按钮旁）添加一个 **`⌨ Editor`** 按钮，点击后用本机的 `code` CLI（VS Code / Qoder / Cursor 等，PATH 上解析到的那个）打开当前会话的工作目录。

这是一个**独立可分发的 npm 插件包**。朋友拿到这份代码/发布后的包后，一条命令即可装进自己的 web profile，无需手动打 patch。

## 目录结构

| 文件 | 作用 |
|---|---|
| `package.json` | 包元数据：`dsh.client` 声明（浏览器半边）+ `dsh.bundle.patch`（自动挂载 patch 层） |
| `cordis.patch.yml` | 该包自带的 bundle patch，安装时自动插入插件行 |
| `lib/index.js` | Host 半边：注册 `/open-editor` 命令，spawn `code <cwd>`（零构建） |
| `lib/client.js` | Client 半边：手写的浏览器 bundle（`window.__ModuleLoader__.load` CJS 格式） |

## 原理

- **Host**：注册 `/open-editor` 斜杠命令。handler 从 `invocation.agent.session.header.cwd`
  取会话工作目录，用 `ctx.subprocess` 解析 `code` 并 spawn。
  - Windows 上 `code` 常被解析为 `.cmd`/`.bat` 垫片，无法直接 spawn（会报 `spawn EINVAL`），
    这里统一走 `cmd.exe /d /c` 让 CLI 正常启动。
  - spawn 是非阻塞的（从不等待编辑器退出），所以 Web GUI 不会被编辑器进程卡住。
- **Client**：手写浏览器插件包，按钮点击时调用 Web 自带的
  `ctx.remote.commands.execute(sessionId, "/open-editor", [])`——复用 web app 已有的
  `commands` Remote 命名空间，**不需要 typert / tsdown 构建**。React 是平台基线外部模块。

## 安装（给朋友 / 换机器）

前置：目标机器已装 dsh，且 `dsh` 在 PATH（或用 `node <dsh仓库>/apps/cli/lib/bin.js` 代替）。

### 方式一：从本地目录安装（无需发布）

```sh
dsh plugin --profile web add <本包所在路径>/dsh-open-editor
```

> 由于本包声明了 `dsh.bundle.patch`，安装后该 patch 层会自动加入 web profile，
> 插件行会被自动插入，**不需要**再单独 `--patch`。

### 方式二：发布到 npm 后安装

```sh
# 在 dsh-open-editor 目录内
npm publish

# 朋友机器上
dsh plugin --profile web add dsh-open-editor
```

### 方式三：直接 pnpm（等价）

```sh
pnpm --dir "$HOME/.dsh/profiles/web" add <路径或包名>
```

## 使用

打开 Web UI 进入任意会话 → 右上角 session log 按钮旁出现 **`⌨ Editor`** →
点击即以当前会话工作目录为目标启动本地编辑器。

如果机器上 `code` / `qoder` 都不在 PATH，按钮会通过命令返回 `open-editor: ...` 的错误提示。

## 卸载

```sh
dsh plugin --profile web remove dsh-open-editor
```

## 注意事项

- 该包只声明了一个必需 peer：`@deepseek-ai/cordis`（dsh 本身已带，通常无需手动安装）。
- 手写的 `lib/client.js` 已按 dsh client-modules 期望的格式写好，`id` 与包名
  `dsh-open-editor` 一致；若你改了包名，请同步改 `lib/client.js` 里的 `id` 和
  `cordis.patch.yml` 里的 `name`。
- 若要在开发时热改 client 半边，需重开 Web 会话让模块图重新组合。
