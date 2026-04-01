import { toFile } from 'openai'
import { logger } from '../logger.js'
import { getOpenAIClient } from './openai.js'
import type { STTProvider, STTResult } from './stt-provider.js'

const log = logger.child({ module: 'stt' })

export class OpenAISTTProvider implements STTProvider {
  readonly name = 'openai'

  async transcribe(
    audioBuffer: Buffer,
    mimeType = 'audio/webm',
  ): Promise<STTResult> {
    const openai = getOpenAIClient()

    const ext = mimeType.includes('webm') ? 'webm' : 'wav'
    const file = await toFile(audioBuffer, `audio.${ext}`, { type: mimeType })

    log.debug(
      { sizeKB: (audioBuffer.byteLength / 1024).toFixed(1), mimeType },
      'transcribing',
    )
    const start = Date.now()

    const response = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file,
      response_format: 'verbose_json',
    })

    const elapsed = Date.now() - start
    const resp = response as unknown as { text?: string; duration?: number }
    const text = (resp.text ?? '').trim()
    const durationSec = resp.duration ?? 0

    log.info({ elapsedMs: elapsed, durationSec, text }, 'transcription result')
    return { text, durationSec }
  }
}
