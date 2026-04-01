import { AnthropicProvider } from './anthropic-provider.js'
import { ClaudeCodeProvider } from './claude-code-provider.js'

export interface AIProvider {
  readonly name: string
  chat(params: ChatParams): Promise<ChatResponse>
  clearSession(sessionId: string): void
  restoreSession(
    sessionId: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): void
}

export interface ChatParams {
  sessionId: string
  userText: string
  onToolUse?: (name: string, input: string) => void
}

export interface ChatResponse {
  text: string
  toolCalls: Array<{ name: string; input: string; result: string }>
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  }
  model: string
}

// --- Provider factory ---

const providers: Record<string, () => AIProvider> = {
  anthropic: () => new AnthropicProvider(),
  'claude-code': () => new ClaudeCodeProvider(),
}

let cached: AIProvider | null = null

export function getAIProvider(): AIProvider {
  if (cached) return cached

  const name = process.env.AI_PROVIDER ?? 'anthropic'
  const factory = providers[name]

  if (!factory) {
    const available = Object.keys(providers).join(', ')
    throw new Error(`Unknown AI_PROVIDER "${name}". Available: ${available}`)
  }

  cached = factory()
  console.log(`[ai] using provider: ${cached.name}`)
  return cached
}
