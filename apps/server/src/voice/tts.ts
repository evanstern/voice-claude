import { getOpenAIClient } from './openai.js'

type Voice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'

const DEFAULT_VOICE: Voice = 'nova'

export async function synthesize(
  text: string,
  voice?: Voice,
): Promise<Buffer> {
  const openai = getOpenAIClient()
  const selectedVoice = voice ?? (process.env.TTS_VOICE as Voice) ?? DEFAULT_VOICE

  console.log(
    `[tts] synthesizing ${text.length} chars with voice="${selectedVoice}"`,
  )
  const start = Date.now()

  const response = await openai.audio.speech.create({
    model: 'tts-1',
    voice: selectedVoice,
    input: text,
    response_format: 'mp3',
  })

  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  const elapsed = Date.now() - start
  console.log(
    `[tts] done (${elapsed}ms): ${(buffer.byteLength / 1024).toFixed(1)} KB mp3`,
  )

  return buffer
}
