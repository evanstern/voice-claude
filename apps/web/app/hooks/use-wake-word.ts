import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '~/lib/logger'

const log = createLogger('wake-word')

interface WakeEvent {
  model: string
  score: number
  timestamp: number
}

interface WakeWordState {
  connected: boolean
  listening: boolean
  models: string[]
  lastWake: WakeEvent | null
}

const RECONNECT_BASE_DELAY = 2000
const RECONNECT_MAX_DELAY = 30000
const RECONNECT_MAX_ATTEMPTS = 10

const FRAME_SAMPLES = 2560

export function useWakeWord(wsUrl: string | null, enabled: boolean) {
  const wsRef = useRef<WebSocket | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const reconnectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intentionalCloseRef = useRef(false)
  const pausedRef = useRef(false)
  const onWakeRef = useRef<((event: WakeEvent) => void) | null>(null)

  const [state, setState] = useState<WakeWordState>({
    connected: false,
    listening: false,
    models: [],
    lastWake: null,
  })

  const setOnWake = useCallback((cb: ((event: WakeEvent) => void) | null) => {
    onWakeRef.current = cb
  }, [])

  const stopAudioPipeline = useCallback(() => {
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage('stop')
      workletNodeRef.current.disconnect()
      workletNodeRef.current = null
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop()
      }
      streamRef.current = null
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close()
      audioCtxRef.current = null
    }
  }, [])

  const startAudioPipeline = useCallback(
    async (ws: WebSocket) => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 16000,
          },
        })
        streamRef.current = stream

        const audioCtx = new AudioContext({ sampleRate: 16000 })
        audioCtxRef.current = audioCtx

        await audioCtx.audioWorklet.addModule(
          '/audio-worklet/pcm-capture-processor.js',
        )

        const source = audioCtx.createMediaStreamSource(stream)
        const workletNode = new AudioWorkletNode(
          audioCtx,
          'pcm-capture-processor',
          { processorOptions: { frameSamples: FRAME_SAMPLES } },
        )
        workletNodeRef.current = workletNode

        workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
          if (ws.readyState === WebSocket.OPEN && !pausedRef.current) {
            ws.send(event.data)
          }
        }

        source.connect(workletNode)
        workletNode.connect(audioCtx.destination)

        ws.send(JSON.stringify({ sample_rate: audioCtx.sampleRate }))

        setState((s) => ({ ...s, listening: true }))
        log.info(
          `streaming PCM at ${audioCtx.sampleRate} Hz, frame=${FRAME_SAMPLES} samples`,
        )
      } catch (err) {
        log.error('failed to start audio pipeline:', err)
        stopAudioPipeline()
      }
    },
    [stopAudioPipeline],
  )

  useEffect(() => {
    if (!wsUrl || !enabled) {
      if (wsRef.current) {
        intentionalCloseRef.current = true
        wsRef.current.close()
        wsRef.current = null
      }
      stopAudioPipeline()
      setState({
        connected: false,
        listening: false,
        models: [],
        lastWake: null,
      })
      return
    }

    intentionalCloseRef.current = false
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      log.info('connected to wake-word service')
      reconnectAttemptRef.current = 0
      setState((s) => ({ ...s, connected: true }))
    }

    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return

      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }

      if (msg.type === 'ready') {
        const models = (msg.models as string[]) ?? []
        log.info('wake-word service ready, models:', models)
        setState((s) => ({ ...s, models }))
        startAudioPipeline(ws)
      }

      if (msg.type === 'wake') {
        const wakeEvent: WakeEvent = {
          model: msg.model as string,
          score: msg.score as number,
          timestamp: msg.timestamp as number,
        }
        log.info(
          `wake detected: ${wakeEvent.model} (${wakeEvent.score.toFixed(3)})`,
        )
        setState((s) => ({ ...s, lastWake: wakeEvent }))
        onWakeRef.current?.(wakeEvent)
      }
    }

    ws.onclose = () => {
      log.info('disconnected from wake-word service')
      setState((s) => ({
        ...s,
        connected: false,
        listening: false,
      }))
      stopAudioPipeline()

      if (
        !intentionalCloseRef.current &&
        reconnectAttemptRef.current < RECONNECT_MAX_ATTEMPTS
      ) {
        const attempt = reconnectAttemptRef.current + 1
        const delay = Math.min(
          RECONNECT_BASE_DELAY * 2 ** (attempt - 1),
          RECONNECT_MAX_DELAY,
        )
        reconnectAttemptRef.current = attempt
        log.info(`reconnecting (attempt ${attempt}) in ${delay}ms`)
        reconnectTimerRef.current = setTimeout(() => {
          wsRef.current = null
          setState((s) => ({ ...s, connected: false }))
        }, delay)
      }
    }

    ws.onerror = () => {
      log.error('wake-word WebSocket error')
    }

    return () => {
      intentionalCloseRef.current = true
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      ws.close()
      stopAudioPipeline()
    }
  }, [wsUrl, enabled, startAudioPipeline, stopAudioPipeline])

  const pause = useCallback(() => {
    pausedRef.current = true
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'pause' }))
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage('stop')
    }
    setState((s) => ({ ...s, listening: false }))
    log.debug('paused')
  }, [])

  const resume = useCallback(() => {
    pausedRef.current = false
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resume' }))
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage('start')
    }
    setState((s) => ({ ...s, listening: true }))
    log.debug('resumed')
  }, [])

  return {
    ...state,
    pause,
    resume,
    setOnWake,
  }
}
