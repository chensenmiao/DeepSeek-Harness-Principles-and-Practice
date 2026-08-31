# LLM与大模型集成

> ← [深入工具开发](05-深入工具开发.md) | [目录](README.md) | [WebUI 插件开发](07-WebUI插件开发.md) →

> **参考文档：**
> - [../docs/cookbook/adding-an-llm-adapter.zh.md](../docs/cookbook/adding-an-llm-adapter.zh.md) — 编写 LLM 适配器
> - [../docs/user/guide/providers.zh.md](../docs/user/guide/providers.zh.md) — 提供商配置指南
> - [../docs/deepseek-llm-api-wire-extensions.zh.md](../docs/deepseek-llm-api-wire-extensions.zh.md) — DeepSeek API 扩展
> - [../docs/subsystems/llm-streaming.zh.md](../docs/subsystems/llm-streaming.zh.md) — LLM 流式子系統
> - [../docs/config-catalog.zh.md](../docs/config-catalog.zh.md) — 配置目录（LLM 相关）
---

## 6.1 Harness 中的 LLM 角色

如果把 Harness Agent 比作一个人，LLM 就是他的大脑。Agent 每做一次决策——回答问题、调用工具、判断下一步做什么——都需要 LLM 的推理能力。Harness 本身不绑定任何特定的模型提供商，而是通过**适配器模式**提供一个统一的接口，让同一个 Agent 可以对接 DeepSeek、OpenAI、Anthropic，甚至你自己部署的内网模型。

这个模式的核心是 `ctx.llm` 服务。它是 LLM 子系统的抽象入口，对外暴露三个关键能力：

- **适配器注册**：通过 `ctx.llm.registerAdapter()` 将某组提供商路由注册到具体的适配器实例。
- **模型调用**：通过 `ctx.llm.stream()` 发起一次流式模型请求，底层自动路由到对应的适配器。
- **事件拦截**：`llm/stream` waterfall 事件允许插件在请求到达适配器之前拦截、修改或短路它。

适配器模式的好处是隔离。Agent 循环不需要关心你用的是哪个模型，它只需要调用 `ctx.llm.stream()`，传入 `GenerateOptions`（包含 provider、model、messages 等信息），底层适配器会负责把这份 Harness 内部请求转成对应提供商的 API 调用，再把响应拆成标准的 `StreamChunk` 分片吐回来。

目前 Harness 内置了两个已交付的适配器：

- `@deepseek-ai/dsh-llm-deepseek`：直接发起 HTTP 请求，用 `eventsource-parser` 分帧 SSE 流，对接 DeepSeek 官方 API。
- `@deepseek-ai/dsh-llm-pi-ai`：封装了 LLM 库，支持更广泛的协议（OpenAI 兼容、Anthropic、Azure 等）。

这两个适配器共同验证了同一套 StreamChunk 协议约定。你编写的自定义适配器也需要遵守这套约定——这是我们下一节要讨论的配置前提。

## 6.2 配置模型提供商

配置提供商有两种方式。Web UI 适合快速试用，settings.yaml 适合生产环境和自动化部署。

### 方式一：Web UI

打开 Harness Web UI，进入**设置 → 模型**页面。你会看到 DeepSeek 卡片，填入 API 密钥即可使用。如果需要更多提供商，点击**添加提供方**，从目录中选择 Anthropic、OpenAI 等。Web UI 会处理密钥的存储——密钥是只写的，保存后页面只显示脱敏描述符，明文密钥不会离开凭据存储。

对于公司网关或自建服务器，选择**添加自定义提供方**。你需要提供：

- Provider ID（小写，永久性标识）
- 基础 URL
- API 协议
- API 密钥
- 至少一个模型

### 方式二：settings.yaml

生产环境中，你更可能通过配置文件直接管理。以下是一个典型的配置：

