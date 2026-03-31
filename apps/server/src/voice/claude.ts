import { exec } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execAsync = promisify(exec)
import Anthropic from '@anthropic-ai/sdk'

let client: Anthropic | null = null

function getClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('Missing ANTHROPIC_API_KEY environment variable')
    }
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return client
}

// --- Model routing ---

const MODEL_SONNET = 'claude-sonnet-4-6'
const MODEL_HAIKU = 'claude-haiku-4-5-20251001'

type ModelMode = 'auto' | 'sonnet' | 'haiku'

function getModelMode(): ModelMode {
  const env = process.env.CLAUDE_MODEL?.toLowerCase()
  if (env === 'sonnet' || env === 'haiku') return env
  return 'auto' // default
}

// Only pre-route to Sonnet for tasks that require complex reasoning.
// Simple tool use (read file, git status, ls) is handled fine by Haiku.
const COMPLEX_TASK_PHRASES = [
  'refactor',
  'implement',
  'debug the',
  'fix the bug',
  'fix the error',
  'rewrite',
  'redesign',
  'architect',
  'write a',
  'write the',
  'create a new',
  'build the',
  'deploy',
  'migrate',
  'explain the code',
  'explain how',
  'review the code',
  'code review',
]

function looksLikeComplexTask(text: string): boolean {
  const lower = text.toLowerCase()
  return COMPLEX_TASK_PHRASES.some((phrase) => lower.includes(phrase))
}

// Max tool iterations before Haiku escalates to Sonnet mid-request.
// Simple queries use 1-2 tool calls; anything beyond this threshold
// suggests multi-step reasoning that benefits from Sonnet.
const HAIKU_TOOL_ESCALATION_THRESHOLD = 3

function pickModel(_sessionId: string, userText: string): string {
  const mode = getModelMode()

  if (mode === 'sonnet') return MODEL_SONNET
  if (mode === 'haiku') return MODEL_HAIKU

  // Auto mode: only route to Sonnet for complex tasks
  if (looksLikeComplexTask(userText)) {
    return MODEL_SONNET
  }

  // Default to Haiku — it handles simple tool use fine
  return MODEL_HAIKU
}

// --- End model routing ---

const WORK_DIR = process.env.WORK_DIR ?? process.cwd()

// --- Command blocklist ---

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /rm\s+-[^\s]*r[^\s]*f[^\s]*\s+\/\s*$/,
    reason: 'Refusing to rm -rf /',
  },
  {
    pattern: /rm\s+-[^\s]*r[^\s]*f[^\s]*\s+~\s*$/,
    reason: 'Refusing to rm -rf home directory',
  },
  { pattern: /\bsudo\b/, reason: 'sudo is not allowed' },
  {
    pattern: /\b(curl|wget)\b.*\|\s*(sh|bash|zsh)\b/,
    reason: 'Piped remote execution is not allowed',
  },
  {
    pattern: /(^|\||\;|\&\&)\s*eval\s/,
    reason: 'eval is not allowed',
  },
  {
    pattern: /(^|\||\;|\&\&)\s*exec\s/,
    reason: 'exec is not allowed',
  },
  { pattern: /\bmkfs\b/, reason: 'mkfs is not allowed' },
  { pattern: /\bdd\s+if=/, reason: 'dd is not allowed' },
  {
    pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;?\s*:/,
    reason: 'Fork bomb detected',
  },
  {
    pattern: /\bchmod\s+777\s+\//,
    reason: 'chmod 777 on system paths is not allowed',
  },
  {
    pattern: /\bchown\b.*\s+\/(bin|sbin|usr|etc|var|lib|boot|sys|proc|dev)\b/,
    reason: 'chown on system paths is not allowed',
  },
  {
    pattern: /^\s*>/,
    reason: 'Truncating files with > redirection is not allowed',
  },
]

