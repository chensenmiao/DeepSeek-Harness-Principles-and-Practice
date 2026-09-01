# DeepSeek Harness 插件开发实战

> 本仓库是 DeepSeek Harness 官方教程文档的重新整理版，以"插件开发实战"为主线，将零散的 65+ 篇文档组织为一本结构化的电子书。
>
> 面向有编程基础 + 了解 LLM 工作原理的开发者，目标读者想自己动手编写 Harness 插件的开发人员。

---

## 内容概览

全书共 **14 章**，按四个部分组织：

**第一部分：基础篇（第 1-3 章）**
从零认识 Harness、搭建开发环境、理解 Cordis 插件框架的核心概念。

| 章节 | 内容 |
|------|------|
| [第 1 章](book-output/01-什么是DeepSeekHarness.md) | Harness 是什么、核心问题、5 分钟快速体验 |
| [第 2 章](book-output/02-环境搭建与第一个插件.md) | 环境搭建、hello-plugin、三种写法、加载机制 |
| [第 3 章](book-output/03-Cordis快速上手.md) | Context、inject、事件系统、effect、Config+Schema |

**第二部分：实战篇（第 4-6 章）**
动手写真正的工具插件，深入文件系统/Shell/后台任务，集成 LLM 能力。

| 章节 | 内容 |
|------|------|
| [第 4 章](book-output/04-动手写第一个工具插件.md) | 工具四要素、greet 工具、参数类型、规范值 vs 渲染、file_stats 工具 |
| [第 5 章](book-output/05-深入工具开发.md) | 文件系统工具、Shell 命令、持久终端、后台任务、执行管道、UI 卡片 |
| [第 6 章](book-output/06-LLM与大模型集成.md) | 适配器模式、模型配置、自定义适配器、流式协议、推理模型 |

**第三部分：进阶篇（第 7-10 章）**
Web UI 插件、完整实战案例、Agent Preset 编写、高级 Harness 能力。

| 章节 | 内容 |
|------|------|
| [第 7 章](book-output/07-WebUI插件开发.md) | Host vs Client、设置卡片、对话定制、样式、打包 |
| [第 8 章](book-output/08-实战-dsh-open-editor插件开发全过程.md) | **实战**：一个完整的 Web UI 插件，从需求到打包分发 |
| [第 9 章](book-output/09-实战-PluginBuilder预设与需求驱动开发.md) | **实战**：Agent Preset 编写、需求文档驱动的开发流程 |
| [第 10 章](book-output/10-高级能力.md) | Subagent、Goal、Workflow、Plan Mode、Schedule、Skill |

**第四部分：架构与发布篇（第 11-14 章）**
深入架构理解、安全模型、测试与发布、事故复盘。

| 章节 | 内容 |
|------|------|
| [第 11 章](book-output/11-Harness架构深度解析.md) | 微内核、核心子系统、Agent 生命周期、能力接缝、事件驱动 |
| [第 12 章](book-output/12-安全与运行时.md) | 沙箱、权限、持久化、压缩内容溢出、防御性编程 |
| [第 13 章](book-output/13-打包测试与发布.md) | Bundle、Profile、测试策略、代码审查、发布流程 |
| [第 14 章](book-output/14-事故复盘与参考.md) | 4 篇 Postmortem、术语表、参考资料索引 |

---

## 目录结构

```
├── README.md                     # 本文件
├── book-output/                  # 电子书正文（14 章 + 索引）
│   ├── README.md                 # 电子书内部索引
│   ├── 01-什么是DeepSeekHarness.md
│   ├── ...
│   └── 14-事故复盘与参考.md
├── docs/                         # 原始教程文档（参考资料）
├── dsh-open-editor/              # 实战案例：编辑器按钮插件（第 8 章源码）
└── .agent-presets/               # 实战案例：Plugin Builder 预设（第 9 章源码）
```

---

## 阅读建议

- **新手入门**：按 1 → 2 → 3 → 4 → 5 → 6 → 10 顺序阅读
- **想写 Web UI 插件**：在上述基础上 + 7 → 8
- **想自定义 Agent 行为**：9（Plugin Builder 预设）
- **想理解设计原理**：11 → 12 → 13
- **查阅参考**：14

每章头部有**章节导航链接**（上一章/下一章）和**参考文档链接**（指向 `docs/` 和源码目录），方便跳转。

---

## 数据来源

本电子书基于 DeepSeek Harness 仓库的以下原始资料编写：

- `docs/` 目录下 65+ 篇教程和参考文档
- `.agent-presets/plugin-builder/` — Plugin Builder 预设源码
- `dsh-open-editor/` — 编辑器按钮插件源码