```yaml
# 配置 DeepSeek 官方
llm-deepseek:
  apiKeyEnv: DEEPSEEK_API_KEY
  baseURL: https://api.deepseek.com/v1
  reasoningEffort: high
  maxTokens: 256000

# 配置 pi-ai 托管的 OpenAI
llm-pi-ai:
  providers:
    openai:
      apiKeyEnv: OPENAI_API_KEY
      api: openai-completions
      baseURL: https://api.openai.com/v1
      models:
        - id: gpt-4o
        - id: gpt-4o-mini

    anthropic:
      apiKeyEnv: ANTHROPIC_API_KEY
      api: anthropic-messages
      baseURL: https://api.anthropic.com/v1
      models:
        - id: claude-sonnet-4-20250514

    # 企业网关：OpenAI 兼容端点
    my-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example.com/v1
      models:
        - id: internal-chat
```

### Provider ID 的永久性

Provider ID 是永久性的——请求日志、已保存会话、模型默认值和凭据引用都会使用它。如果你需要重命名一个提供商，正确的做法是添加新提供商并删除旧的，而不是修改现有 ID。不过，显示名称、基础 URL、协议和模型列表都是可以随时编辑的。

### 配置企业网关的兼容性开关

当你使用 OpenAI 兼容的企业网关时，常常遇到请求被拒绝的情况。大多数网关至少会拒绝 OpenAI 接受的某一两样东西。最常见的两个问题是：

1. 推理模型的系统提示词以 `role: "developer"` 发出，很多网关拒绝这个角色。
2. 输出上限写作 `max_completion_tokens`，但有些网关只认 `max_tokens`。

这时需要在配置中设置 `compat` 开关：

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      compat:
        supportsDeveloperRole: false
        maxTokensField: max_tokens
      models:
        - id: my-model
```

compat 开关在路由级别设置，作为该路由所有模型的默认值；也可以在单个模型上覆写：

```yaml
      models:
        - id: my-model
        - id: my-reasoner
          compat:
            thinkingFormat: deepseek
```

### 图片输入配置

手动输入的模型默认按纯文本对待。如果模型支持图片，需要显式声明：

```yaml
      models:
        - id: vision-preview
          input: [text, image]
```

如果路由上的所有模型都支持图片，可以在路由级别设置回退值：

```yaml
      defaultInput: [text, image]
```

## 6.3 理解 LLM 适配器

适配器是 Harness LLM 系统的核心抽象。它的职责简单明确：把 Harness 内部通用的模型请求（`GenerateOptions`）转成具体提供商的 API 调用，再把提供商的流式响应拆成标准的 `StreamChunk` 分片。

### 适配器的核心方法：stream()

每个适配器都必须实现 `stream()` 方法。它是一个异步生成器，接收 `GenerateOptions`，产出 `AsyncIterable<StreamChunk>`：

```ts
abstract class LlmAdapter {
  abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}
```

这是适配器唯一必须实现的方法。除此之外，适配器还可以覆写以下方法来提供更丰富的元数据：

- `resolveModel(provider, model, signal?)`：返回该模型的上下文容量、推理能力等元数据。
- `listModels(provider)`：返回该路由可使用的模型列表（仅用于选择器展示，不是请求白名单）。
- `providerInfo(provider)`：返回提供商显示元数据。
- `providerRetryPolicy(provider)`：返回该路由的重试策略。

### StreamChunk 协议

适配器输出的 StreamChunk 是一个可辨识联合类型（discriminated union），共有五种实际类型加上起始/结束标记：

```ts
type StreamChunk =
  | { type: 'block-start'; index: number; blockType: ContentBlockType }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: ToolCallId; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: ContentBlock }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'finish'; reason: FinishReason; replayState?: ReplayEnvelope }
