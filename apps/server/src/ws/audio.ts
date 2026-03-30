import { randomUUID } from 'node:crypto'
import type { IncomingMessage, Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { chat } from '../voice/claude.js'
import { transcribe } from '../voice/stt.js'

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

    console.log(`[ws] connected  client=${client} session=${sessionId.slice(0, 8)}`)

    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        try {
          const msg = JSON.parse(data.toString())
          handleControl(ws, sessionId, msg, () => ({
            audioChunks,
            resetAudio: () => {
              audioChunks = []
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
  getAudioState: () => { audioChunks: Buffer[]; resetAudio: () => void },
) {
  console.log(`[ws] control    type=${msg.type}`)

  switch (msg.type) {
    case 'ping':
      send(ws, { type: 'pong', timestamp: Date.now() })
      break

    case 'stop': {
      const { audioChunks, resetAudio } = getAudioState()
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
        userText = await transcribe(combined)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        console.error(`[ws] stt error  ${message}`)
        send(ws, { type: 'transcription', text: '', error: message })
        break
      }

      send(ws, { type: 'transcription', text: userText })

      if (!userText) break

      // Phase 2: Send to Claude
      send(ws, { type: 'thinking' })

      try {
        const response = await chat(sessionId, userText, (toolName, toolInput) => {
          send(ws, { type: 'tool_use', name: toolName, input: toolInput })
        })

        send(ws, {
          type: 'claude_response',
          text: response.text,
          toolCalls: response.toolCalls,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        console.error(`[ws] claude error  ${message}`)
        send(ws, { type: 'claude_response', text: '', error: message })
      }
      break
    }
  }
}
