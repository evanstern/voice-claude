import Anthropic from '@anthropic-ai/sdk'
import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

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

const MODEL_SONNET = 'claude-sonnet-4-5'
const MODEL_HAIKU = 'claude-haiku-4-5'

type ModelMode = 'auto' | 'sonnet' | 'haiku'

function getModelMode(): ModelMode {
  const env = process.env.CLAUDE_MODEL?.toLowerCase()
  if (env === 'sonnet' || env === 'haiku') return env
  return 'auto' // default
}

// Keywords that suggest the query needs tool use (and therefore Sonnet)
const TOOL_KEYWORDS = [
  'file', 'code', 'git', 'run', 'build', 'deploy',
  'read', 'write', 'edit', 'commit', 'push', 'pull',
  'branch', 'merge', 'diff', 'log', 'status',
  'install', 'test', 'compile', 'lint', 'format',
  'directory', 'folder', 'path', 'create', 'delete',
  'remove', 'rename', 'move', 'copy', 'search', 'find',
  'grep', 'cat', 'ls', 'cd', 'npm', 'pnpm', 'yarn',
  'docker', 'make', 'script', 'package', 'config',
  'debug', 'error', 'fix', 'refactor', 'implement',
  'function', 'class', 'variable', 'import', 'module',
  'repo', 'repository', 'pr', 'issue', 'release',
  'server', 'database', 'api', 'endpoint', 'route',
  'show me', 'look at', 'check the', 'what does',
  'open', 'source', 'execute', 'command', 'shell', 'terminal',
]

function looksLikeToolQuery(text: string): boolean {
  const lower = text.toLowerCase()
  return TOOL_KEYWORDS.some((kw) => lower.includes(kw))
}

// Track sessions that have needed tools — once a session uses tools, prefer Sonnet
const toolSessions = new Set<string>()

function pickModel(sessionId: string, userText: string): string {
  const mode = getModelMode()

  if (mode === 'sonnet') return MODEL_SONNET
  if (mode === 'haiku') return MODEL_HAIKU

  // Auto mode: use heuristics
  // If this session already needed tools, stick with Sonnet
  if (toolSessions.has(sessionId)) {
    return MODEL_SONNET
  }

  // Check keywords
  if (looksLikeToolQuery(userText)) {
    return MODEL_SONNET
  }

  // Default to Haiku for simple queries
  return MODEL_HAIKU
}

// --- End model routing ---

