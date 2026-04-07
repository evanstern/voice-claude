const WAKE_PHRASE_PATTERN = /\b(?:hey|hi|okay|ok)?\s*coda\b/i

export interface WakePhraseDetection {
  detected: boolean
  transcript: string
}

function normalizeTranscript(text: string): string {
  return text
    .replace(/[.,!?;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function detectWakePhrase(text: string): WakePhraseDetection {
  const transcript = normalizeTranscript(text)

  return {
    detected: WAKE_PHRASE_PATTERN.test(transcript),
    transcript,
  }
}
