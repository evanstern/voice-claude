export interface TTSOptions {
  voice?: string
  format?: 'mp3' | 'ogg_opus'
  speakingRate?: number
}

export interface TTSProvider {
  readonly name: string
  synthesize(text: string, options?: TTSOptions): Promise<Buffer>
  readonly defaultFormat: 'mp3' | 'ogg_opus'
}