```

其中每个 `index` 用于关联交错出现的分片到同一个内容块。`block-end` 携带完整组装好的 `ContentBlock`，消费方不需要自己拼接 delta。

### 适配器必须遵守的约定

两个已交付的适配器共同验证了以下规则。编写你自己的适配器时，务必遵守：

1. **`usage` 必须在 `finish` 之前发出；`finish` 之后不再有任何分片。** 稳健的做法是把 `usage` 和 `finish` 都缓冲到提供商的流结束标记，再统一 flush——这样可以处理提供商在末尾发送仅含 usage 的分片的情况。

2. **工具调用的 `arguments` 全程保持原始 JSON 字符串。** 流式片段通过 `argumentsDelta` 发送。如果提供商返回了已解析的对象，适配器在 `block-end` 时需要重新 stringify。

3. **按首次出现的流顺序分配 `index`。** 同一个块的每次 delta 复用该 index。

4. **错误只有两条合法路径：** 从 `stream()` **抛出**（传输与协议故障——使用带稳定 code 的 `LlmError`），或以 `finish {kind: 'error' | 'aborted'}` 结束流（提供商带内故障）。消费方两者都处理。

5. **遵守 `options.signal`。** 把它传递给 fetch 调用或你的 SDK，以支持取消。

6. **如果无法支持 `GenerateOptions` 中的某个字段，抛出 `LlmError(..., 'UNSUPPORTED_OPTION')`**，而不是静默丢弃。

### 思考 token 的处理

对于支持思考/推理的模型（如 DeepSeek R1），适配器通过 `reasoning-delta` 分片传输推理过程中的内部 token。这与普通文本分片（`text-delta`）是分开的，便于 UI 层分别展示。`reasoning-delta` 使用与 `text-delta` 相同的 `index` 关联机制，但属于不同的 `blockType`。

### 最小适配器骨架

以下是一个适配器的最小骨架，展示了 `stream()` 方法的结构：

```ts
import { LlmAdapter, LlmError, attributionHeaders } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

export class MyMinimalAdapter extends LlmAdapter {
  constructor(private readonly apiKey: string) {
    super()
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // 1. 将 Harness 请求转为提供商 API 格式
    // 2. 发起 HTTP 流式请求
    // 3. 解析 SSE 响应，产出 StreamChunk
    // 4. 产出 usage 和 finish

    throw new LlmError('Not implemented', 'UNSUPPORTED_OPTION')
  }
}
```

## 6.4 编写自定义适配器

这一节我们动手写一个完整的自定义适配器。场景假设：你的团队部署了一个内部模型服务，它对外提供 OpenAI 兼容的 HTTP 流式接口，但有一些自定义的错误码。

### 步骤 1：创建适配器类

适配器继承 `LlmAdapter` 基类。构造函数接收该适配器所需的配置：

```ts
import {
  LlmAdapter, LlmError, attributionHeaders,
  type GenerateOptions, type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { type Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

class InternalAdapter extends LlmAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly baseURL: string,
    private readonly timeoutMs: number,
  ) {
    super()
  }
  // ... stream() 实现见下一步
}
```

### 步骤 2：实现 stream() 方法

这是最核心的部分。我们需要做三件事：构造请求、发起流式调用、解析 SSE 事件并映射为 StreamChunk。

```ts
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // 构造请求体——将 Harness 消息映射到 OpenAI 兼容格式
    const body = {
      model: options.model,
      messages: [
        ...(options.system ? [{ role: 'system', content: options.system }] : []),
        ...options.messages.map(msg => ({
          role: msg.role,
          content: msg.content.map(c => {
            if (c.type === 'text') return { type: 'text', text: c.text }
            if (c.type === 'image') return { type: 'image_url', image_url: { url: c.source.url } }
            return { type: 'text', text: JSON.stringify(c) }
          }),
        })),
      ],
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
      ...(options.temperature ? { temperature: options.temperature } : {}),
      ...(options.tools ? { tools: options.tools } : {}),
      stream: true,
    }

    // 发起带超时的流式请求
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    // 将外部 signal 与内部超时 signal 合并
    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort(), { once: true })
    }

    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          ...attributionHeaders(),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'unknown error')
        throw new LlmError(
          `Provider error ${response.status}: ${errorText}`,
          response.status === 401 ? 'MISSING_CREDENTIAL'
            : response.status === 404 ? 'UNKNOWN_MODEL'
            : 'PROVIDER_HTTP_ERROR',
          { status: response.status },
        )
      }

      // 解析 SSE 流
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let blockIndex = 0
      let accumulatedTokens = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue

          const data = trimmed.slice(6)
          if (data === '[DONE]') break

          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta
            const finishReason = parsed.choices?.[0]?.finish_reason

            if (!delta) continue

            if (delta.content) {
              // 如果是第一个文本块，先发出 block-start
              if (accumulatedTokens === 0) {
                yield { type: 'block-start', index: blockIndex, blockType: 'text' }
              }

              yield { type: 'text-delta', index: blockIndex, text: delta.content }
              accumulatedTokens += delta.content.length
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const tcIndex = blockIndex + (delta.content ? 1 : 0)
                yield {
                  type: 'tool-call-delta',
                  index: tcIndex,
                  id: tc.id,
                  name: tc.function?.name,
                  argumentsDelta: tc.function?.arguments ?? '',
                }
              }
            }

            if (finishReason && finishReason !== 'null') {
              // 关闭打开的文本块
              if (accumulatedTokens > 0) {
                yield { type: 'block-end', index: blockIndex, block: { type: 'text', text: '' } }
              }

              // 使用量（实际中应解析 response 中的 usage 字段）
              yield {
                type: 'usage',
                usage: { inputTokens: body.messages.length * 10, outputTokens: accumulatedTokens },
              }

              // 完成信号
              const kind = finishReason === 'tool_calls' ? 'tool-calls'
                : finishReason === 'length' ? 'max-tokens'
                : finishReason === 'stop' ? 'stop'
                : 'stop'

              yield { type: 'finish', reason: { kind } as any }
            }
          } catch {
            // 跳过无法解析的行
          }
        }
      }
    } finally {
      clearTimeout(timer)
    }
  }
