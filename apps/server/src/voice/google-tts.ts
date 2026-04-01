import { readFileSync } from 'node:fs'
import { TextToSpeechClient } from '@google-cloud/text-to-speech'
import { logger } from '../logger.js'
import type { TTSOptions, TTSProvider } from './tts-provider.js'

const log = logger.child({ module: 'tts' })

export class GoogleTTSProvider implements TTSProvider {
  readonly name = 'google'
  readonly defaultFormat = 'ogg_opus' as const

  private client: TextToSpeechClient

  constructor() {
    const credentialsFile = process.env.GOOGLE_TTS_CREDENTIALS_FILE
    if (credentialsFile) {
      const credentials = JSON.parse(readFileSync(credentialsFile, 'utf-8'))
      this.client = new TextToSpeechClient({ credentials })
    } else {
      // Fall back to Application Default Credentials
      this.client = new TextToSpeechClient()
    }
  }

  async synthesize(text: string, options?: TTSOptions): Promise<Buffer> {
    const voice =
      options?.voice ?? process.env.GOOGLE_TTS_VOICE ?? 'en-US-Standard-C'
    const speakingRate =
      options?.speakingRate ??
      Number.parseFloat(process.env.GOOGLE_TTS_SPEAKING_RATE ?? '1.0')
    const format = options?.format ?? this.defaultFormat
    const audioEncoding = format === 'mp3' ? 'MP3' : 'OGG_OPUS'

    log.debug({ chars: text.length, voice, audioEncoding }, 'synthesizing')
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
    log.info({ elapsedMs: elapsed, sizeKB: (buffer.byteLength / 1024).toFixed(1), format }, 'synthesis done')

    return buffer
  }
}