function isCommandBlocked(cmd: string): string | null {
  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) {
      return reason
    }
  }
  return null
}
const SYSTEM_PROMPT = `You are a hands-free voice coding assistant called Voice Claude. You run as a web app that the user accesses from their phone or computer. You can hear them speak through their microphone — their speech is transcribed and sent to you. Your responses are spoken back to them via text-to-speech. This is a live, real-time voice conversation.

When the user says things like "can you hear me" or "are you there", respond naturally — you can hear them. If they ask what you are, explain that you're a voice interface for Claude that can help with coding tasks hands-free.

Input is speech-to-text — interpret generously despite transcription errors.

You have tools for files, shell commands, and git. Use them as needed.

VOICE RULES (responses are spoken via TTS):
- 100 words max. Two to three sentences typical.
- Never read back file contents, code, or long lists. Summarize instead: "The config has 12 dependencies" not the actual list.
- After tool use, report results conversationally: "I found 3 matching files" or "The build succeeded with 2 warnings." Don't echo raw output.
- No markdown, code blocks, or bullet points — plain spoken language only.
- If the user asks for details, give slightly more but still stay concise.

Working directory: ${WORK_DIR}`
const tools: Anthropic.Tool[] = [
  {
    name: 'run_shell',
    description:
      'Run a shell command and return stdout/stderr. Use for git commands, listing files, searching code, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file. Returns the full text content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description:
            'Path to the file (relative to working directory or absolute)',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
]

async function executeTool(
  name: string,
  input: Record<string, string>,
): Promise<string> {
  switch (name) {
    case 'run_shell': {
      const cmd = input.command ?? ''
      console.log(`[claude] tool run_shell: ${cmd}`)
      const blocked = isCommandBlocked(cmd)
      if (blocked) {
        console.log(`[claude] blocked command: ${cmd}`)
        return `Error: ${blocked}`
      }
      try {
        const { stdout } = await execAsync(cmd, {
          cwd: WORK_DIR,
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        })
        return stdout.trim() || '(no output)'
      } catch (err) {
        const e = err as { stderr?: string; message?: string }
        return `Error: ${e.stderr ?? e.message ?? 'unknown error'}`
      }
    }

    case 'read_file': {
      const filePath = input.path ?? ''
      const resolvedWorkDir = path.resolve(WORK_DIR)
      const resolved = path.resolve(WORK_DIR, filePath)
      if (!resolved.startsWith(resolvedWorkDir)) {
        return 'Error: access denied — path is outside the working directory'
      }
      console.log(`[claude] tool read_file: ${resolved}`)
      if (!existsSync(resolved)) {
        return `Error: file not found: ${resolved}`
      }
      try {
        return readFileSync(resolved, 'utf-8')
      } catch (err) {
        const e = err as { message?: string }
        return `Error: ${e.message ?? 'unknown error'}`
      }
    }

    default:
      return `Error: unknown tool "${name}"`
  }
}

// Conversation state per session
const sessions = new Map<string, Anthropic.MessageParam[]>()
const sessionLastActive = new Map<string, number>()

const SESSION_TTL_MS = 30 * 60 * 1000 // 30 minutes
const MAX_SESSION_MESSAGES = 50

// Evict sessions that have been inactive for longer than SESSION_TTL_MS.
// Runs on a fixed interval so stale sessions don't accumulate.
const SESSION_EVICTION_INTERVAL_MS = 5 * 60 * 1000 // check every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [id, lastActive] of sessionLastActive) {
    if (now - lastActive > SESSION_TTL_MS) {
      console.log(
        `[claude] evicting stale session ${id.slice(0, 8)} (inactive ${Math.round((now - lastActive) / 1000 / 60)}m)`,
      )
      sessions.delete(id)
      sessionLastActive.delete(id)
    }
  }
}, SESSION_EVICTION_INTERVAL_MS).unref()

