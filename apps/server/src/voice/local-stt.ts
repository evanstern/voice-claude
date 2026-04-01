import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { logger } from '../logger.js'
import type { STTProvider, STTResult } from './stt-provider.js'

const log = logger.child({ module: 'stt' })

const execFileAsync = promisify(execFile)

export class LocalSTTProvider implements STTProvider {
  readonly name = 'local'
  private readonly binaryPath: string
  private readonly modelPath: string

  constructor() {
    this.binaryPath = process.env.WHISPER_BINARY ?? 'whisper-cpp'
    this.modelPath = process.env.WHISPER_MODEL_PATH ?? ''

    if (!this.modelPath) {
      throw new Error(
        'WHISPER_MODEL_PATH environment variable is required when using the local STT provider',
      )
    }
  }

  async transcribe(
    audioBuffer: Buffer,
    mimeType = 'audio/webm',
  ): Promise<STTResult> {
    const tempDir = await mkdtemp(join(tmpdir(), 'stt-'))
    const inputPath = join(tempDir, 'input.webm')
    const wavPath = join(tempDir, 'input.wav')

    try {
      log.debug({ sizeKB: (audioBuffer.byteLength / 1024).toFixed(1), mimeType }, 'transcribing')
      const start = Date.now()

      // Write the incoming audio to a temp file
      await writeFile(inputPath, audioBuffer)

      // Convert to 16kHz mono WAV via ffmpeg
      await execFileAsync('ffmpeg', [
        '-i',
        inputPath,
        '-ar',
        '16000',
        '-ac',
        '1',
        '-f',
        'wav',
        wavPath,
      ])

      // Run whisper-cpp on the WAV file
      const { stdout } = await execFileAsync(this.binaryPath, [
        '-m',
        this.modelPath,
        '-f',
        wavPath,
        '--language',
        'en',
        '--no-timestamps',
        '--output-json',
      ])

      const elapsed = Date.now() - start

      // Parse the whisper-cpp output
      const { text, durationSec } = this.parseOutput(stdout)

      log.info({ elapsedMs: elapsed, durationSec, text }, 'transcription result')
      return { text, durationSec }
    } finally {
      // Clean up temp files
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  private parseOutput(stdout: string): { text: string; durationSec: number } {
    let text = ''
    let durationSec = 0

    try {
      // Try parsing stdout as JSON (whisper-cpp --output-json may write to stdout)
      const json = JSON.parse(stdout)
      if (json.transcription) {
        text = json.transcription
          .map((segment: { text: string }) => segment.text)
          .join('')
          .trim()
      } else if (json.text) {
        text = json.text.trim()
      }
      if (json.result?.duration) {
        durationSec = json.result.duration
      }
    } catch {
      // Fall back to parsing plain text output from stdout
      // whisper-cpp plain output: "[00:00:00.000 --> 00:00:05.000]  Hello world"
      // With --no-timestamps it outputs just the text
      text = stdout.replace(/\[[\d:.]+\s*-->\s*[\d:.]+\]\s*/g, '').trim()
    }

    return { text, durationSec }
  }
}