```

### 步骤 3：注册适配器

适配器需要通过插件注册到 `ctx.llm`：

```ts
export interface Config {
  apiKey: string
  baseURL: string
  timeoutMs?: number
  providers: string[]
}

export const Config: Schema<Config> = Schema.object({
  apiKey: Schema.string().required(),
  baseURL: Schema.string().required(),
  timeoutMs: Schema.number().default(30000),
  providers: Schema.array(Schema.string()).required(),
})

export const name = 'llm-internal'
export const inject = ['llm']

export function apply(ctx: Context, config: Config) {
  const adapter = new InternalAdapter(config.apiKey, config.baseURL, config.timeoutMs ?? 30000)
  ctx.llm.registerAdapter(config.providers, adapter)
}
```

### 步骤 4：配置使用该适配器

在 settings.yaml 中配置你的自定义适配器：

```yaml
llm-internal:
  apiKey: !!js process.env.INTERNAL_API_KEY
  baseURL: https://internal-ml.example.com/v1
  timeoutMs: 60000
  providers:
    - internal

agent-loop:
  agents:
    - id: main
      provider: internal
      model: internal-chat-v2
```

### 错误映射与超时处理

在适配器中有三类错误需要处理：

| 异常情况 | 处理方式 | Error Code |
|---------|---------|-----------|
| 401 未授权 | 抛出 `LlmError` | `MISSING_CREDENTIAL` |
| 404 模型不存在 | 抛出 `LlmError` | `UNKNOWN_MODEL` |
| HTTP 5xx | 抛出 `LlmError` | `PROVIDER_HTTP_ERROR` |
| 请求超时 | 通过 AbortSignal 中断 fetch | `TIMEOUT` |
| 不支持的选项 | 抛出 `LlmError` | `UNSUPPORTED_OPTION` |

所有错误都使用 `LlmError`，它携带一个稳定的 `code`，方便上层做策略路由。不要抛出普通的 `Error`。

## 6.5 流式输出详解

### 非流式 vs 流式

非流式调用：你发送一个请求，等待数秒后拿到完整的响应正文。这种方式简单，但用户体验差——用户需要等到全部内容生成完毕才能看到结果。

流式调用：适配器通过 SSE 逐片接收模型输出，每收到一个分片就立即转换成 StreamChunk 发出。Agent 循环在收到 `text-delta` 时就可以把文本推送给前端，实现打字机效果。工具调用也是流式的——`tool-call-delta` 可以分多次发送同一个工具调用的参数片段。

Harness 的流式调用入口是 `ctx.llm.stream()`，返回 `AsyncIterable<StreamChunk>`。

### StreamChunk 的五种类型

StreamChunk 分为七种变体（含起止标记），按功能可归为五类：

**1. 文本块（text-delta）**

由 `block-start` + 若干 `text-delta` + `block-end` 组成：

```ts
yield { type: 'block-start', index: 0, blockType: 'text' }
yield { type: 'text-delta', index: 0, text: '你好，' }
yield { type: 'text-delta', index: 0, text: '世界！' }
yield { type: 'block-end', index: 0, block: { type: 'text', text: '你好，世界！' } }
```

**2. 推理块（reasoning-delta）**

与文本块结构相同，但 blockType 为 `reasoning`。用于模型输出内部推理过程：

```ts
yield { type: 'block-start', index: 0, blockType: 'reasoning' }
yield { type: 'reasoning-delta', index: 0, text: '让我思考一下这个问题...' }
yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: '让我思考一下这个问题...' } }
```

**3. 工具调用块（tool-call / tool-call-delta）**

工具调用的参数通过 `argumentsDelta` 流式传输，参数全程保持原始 JSON 字符串：

```ts
yield { type: 'block-start', index: 1, blockType: 'tool-call' }
yield { type: 'tool-call-delta', index: 1, id: CallId('call-abc'), name: 'search', argumentsDelta: '{"query":"天气' }
yield { type: 'tool-call-delta', index: 1, id: CallId('call-abc'), argumentsDelta: '北京"}' }
yield { type: 'block-end', index: 1, block: { type: 'tool-call', id: CallId('call-abc'), name: 'search', arguments: '{"query":"天气北京"}' } }
```

**4. 完成信号（finish）**

标记流式响应的结束，附带结束原因：

```ts
yield { type: 'finish', reason: { kind: 'stop' } }       // 正常结束
yield { type: 'finish', reason: { kind: 'tool-calls' } }  // 请求工具执行
yield { type: 'finish', reason: { kind: 'max-tokens' } }  // 达到最大 token 限制
yield { type: 'finish', reason: { kind: 'error', failure: { message: '...', code: '...' } } }
yield { type: 'finish', reason: { kind: 'aborted', failure: { message: '...', code: 'ABORTED' } } }
```

**5. 用法统计（usage）**

必须在 `finish` 之前发出：

```ts
yield { type: 'usage', usage: { inputTokens: 150, outputTokens: 80, totalTokens: 230 } }
```

### 消费 StreamChunk

以下是消费方使用 `BlockAssembler` 组装流式响应片段的典型模式：

```ts
import { BlockAssembler } from '@deepseek-ai/dsh-llm'

