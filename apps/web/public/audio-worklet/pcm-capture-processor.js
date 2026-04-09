/**
 * AudioWorklet processor that captures raw PCM audio and sends it to the main
 * thread in 16-bit integer format. Buffers samples to the configured frame size
 * before posting to reduce WebSocket message frequency.
 *
 * Register: audioContext.audioWorklet.addModule('/audio-worklet/pcm-capture-processor.js')
 * Create:   new AudioWorkletNode(ctx, 'pcm-capture-processor', { processorOptions: { frameSamples: 2560 } })
 */
class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this._frameSamples = options?.processorOptions?.frameSamples ?? 2560
    this._buffer = new Float32Array(this._frameSamples)
    this._writeIndex = 0
    this._active = true

    this.port.onmessage = (event) => {
      if (event.data === 'stop') {
        this._active = false
      } else if (event.data === 'start') {
        this._active = true
        this._writeIndex = 0
      }
    }
  }

  process(inputs) {
    if (!this._active) return true

    const input = inputs[0]
    if (!input || !input[0]) return true

    const channel = input[0]
    let readIndex = 0

    while (readIndex < channel.length) {
      const remaining = this._frameSamples - this._writeIndex
      const available = channel.length - readIndex
      const toCopy = Math.min(remaining, available)

      this._buffer.set(
        channel.subarray(readIndex, readIndex + toCopy),
        this._writeIndex,
      )
      this._writeIndex += toCopy
      readIndex += toCopy

      if (this._writeIndex >= this._frameSamples) {
        const int16 = new Int16Array(this._frameSamples)
        for (let i = 0; i < this._frameSamples; i++) {
          const s = Math.max(-1, Math.min(1, this._buffer[i]))
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
        }
        this.port.postMessage(int16.buffer, [int16.buffer])

        this._buffer = new Float32Array(this._frameSamples)
        this._writeIndex = 0
      }
    }

    return true
  }
}

registerProcessor('pcm-capture-processor', PCMCaptureProcessor)
