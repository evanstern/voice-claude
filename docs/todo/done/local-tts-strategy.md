# Local TTS Strategy

## Problem

OpenAI TTS (`tts-1`) costs $15 per 1M characters and accounts for 50-60% of per-interaction spend in voice-claude. Since we self-host on a VM, we can run TTS locally and eliminate this cost entirely.

## Current Implementation

`apps/server/src/voice/tts.ts` calls OpenAI's `audio.speech.create` with model `tts-1`, outputting MP3. The `synthesize()` function takes text and a voice name, returns a `Buffer` of audio data. This is the interface we need to preserve while swapping in a local engine.

## Options Evaluated

### 1. Piper TTS (Recommended)

- **Project:** https://github.com/rhasspy/piper
- **Engine:** VITS / VITS2 neural models, optimized for CPU inference via ONNX Runtime
- **Voice quality:** Near-natural for the best voices (e.g., `en_US-lessac-high`, `en_US-amy-medium`). Not indistinguishable from human speech, but very good for a voice assistant. Comparable to Google Cloud TTS standard voices.
- **Speed:** Synthesizes faster than real-time on CPU. A 200-word passage (~1200 characters, ~10 seconds of audio) synthesizes in 1-3 seconds on a modern 4-core VM.
- **Model sizes:** 15-75 MB per voice depending on quality tier (low/medium/high)
- **License:** MIT
- **Maturity:** Actively maintained, used in Home Assistant and other production voice assistants. Stable C++ binary with Python and Node bindings.

### 2. Coqui TTS (XTTS v2)

- **Project:** https://github.com/coqui-ai/TTS (archived, community forks active)
- **Engine:** XTTS v2 is a transformer-based model with voice cloning capability
- **Voice quality:** The highest quality option here. Supports zero-shot voice cloning from a short audio sample. Output is very natural.
- **Speed:** Slow on CPU. A 200-word passage takes 15-45 seconds without a GPU. With a GPU, 2-5 seconds.
- **Model sizes:** 1.5-2 GB for XTTS v2
- **License:** CPML (Coqui Public Model License) for XTTS models; restrictive for commercial use
- **Maturity:** The original Coqui company shut down. Community forks exist but long-term maintenance is uncertain.
- **Verdict:** Best quality but impractical on CPU-only VMs, and the licensing/maintenance situation is risky.

### 3. Bark (Suno)

- **Project:** https://github.com/suno-ai/bark
- **Engine:** GPT-style transformer, generates audio tokens autoregressively
- **Voice quality:** Very natural, supports non-speech sounds (laughter, music). Impressive demos.
- **Speed:** Extremely slow. A 200-word passage takes 30-120 seconds on CPU. Requires a GPU with 4+ GB VRAM to be usable.
- **Model sizes:** ~5 GB
- **License:** MIT
- **Verdict:** Not viable for real-time voice interaction, even with a GPU. Better suited for offline content generation.

### 4. Mimic 3 (Mycroft)

- **Project:** https://github.com/MycroftAI/mimic3
- **Engine:** VITS-based, similar approach to Piper
- **Voice quality:** Decent, but Piper has surpassed it in both quality and speed. Fewer voice options.
- **Speed:** Comparable to Piper (1-3 seconds for 200 words on CPU)
- **Model sizes:** 20-100 MB per voice
- **License:** AGPL-3.0
- **Maturity:** Mycroft AI went bankrupt. Project is effectively abandoned. No updates since 2023.
- **Verdict:** No reason to choose this over Piper. Worse licensing, abandoned project.

### 5. eSpeak-ng

- **Project:** https://github.com/espeak-ng/espeak-ng
- **Engine:** Formant synthesis (rule-based, not neural)
- **Voice quality:** Robotic. Fine for accessibility/screen readers, not acceptable for a conversational voice assistant.
- **Speed:** Near-instantaneous. Synthesizes 200 words in under 100ms.
- **Model sizes:** < 5 MB
- **License:** GPL-3.0
- **Verdict:** Useful as a fallback or for ultra-low-latency scenarios where quality does not matter. Not suitable as the primary voice.

## Voice Quality Comparison

| Engine | Quality (1-10) | Naturalness | Best For |
|--------|----------------|-------------|----------|
| OpenAI TTS (current) | 9 | Very natural | Production, premium feel |
| Coqui XTTS v2 | 8.5 | Very natural | GPU-equipped servers |
| Bark | 8 | Very natural | Offline generation |
| **Piper (high)** | **7** | **Good, slight synthetic edge** | **Real-time on CPU** |
| Mimic 3 | 6 | Acceptable | Home automation |
| eSpeak-ng | 3 | Robotic | Accessibility, fallback |

Piper at quality level "high" is the sweet spot. It is noticeably less natural than OpenAI TTS, but completely usable for a voice assistant. Most users adapt to the voice within a few minutes.

## Hardware Requirements

