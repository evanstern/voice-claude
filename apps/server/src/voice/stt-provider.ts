export interface STTResult {
  text: string
  durationSec: number
}

export interface STTProvider {
  readonly name: string
  transcribe(audioBuffer: Buffer, mimeType?: string): Promise<STTResult>
}
