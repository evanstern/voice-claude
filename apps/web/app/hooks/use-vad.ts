import { useCallback, useEffect, useRef, useState } from 'react'

interface VADOptions {
  /** RMS threshold below which audio is considered silence (0-1). Default: 0.01 */
  silenceThreshold?: number
  /** How long silence must persist before triggering speech end (ms). Default: 1500 */
  silenceTimeout?: number
  /** Minimum speech duration before silence detection kicks in (ms). Default: 500 */
  minSpeechDuration?: number
}

interface VADState {
  isSpeaking: boolean
  silenceDuration: number
}

export function useVAD(
  stream: MediaStream | null,
  options: VADOptions = {},
) {
  const {
    silenceThreshold = 0.01,
    silenceTimeout = 1500,
    minSpeechDuration = 500,
  } = options

  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number>(0)
  const speechStartRef = useRef<number>(0)
  const lastSpeechRef = useRef<number>(0)

  const [state, setState] = useState<VADState>({
    isSpeaking: false,
    silenceDuration: 0,
  })

  const onSpeechEndRef = useRef<(() => void) | null>(null)

  const setOnSpeechEnd = useCallback((cb: (() => void) | null) => {
    onSpeechEndRef.current = cb
  }, [])

  useEffect(() => {
    if (!stream) {
      setState({ isSpeaking: false, silenceDuration: 0 })
      return
    }

    const ctx = new AudioContext()
    ctxRef.current = ctx
    const source = ctx.createMediaStreamSource(stream)
    sourceRef.current = source
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.3
    source.connect(analyser)
    analyserRef.current = analyser

    const dataArray = new Float32Array(analyser.fftSize)
    let speaking = false
    let speechStart = 0
    let lastSpeech = Date.now()

    function tick() {
      analyser.getFloatTimeDomainData(dataArray)

      // Calculate RMS level
      let sum = 0
      for (let i = 0; i < dataArray.length; i++) {
        const sample = dataArray[i] ?? 0
        sum += sample * sample
      }
      const rms = Math.sqrt(sum / dataArray.length)

      const now = Date.now()

      if (rms > silenceThreshold) {
        if (!speaking) {
          speaking = true
          speechStart = now
          speechStartRef.current = now
        }
        lastSpeech = now
        lastSpeechRef.current = now
        setState({ isSpeaking: true, silenceDuration: 0 })
      } else if (speaking) {
        const silence = now - lastSpeech
        const speechDuration = now - speechStart
        setState({ isSpeaking: true, silenceDuration: silence })

        if (silence >= silenceTimeout && speechDuration >= minSpeechDuration) {
          speaking = false
          setState({ isSpeaking: false, silenceDuration: silence })
          onSpeechEndRef.current?.()
        }
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafRef.current)
      source.disconnect()
      ctx.close()
    }
  }, [stream, silenceThreshold, silenceTimeout, minSpeechDuration])

  return { ...state, setOnSpeechEnd }
}
