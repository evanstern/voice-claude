import { randomUUID } from 'node:crypto'
import type { IncomingMessage, Server } from 'node:http'
import {
  type ClientWsMessage,
  type ControlMessage,
  clientWsMessage,
} from '@voice-claude/contracts'
import { type WebSocket, WebSocketServer } from 'ws'
import { logger } from '../logger.js'
import {
  appendMessage,
  autoTitle,
  getConversation,
} from '../storage/conversations.js'
import { chat, clearSession, restoreSession } from '../voice/claude.js'
import { looksLikeFileView, parseCommand } from '../voice/commands.js'
import {
  cleanupSession,
  finalizeInteraction,
  recordClaude,
  recordSTT,
  recordTTS,
} from '../voice/cost-tracker.js'
import { getSTTProvider, transcribe } from '../voice/stt.js'
import { filterForTTS } from '../voice/text-filter.js'
import { getTTSProvider } from '../voice/tts.js'

const log = logger.child({ module: 'ws' })

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function elapsed(startMs: number): string {
  const sec = (Date.now() - startMs) / 1000
  if (sec < 60) return `${sec.toFixed(1)}s`
  return `${Math.floor(sec / 60)}m ${(sec % 60).toFixed(0)}s`
}

const MAX_AUDIO_BUFFER_BYTES = 10 * 1024 * 1024 // 10 MB

function send(ws: WebSocket, msg: Record<string, unknown>) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

function verifyAuth(req: IncomingMessage): boolean {
  const authSecret = process.env.AUTH_SECRET
  if (!authSecret) return true

  const authHeader = req.headers.authorization
  if (authHeader === `Bearer ${authSecret}`) return true

  const url = new URL(
    req.url ?? '/',
    `http://${req.headers.host ?? 'localhost'}`,
  )
  const token = url.searchParams.get('token')
  if (token === authSecret) return true

  return false
}

