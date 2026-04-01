import { logger } from '../logger.js'
import type { TTSOptions, TTSProvider } from './tts-provider.js'

const log = logger.child({ module: 'tts' })

const DEFAULT_PIPER_URL = 'http://localhost:5000'

export class PiperTTSProvider implements TTSProvider {
  readonly name = 'piper'
  readonly defaultFormat = 'wav' as const

  private readonly baseUrl: string
  private readonly defaultVoice: string | undefined

  constructor() {
    this.baseUrl = process.env.PIPER_URL ?? DEFAULT_PIPER_URL
    this.defaultVoice = process.env.PIPER_VOICE

    log.info({ url: this.baseUrl }, 'using Piper TTS service')
  }

  async synthesize(text: string, options?: TTSOptions): Promise<Buffer> {
    const start = Date.now()
    log.debug({ chars: text.length }, 'synthesizing')

    const speaker = options?.voice ?? this.defaultVoice

    const response = await fetch(`${this.baseUrl}/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        ...(speaker && { speaker }),
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Piper service error (${response.status}): ${body}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    const wav = Buffer.from(arrayBuffer)

    const elapsed = Date.now() - start
    log.info({ elapsedMs: elapsed, sizeKB: (wav.byteLength / 1024).toFixed(1), format: 'wav' }, 'synthesis done')

    return wav
  }
}
