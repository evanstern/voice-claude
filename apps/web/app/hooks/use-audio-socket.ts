import { useCallback, useEffect, useRef, useState } from 'react'

interface AudioSocketMessage {
  type: string
  chunk?: number
  bytes?: number
  totalBytes?: number
  timestamp?: number
  message?: string
  text?: string
  error?: string
  name?: string
  input?: string
  toolCalls?: Array<{ name: string; input: string; result: string }>
}

type ProcessingPhase =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'thinking'
  | 'done'

interface AudioSocketState {
  connected: boolean
  phase: ProcessingPhase
  chunksReceived: number
  totalBytes: number
  transcription: string | null
  transcriptionError: string | null
  claudeResponse: string | null
  claudeError: string | null
  toolCalls: Array<{ name: string; input: string; result: string }>
  activeTools: string[]
}

export function useAudioSocket(wsUrl: string | null) {
  const wsRef = useRef<WebSocket | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [state, setState] = useState<AudioSocketState>({
    connected: false,
    phase: 'idle',
    chunksReceived: 0,
    totalBytes: 0,
    transcription: null,
    transcriptionError: null,
    claudeResponse: null,
    claudeError: null,
    toolCalls: [],
    activeTools: [],
  })

  useEffect(() => {
    if (!wsUrl) return

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('[audio] ws connected to', wsUrl)
      setState((s) => ({ ...s, connected: true }))
    }

    ws.onmessage = (event) => {
      try {
        const msg: AudioSocketMessage = JSON.parse(event.data)

        switch (msg.type) {
          case 'audio_ack':
            console.log(
              `[audio] ack chunk #${msg.chunk} (${msg.bytes} B, total: ${msg.totalBytes} B)`,
            )
            setState((s) => ({
              ...s,
              chunksReceived: msg.chunk ?? s.chunksReceived,
              totalBytes: msg.totalBytes ?? s.totalBytes,
            }))
            break

          case 'transcribing':
            console.log(`[audio] transcribing ${msg.bytes} B...`)
            setState((s) => ({ ...s, phase: 'transcribing' }))
            break

          case 'transcription':
            if (msg.error) {
              console.error(`[audio] transcription error: ${msg.error}`)
            } else {
              console.log(`[audio] transcription: "${msg.text}"`)
            }
            setState((s) => ({
              ...s,
              transcription: msg.text ?? null,
              transcriptionError: msg.error ?? null,
              // Don't change phase here — 'thinking' will follow if text was non-empty
              phase: msg.text ? s.phase : 'done',
            }))
            break

          case 'thinking':
            console.log('[audio] claude is thinking...')
            setState((s) => ({ ...s, phase: 'thinking' }))
            break

          case 'tool_use':
            console.log(`[audio] claude using tool: ${msg.name}`)
            setState((s) => ({
              ...s,
              activeTools: [...s.activeTools, msg.name ?? ''],
            }))
            break

          case 'claude_response':
            if (msg.error) {
              console.error(`[audio] claude error: ${msg.error}`)
            } else {
              console.log(
                `[audio] claude: "${(msg.text ?? '').slice(0, 100)}..."`,
              )
            }
            setState((s) => ({
              ...s,
              phase: 'done',
              claudeResponse: msg.text ?? null,
              claudeError: msg.error ?? null,
              toolCalls: msg.toolCalls ?? [],
              activeTools: [],
            }))
            break

          default:
            console.log(`[audio] ${msg.type}`, msg)
        }
      } catch {
        // Ignore non-JSON messages
      }
    }

    ws.onclose = (event) => {
      console.log(`[audio] ws closed (code=${event.code})`)
      setState((s) => ({ ...s, connected: false, phase: 'idle' }))
    }

    ws.onerror = () => {
      console.error('[audio] ws error')
      setState((s) => ({ ...s, connected: false }))
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [wsUrl])

  const startRecording = useCallback(async () => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000,
      },
    })
    streamRef.current = stream

    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm',
    })
    mediaRecorderRef.current = mediaRecorder

    let chunksSent = 0
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
        chunksSent++
        console.log(
          `[audio] sending chunk #${chunksSent} (${event.data.size} B)`,
        )
        ws.send(event.data)
      }
    }

    console.log('[audio] recording started (250ms chunks)')
    mediaRecorder.start(250)
    setState((s) => ({
      ...s,
      phase: 'recording',
      chunksReceived: 0,
      totalBytes: 0,
      transcription: null,
      transcriptionError: null,
      claudeResponse: null,
      claudeError: null,
      toolCalls: [],
      activeTools: [],
    }))
  }, [])

  const stopRecording = useCallback(() => {
    const mediaRecorder = mediaRecorderRef.current
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop()
    }
    mediaRecorderRef.current = null

    const stream = streamRef.current
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop()
      }
    }
    streamRef.current = null

    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop' }))
    }

    console.log('[audio] recording stopped, requesting transcription')
  }, [])

  const busy = state.phase !== 'idle' && state.phase !== 'done' && state.phase !== 'recording'

  return { ...state, busy, startRecording, stopRecording }
}
