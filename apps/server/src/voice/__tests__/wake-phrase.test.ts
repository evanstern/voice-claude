import { describe, expect, it } from 'vitest'
import { detectWakePhrase } from '../wake-phrase.js'

describe('detectWakePhrase', () => {
  it('detects a standalone coda wake phrase', () => {
    expect(detectWakePhrase('Coda').detected).toBe(true)
  })

  it('detects common wake phrase variants', () => {
    expect(detectWakePhrase('hey coda').detected).toBe(true)
    expect(detectWakePhrase('okay coda').detected).toBe(true)
  })

  it('handles punctuation from whisper transcripts', () => {
    const result = detectWakePhrase('Coda, are you there?')
    expect(result.detected).toBe(true)
    expect(result.transcript).toBe('Coda are you there')
  })

  it('does not trigger on unrelated speech', () => {
    expect(detectWakePhrase('show me the package json file').detected).toBe(
      false,
    )
  })
})
