import { logger } from '../logger.js'
import { LocalSTTProvider } from './local-stt.js'
import { OpenAISTTProvider } from './openai-stt.js'
import type { STTProvider, STTResult } from './stt-provider.js'

const log = logger.child({ module: 'stt' })

export type { STTProvider, STTResult }
export type { STTResult as TranscriptionResult }

// Provider registry: maps provider name to a lazy factory
const providers: Record<string, () => STTProvider> = {
  openai: () => new OpenAISTTProvider(),
  local: () => new LocalSTTProvider(),
}

let cachedProvider: STTProvider | null = null

/**
 * Returns the configured STT provider.
 * Reads STT_PROVIDER env var (default: "openai").
 */
export function getSTTProvider(): STTProvider {
  if (cachedProvider) return cachedProvider

  const name = process.env.STT_PROVIDER ?? 'openai'
  const factory = providers[name]

  if (!factory) {
    const available = Object.keys(providers).join(', ')
    throw new Error(
      `Unknown STT_PROVIDER "${name}". Available providers: ${available}`,
    )
  }

  cachedProvider = factory()
  log.info({ provider: cachedProvider.name }, 'using STT provider')
  return cachedProvider
}

/**
 * Backward-compatible transcribe function.
 * Delegates to the configured STT provider.
 */
export async function transcribe(
  audioBuffer: Buffer,
  mimeType = 'audio/webm',
): Promise<STTResult> {
  const provider = getSTTProvider()
  return provider.transcribe(audioBuffer, mimeType)
}
