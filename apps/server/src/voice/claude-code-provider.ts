import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { AIProvider, ChatParams, ChatResponse } from './ai-provider.js'

const WORK_DIR = process.env.WORK_DIR ?? process.cwd()

// Voice-specific instructions appended to Claude Code's own system prompt
const VOICE_SYSTEM_PROMPT = [
  'IMPORTANT: Your response will be spoken aloud via text-to-speech.',
  'VOICE RULES:',
  '- 100 words max. Two to three sentences typical.',
  '- When the user asks to see or show a file, respond briefly. The file contents are displayed inline in the chat — do not describe, summarize, or read back the contents.',
  '- After tool use, report results conversationally.',
  '- No markdown, code blocks, or bullet points — plain spoken language only.',
].join('\n')

// Default timeout for a single claude invocation (2 minutes)
const PROCESS_TIMEOUT_MS = 120_000

export class ClaudeCodeProvider implements AIProvider {
  readonly name = 'claude-code'

  // Map our sessionId -> Claude Code --session-id UUID.
  // Claude Code manages its own conversation history per session-id,
  // so we just need to keep the mapping stable.
  private sessionMap = new Map<string, string>()

  async chat(params: ChatParams): Promise<ChatResponse> {
    const ccSessionId = this.getOrCreateSessionId(params.sessionId)

    const args = [
      '-p',
      params.userText,
      '--output-format',
      'stream-json',
      '--verbose',
      '--session-id',
      ccSessionId,
      '--permission-mode',
      process.env.CLAUDE_CODE_PERMISSION_MODE ?? 'bypassPermissions',
      '--append-system-prompt',
      VOICE_SYSTEM_PROMPT,
    ]

    // Optionally restrict which tools Claude Code can use
    if (process.env.CLAUDE_CODE_TOOLS) {
      args.push('--tools', process.env.CLAUDE_CODE_TOOLS)
    }

    // Optionally set model
    if (process.env.CLAUDE_CODE_MODEL) {
      args.push('--model', process.env.CLAUDE_CODE_MODEL)
    }

    return new Promise<ChatResponse>((resolve, reject) => {
      let proc: ChildProcess

      try {
        proc = spawn('claude', args, {
          cwd: WORK_DIR,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env },
        })
      } catch (err) {
        reject(
          new Error(
            'Failed to spawn Claude Code CLI. Is it installed? npm install -g @anthropic-ai/claude-code',
          ),
        )
        return
      }

      let resultText = ''
      const toolCalls: ChatResponse['toolCalls'] = []
      let model = ''
      let usage: ChatResponse['usage'] = {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      }
      let buffer = ''

      // Track tool_use IDs so we can match results back
      const pendingToolUseIds = new Map<
        string,
        { name: string; input: string }
      >()

      const timeout = setTimeout(() => {
        proc.kill('SIGTERM')
        reject(new Error('Claude Code CLI timed out'))
      }, PROCESS_TIMEOUT_MS)

      proc.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line)
            processEvent(
              event,
              params,
              toolCalls,
              pendingToolUseIds,
              (t, u, m) => {
                resultText = t
                usage = u
                model = m
              },
            )
          } catch {
            // skip malformed JSON lines
          }
        }
      })

      proc.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim()
        if (text) {
          console.error(`[claude-code] stderr: ${text}`)
        }
      })

      proc.on('close', (code) => {
        clearTimeout(timeout)

        // Process remaining buffer
        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer)
            processEvent(
              event,
              params,
              toolCalls,
              pendingToolUseIds,
              (t, u, m) => {
                resultText = t
                usage = u
                model = m
              },
            )
          } catch {
            // ignore
          }
        }

        if (code !== 0 && !resultText) {
          reject(new Error(`Claude Code CLI exited with code ${code}`))
        } else {
          resolve({ text: resultText, toolCalls, usage, model })
        }
      })

      proc.on('error', (err) => {
        clearTimeout(timeout)
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(
            new Error(
              'Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code',
            ),
          )
        } else {
          reject(err)
        }
      })
    })
  }

  clearSession(sessionId: string): void {
    // Discard the mapping so the next chat() call starts a fresh Claude Code session
    this.sessionMap.delete(sessionId)
  }

  restoreSession(
    _sessionId: string,
    _history: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): void {
    // No-op: Claude Code manages its own session history via --session-id.
    // When we reuse the same session-id, it picks up prior context automatically.
  }

  private getOrCreateSessionId(sessionId: string): string {
    const existing = this.sessionMap.get(sessionId)
    if (existing) return existing

    const newId = randomUUID()
    this.sessionMap.set(sessionId, newId)
    return newId
  }
}

