import { randomUUID } from 'node:crypto'
import type { IncomingMessage, Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  appendMessage,
  autoTitle,
} from '../storage/conversations.js'
import { chat, clearSession } from '../voice/claude.js'
import { parseCommand } from '../voice/commands.js'
import {
  recordSTT,
  recordClaude,
  recordTTS,
  finalizeInteraction,
} from '../voice/cost-tracker.js'
import { transcribe } from '../voice/stt.js'
import { filterForTTS } from '../voice/text-filter.js'
import { getTTSProvider } from '../voice/tts.js'

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

function send(ws: WebSocket, msg: Record<string, unknown>) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

export function attachWebSocket(httpServer: Server) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/audio' })

  wss.on('connection', (ws, req: IncomingMessage) => {
    const client = req.socket.remoteAddress ?? 'unknown'
    const sessionId = randomUUID()
    const connectedAt = Date.now()
    let chunkCount = 0
    let totalBytes = 0
    let streamStartedAt: number | null = null
    let audioChunks: Buffer[] = []
    let conversationId: string | null = null
    let isFirstMessage = true

    console.log(`[ws] connected  client=${client} session=${sessionId.slice(0, 8)}`)

    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        try {
          const msg = JSON.parse(data.toString())

          // Handle conversation assignment
          if (msg.type === 'set_conversation') {
            conversationId = msg.conversationId ?? null
            isFirstMessage = msg.isFirstMessage ?? true
            console.log(`[ws] conversation set to ${conversationId?.slice(0, 8) ?? 'none'}`)
            send(ws, { type: 'conversation_set', conversationId })
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
          }))
        } catch {
          // Ignore malformed text
        }
        return
      }

      if (chunkCount === 0) {
        streamStartedAt = Date.now()
        console.log(`[ws] stream     started`)
      }

      chunkCount++
      const chunk = data as Buffer
      const bytes = chunk.byteLength
      totalBytes += bytes
      audioChunks.push(chunk)

      console.log(
        `[ws] chunk #${String(chunkCount).padStart(4)}  ` +
          `size=${formatBytes(bytes).padStart(8)}  ` +
          `total=${formatBytes(totalBytes).padStart(10)}`,
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
      const streamDuration = streamStartedAt
        ? elapsed(streamStartedAt)
        : 'n/a'
      const avgChunkSize =
        chunkCount > 0
          ? formatBytes(Math.round(totalBytes / chunkCount))
          : 'n/a'

      console.log(`[ws] closed     code=${code}`)
      console.log(
        `[ws] ─── session summary ───────────────────\n` +
          `[ws]   connection duration : ${duration}\n` +
          `[ws]   stream duration     : ${streamDuration}\n` +
          `[ws]   chunks received     : ${chunkCount}\n` +
          `[ws]   total data          : ${formatBytes(totalBytes)}\n` +
          `[ws]   avg chunk size      : ${avgChunkSize}\n` +
          `[ws] ──────────────────────────────────────`,
      )
    })

    ws.on('error', (err) => {
      console.error(`[ws] error      ${err.message}`)
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
  msg: Record<string, unknown>,
  getAudioState: () => {
    audioChunks: Buffer[]
    resetAudio: () => void
    conversationId: string | null
    isFirstMessage: boolean
    setFirstMessage: (val: boolean) => void
  },
) {
  console.log(`[ws] control    type=${msg.type}`)

  switch (msg.type) {
    case 'ping':
      send(ws, { type: 'pong', timestamp: Date.now() })
      break

    case 'stop': {
      const { audioChunks, resetAudio, conversationId, isFirstMessage, setFirstMessage } = getAudioState()
      if (audioChunks.length === 0) {
        send(ws, { type: 'transcription', text: '', error: 'No audio received' })
        break
      }

      const combined = Buffer.concat(audioChunks)
      resetAudio()

      // Phase 1: Transcribe
      send(ws, { type: 'transcribing', bytes: combined.byteLength })

      let userText: string
      try {
        const result = await transcribe(combined)
        userText = result.text
        recordSTT(sessionId, result.durationSec)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        console.error(`[ws] stt error  ${message}`)
        send(ws, { type: 'transcription', text: '', error: message })
        break
      }

      // Check for voice commands before sending to Claude
      const { command, text: cleanedText } = parseCommand(userText)

      if (command === 'disregard') {
        console.log(`[ws] command    disregard — dropping message`)
        send(ws, { type: 'transcription', text: userText })
        send(ws, { type: 'command', command: 'disregard' })
        break
      }

      if (command === 'clear') {
        console.log(`[ws] command    clear — resetting session ${sessionId.slice(0, 8)}`)
        clearSession(sessionId)
        send(ws, { type: 'transcription', text: userText })
        send(ws, { type: 'command', command: 'clear' })
        break
      }

      // Use the cleaned text (command keyword stripped) going forward
      userText = cleanedText

      send(ws, { type: 'transcription', text: userText })

      if (!userText) break

      // Persist user message
      if (conversationId) {
        appendMessage(conversationId, { role: 'user', content: userText })
        if (isFirstMessage) {
          autoTitle(conversationId, userText)
          setFirstMessage(false)
        }
      }

      // Phase 2: Send to Claude
      send(ws, { type: 'thinking' })

      try {
        const response = await chat(sessionId, userText, (toolName, toolInput) => {
          send(ws, { type: 'tool_use', name: toolName, input: toolInput })
        })

        recordClaude(sessionId, response.usage)

        // Persist assistant message
        if (conversationId) {
          appendMessage(conversationId, {
            role: 'assistant',
            content: response.text ?? '',
            toolCalls: response.toolCalls,
            error: undefined,
          })
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
        if (spokenText) {
          send(ws, { type: 'synthesizing' })

          try {
            recordTTS(sessionId, spokenText.length)
            const ttsProvider = await getTTSProvider()
            const audioBuffer = await ttsProvider.synthesize(spokenText)
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
            const ttsMsg = ttsErr instanceof Error ? ttsErr.message : 'Unknown error'
            console.error(`[ws] tts error  ${ttsMsg}`)
            send(ws, { type: 'tts_error', error: ttsMsg })
          }
        }

        finalizeInteraction(sessionId)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        console.error(`[ws] claude error  ${message}`)
        send(ws, { type: 'claude_response', text: '', error: message })
        finalizeInteraction(sessionId)
      }
      break
    }
  }
}
