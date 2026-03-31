import { TextToSpeechClient } from '@google-cloud/text-to-speech'
import type { TTSOptions, TTSProvider } from './tts-provider.js'

export class GoogleTTSProvider implements TTSProvider {
  readonly name = 'google'
  readonly defaultFormat = 'ogg_opus' as const

  private client: TextToSpeechClient

  constructor() {
    const credentialsJson = process.env.GOOGLE_TTS_CREDENTIALS
    if (credentialsJson) {
      const credentials = JSON.parse(credentialsJson)
      this.client = new TextToSpeechClient({ credentials })
    } else {
      this.client = new TextToSpeechClient()
    }
  }

  async synthesize(text: string, options?: TTSOptions): Promise<Buffer> {
    const voice = options?.voice ?? process.env.GOOGLE_TTS_VOICE ?? 'en-US-Standard-C'
    const speakingRate = options?.speakingRate
      ?? Number.parseFloat(process.env.GOOGLE_TTS_SPEAKING_RATE ?? '1.0')
    const format = options?.format ?? this.defaultFormat
    const audioEncoding = format === 'mp3' ? 'MP3' : 'OGG_OPUS'

    console.log(`[tts:google] synthesizing ${text.length} chars with voice="${voice}" format=${audioEncoding}`)
    const start = Date.now()

    const [response] = await this.client.synthesizeSpeech({
      input: { text },
      voice: {
        languageCode: 'en-US',
        name: voice,
      },
      audioConfig: {
        audioEncoding: audioEncoding as 'MP3' | 'OGG_OPUS',
        speakingRate,
      },
    })

    const buffer = Buffer.from(response.audioContent as Uint8Array)

    const elapsed = Date.now() - start
    console.log(`[tts:google] done (${elapsed}ms): ${(buffer.byteLength / 1024).toFixed(1)} KB ${format}`)

    return buffer
  }
}