// --- Stream event processing ---

interface StreamAssistantEvent {
  type: 'assistant'
  message?: {
    model?: string
    content?: Array<{
      type: string
      id?: string
      name?: string
      text?: string
      input?: Record<string, unknown>
    }>
  }
}

interface StreamUserEvent {
  type: 'user'
  message?: {
    content?: Array<{
      type: string
      tool_use_id?: string
      content?: string
      is_error?: boolean
    }>
  }
  tool_use_result?: {
    stdout?: string
    stderr?: string
  }
}

interface StreamResultEvent {
  type: 'result'
  result?: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
  modelUsage?: Record<string, unknown>
}

type StreamEvent =
  | StreamAssistantEvent
  | StreamUserEvent
  | StreamResultEvent
  | { type: string }

function processEvent(
  event: StreamEvent,
  params: ChatParams,
  toolCalls: ChatResponse['toolCalls'],
  pendingToolUseIds: Map<string, { name: string; input: string }>,
  setResult: (
    text: string,
    usage: ChatResponse['usage'],
    model: string,
  ) => void,
): void {
  switch (event.type) {
    case 'assistant': {
      const msg = (event as StreamAssistantEvent).message
      if (!msg?.content) break

      for (const block of msg.content) {
        if (block.type === 'tool_use' && block.name && block.id) {
          const inputStr = JSON.stringify(block.input ?? {})
          params.onToolUse?.(block.name, inputStr)
          pendingToolUseIds.set(block.id, {
            name: block.name,
            input: inputStr,
          })
          // Push a placeholder into toolCalls; result filled in on user event
          toolCalls.push({
            name: block.name,
            input: inputStr,
            result: '',
          })
        }
      }
      break
    }

    case 'user': {
      const userEvent = event as StreamUserEvent
      const content = userEvent.message?.content

      if (content) {
        for (const block of content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            const pending = pendingToolUseIds.get(block.tool_use_id)
            if (pending) {
              // Find the matching tool call placeholder
              const tc = toolCalls.find(
                (t) =>
                  t.name === pending.name &&
                  t.input === pending.input &&
                  t.result === '',
              )
              if (tc) {
                tc.result =
                  typeof block.content === 'string'
                    ? block.content
                    : '(no output)'
              }
              pendingToolUseIds.delete(block.tool_use_id)
            }
          }
        }
      }

      // Also check top-level tool_use_result
      if (userEvent.tool_use_result) {
        const r = userEvent.tool_use_result
        const resultStr = r.stdout || r.stderr || '(no output)'
        const emptyTc = toolCalls.find((t) => t.result === '')
        if (emptyTc) {
          emptyTc.result = resultStr
        }
      }
      break
    }

    case 'result': {
      const resultEvent = event as StreamResultEvent
      const u = resultEvent.usage ?? {}
      setResult(
        resultEvent.result ?? '',
        {
          input_tokens: u.input_tokens ?? 0,
          output_tokens: u.output_tokens ?? 0,
          cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
          cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
        },
        Object.keys(resultEvent.modelUsage ?? {})[0] ?? 'claude-code',
      )
      break
    }
  }
}
