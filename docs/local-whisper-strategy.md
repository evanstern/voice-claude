# Local Whisper STT Strategy

## Motivation

voice-claude currently uses OpenAI's Whisper API at $0.006/min. For a hands-free voice interface with continuous use, costs add up quickly. Running Whisper locally on the self-hosted VM eliminates per-minute API charges and can reduce latency by removing the network round-trip to OpenAI's servers.

## Options

### 1. whisper.cpp

C/C++ port of Whisper by Georgi Gerganov. Runs inference on CPU with optional GPU acceleration via CUDA, Metal, or OpenCL.

**Pros:**
- No Python dependency. Single binary, easy to deploy.
- Best CPU performance of all options. Heavily optimized with SIMD (AVX2, NEON).
- Low memory footprint compared to Python-based options.
- Active community with frequent updates.
- Can be called from Node.js via child process or FFI bindings.

**Cons:**
- Building from source required (though straightforward on Linux).
- Fewer high-level abstractions; you work with raw audio buffers.
- GPU support requires compiling with the right flags.

### 2. faster-whisper (Python)

CTranslate2-based reimplementation. Uses quantized models for significantly faster inference than the original OpenAI Whisper.

**Pros:**
- 4x faster than openai-whisper with comparable accuracy.
- Supports int8 quantization, cutting memory use roughly in half.
- Python ecosystem makes it easy to add pre/post-processing.
- Good streaming support via `faster-whisper`'s segment iterator.

**Cons:**
- Requires a Python runtime alongside Node.js in the container.
- CTranslate2 dependency can be finicky to build on some platforms.
- Slightly less active than whisper.cpp.

### 3. openai-whisper (Python)

The original reference implementation from OpenAI. PyTorch-based.

**Pros:**
- "Official" implementation; guaranteed compatibility with published model weights.
- Well-documented, widely used.
- Straightforward API.

**Cons:**
- Slowest inference of all options. No quantization support out of the box.
- Large PyTorch dependency (~2 GB installed).
- High memory usage, especially for medium+ models.
- Not practical for real-time voice on CPU-only VMs.

### 4. whisper-node (Node.js bindings)

Node.js bindings wrapping whisper.cpp via native addons (N-API).

**Pros:**
- Stays in the Node.js ecosystem. No child process or Python needed.
- Directly integrates with the existing server codebase.

**Cons:**
- Less mature than whisper.cpp itself. Binding libraries (e.g., `whisper-node`, `@nickcis/whisper.cpp`) have smaller communities.
- Native addon compilation can fail across different OS/arch combos.
- May lag behind whisper.cpp releases.
- Debugging native crashes is harder than debugging a subprocess.

## Hardware Requirements

All figures assume a single concurrent transcription stream (one user).

| Model | Parameters | Disk | RAM (CPU) | RAM (GPU VRAM) | Min CPU | GPU optional? |
|-------|-----------|------|-----------|----------------|---------|---------------|
| tiny | 39M | 75 MB | ~1 GB | ~1 GB | 2 cores | Yes |
| base | 74M | 142 MB | ~1 GB | ~1 GB | 2 cores | Yes |
| small | 244M | 466 MB | ~2 GB | ~2 GB | 4 cores | Yes |
| medium | 769M | 1.5 GB | ~5 GB | ~5 GB | 4 cores | Recommended |
| large-v3 | 1.55B | 3.1 GB | ~10 GB | ~10 GB | 8 cores | Strongly recommended |

**Typical self-hosted VM specs:** 4-8 vCPU, 8-16 GB RAM, no GPU. This makes tiny through small the practical range, with medium possible on 16 GB RAM VMs if nothing else is memory-hungry.

## Performance Benchmarks

Latency to transcribe a 10-second audio clip. Measured with whisper.cpp and faster-whisper on CPU (4-core x86_64, no GPU). These are representative figures from published community benchmarks.

| Model | whisper.cpp (CPU) | faster-whisper (CPU) | openai-whisper (CPU) | OpenAI API |
|-------|------------------|---------------------|---------------------|------------|
| tiny | ~0.5s | ~0.8s | ~2s | — |
| base | ~1.0s | ~1.3s | ~4s | — |
| small | ~3s | ~3.5s | ~10s | — |
| medium | ~10s | ~8s | ~30s | — |
| API | — | — | — | ~1-2s |

