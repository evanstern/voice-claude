import { toFile } from 'openai'
import { getOpenAIClient } from './openai.js'

export async function transcribe(
  audioBuffer: Buffer,
  mimeType = 'audio/webm',
): Promise<string> {
  const openai = getOpenAIClient()

  const ext = mimeType.includes('webm') ? 'webm' : 'wav'
  const file = await toFile(audioBuffer, `audio.${ext}`, { type: mimeType })

  console.log(
    `[stt] transcribing ${(audioBuffer.byteLength / 1024).toFixed(1)} KB of ${mimeType}`,
  )
  const start = Date.now()

  const response = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file,
    response_format: 'text',
  })

  const elapsed = Date.now() - start
  const text = typeof response === 'string' ? response.trim() : ''

  console.log(`[stt] result (${elapsed}ms): "${text}"`)
  return text
}