export interface ClaudeUsageResult {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

export interface ClaudeResponse {
  text: string
  toolCalls: Array<{ name: string; input: string; result: string }>
  usage: ClaudeUsageResult
  model: string
}

export async function chat(
  sessionId: string,
  userText: string,
  onToolUse?: (name: string, input: string) => void,
): Promise<ClaudeResponse> {
  const anthropic = getClient()

  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, [])
  }
  sessionLastActive.set(sessionId, Date.now())
  const messages = sessions.get(sessionId) ?? []
  messages.push({ role: 'user', content: userText })

  // Enforce max message depth — keep the most recent messages
  if (messages.length > MAX_SESSION_MESSAGES) {
    const excess = messages.length - MAX_SESSION_MESSAGES
    messages.splice(0, excess)
  }

  const toolCalls: ClaudeResponse['toolCalls'] = []
  const accumulatedUsage: ClaudeUsageResult = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
  let continueCount = 0
  const MAX_CONTINUES = 3

  // Pick the initial model based on heuristics
  let model = pickModel(sessionId, userText)
  console.log(
    `[claude] model routing: ${model} (mode=${getModelMode()}, session=${sessionId})`,
  )

  // Retry helper for transient API errors (429 rate-limited, 529 overloaded)
  const MAX_RETRIES = 3
  async function createWithRetry(
    params: Anthropic.MessageCreateParamsNonStreaming,
  ): Promise<Anthropic.Message> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await anthropic.messages.create(params)
      } catch (err) {
        const status = (err as { status?: number }).status
        if ((status === 429 || status === 529) && attempt < MAX_RETRIES) {
          const delay = 1000 * 2 ** (attempt - 1) // 1s, 2s, 4s
          console.log(
            `[claude] ${status} error on attempt ${attempt}/${MAX_RETRIES}, retrying in ${delay}ms`,
          )
          await new Promise((r) => setTimeout(r, delay))
          continue
        }
        throw err
      }
    }
  }

  while (continueCount <= MAX_CONTINUES) {
    try {
      let iterations = 0
      const MAX_ITERATIONS = 20

      while (iterations < MAX_ITERATIONS) {
        iterations++

        console.log(
          `[claude] sending request to ${model} (iteration ${iterations}, continue ${continueCount})`,
        )
        const response = await createWithRetry({
          model,
          max_tokens: 4096,
          system: [
            {
              type: 'text',
              text: SYSTEM_PROMPT,
              cache_control: { type: 'ephemeral' },
            },
          ],
          tools,
          messages,
        })

        // Log prompt caching stats
        const usage = response.usage as unknown as Record<
          string,
          number | undefined
        >
        const cacheRead = usage.cache_read_input_tokens ?? 0
        const cacheCreation = usage.cache_creation_input_tokens ?? 0
        if (cacheRead > 0 || cacheCreation > 0) {
          console.log(
            `[claude] cache stats: read=${cacheRead} tokens, creation=${cacheCreation} tokens, input=${usage.input_tokens ?? 0} tokens`,
          )
        }

        messages.push({ role: 'assistant', content: response.content })

        // Accumulate token usage from this API call
        accumulatedUsage.input_tokens += response.usage.input_tokens
        accumulatedUsage.output_tokens += response.usage.output_tokens
        accumulatedUsage.cache_creation_input_tokens +=
          (response.usage as unknown as Record<string, number>)
            .cache_creation_input_tokens ?? 0
        accumulatedUsage.cache_read_input_tokens +=
          (response.usage as unknown as Record<string, number>)
            .cache_read_input_tokens ?? 0

        if (response.stop_reason === 'end_turn') {
          const textBlock = response.content.find(
            (b): b is Anthropic.TextBlock => b.type === 'text',
          )
          const text = textBlock?.text ?? ''
          console.log(
            `[claude] response (${iterations} iterations, ${continueCount} continues): "${text.slice(0, 100)}${text.length > 100 ? '...' : ''}"`,
          )
          return { text, toolCalls, usage: accumulatedUsage, model }
        }

        if (response.stop_reason === 'tool_use') {
          // In auto mode, escalate Haiku to Sonnet if tool iterations exceed
          // the threshold — this indicates a complex multi-step task.
          if (
            model === MODEL_HAIKU &&
            getModelMode() === 'auto' &&
            iterations >= HAIKU_TOOL_ESCALATION_THRESHOLD
          ) {
            console.log(
              `[claude] Haiku hit ${iterations} tool iterations — escalating to Sonnet`,
            )
            model = MODEL_SONNET
            // Don't discard messages — keep the conversation history and
            // tool results so Sonnet can continue where Haiku left off.
          }

          const toolUseBlocks = response.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
          )

          const toolResults: Anthropic.ToolResultBlockParam[] = []

          for (const tool of toolUseBlocks) {
            const input = tool.input as Record<string, string>
            const inputStr = JSON.stringify(input)
            onToolUse?.(tool.name, inputStr)

            const result = await executeTool(tool.name, input)
            const truncated =
              result.length > 10_000
                ? `${result.slice(0, 10_000)}\n... (truncated, ${result.length} chars total)`
                : result

            toolCalls.push({
              name: tool.name,
              input: inputStr,
              result: truncated,
            })
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tool.id,
              content: truncated,
            })
          }

          messages.push({ role: 'user', content: toolResults })
          continue
        }

        // Unexpected stop reason — return what we have
        const textBlock = response.content.find(
          (b): b is Anthropic.TextBlock => b.type === 'text',
        )
        return {
          text: textBlock?.text ?? '',
          toolCalls,
          usage: accumulatedUsage,
          model,
        }
      }

      return {
        text: 'I hit the maximum number of tool iterations. Could you try a simpler request?',
        toolCalls,
        usage: accumulatedUsage,
        model,
      }
    } catch (err) {
      const error = err as {
        message?: string
        error?: { type?: string; message?: string }
      }
      const errorMessage =
        error.error?.message ?? error.message ?? 'Unknown error'

      // Check if this is a max iterations error from the API
      if (
        errorMessage.includes('maximum number of tool') ||
        errorMessage.includes('too many tool calls') ||
        error.error?.type === 'invalid_request_error'
      ) {
        continueCount++
        console.log(
          `[claude] hit API tool limit, auto-continuing (${continueCount}/${MAX_CONTINUES})`,
        )

        if (continueCount > MAX_CONTINUES) {
          return {
            text: `I've made a lot of progress but need to stop here. I completed ${toolCalls.length} operations. Please ask me to continue if you'd like me to finish.`,
            toolCalls,
            usage: accumulatedUsage,
            model,
          }
        }

        // Add a continue message and loop again
        messages.push({
          role: 'user',
          content: 'Please continue with the remaining tasks.',
        })
        continue
      }

      // Some other error - rethrow it
      throw err
    }
  }

  return {
    text: 'Completed the available operations.',
    toolCalls,
    usage: accumulatedUsage,
    model,
  }
}

export function clearSession(sessionId: string) {
  sessions.delete(sessionId)
  sessionLastActive.delete(sessionId)
}

export function restoreSession(
  sessionId: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
) {
  const messages: Anthropic.MessageParam[] = []
  for (const msg of history) {
    if (msg.content) {
      messages.push({ role: msg.role, content: msg.content })
    }
  }
  sessions.set(sessionId, messages)
  console.log(
    `[claude] restored session ${sessionId.slice(0, 8)} with ${messages.length} messages`,
  )
}