### Piper TTS (Recommended)

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 cores (x86_64 or ARM64) | 4+ cores |
| RAM | 512 MB free (on top of other services) | 1 GB free |
| Disk | 100 MB (binary + one voice) | 500 MB (binary + multiple voices) |
| GPU | Not needed | Not needed (no benefit for Piper) |

Piper uses ONNX Runtime for inference, which is well-optimized for CPU. GPU acceleration exists but provides minimal benefit since the models are small and already fast on CPU.

### For Coqui XTTS (if GPU available)

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 4 cores | 8 cores |
| RAM | 4 GB free | 8 GB free |
| GPU VRAM | 4 GB | 6+ GB |
| Disk | 3 GB | 5 GB |

## Latency Analysis

Target: synthesize a typical Claude response (~200 words / ~1200 characters) fast enough to maintain conversational flow.

### Piper TTS on typical VM specs (4 vCPU, 8 GB RAM, no GPU)

| Quality Tier | Model Size | Synthesis Time (200 words) | Real-Time Factor |
|--------------|------------|---------------------------|-------------------|
| Low | 15-20 MB | 0.3-0.8s | 12-30x faster than real-time |
| Medium | 30-45 MB | 0.5-1.5s | 7-20x faster than real-time |
| High | 60-75 MB | 1.0-3.0s | 3-10x faster than real-time |

These numbers are for batch synthesis (full text at once). For streaming synthesis (sentence-by-sentence), the first audio chunk is available in under 500ms even at high quality.

### End-to-end latency comparison

| Component | OpenAI TTS | Piper Local |
|-----------|-----------|-------------|
| Network to TTS | 50-150ms (API call) | 0ms (local) |
| Synthesis | 500-2000ms (server side) | 1000-3000ms (local CPU) |
| Network from TTS | 100-300ms (download audio) | 0ms (local) |
| **Total** | **650-2450ms** | **1000-3000ms** |

Piper is slightly slower in raw synthesis but eliminates network overhead. The total latency is comparable, and for shorter responses (1-2 sentences) Piper is often faster.

## Integration Plan

### 1. Abstract TTS behind a provider interface

Create a `TTSProvider` interface that both OpenAI and local implementations satisfy:

```typescript
// apps/server/src/voice/tts-provider.ts

export interface TTSProvider {
  synthesize(text: string, voice?: string): Promise<Buffer>
  readonly name: string
}
```

### 2. Environment variable configuration

```bash
# .env
TTS_PROVIDER=openai|local|google   # default: openai
TTS_VOICE=nova                      # provider-specific voice name

# Piper-specific
PIPER_MODEL_PATH=/models/en_US-lessac-high.onnx
PIPER_BINARY_PATH=/usr/local/bin/piper
```

### 3. Provider factory

```typescript
// apps/server/src/voice/tts.ts

export function createTTSProvider(): TTSProvider {
  const provider = process.env.TTS_PROVIDER ?? 'openai'
  switch (provider) {
    case 'openai':
      return new OpenAITTSProvider()
    case 'local':
      return new PiperTTSProvider()
    case 'google':
      return new GoogleTTSProvider()
    default:
      throw new Error(`Unknown TTS provider: ${provider}`)
  }
}
```

### 4. Piper provider implementation

```typescript
// apps/server/src/voice/providers/piper-tts.ts

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { TTSProvider } from '../tts-provider.js'

const execFileAsync = promisify(execFile)

export class PiperTTSProvider implements TTSProvider {
  readonly name = 'piper'

  async synthesize(text: string, voice?: string): Promise<Buffer> {
    const modelPath = voice
      ? `/models/${voice}.onnx`
      : process.env.PIPER_MODEL_PATH ?? '/models/en_US-lessac-high.onnx'

    const piperBin = process.env.PIPER_BINARY_PATH ?? '/usr/local/bin/piper'

    // Piper reads from stdin, writes WAV to stdout
    const child = execFileAsync(piperBin, [
      '--model', modelPath,
      '--output-raw',
    ], {
      encoding: 'buffer',
      maxBuffer: 10 * 1024 * 1024,
    })

    // Pipe text to stdin
    child.child.stdin?.write(text)
    child.child.stdin?.end()

    const { stdout } = await child

    // Convert raw PCM to MP3 using ffmpeg for compatibility
    // with the existing audio playback pipeline
    return this.convertToMp3(stdout)
  }

  private async convertToMp3(rawPcm: Buffer): Promise<Buffer> {
    const { stdout } = await execFileAsync('ffmpeg', [
      '-f', 's16le',
      '-ar', '22050',
      '-ac', '1',
      '-i', 'pipe:0',
      '-codec:a', 'libmp3lame',
      '-b:a', '64k',
      '-f', 'mp3',
      'pipe:1',
    ], {
      encoding: 'buffer',
      maxBuffer: 10 * 1024 * 1024,
    })

    return stdout
  }
}
```

### 5. Migration path