export function attachWebSocket(httpServer: Server) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/audio' })

  wss.on('connection', (ws, req: IncomingMessage) => {
    if (!verifyAuth(req)) {
      ws.close(4001, 'Unauthorized')
      return
    }

    const client = req.socket.remoteAddress ?? 'unknown'
    const sessionId = randomUUID()
    const connectedAt = Date.now()
    let chunkCount = 0
    let totalBytes = 0
    let streamStartedAt: number | null = null
    let audioChunks: Buffer[] = []
    let conversationId: string | null = null
    let isFirstMessage = true
    let processingAbort: AbortController | null = null

    log.info({ client, session: sessionId.slice(0, 8) }, 'connected')

    ws.on('message', async (data, isBinary) => {
      if (!isBinary) {
        let raw: unknown
        try {
          raw = JSON.parse(data.toString())
        } catch {
          log.warn('ignoring malformed JSON')
          return
        }

        const result = clientWsMessage.safeParse(raw)
        if (!result.success) {
          log.warn({ raw }, 'ignoring unrecognized message')
          return
        }

        const msg: ClientWsMessage = result.data

        // Handle conversation assignment
        if (msg.type === 'set_conversation') {
          conversationId = msg.conversationId
          isFirstMessage = msg.isFirstMessage ?? true
          log.info(
            { conversationId: conversationId?.slice(0, 8) ?? 'none' },
            'conversation set',
          )

          // Restore Claude session from persisted messages
          clearSession(sessionId)
          if (conversationId) {
            const conv = await getConversation(conversationId)
            if (conv && conv.messages.length > 0) {
              restoreSession(
                sessionId,
                conv.messages.map((m) => ({
                  role: m.role,
                  content: m.content,
                })),
              )
            }
          }

          send(ws, { type: 'conversation_set', conversationId })
          return
        }

        // Handle cancel inline — abort any in-progress processing
        if (msg.type === 'cancel') {
          if (processingAbort) {
            log.debug('cancel: aborting in-progress processing')
            processingAbort.abort()
            processingAbort = null
          }
          send(ws, { type: 'cancelled' })
          return
        }

        handleControl(ws, sessionId, msg, () => ({
          audioChunks,
          resetAudio: () => {
            audioChunks = []
          },
          conversationId,
          isFirstMessage,
          setFirstMessage: (val: boolean) => {
            isFirstMessage = val
          },
          getAbortSignal: () => {
            processingAbort = new AbortController()
            return processingAbort.signal
          },
          clearAbort: () => {
            processingAbort = null
          },
        }))
        return
      }

      if (chunkCount === 0) {
        streamStartedAt = Date.now()
        log.debug('audio stream started')
      }

      chunkCount++
      const chunk = data as Buffer
      const bytes = chunk.byteLength
      totalBytes += bytes
      audioChunks.push(chunk)

      // Enforce max buffer size to prevent memory exhaustion
      if (totalBytes > MAX_AUDIO_BUFFER_BYTES) {
        log.warn(
          { maxBytes: MAX_AUDIO_BUFFER_BYTES },
          'audio buffer exceeded limit, clearing',
        )
        audioChunks = []
        totalBytes = 0
        chunkCount = 0
        send(ws, {
          type: 'error',
          error: 'Audio buffer exceeded 10 MB limit. Recording cleared.',
        })
        return
      }

      log.debug(
        { chunk: chunkCount, size: bytes, total: totalBytes },
        'audio chunk received',
      )

      send(ws, {
        type: 'audio_ack',
        chunk: chunkCount,
        bytes,
        totalBytes,
      })
    })

    ws.on('close', (code) => {
      const duration = elapsed(connectedAt)
      const streamDuration = streamStartedAt ? elapsed(streamStartedAt) : 'n/a'
      const avgChunkSize =
        chunkCount > 0
          ? formatBytes(Math.round(totalBytes / chunkCount))
          : 'n/a'

      log.info(
        {
          code,
          duration,
          streamDuration,
          chunks: chunkCount,
          totalBytes,
          avgChunkSize,
        },
        'connection closed',
      )

      // Clean up server-side state for this session
      audioChunks = []
      clearSession(sessionId)
      cleanupSession(sessionId)
    })

    ws.on('error', (err) => {
      log.error({ err: err.message }, 'WebSocket error')
    })

    send(ws, {
      type: 'connected',
      sessionId,
      message: 'WebSocket audio channel open',
      timestamp: Date.now(),
    })
  })

  return wss
}