const WORK_DIR = process.env.WORK_DIR ?? process.cwd()
const SYSTEM_PROMPT = `You are a hands-free voice assistant for a software developer. The developer is talking to you through speech-to-text, so their messages may be informal or contain transcription errors — interpret generously.

You have access to tools for reading files, running shell commands, and executing git operations. Use them when the developer asks about code, repos, or system state.

Keep responses concise and conversational — they'll be read back via text-to-speech. Avoid code blocks, markdown formatting, or long lists unless specifically asked. Prefer short, spoken-style answers.

IMPORTANT: Be BRIEF. One or two sentences maximum unless the user explicitly asks for details. Think of this as a quick back-and-forth conversation, not an essay.

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
          description: 'Path to the file (relative to working directory or absolute)',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
]

function executeTool(
  name: string,
  input: Record<string, string>,
): string {
  switch (name) {
    case 'run_shell': {
      const cmd = input.command ?? ''
      console.log(`[claude] tool run_shell: ${cmd}`)
      try {
        const output = execSync(cmd, {
          cwd: WORK_DIR,
          encoding: 'utf-8',
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        })
        return output.trim() || '(no output)'
      } catch (err) {
        const e = err as { stderr?: string; message?: string }
        return `Error: ${e.stderr ?? e.message ?? 'unknown error'}`
      }
    }

    case 'read_file': {
      const filePath = input.path ?? ''
      const resolved = filePath.startsWith('/')
        ? filePath
        : `${WORK_DIR}/${filePath}`
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

export interface ClaudeResponse {
  text: string
  toolCalls: Array<{ name: string; input: string; result: string }>
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
  const messages = sessions.get(sessionId)!
  messages.push({ role: 'user', content: userText })

  const toolCalls: ClaudeResponse['toolCalls'] = []
  let continueCount = 0
  const MAX_CONTINUES = 3

  // Pick the initial model based on heuristics
  let model = pickModel(sessionId, userText)
  console.log(`[claude] model routing: ${model} (mode=${getModelMode()}, session=${sessionId})`)

  while (continueCount <= MAX_CONTINUES) {
    try {
      let iterations = 0
      const MAX_ITERATIONS = 20

      while (iterations < MAX_ITERATIONS) {
        iterations++

        console.log(`[claude] sending request to ${model} (iteration ${iterations}, continue ${continueCount})`)
        const response = await anthropic.messages.create({
          model,
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          tools,
          messages,
        })

        messages.push({ role: 'assistant', content: response.content })

        if (response.stop_reason === 'end_turn') {
          const textBlock = response.content.find(
            (b): b is Anthropic.TextBlock => b.type === 'text',
          )
          const text = textBlock?.text ?? ''
          console.log(`[claude] response from ${model} (${iterations} iterations, ${continueCount} continues): "${text.slice(0, 100)}${text.length > 100 ? '...' : ''}"`)
          return { text, toolCalls, model }
        }

        if (response.stop_reason === 'tool_use') {
          // If we were using Haiku and it wants tools, escalate to Sonnet
          if (model === MODEL_HAIKU) {
            console.log(`[claude] Haiku requested tool_use — escalating to Sonnet for this session`)
            model = MODEL_SONNET
            toolSessions.add(sessionId)

            // Remove the assistant message we just added (Haiku's tool_use response)
            // and replay from the user message with Sonnet instead
            messages.pop()
            continue
          }

          // Mark session as tool-using for future requests
          toolSessions.add(sessionId)

          const toolUseBlocks = response.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
          )

          const toolResults: Anthropic.ToolResultBlockParam[] = []

          for (const tool of toolUseBlocks) {
            const input = tool.input as Record<string, string>
            const inputStr = JSON.stringify(input)
            onToolUse?.(tool.name, inputStr)

            const result = executeTool(tool.name, input)
            const truncated =
              result.length > 10_000
                ? `${result.slice(0, 10_000)}\n... (truncated, ${result.length} chars total)`
                : result

            toolCalls.push({ name: tool.name, input: inputStr, result: truncated })
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
        return { text: textBlock?.text ?? '', toolCalls, model }
      }

      return { text: 'I hit the maximum number of tool iterations. Could you try a simpler request?', toolCalls, model }

    } catch (err) {
      const error = err as { message?: string; error?: { type?: string; message?: string } }
      const errorMessage = error.error?.message ?? error.message ?? 'Unknown error'

      // Check if this is a max iterations error from the API
      if (errorMessage.includes('maximum number of tool') ||
          errorMessage.includes('too many tool calls') ||
          error.error?.type === 'invalid_request_error') {

        continueCount++
        console.log(`[claude] hit API tool limit, auto-continuing (${continueCount}/${MAX_CONTINUES})`)

        if (continueCount > MAX_CONTINUES) {
          return {
            text: `I've made a lot of progress but need to stop here. I completed ${toolCalls.length} operations. Please ask me to continue if you'd like me to finish.`,
            toolCalls,
            model,
          }
        }

        // Add a continue message and loop again
        messages.push({ role: 'user', content: 'Please continue with the remaining tasks.' })
        continue
      }

      // Some other error - rethrow it
      throw err
    }
  }

  return { text: 'Completed the available operations.', toolCalls, model }
}

export function clearSession(sessionId: string) {
  sessions.delete(sessionId)
  toolSessions.delete(sessionId)
}