**Key takeaway:** On a CPU-only VM, `tiny` and `base` models via whisper.cpp process a 10-second clip faster than the API round-trip. `small` is borderline. `medium` is too slow for real-time voice on CPU alone.

### With GPU (e.g., NVIDIA T4)

| Model | whisper.cpp (CUDA) | faster-whisper (CUDA) |
|-------|-------------------|----------------------|
| tiny | ~0.2s | ~0.3s |
| base | ~0.3s | ~0.4s |
| small | ~0.5s | ~0.6s |
| medium | ~1.5s | ~1.2s |

GPU changes the calculus entirely. Even `medium` becomes viable for real-time use.

## Accuracy Comparison

Word Error Rate (WER) on English conversational speech, relative to the OpenAI Whisper API (which uses large-v2 internally).

| Model | WER (approx.) | Quality notes |
|-------|--------------|---------------|
| tiny | ~14% | Misses filler words, struggles with accents and technical terms |
| base | ~10% | Decent for clear speech; drops accuracy on jargon |
| small | ~7% | Good balance. Handles most conversational English well |
| medium | ~5% | Near-API quality for English |
| large-v3 | ~4% | Matches or exceeds API on English |
| API | ~5% | Baseline reference |

**For voice-claude's use case** (a single English speaker giving programming commands), `small` is likely sufficient. Programming terms like "git push" or "TypeScript" may need a prompt hint regardless of model size.

## Integration Plan

### Abstract STT behind an interface

Create a provider interface in `apps/server/src/voice/stt.ts`:

```typescript
export interface STTProvider {
  /** Transcribe a complete audio buffer */
  transcribe(audio: Buffer, options?: TranscribeOptions): Promise<TranscriptionResult>;
  /** Optional: streaming transcription for real-time use */
  transcribeStream?(stream: ReadableStream<Uint8Array>): AsyncGenerator<PartialTranscription>;
}

export interface TranscribeOptions {
  language?: string;
  prompt?: string;  // context hint for domain-specific terms
}

export interface TranscriptionResult {
  text: string;
  segments?: Array<{ start: number; end: number; text: string }>;
  language?: string;
  duration?: number;
}
```

### Provider implementations

```
apps/server/src/voice/
  stt.ts              — STTProvider interface + factory
  stt-openai.ts       — OpenAI API implementation (current behavior)
  stt-local-whisper.ts — Local whisper.cpp implementation
```

The local provider shells out to the whisper.cpp binary:

```typescript
// stt-local-whisper.ts (simplified)
import { execFile } from 'node:child_process';

export class LocalWhisperSTT implements STTProvider {
  constructor(
    private binaryPath: string,
    private modelPath: string,
  ) {}

  async transcribe(audio: Buffer): Promise<TranscriptionResult> {
    // Write audio to temp file, invoke whisper.cpp, parse JSON output
    const result = await execFileAsync(this.binaryPath, [
      '-m', this.modelPath,
      '-f', tempAudioPath,
      '--output-json',
      '--language', 'en',
    ]);
    return parseWhisperOutput(result.stdout);
  }
}
```

### Configuration via environment variable

```bash
# .env
STT_PROVIDER=local        # "openai" | "local"
STT_MODEL=base            # whisper model size (for local provider)
WHISPER_BINARY=/usr/local/bin/whisper-cpp  # path to whisper.cpp binary
WHISPER_MODEL_DIR=/models  # directory containing .bin model files
```

Factory function selects the provider:

```typescript
export function createSTTProvider(): STTProvider {
  const provider = process.env.STT_PROVIDER ?? 'openai';
  switch (provider) {
    case 'local':
      return new LocalWhisperSTT(
        process.env.WHISPER_BINARY ?? '/usr/local/bin/whisper-cpp',
        `${process.env.WHISPER_MODEL_DIR ?? '/models'}/ggml-${process.env.STT_MODEL ?? 'base'}.en.bin`,
      );
    case 'openai':
      return new OpenAIWhisperSTT(process.env.OPENAI_API_KEY!);
    default:
      throw new Error(`Unknown STT_PROVIDER: ${provider}`);
  }
}
```