async function handleControl(
  ws: WebSocket,
  sessionId: string,
  msg: ControlMessage,
  getAudioState: () => {
    audioChunks: Buffer[]
    resetAudio: () => void
    conversationId: string | null
    isFirstMessage: boolean
    setFirstMessage: (val: boolean) => void
    getAbortSignal: () => AbortSignal
    clearAbort: () => void
  },
) {
  log.debug({ type: msg.type }, 'control message')

  switch (msg.type) {
    case 'ping':
      send(ws, { type: 'pong', timestamp: Date.now() })
      break

    case 'stop': {
      const {
        audioChunks,
        resetAudio,
        conversationId,
        isFirstMessage,
        setFirstMessage,
        getAbortSignal,
        clearAbort,
      } = getAudioState()

      const signal = getAbortSignal()

      if (audioChunks.length === 0) {
        send(ws, {
          type: 'transcription',
          text: '',
          error: 'No audio received',
        })
        clearAbort()
        break
      }

      let combined: Buffer
      try {
        combined = Buffer.concat(audioChunks)
      } finally {
        resetAudio()
      }

      // Phase 1: Transcribe
      send(ws, { type: 'transcribing', bytes: combined.byteLength })

      let userText: string
      try {
        const result = await transcribe(combined)
        userText = result.text
        const sttProvider = getSTTProvider()
        recordSTT(sessionId, result.durationSec, sttProvider.name, 'whisper-1')
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        log.error({ err: message }, 'STT error')
        send(ws, { type: 'transcription', text: '', error: message })
        clearAbort()
        break
      }

      if (signal.aborted) {
        log.debug('cancelled after transcription')
        clearAbort()
        break
      }

      // Check for voice commands before sending to Claude
      const { command, text: cleanedText } = parseCommand(userText)

      if (command === 'disregard') {
        log.info('voice command: disregard, dropping message')
        send(ws, { type: 'transcription', text: userText })
        send(ws, { type: 'command', command: 'disregard' })
        clearAbort()
        break
      }

      if (command === 'clear') {
        log.info(
          { session: sessionId.slice(0, 8) },
          'voice command: clear, resetting session',
        )
        clearSession(sessionId)
        send(ws, { type: 'transcription', text: userText })
        send(ws, { type: 'command', command: 'clear' })
        clearAbort()
        break
      }

      // Use the cleaned text (command keyword stripped) going forward
      userText = cleanedText

      send(ws, { type: 'transcription', text: userText })

      if (!userText) {
        clearAbort()
        break
      }

      // Persist user message
      if (conversationId) {
        await appendMessage(conversationId, { role: 'user', content: userText })
        if (isFirstMessage) {
          await autoTitle(conversationId, userText)
          setFirstMessage(false)
        }
      }

      // Phase 2: Send to Claude
      send(ws, { type: 'thinking' })

      // Detect file-viewing intent and append a terse instruction
      let chatText = userText
      if (looksLikeFileView(userText)) {
        log.debug('detected file-view intent')
        chatText +=
          '\n\n[SYSTEM: The file contents will be displayed inline in the chat UI. Just read the file and say "Here\'s [filename]." Do NOT describe, summarize, or explain the contents. One sentence max.]'
      }

      try {
        const response = await chat(
          sessionId,
          chatText,
          (toolName, toolInput) => {
            send(ws, { type: 'tool_use', name: toolName, input: toolInput })
          },
          signal,
        )

        recordClaude(sessionId, response.usage, response.model)

        // Persist assistant message
        if (conversationId) {
          await appendMessage(conversationId, {
            role: 'assistant',
            content: response.text ?? '',
            toolCalls: response.toolCalls,
          })
        }

        if (signal.aborted) {
          log.debug('cancelled after claude response')
          // Still send the response text so it appears in chat, just skip TTS
          send(ws, {
            type: 'claude_response',
            text: response.text,
            toolCalls: response.toolCalls,
          })
          finalizeInteraction(sessionId)
          clearAbort()
          break
        }

        send(ws, {
          type: 'claude_response',
          text: response.text,
          toolCalls: response.toolCalls,
        })

        // Phase 3: TTS — synthesize Claude's spoken response to audio
        //   Filter out code blocks, inline code, and raw paths first so
        //   we only pay for (and hear) the conversational content.
        const spokenText = response.text ? filterForTTS(response.text) : ''
        if (spokenText && !signal.aborted) {
          send(ws, { type: 'synthesizing' })

          try {
            const ttsProvider = await getTTSProvider()
            recordTTS(sessionId, spokenText.length, ttsProvider.name, 'tts-1')
            const audioBuffer = await ttsProvider.synthesize(spokenText)

            if (signal.aborted) {
              log.debug('cancelled after TTS synthesis')
              finalizeInteraction(sessionId)
              clearAbort()
              break
            }

            send(ws, {
              type: 'tts_audio',
              format: ttsProvider.defaultFormat,
              bytes: audioBuffer.byteLength,
            })
            // Send the raw audio as binary
            if (ws.readyState === ws.OPEN) {
              ws.send(audioBuffer)
            }
          } catch (ttsErr) {
            const ttsMsg =
              ttsErr instanceof Error ? ttsErr.message : 'Unknown error'
            log.error({ err: ttsMsg }, 'TTS error')
            send(ws, { type: 'tts_error', error: ttsMsg })
          }
        }

        finalizeInteraction(sessionId)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        log.error({ err: message }, 'Claude error')
        send(ws, { type: 'claude_response', text: '', error: message })
        finalizeInteraction(sessionId)
      }
      clearAbort()
      break
    }
  }
}