async function handleStream(stream: AsyncIterable<StreamChunk>) {
  const assembler = new BlockAssembler()

  for await (const chunk of stream) {
    assembler.push(chunk)

    // 实时推送给 UI
    if (chunk.type === 'text-delta') {
      pushToUI(chunk.text)
    }
  }

  // 流结束后获取组装结果
  const blocks = assembler.blocks()          // 完整的内容块列表
  const usage = assembler.usage               // token 用量
  const finish = assembler.finish             // 结束原因
  const message = assembler.message()         // 完整的 assistant 消息
}
```

`BlockAssembler` 处理了所有边缘情况：不发射 `block-start`/`block-end` 的分片协议、异常中断时的部分组装（`interruptedBlocks()`）、最大 token 截断时丢弃不安全的工具调用等。

## 6.6 推理模型支持

### 什么是推理模型

推理模型（如 DeepSeek R1）在生成最终答案之前，会先输出一段内部推理过程——这就是我们通常所说的"思考过程"。与传统模型直接输出答案不同，推理模型会先"想清楚再回答"。

### reasoning token 的传输

在 Harness 的流协议中，推理过程通过 `reasoning-delta` 分片传输，与普通文本分片（`text-delta`）独立。这使得 UI 层可以：

- 将推理内容显示在折叠区域中，不干扰主对话流
- 在推理过程中显示打字机效果的思考过程
- 最终答案从 `text-delta` 中恢复

### reasoning effort 控制

推理模型支持不同的推理强度（reasoning effort），通过 `GenerateOptions.reasoningEffort` 控制。effort 是一个品牌类型 `ReasoningEffortId`，由适配器持有其完整的可选列表，包括 `off`。

适配器可以通过 `resolveModel()` 返回模型支持的 effort 列表和默认值：

```ts
async resolveModel(provider: string, model: string, signal?: AbortSignal) {
  return {
    provider,
    id: model,
    name: 'Internal Chat v2',
    reasoning: {
      efforts: [
        { id: 'off' as ReasoningEffortId, name: '关闭推理' },
        { id: 'low' as ReasoningEffortId, name: '低强度' },
        { id: 'high' as ReasoningEffortId, name: '高强度' },
      ],
      defaultEffort: 'high' as ReasoningEffortId,
    },
  }
}
```

在配置中，可以通过 `reasoningEffort` 设置默认推理强度：

```yaml
llm-deepseek:
  reasoningEffort: high
