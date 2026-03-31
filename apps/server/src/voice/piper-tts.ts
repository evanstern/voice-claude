import { spawn } from 'node:child_process'
import type { TTSOptions, TTSProvider } from './tts-provider.js'

const DEFAULT_PIPER_BINARY = 'piper'

export class PiperTTSProvider implements TTSProvider {
  readonly name = 'piper'
  readonly defaultFormat = 'mp3' as const

  private readonly binaryPath: string
  private readonly modelPath: string
  private readonly defaultVoice: string | undefined

  constructor() {
    this.binaryPath = process.env.PIPER_BINARY ?? DEFAULT_PIPER_BINARY
    this.modelPath = process.env.PIPER_MODEL ?? ''
    this.defaultVoice = process.env.PIPER_VOICE

    if (!this.modelPath) {
      throw new Error(
        'PIPER_MODEL environment variable is required (path to .onnx model file)',
      )
    }
  }

  async synthesize(text: string, options?: TTSOptions): Promise<Buffer> {
    const start = Date.now()
    console.log(`[tts:piper] synthesizing ${text.length} chars`)

    const rawPcm = await this.runPiper(text, options?.voice)
    const mp3 = await this.convertToMp3(rawPcm, options?.speakingRate)

    const elapsed = Date.now() - start
    console.log(
      `[tts:piper] done (${elapsed}ms): ${(mp3.byteLength / 1024).toFixed(1)} KB mp3`,
    )

    return mp3
  }

  private runPiper(text: string, voice?: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const args = ['--model', this.modelPath, '--output-raw']

      const selectedVoice = voice ?? this.defaultVoice
      if (selectedVoice) {
        args.push('--speaker', selectedVoice)
      }

      const proc = spawn(this.binaryPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      const chunks: Buffer[] = []
      const stderrChunks: Buffer[] = []

      proc.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })

      proc.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk)
      })

      proc.on('error', (err) => {
        reject(
          new Error(`Failed to spawn piper at "${this.binaryPath}": ${err.message}`),
        )
      })

      proc.on('close', (code) => {
        if (code !== 0) {
          const stderr = Buffer.concat(stderrChunks).toString()
          reject(new Error(`Piper exited with code ${code}: ${stderr}`))
          return
        }
        resolve(Buffer.concat(chunks))
      })

      proc.stdin.write(text)
      proc.stdin.end()
    })
  }

  private convertToMp3(
    rawPcm: Buffer,
    speakingRate?: number,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const args = [
        '-f',
        's16le',
        '-ar',
        '22050',
        '-ac',
        '1',
        '-i',
        'pipe:0',
      ]

      // Apply speaking rate via atempo filter if specified
      if (speakingRate && speakingRate !== 1.0) {
        // ffmpeg atempo range is 0.5 to 100.0
        const rate = Math.max(0.5, Math.min(speakingRate, 100.0))
        args.push('-af', `atempo=${rate}`)
      }

      args.push('-codec:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3', 'pipe:1')

      const proc = spawn('ffmpeg', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      const chunks: Buffer[] = []
      const stderrChunks: Buffer[] = []

      proc.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })

      proc.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk)
      })

      proc.on('error', (err) => {
        reject(
          new Error(`Failed to spawn ffmpeg for PCM-to-MP3 conversion: ${err.message}`),
        )
      })

      proc.on('close', (code) => {
        if (code !== 0) {
          const stderr = Buffer.concat(stderrChunks).toString()
          reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`))
          return
        }
        resolve(Buffer.concat(chunks))
      })

      proc.stdin.write(rawPcm)
      proc.stdin.end()
    })
  }
}
