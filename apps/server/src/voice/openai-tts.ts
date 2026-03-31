import { getOpenAIClient } from './openai.js'
import type { TTSOptions, TTSProvider } from './tts-provider.js'

type OpenAIVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'

export class OpenAITTSProvider implements TTSProvider {
  readonly name = 'openai'
  readonly defaultFormat = 'mp3' as const

  async synthesize(text: string, options?: TTSOptions): Promise<Buffer> {
    const openai = getOpenAIClient()
    const voice = (options?.voice ?? process.env.TTS_VOICE ?? 'nova') as OpenAIVoice
    const speed = options?.speakingRate ?? 1.0

    console.log(`[tts:openai] synthesizing ${text.length} chars with voice="${voice}"`)
    const start = Date.now()

    const response = await openai.audio.speech.create({
      model: 'tts-1',
      voice,
      input: text,
      response_format: 'mp3',
      speed,
    })

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const elapsed = Date.now() - start
    console.log(`[tts:openai] done (${elapsed}ms): ${(buffer.byteLength / 1024).toFixed(1)} KB mp3`)

    return buffer
  }
}