```

### 推理内容在 UI 中的展示

推理内容（`ReasoningBlock`）在 UI 中通常显示为可折叠的思考过程区域。Agent 循环在收到 `reasoning-delta` 时会将其追加到当前推理块中，最终以 `block-end` 中的 `ReasoningBlock` 形式存储。UI 端可以根据 `blockType === 'reasoning'` 来判断是否需要特殊渲染。

### 适配器中实现推理开关

适配器实现推理支持的关键在于两点：

1. 在 `resolveModel()` 中声明模型的能力（是否支持推理、支持哪些 effort 级别）。
2. 在 `stream()` 中根据 `options.reasoningEffort` 决定如何构造请求体。

对于不支持某个 effort 的适配器，应该在 Config 校验阶段或 `stream()` 中抛出 `UNSUPPORTED_OPTION` 错误，而不是静默忽略。

## 6.7 LLM 配置的高级设置

### 模型选择

已配置的提供商会在模型选择器中显示。选择一个模型同时将其设为新会话的默认值。已发送过请求的会话会保留自身日志中记录的模型，不受后续默认值变更影响。

如果已保存的默认值指向一个已被删除的提供商，选择器会显示"选择模型"，并在用户选择可用模型前阻止输入。

### 默认模型与会话保留

模型选择与 Provider ID 绑定。会话日志记录的是请求时刻的 provider + model，不是配置中的默认值。这意味着即使你更换了默认模型，历史会话仍能正确回放。

### 模型回退（fallback）

回退策略通过 `retryPolicy` 配置。当主模型失败时，Harness 的重试机制会自动重试。回退到不同模型需要更高级的编排——通过 `llm/stream` waterfall 事件监听器实现：

```yaml
llm-pi-ai:
  providers:
    primary:
      apiKeyEnv: PRIMARY_KEY
      api: openai-completions
      baseURL: https://primary.example.com/v1
      models:
        - id: gpt-4o
      retryPolicy:
        mode: normal
        maxRetries: 3
        initialDelayMs: 1000
```

### 重试策略

`retryPolicy` 有两种模式：

- `normal`：有限次重试，配合可重试的 error code 列表。
- `always`：持续重试直到成功（慎用）。

重试策略的完整配置：

```yaml
retryPolicy:
  mode: normal
  maxRetries: 5
  retryableCodes:
    - TIMEOUT
    - RATE_LIMITED
    - EMPTY_RESPONSE
  initialDelayMs: 1000
  maxDelayMs: 30000
  jitterRatio: 0.1
