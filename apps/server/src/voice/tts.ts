import type { TTSProvider } from './tts-provider.js'

const PROVIDERS: Record<string, () => Promise<TTSProvider>> = {
  openai: async () => {
    const { OpenAITTSProvider } = await import('./openai-tts.js')
    return new OpenAITTSProvider()
  },
  google: async () => {
    const { GoogleTTSProvider } = await import('./google-tts.js')
    return new GoogleTTSProvider()
  },
  piper: async () => {
    const { PiperTTSProvider } = await import('./piper-tts.js')
    return new PiperTTSProvider()
  },
}

let cachedProvider: TTSProvider | null = null

export async function getTTSProvider(): Promise<TTSProvider> {
  if (!cachedProvider) {
    const name = process.env.TTS_PROVIDER ?? 'openai'
    const factory = PROVIDERS[name]
    if (!factory) {
      throw new Error(
        `Unknown TTS provider: "${name}". Supported: ${Object.keys(PROVIDERS).join(', ')}`,
      )
    }
    cachedProvider = await factory()
    console.log(`[tts] using provider: ${cachedProvider.name}`)
  }
  return cachedProvider
}

export function getAudioFormat(): string {
  return cachedProvider?.defaultFormat ?? 'mp3'
}

/** Backward-compatible convenience export */
export async function synthesize(text: string): Promise<Buffer> {
  const provider = await getTTSProvider()
  return provider.synthesize(text)
}