## Docker Considerations

### Building whisper.cpp in the container

Add a build stage to the server Dockerfile:

```dockerfile
# --- whisper.cpp build stage ---
FROM debian:bookworm-slim AS whisper-build
RUN apt-get update && apt-get install -y git build-essential cmake
RUN git clone https://github.com/ggerganov/whisper.cpp.git /whisper \
    && cd /whisper \
    && cmake -B build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build --config Release
# Binary lands at /whisper/build/bin/whisper-cli

# --- server runner stage ---
FROM node:22-slim AS runner
# ...existing setup...
COPY --from=whisper-build /whisper/build/bin/whisper-cli /usr/local/bin/whisper-cpp
```

### Model file management

Model files (75 MB to 3.1 GB) should not be baked into the Docker image. Options:

1. **Volume mount (recommended):** Mount a host directory containing model files into the container at `/models`. Download models once on the host.
   ```yaml
   # docker-compose.prod.yml
   services:
     server:
       volumes:
         - ./models:/models:ro
   ```

2. **Init container / entrypoint script:** Download the model on first boot if it doesn't exist.
   ```bash
   # entrypoint.sh
   MODEL_FILE="/models/ggml-${STT_MODEL:-base}.en.bin"
   if [ ! -f "$MODEL_FILE" ]; then
     echo "Downloading whisper model: ${STT_MODEL:-base}..."
     wget -q "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${STT_MODEL:-base}.en.bin" -O "$MODEL_FILE"
   fi
   exec "$@"
   ```

3. **Separate download script:** A `scripts/download-whisper-model.sh` for manual use:
   ```bash
   ./scripts/download-whisper-model.sh base  # downloads ggml-base.en.bin to ./models/
   ```

### Updated environment variables table

| Variable | Default | Description |
|---|---|---|
| `STT_PROVIDER` | `openai` | STT backend: `openai` or `local` |
| `STT_MODEL` | `base` | Whisper model size (tiny/base/small/medium) |
| `WHISPER_BINARY` | `/usr/local/bin/whisper-cpp` | Path to whisper.cpp binary |
| `WHISPER_MODEL_DIR` | `/models` | Directory containing model `.bin` files |

## Recommended Approach

**For a self-hosted Linux VM without GPU:**

1. **Use whisper.cpp** with the **base.en** model (English-only variant).
   - base.en gives a good accuracy/speed tradeoff on CPU: ~1 second to transcribe 10 seconds of audio, with ~10% WER that handles clear English speech well.
   - whisper.cpp has no Python dependency, keeping the Docker image lean.
   - The binary is straightforward to build and deploy.

2. **Start with subprocess invocation** (`child_process.execFile`), not native Node bindings.
   - Simpler to debug, easier to upgrade whisper.cpp independently.
   - Overhead of spawning a process per transcription is negligible compared to inference time.
   - If profiling later shows process spawn overhead matters, switch to whisper-node bindings.

3. **Use the English-only model variants** (`ggml-base.en.bin` instead of `ggml-base.bin`).
   - English-only models are faster and more accurate for English than the multilingual versions at the same size.

4. **Plan an upgrade path to small.en** if accuracy on programming terminology proves insufficient.
   - Monitor transcription quality in practice. If "git rebase" gets heard as "get rebased" too often, step up to small.
   - If a GPU becomes available later, jump straight to medium for near-API quality.

5. **Keep the OpenAI API as a fallback.** The provider abstraction makes it trivial to switch via env var, which is useful for debugging accuracy issues or if the local model can't handle a particular audio scenario.

### Migration steps

1. Implement the `STTProvider` interface and refactor existing OpenAI STT code to use it.
2. Add the `LocalWhisperSTT` provider with whisper.cpp subprocess calls.
3. Add the whisper.cpp build stage to the server Dockerfile.
4. Create `scripts/download-whisper-model.sh` for model management.
5. Update docker-compose to mount the models volume.
6. Test with real voice input and tune the model choice.