```

### 超时控制

超时分为两类：

- 请求超时（`timeoutMs`）：整个 HTTP 请求的超时时间，适用于 pi-ai 适配器。
- 流空闲超时（`streamIdleTimeoutMs`）：两次相邻流式分片之间的最大等待时间，默认 5 分钟。watchdog 仅在 iterator 的 `next()` 尚未完成时启动。

### 并发限制

并发控制不在适配器层实现。如果需要对某个提供商做并发限制，可以在 `llm/stream` waterfall 中实现一个限流中间件，或者通过系统的任务队列（jobs 子系统）来管理。

## 6.8 常见问题排查

### MISSING_CREDENTIAL 错误

**原因**：适配器试图发起请求，但没有找到 API 密钥。

**解决**：通过模型页面存储提供商密钥，或者在 settings.yaml 中正确配置 `apiKeyEnv` 指向的环境变量。

```yaml
llm-pi-ai:
  providers:
    openai:
      apiKeyEnv: OPENAI_API_KEY  # 确保该环境变量已设置
```

### UNKNOWN_MODEL 错误

**原因**：请求中指定的模型没有在对应提供商下配置。

**解决**：在提供商配置中添加该模型，或者在选择器中重新选择一个已配置的模型。自定义提供商必须显式列出所有模型。

### 网关兼容性问题

**症状**：密钥和地址都正确，但网关拒绝每一个请求。

**解决**：先在路由上设置两个最常见的 compat 开关：

```yaml
compat:
  supportsDeveloperRole: false
  maxTokensField: max_tokens
```

如果问题仍然存在，检查 `compat` 开关的拼写。冒号后留空的键会被拒绝。

### 推理模型无法使用

**症状**：只有推理模型（如 DeepSeek R1）失败，其他模型正常。

**解决**：pi-ai 把推理模型的系统提示词以 `developer` 角色发出，而一些网关拒绝该角色。设置 `compat.supportsDeveloperRole: false`。

### 图片输入被拒绝

**现象 A——发送前被拒绝**：错误消息中提到了具体的模型名称。这意味着该模型未声明图片模态。给自定义提供商的模型加上：

```yaml
models:
  - id: vision-model
    input: [text, image]
```

**现象 B——被提供商拒绝**：模型声明了图片能力，但端点实际上不支持。移除授予图片能力的那条配置——可能是模型的 `input` 或路由的 `defaultInput`——然后开启一个新会话。

### 排查清单

当你遇到无法解释的 LLM 请求失败时，按顺序检查以下各项：

1. [ ] 环境变量是否已设置？`echo $DEEPSEEK_API_KEY` 有值吗？
2. [ ] Provider ID 是否正确？配置中的 provider 是否等于注册时的路由？
3. [ ] 模型是否已在提供商下配置？自定义提供商需要显式列出模型 ID。
4. [ ] compat 开关是否正确？企业网关通常需要 `supportsDeveloperRole: false`。
5. [ ] 图片模态声明是否准确？声明了图片能力但网关不支持的模型会导致提供商拒绝。
6. [ ] 流空闲超时是否过短？对于生成较长输出的模型，默认 5 分钟通常是够的，但如果你自定义了这个值，确保它足够大。
7. [ ] 查看适配器日志。适配器的 `LlmError` 包含稳定的 `code`，可以用来定位问题类别。

## 6.9 本章小结

本章覆盖了 DeepSeek Harness 中 LLM 集成的完整知识体系。你已掌握：

- 如何通过 Web UI 和 settings.yaml 配置多个模型提供商。
- 适配器模式的工作原理——`LlmAdapter` 基类、`stream()` 方法、`StreamChunk` 协议和适配器约定。
- 如何编写一个完整的自定义适配器，包括 SSE 流解析、错误映射和超时处理。
- 流式输出的五种分片类型及其消费方式。
- 推理模型的特性和 reasoning effort 控制。
- 高级配置选项（重试、超时、并发控制）和常见问题的排查方法。

下一章将进入 Web UI 插件开发。你将学习如何让插件拥有自己的界面——包括设置面板、聊天组件和自定义页面。
---
← [深入工具开发](05-深入工具开发.md) | [返回目录](README.md) | [WebUI 插件开发](07-WebUI插件开发.md) →
