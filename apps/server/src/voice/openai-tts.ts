import { logger } from '../logger.js'
import { getOpenAIClient } from './openai.js'
import type { TTSOptions, TTSProvider } from './tts-provider.js'

const log = logger.child({ module: 'tts' })

type OpenAIVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'

export class OpenAITTSProvider implements TTSProvider {
  readonly name = 'openai'
  readonly defaultFormat = 'mp3' as const

  async synthesize(text: string, options?: TTSOptions): Promise<Buffer> {
    const openai = getOpenAIClient()
    const voice = (options?.voice ??
      process.env.TTS_VOICE ??
      'nova') as OpenAIVoice
    const speed = options?.speakingRate ?? 1.0

    log.debug({ chars: text.length, voice }, 'synthesizing')
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
    log.info(
      {
        elapsedMs: elapsed,
        sizeKB: (buffer.byteLength / 1024).toFixed(1),
        format: 'mp3',
      },
      'synthesis done',
    )

    return buffer
  }
}
