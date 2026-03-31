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
  format?: string
  command?: string
  toolCalls?: Array<{ name: string; input: string; result: string }>
}

type ProcessingPhase =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'thinking'
  | 'synthesizing'
  | 'speaking'
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
  commandNotice: string | null
}

function playAudio(data: ArrayBuffer, format = 'mp3'): Promise<void> {
  return new Promise((resolve, reject) => {
    const mimeType =
      format === 'ogg_opus'
        ? 'audio/ogg'
        : format === 'wav'
          ? 'audio/wav'
          : 'audio/mpeg'
    const blob = new Blob([data], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.onended = () => {
      URL.revokeObjectURL(url)
      resolve()
    }
    audio.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Audio playback failed'))
    }
    audio.play().catch(reject)
  })
}

export function useAudioSocket(wsUrl: string | null) {
  const wsRef = useRef<WebSocket | null>(null)
  const currentUrlRef = useRef<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const expectingAudioRef = useRef(false)
  const audioFormatRef = useRef('mp3')
  const audioPlaybackRef = useRef<Promise<void> | null>(null)

  const [micError, setMicError] = useState<string | null>(null)

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
    commandNotice: null,
  })

  const commandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!wsUrl) return

    // If we already have a connection to this URL, don't recreate it
    if (
      wsRef.current &&
      currentUrlRef.current === wsUrl &&
      wsRef.current.readyState !== WebSocket.CLOSED
    ) {
      console.log('[audio] reusing existing WebSocket connection')
      return
    }

    // Close old connection only if URL changed
    if (wsRef.current && currentUrlRef.current !== wsUrl) {
      console.log('[audio] URL changed, closing old connection')
      wsRef.current.close()
    }

    currentUrlRef.current = wsUrl
    const ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onopen = () => {
      console.log('[audio] ws connected to', wsUrl)
      setState((s) => ({ ...s, connected: true }))
    }

    ws.onmessage = (event) => {
      // Binary message = TTS audio
      if (event.data instanceof ArrayBuffer) {
        if (!expectingAudioRef.current) {
          console.warn('[audio] unexpected binary message, ignoring')
          return
        }
        expectingAudioRef.current = false
        const bytes = event.data.byteLength
        console.log(
          `[audio] received TTS audio: ${(bytes / 1024).toFixed(1)} KB`,
        )

        setState((s) => ({ ...s, phase: 'speaking' }))
        const playbackPromise = playAudio(event.data, audioFormatRef.current)
          .then(() => {
            console.log('[audio] playback complete')
            setState((s) => ({ ...s, phase: 'done' }))
          })
          .catch((err) => {
            console.error('[audio] playback error:', err)
            setState((s) => ({ ...s, phase: 'done' }))
          })

        // Store playback promise so it can complete even after hot reload
        audioPlaybackRef.current = playbackPromise
        return
      }

      // Text message = JSON control
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
              setState((s) => ({
                ...s,
                phase: 'done',
                claudeResponse: null,
                claudeError: msg.error ?? null,
                toolCalls: msg.toolCalls ?? [],
                activeTools: [],
              }))
            } else {
              console.log(
                `[audio] claude: "${(msg.text ?? '').slice(0, 100)}..."`,
              )
              // Don't set phase to 'done' yet — TTS may follow
              setState((s) => ({
                ...s,
                claudeResponse: msg.text ?? null,
                claudeError: null,
                toolCalls: msg.toolCalls ?? [],
                activeTools: [],
              }))
            }
            break

          case 'synthesizing':
            console.log('[audio] synthesizing TTS...')
            setState((s) => ({ ...s, phase: 'synthesizing' }))
            break

          case 'tts_audio':
            console.log(
              `[audio] TTS audio header: ${msg.format}, ${msg.bytes} B`,
            )
            expectingAudioRef.current = true
            audioFormatRef.current = msg.format ?? 'mp3'
            break

          case 'tts_error':
            console.error(`[audio] TTS error: ${msg.error}`)
            setState((s) => ({ ...s, phase: 'done' }))
            break

          case 'command': {
            const label =
              msg.command === 'disregard'
                ? 'Message discarded'
                : msg.command === 'clear'
                  ? 'Conversation cleared'
                  : `Command: ${msg.command}`
            console.log(`[audio] voice command: ${msg.command}`)
            setState((s) => ({
              ...s,
              phase: 'done',
              commandNotice: label,
              // Clear conversation state on reset
              ...(msg.command === 'clear'
                ? {
                    transcription: null,
                    claudeResponse: null,
                    claudeError: null,
                    toolCalls: [],
                  }
                : {}),
            }))
            // Auto-dismiss the notice after 3 seconds
            if (commandTimerRef.current) {
              clearTimeout(commandTimerRef.current)
            }
            commandTimerRef.current = setTimeout(() => {
              setState((s) => ({ ...s, commandNotice: null }))
              commandTimerRef.current = null
            }, 3000)
            break
          }

          default:
            console.log(`[audio] ${msg.type}`, msg)
        }
      } catch {
        // Ignore non-JSON text messages
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
      // Only close on true unmount (when component is removed from DOM)
      // Don't close on hot reload or re-render
      console.log('[audio] cleanup called - checking if should close')

      // We'll only actually close if the URL is changing or component unmounting
      // React will call this again with the new URL if needed
    }
  }, [wsUrl])

  // Separate effect to handle true unmount
  useEffect(() => {
    return () => {
      // This only runs on true unmount
      if (wsRef.current) {
        console.log('[audio] component unmounting, closing WebSocket')
        wsRef.current.close()
        wsRef.current = null
        currentUrlRef.current = null
      }
    }
  }, [])

  const startRecording = useCallback(async () => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      })
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      console.error(`[audio] getUserMedia failed: ${err.message}`)

      if (err.name === 'NotAllowedError') {
        setMicError(
          'Microphone permission denied. Please allow microphone access and try again.',
        )
      } else if (err.name === 'NotFoundError') {
        setMicError(
          'No microphone found. Please connect a microphone and try again.',
        )
      } else {
        setMicError(err.message)
      }

      setState((s) => ({ ...s, phase: 'idle' }))
      return
    }

    // Clear any previous mic error on successful access
    setMicError(null)
    streamRef.current = stream

    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm',
    })
    mediaRecorderRef.current = mediaRecorder

    chunksRef.current = []
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data)
        console.log(
          `[audio] buffered chunk #${chunksRef.current.length} (${event.data.size} B)`,
        )
      }
    }

    console.log('[audio] recording started')
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
      commandNotice: null,
    }))
  }, [])

  const stopRecording = useCallback(() => {
    const mediaRecorder = mediaRecorderRef.current
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      // Request final data then stop
      mediaRecorder.requestData()
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
      // Combine all chunks into one valid webm blob and send it
      const chunks = chunksRef.current
      if (chunks.length > 0) {
        const mimeType = chunks[0]?.type || 'audio/webm'
        const blob = new Blob(chunks, { type: mimeType })
        console.log(
          `[audio] sending complete recording: ${(blob.size / 1024).toFixed(1)} KB (${chunks.length} chunks)`,
        )
        ws.send(blob)
      }
      chunksRef.current = []

      // Signal the server to process
      ws.send(JSON.stringify({ type: 'stop' }))
    }

    console.log('[audio] recording stopped, requesting transcription')
  }, [])

  const cancelRecording = useCallback(() => {
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
    chunksRef.current = []

    setState((s) => ({
      ...s,
      phase: 'idle',
    }))

    console.log('[audio] recording cancelled, no audio sent')
  }, [])

  const sendConversation = useCallback(
    (conversationId: string | null, isFirstMessage: boolean) => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'set_conversation',
            conversationId,
            isFirstMessage,
          }),
        )
      }
    },
    [],
  )

  const busy =
    state.phase !== 'idle' &&
    state.phase !== 'done' &&
    state.phase !== 'recording'

  // Expose the mic stream so VAD can attach to it
  const micStream = streamRef.current

  return {
    ...state,
    busy,
    micError,
    startRecording,
    stopRecording,
    cancelRecording,
    micStream,
    sendConversation,
  }
}
