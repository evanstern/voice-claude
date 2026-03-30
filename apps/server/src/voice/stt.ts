import { File } from 'node:buffer'
import OpenAI from 'openai'

let client: OpenAI | null = null

function getClient(): OpenAI {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('Missing OPENAI_API_KEY environment variable')
    }
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return client
}

export async function transcribe(
  audioBuffer: Buffer,
  mimeType = 'audio/webm',
): Promise<string> {
  const openai = getClient()

  const ext = mimeType.includes('webm') ? 'webm' : 'wav'
  const file = new File([audioBuffer], `audio.${ext}`, { type: mimeType })

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