1. Implement `TTSProvider` interface and refactor existing OpenAI code into `OpenAITTSProvider`
2. Implement `PiperTTSProvider`
3. Add provider factory with `TTS_PROVIDER` env var (default stays `openai`)
4. Deploy with `TTS_PROVIDER=local` on the self-hosted VM
5. Keep OpenAI as a fallback option for when quality matters more than cost

## Docker Considerations

### Adding Piper to the server container

```dockerfile
# In apps/server/Dockerfile (build stage or separate stage)

# Install Piper binary
RUN apt-get update && apt-get install -y wget ffmpeg && \
    wget -qO- https://github.com/rhasspy/piper/releases/download/v1.2.0/piper_amd64.tar.gz \
    | tar xz -C /usr/local/bin/ && \
    rm -rf /var/lib/apt/lists/*

# Download default voice model
RUN mkdir -p /models && \
    wget -q -O /models/en_US-lessac-high.onnx \
    https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/high/en_US-lessac-high.onnx && \
    wget -q -O /models/en_US-lessac-high.onnx.json \
    https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/high/en_US-lessac-high.onnx.json
```

### Model file management

Models should not be baked into the Docker image for production. Instead:

```yaml
# docker-compose.prod.yml additions
services:
  server:
    volumes:
      - piper-models:/models
    environment:
      - TTS_PROVIDER=local
      - PIPER_MODEL_PATH=/models/en_US-lessac-high.onnx

volumes:
  piper-models:
    driver: local
```

Use an init script or sidecar to download models on first run:

```bash
#!/bin/bash
# scripts/download-piper-models.sh
MODEL_DIR="${1:-/models}"
BASE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main"

download_voice() {
  local voice=$1
  local path=$2
  if [ ! -f "$MODEL_DIR/$voice.onnx" ]; then
    echo "Downloading $voice..."
    wget -q -O "$MODEL_DIR/$voice.onnx" "$BASE_URL/$path/$voice.onnx"
    wget -q -O "$MODEL_DIR/$voice.onnx.json" "$BASE_URL/$path/$voice.onnx.json"
  fi
}

mkdir -p "$MODEL_DIR"
download_voice "en_US-lessac-high" "en/en_US/lessac/high"
download_voice "en_US-amy-medium" "en/en_US/amy/medium"
```

### Voice selection

Recommended voices for voice-claude (conversational, clear diction):

| Voice | Quality | Size | Notes |
|-------|---------|------|-------|
| `en_US-lessac-high` | Best overall | 75 MB | Clear, neutral American English |
| `en_US-amy-medium` | Good | 45 MB | Warm, slightly faster synthesis |
| `en_US-danny-low` | Fast | 18 MB | Male voice, lowest latency |
| `en_GB-alba-medium` | Good | 40 MB | British English option |

## Audio Format

Piper outputs raw PCM audio (16-bit signed, little-endian) by default, or WAV with the `--output_file` flag. The existing client expects MP3 (matching the OpenAI TTS output).

**Conversion options:**

1. **ffmpeg (recommended):** Already commonly available in Docker images. Converts PCM to MP3 with minimal overhead (~50-100ms for a 10-second clip). Also supports Opus for even smaller file sizes.

2. **Direct WAV delivery:** Skip conversion entirely if the client can handle WAV. Larger file size but zero conversion overhead. WAV at 22050 Hz mono is about 10x larger than equivalent MP3.

3. **Opus via ffmpeg:** Best compression for speech audio. About 50% smaller than MP3 at equivalent quality. Good option if bandwidth between server and phone matters.

**Recommendation:** Use ffmpeg to convert to MP3 for now (preserves compatibility with the existing pipeline). Consider switching to Opus later if bandwidth becomes a concern.

## Recommended Approach

For a self-hosted Linux VM without a GPU:

1. **Use Piper TTS** with the `en_US-lessac-high` voice model
2. **Install ffmpeg** in the Docker container for PCM-to-MP3 conversion
3. **Mount models as a volume** rather than baking them into the image
4. **Set `TTS_PROVIDER=local`** in the VM's environment
5. **Keep OpenAI TTS as a fallback** by setting `TTS_PROVIDER=openai` (useful for testing or when quality is critical)
6. **Consider sentence-level streaming** in a future iteration: split Claude's response at sentence boundaries and synthesize/play each sentence as it arrives, reducing perceived latency

### Cost impact

- Current: ~$15/1M characters (OpenAI TTS)
- After: $0 (self-hosted Piper)
- At 5000 characters per interaction, 100 interactions/day: saves ~$2.25/day, ~$67.50/month

### Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Voice quality noticeably worse | Test multiple Piper voices; keep OpenAI fallback |
| Piper binary compatibility issues | Pin to specific release; test in CI Docker build |
| Model download fails on deploy | Cache models in persistent volume; include fallback URL |
| CPU spikes during synthesis | Run Piper with nice/ionice; monitor with cost-monitoring branch |
| ffmpeg adds latency | Profile; consider direct WAV delivery if conversion is slow |
