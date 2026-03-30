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

const WORK_DIR = process.env.WORK_DIR ?? process.cwd()

const SYSTEM_PROMPT = `You are a hands-free voice assistant for a software developer. The developer is talking to you through speech-to-text, so their messages may be informal or contain transcription errors — interpret generously.

You have access to tools for reading files, running shell commands, and executing git operations. Use them when the developer asks about code, repos, or system state.

Keep responses concise and conversational — they'll be read back via text-to-speech. Avoid code blocks, markdown formatting, or long lists unless specifically asked. Prefer short, spoken-style answers.

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
  let iterations = 0
  const MAX_ITERATIONS = 10

  while (iterations < MAX_ITERATIONS) {
    iterations++

    console.log(`[claude] sending request (iteration ${iterations})`)
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
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
      console.log(`[claude] response (${iterations} iterations): "${text.slice(0, 100)}${text.length > 100 ? '...' : ''}"`)
      return { text, toolCalls }
    }

    if (response.stop_reason === 'tool_use') {
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
    return { text: textBlock?.text ?? '', toolCalls }
  }

  return { text: 'I hit the maximum number of tool iterations. Could you try a simpler request?', toolCalls }
}

export function clearSession(sessionId: string) {
  sessions.delete(sessionId)
}
