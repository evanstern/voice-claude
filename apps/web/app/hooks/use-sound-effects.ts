import { useCallback, useRef } from 'react'

type SoundName =
  | 'recordingStarted'
  | 'messageSent'
  | 'error'
  | 'commandAcknowledged'

/**
 * Synthesize short audio cues using the Web Audio API.
 * All tones are < 0.5 s, non-intrusive, and require no external files.
 */
export function useSoundEffects() {
  const ctxRef = useRef<AudioContext | null>(null)

  const getContext = useCallback((): AudioContext => {
    if (!ctxRef.current || ctxRef.current.state === 'closed') {
      ctxRef.current = new AudioContext()
    }
    // Resume if suspended (browser autoplay policy)
    if (ctxRef.current.state === 'suspended') {
      ctxRef.current.resume()
    }
    return ctxRef.current
  }, [])

  const play = useCallback(
    (sound: SoundName) => {
      try {
        const ctx = getContext()
        switch (sound) {
          case 'recordingStarted':
            playRecordingStarted(ctx)
            break
          case 'messageSent':
            playMessageSent(ctx)
            break
          case 'error':
            playError(ctx)
            break
          case 'commandAcknowledged':
            playCommandAcknowledged(ctx)
            break
        }
      } catch {
        // Silently ignore audio errors — never block the UI
      }
    },
    [getContext],
  )

  return { play }
}

/**
 * Recording started: soft ascending two-note chirp (C5 -> E5).
 * Duration ~0.25 s.
 */
function playRecordingStarted(ctx: AudioContext) {
  const now = ctx.currentTime

  const osc1 = ctx.createOscillator()
  const gain1 = ctx.createGain()
  osc1.type = 'sine'
  osc1.frequency.value = 523.25 // C5
  gain1.gain.setValueAtTime(0, now)
  gain1.gain.linearRampToValueAtTime(0.15, now + 0.03)
  gain1.gain.linearRampToValueAtTime(0, now + 0.12)
  osc1.connect(gain1).connect(ctx.destination)
  osc1.start(now)
  osc1.stop(now + 0.12)

  const osc2 = ctx.createOscillator()
  const gain2 = ctx.createGain()
  osc2.type = 'sine'
  osc2.frequency.value = 659.25 // E5
  gain2.gain.setValueAtTime(0, now + 0.1)
  gain2.gain.linearRampToValueAtTime(0.15, now + 0.13)
  gain2.gain.linearRampToValueAtTime(0, now + 0.25)
  osc2.connect(gain2).connect(ctx.destination)
  osc2.start(now + 0.1)
  osc2.stop(now + 0.25)
}

/**
 * Message sent: a quick soft "whoosh" — short noise burst with a bandpass sweep.
 * Duration ~0.2 s.
 */
function playMessageSent(ctx: AudioContext) {
  const now = ctx.currentTime

  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  const filter = ctx.createBiquadFilter()

  osc.type = 'triangle'
  osc.frequency.setValueAtTime(880, now)
  osc.frequency.exponentialRampToValueAtTime(1760, now + 0.1)

  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(880, now)
  filter.frequency.exponentialRampToValueAtTime(1760, now + 0.1)
  filter.Q.value = 2

  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(0.12, now + 0.03)
  gain.gain.linearRampToValueAtTime(0, now + 0.2)

  osc.connect(filter).connect(gain).connect(ctx.destination)
  osc.start(now)
  osc.stop(now + 0.2)
}

/**
 * Error: gentle descending two-tone (E5 -> C5).
 * Duration ~0.35 s.
 */
function playError(ctx: AudioContext) {
  const now = ctx.currentTime

  const osc1 = ctx.createOscillator()
  const gain1 = ctx.createGain()
  osc1.type = 'sine'
  osc1.frequency.value = 659.25 // E5
  gain1.gain.setValueAtTime(0, now)
  gain1.gain.linearRampToValueAtTime(0.15, now + 0.03)
  gain1.gain.linearRampToValueAtTime(0, now + 0.15)
  osc1.connect(gain1).connect(ctx.destination)
  osc1.start(now)
  osc1.stop(now + 0.15)

  const osc2 = ctx.createOscillator()
  const gain2 = ctx.createGain()
  osc2.type = 'sine'
  osc2.frequency.value = 392.0 // G4 (lower, more somber)
  gain2.gain.setValueAtTime(0, now + 0.15)
  gain2.gain.linearRampToValueAtTime(0.15, now + 0.18)
  gain2.gain.linearRampToValueAtTime(0, now + 0.35)
  osc2.connect(gain2).connect(ctx.destination)
  osc2.start(now + 0.15)
  osc2.stop(now + 0.35)
}

/**
 * Command acknowledged: distinct triple-beep (G5 -> B5 -> D6).
 * Duration ~0.3 s.
 */
function playCommandAcknowledged(ctx: AudioContext) {
  const now = ctx.currentTime
  const notes = [783.99, 987.77, 1174.66] // G5, B5, D6

  for (let i = 0; i < notes.length; i++) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const start = now + i * 0.09
    osc.type = 'sine'
    osc.frequency.value = notes[i] ?? 0
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(0.12, start + 0.02)
    gain.gain.linearRampToValueAtTime(0, start + 0.08)
    osc.connect(gain).connect(ctx.destination)
    osc.start(start)
    osc.stop(start + 0.08)
  }
}
