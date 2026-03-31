import { toFile } from 'openai'
import { getOpenAIClient } from './openai.js'
import type { STTProvider, STTResult } from './stt-provider.js'

export class OpenAISTTProvider implements STTProvider {
  readonly name = 'openai'

  async transcribe(
    audioBuffer: Buffer,
    mimeType = 'audio/webm',
  ): Promise<STTResult> {
    const openai = getOpenAIClient()

    const ext = mimeType.includes('webm') ? 'webm' : 'wav'
    const file = await toFile(audioBuffer, `audio.${ext}`, { type: mimeType })

    console.log(
      `[stt:openai] transcribing ${(audioBuffer.byteLength / 1024).toFixed(1)} KB of ${mimeType}`,
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

    console.log(
      `[stt:openai] result (${elapsed}ms, ${durationSec.toFixed(1)}s audio): "${text}"`,
    )
    return { text, durationSec }
  }
}
