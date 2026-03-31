import type { TTSOptions, TTSProvider } from './tts-provider.js'

const DEFAULT_PIPER_URL = 'http://localhost:5000'

export class PiperTTSProvider implements TTSProvider {
  readonly name = 'piper'
  readonly defaultFormat = 'wav' as const

  private readonly baseUrl: string
  private readonly defaultVoice: string | undefined

  constructor() {
    this.baseUrl = process.env.PIPER_URL ?? DEFAULT_PIPER_URL
    this.defaultVoice = process.env.PIPER_VOICE

    console.log(`[tts:piper] using service at ${this.baseUrl}`)
  }

  async synthesize(text: string, options?: TTSOptions): Promise<Buffer> {
    const start = Date.now()
    console.log(`[tts:piper] synthesizing ${text.length} chars`)

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
    console.log(
      `[tts:piper] done (${elapsed}ms): ${(wav.byteLength / 1024).toFixed(1)} KB wav`,
    )

    return wav
  }
}
