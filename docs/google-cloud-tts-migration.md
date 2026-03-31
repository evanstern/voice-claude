# Adding Google Cloud TTS as a Provider

## Overview

This document outlines the plan for adding Google Cloud Text-to-Speech as a TTS provider alongside the existing OpenAI TTS implementation. The design uses a **provider/factory pattern** so that TTS providers are plug-and-play: OpenAI TTS remains the default and continues working exactly as it does today, while Google Cloud TTS (and any future providers) can be selected via an environment variable.

The motivation for adding Google Cloud TTS is cost: Google Standard voices cost $4/1M characters vs OpenAI's $15/1M characters, a 73% reduction. Since TTS accounts for 50-60% of per-interaction cost, this is the single highest-impact cost optimization available.

## Design Principle: Provider Factory Pattern

The core architectural decision is that **no TTS provider is hardcoded**. All providers implement a shared `TTSProvider` interface, and a factory function selects the active provider at runtime based on configuration. This means:

- **OpenAI TTS stays.** It is the current default and remains the default after this work.
- **Google Cloud TTS is added alongside it.** Setting `TTS_PROVIDER=google` opts in.
- **Future providers** (ElevenLabs, Azure, local Piper, etc.) can be added by implementing the same interface and registering in the factory. No changes to calling code required.

## TTSProvider Interface (The Centerpiece)

This interface is the contract that every TTS provider must implement. It lives at `apps/server/src/voice/tts-provider.ts`:

```typescript
/**
 * Common options for TTS synthesis. Each provider may support additional
 * provider-specific options, but all must accept these.
 */
export interface TTSOptions {
  /** Provider-specific voice identifier (e.g., "alloy" for OpenAI, "en-US-Standard-C" for Google) */
  voice?: string
  /** Output audio format */
  format?: 'mp3' | 'ogg_opus'
  /** Speaking rate multiplier (1.0 = normal speed) */
  speakingRate?: number
}

/**
 * The interface every TTS provider must implement.
 *
 * This is the plug-and-play contract. Any new provider (ElevenLabs, Azure,
 * local Piper, etc.) just needs to implement this interface and register
 * itself in the factory.
 */
export interface TTSProvider {
  /** Human-readable name for logging and debugging */
  readonly name: string

  /**
   * Synthesize text into audio.
   * Returns a Buffer containing audio data in the format specified by options
   * (or the provider's default format).
   */
  synthesize(text: string, options?: TTSOptions): Promise<Buffer>

  /**
   * The default audio format this provider returns when none is specified.
   * The client uses this to know how to decode the audio.
   */
  readonly defaultFormat: 'mp3' | 'ogg_opus'
}
```

Every provider implements this interface. The calling code never references OpenAI or Google directly -- it only talks to `TTSProvider`.

## OpenAI TTS Provider (Wrapping Existing Code)

The current OpenAI TTS logic gets wrapped into a class that implements `TTSProvider`. This is a refactor of the existing code, not a rewrite. The behavior stays identical.

File: `apps/server/src/voice/openai-tts.ts`

```typescript
import OpenAI from 'openai'
import type { TTSOptions, TTSProvider } from './tts-provider.js'

export class OpenAITTSProvider implements TTSProvider {
  readonly name = 'openai'
  readonly defaultFormat = 'mp3' as const

  private client: OpenAI

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  }

  async synthesize(text: string, options?: TTSOptions): Promise<Buffer> {
    const voice = options?.voice ?? process.env.OPENAI_TTS_VOICE ?? 'alloy'
    const speed = options?.speakingRate ?? 1.0

    const response = await this.client.audio.speech.create({
      model: 'tts-1',
      voice: voice as 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer',
      input: text,
      response_format: 'mp3',
      speed,
    })

    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }
}
```

This is a straight extraction of the existing OpenAI TTS code into the provider interface. Nothing changes about how it works.

## Google Cloud TTS Provider (New)

File: `apps/server/src/voice/google-tts.ts`

```typescript
import textToSpeech from '@google-cloud/text-to-speech'
import type { TTSOptions, TTSProvider } from './tts-provider.js'

export class GoogleTTSProvider implements TTSProvider {
  readonly name = 'google'
  readonly defaultFormat = 'ogg_opus' as const

  private client: textToSpeech.TextToSpeechClient

  constructor() {
    // Support both file-based and inline JSON credentials
    const credentialsJson = process.env.GOOGLE_TTS_CREDENTIALS
    if (credentialsJson) {
      const credentials = JSON.parse(credentialsJson)
      this.client = new textToSpeech.TextToSpeechClient({ credentials })
    } else {
      // Falls back to GOOGLE_APPLICATION_CREDENTIALS env var (file path)
      this.client = new textToSpeech.TextToSpeechClient()
    }
  }

  async synthesize(text: string, options?: TTSOptions): Promise<Buffer> {
    const voice = options?.voice ?? process.env.GOOGLE_TTS_VOICE ?? 'en-US-Standard-C'
    const speakingRate = options?.speakingRate
      ?? Number.parseFloat(process.env.GOOGLE_TTS_SPEAKING_RATE ?? '1.0')
    const format = options?.format ?? this.defaultFormat

    const audioEncoding = format === 'mp3' ? 'MP3' : 'OGG_OPUS'

    const [response] = await this.client.synthesizeSpeech({
      input: { text },
      voice: {
        languageCode: 'en-US',
        name: voice,
      },
      audioConfig: {
        audioEncoding: audioEncoding as 'MP3' | 'OGG_OPUS',
        speakingRate,
      },
    })

    return Buffer.from(response.audioContent as Uint8Array)
  }
}
```

## Provider Factory (Selects the Active Provider)

This is the entry point that the rest of the application uses. It reads `TTS_PROVIDER` from the environment and returns the right implementation. **The default is `openai`.**

File: `apps/server/src/voice/tts.ts`

```typescript
import type { TTSProvider } from './tts-provider.js'

/** Registry of known provider constructors, keyed by TTS_PROVIDER value */
const PROVIDERS: Record<string, () => Promise<TTSProvider>> = {
  openai: async () => {
    const { OpenAITTSProvider } = await import('./openai-tts.js')
    return new OpenAITTSProvider()
  },
  google: async () => {
    const { GoogleTTSProvider } = await import('./google-tts.js')
    return new GoogleTTSProvider()
  },
  // Future providers go here:
  // elevenlabs: async () => { ... },
  // azure: async () => { ... },
  // piper: async () => { ... },
}

let cachedProvider: TTSProvider | null = null

/**
 * Get the configured TTS provider.
 *
 * Reads TTS_PROVIDER from env (default: "openai") and returns the
 * corresponding provider instance. The instance is cached for the
 * lifetime of the process.
 *
 * Supported values: "openai" (default), "google"
 */
export async function getTTSProvider(): Promise<TTSProvider> {
  if (!cachedProvider) {
    const name = process.env.TTS_PROVIDER ?? 'openai'
    const factory = PROVIDERS[name]
    if (!factory) {
      throw new Error(
        `Unknown TTS provider: "${name}". Supported: ${Object.keys(PROVIDERS).join(', ')}`
      )
    }
    cachedProvider = await factory()
    console.log(`TTS provider initialized: ${cachedProvider.name}`)
  }
  return cachedProvider
}

/**
 * Backward-compatible synthesize function.
 *
 * Existing code that calls synthesize() continues to work without any
 * changes. Under the hood it delegates to whatever provider is configured.
 */
export async function synthesize(text: string): Promise<Buffer> {
  const provider = await getTTSProvider()
  return provider.synthesize(text)
}

/**
 * Get the default audio format for the active provider.
 * The client needs this to know how to decode the audio.
 */
export async function getAudioFormat(): Promise<'mp3' | 'ogg_opus'> {
  const provider = await getTTSProvider()
  return provider.defaultFormat
}
```

### How it works at runtime

1. Application starts. Nothing is loaded yet.
2. First call to `synthesize()` or `getTTSProvider()` reads `TTS_PROVIDER` from env.
3. If unset or `"openai"` (the default), it dynamically imports `openai-tts.js` and creates an `OpenAITTSProvider`. Google SDK is never loaded.
4. If `"google"`, it dynamically imports `google-tts.js` and creates a `GoogleTTSProvider`. OpenAI SDK is never loaded for TTS.
5. The provider instance is cached. All subsequent calls reuse it.

### Adding a new provider in the future

To add, say, ElevenLabs:

1. Create `apps/server/src/voice/elevenlabs-tts.ts` implementing `TTSProvider`
2. Add one entry to the `PROVIDERS` map in `tts.ts`:
   ```typescript
   elevenlabs: async () => {
     const { ElevenLabsTTSProvider } = await import('./elevenlabs-tts.js')
     return new ElevenLabsTTSProvider()
   },
   ```
3. Set `TTS_PROVIDER=elevenlabs` in env. Done.

No other code changes needed. The factory handles it.

## File Layout

```
apps/server/src/voice/
  tts-provider.ts     -- TTSProvider interface + TTSOptions type
  tts.ts              -- Factory function + backward-compatible synthesize()
  openai-tts.ts       -- OpenAITTSProvider (wraps existing code)
  google-tts.ts       -- GoogleTTSProvider (new)
```

## Environment Variables

```env
# TTS provider selection (default: "openai")
# Supported values: "openai", "google"
TTS_PROVIDER=openai

# --- OpenAI TTS config (used when TTS_PROVIDER=openai) ---
OPENAI_API_KEY=sk-...             # Already exists; also used for Whisper STT
OPENAI_TTS_VOICE=alloy            # alloy, echo, fable, onyx, nova, shimmer

# --- Google Cloud TTS config (used when TTS_PROVIDER=google) ---
GOOGLE_APPLICATION_CREDENTIALS=   # Path to service account JSON key file
GOOGLE_TTS_CREDENTIALS=           # OR: inline JSON string (for Docker)
GOOGLE_TTS_VOICE=en-US-Standard-C # Voice name
GOOGLE_TTS_SPEAKING_RATE=1.0      # 0.25 to 4.0
```

**The default is `openai`.** If `TTS_PROVIDER` is not set, OpenAI TTS is used. This is a non-breaking change: existing deployments that have no `TTS_PROVIDER` set will behave identically to today.

## Google Cloud TTS API: Voice Tiers

Google Cloud TTS offers three tiers of voices, each with different quality and pricing:

### Standard voices ($4/1M characters)
- Concatenative synthesis (traditional approach)
- Decent quality for most use cases, comparable to basic assistants
- Lowest latency of the three tiers
- Good enough for code-related responses where naturalness matters less

### WaveNet voices ($16/1M characters)
- DeepMind WaveNet model, significantly more natural than Standard
- More expensive than OpenAI tts-1
- Higher latency due to model inference
- Not cost-effective for our use case

### Neural2 voices ($16/1M characters)
- Google's latest neural network synthesis
- Similar pricing to WaveNet
- Slightly better quality than WaveNet in some languages
- Same cost concern as WaveNet

### Journey voices ($16/1M characters)
- Conversational style, designed for interactive use cases
- Most natural-sounding for dialogue
- Same premium pricing tier

**Recommendation:** Start with Standard voices. At $4/1M chars, even if quality is noticeably lower than OpenAI tts-1, the 73% cost savings justify it for a tool where the content (code discussions) matters more than vocal polish. If users find Standard quality unacceptable, Neural2 is available at the same price as OpenAI.

## Voice Quality Comparison: Google Standard vs OpenAI tts-1

| Aspect | OpenAI tts-1 | Google Standard | Notes |
|--------|-------------|-----------------|-------|
| Naturalness | Good, consistent | Acceptable, slightly robotic | OpenAI is noticeably better |
| Pronunciation of code terms | Good | Variable | Both struggle with some technical terms |
| Latency (time to first byte) | ~300-500ms | ~100-300ms | Google is faster for Standard |
| Streaming support | Yes (chunked) | Yes (up to 5000 chars per request) | OpenAI streams; Google returns full audio |
| Voice variety | 6 voices | 30+ per language | Google has more selection |
| SSML support | No | Yes | Google allows fine-grained control |
| Max input length | 4096 chars | 5000 bytes (Standard) | Similar practical limits |

For our use case (spoken code discussions through Bluetooth earbuds in a potentially noisy environment like a bakery), Standard voice quality should be sufficient. The content comprehension matters far more than vocal aesthetics.

## Google Cloud Authentication Setup

### Service Account Creation
1. Create a GCP project (or use an existing one)
2. Enable the Cloud Text-to-Speech API
3. Create a service account with the `Cloud Text-to-Speech User` role
4. Generate a JSON key file

### Credential Configuration
Two options for providing credentials to the SDK:

**Option A: Key file path (simpler for local dev)**
```
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
```

**Option B: Inline JSON (better for Docker/production)**
```
GOOGLE_TTS_CREDENTIALS='{"type":"service_account","project_id":"...","private_key":"..."}'
```

For our Docker setup, Option B is preferred since it avoids mounting a credentials file. The server would parse the JSON string and pass it to the SDK client constructor.

## SDK: @google-cloud/text-to-speech

The official npm package is `@google-cloud/text-to-speech`.

### Installation
```bash
pnpm add @google-cloud/text-to-speech --filter @voice-claude/server
```

### SSML Support (Future Enhancement)
Google TTS supports SSML, which could be useful for:
- Adding pauses between code blocks and explanations
- Spelling out variable names letter-by-letter when needed
- Controlling emphasis on important words

This is not needed for the initial implementation but is a nice capability to have available.

## Audio Format Considerations

### MP3 (OpenAI default)
- Universal browser support
- Higher bandwidth (~32kbps at low quality, ~128kbps typical)
- Higher encoding overhead
- What we use today with OpenAI

### OGG/Opus (Google default)
- Excellent browser support (all modern browsers)
- Much lower bandwidth (~16-24kbps for speech with similar quality)
- Lower latency encoding
- Native WebSocket-friendly format
- Google TTS supports it natively (no server-side transcoding)

**Each provider uses its optimal format by default.** OpenAI returns MP3; Google returns OGG/Opus. The `TTSProvider.defaultFormat` property tells the client which format to expect, so the playback code can handle both transparently (which it effectively already does via the browser's built-in audio decoding).

## Latency Comparison

Expected round-trip latency for a typical response (~200 characters):

| Stage | OpenAI tts-1 | Google Standard |
|-------|-------------|-----------------|
| API call + synthesis | 300-500ms | 100-300ms |
| Audio transfer (mobile) | ~50ms (MP3) | ~30ms (Opus) |
| **Total TTS latency** | **350-550ms** | **130-330ms** |

Google Standard voices should be faster because:
1. Standard synthesis is computationally simpler than neural models
2. OGG/Opus produces smaller payloads than MP3
3. Google's infrastructure has lower latency for simple API calls

This is a meaningful improvement given our target of keeping the full STT + Claude + TTS loop under 3-4 seconds.

## Implementation Phases

### Phase 1: Abstraction Layer (no behavior change)
1. Create `TTSProvider` interface and `TTSOptions` type in `tts-provider.ts`
2. Create `OpenAITTSProvider` class wrapping the existing OpenAI TTS code
3. Create the provider factory in `tts.ts` with the `PROVIDERS` registry
4. Wire up the backward-compatible `synthesize()` export
5. Verify all existing tests pass -- behavior is identical, only the internal structure changed

After Phase 1, the app still uses OpenAI TTS exactly as before. The factory defaults to `openai`. No new dependencies. This phase is safe to merge on its own.

### Phase 2: Add Google Cloud TTS Provider
1. Install `@google-cloud/text-to-speech` dependency
2. Implement `GoogleTTSProvider` class
3. Register `google` in the `PROVIDERS` map
4. Add Google-specific env vars to `.env.example`
5. Write unit tests for the Google provider (mock the SDK)

### Phase 3: Integration Testing
1. Set up a GCP project with TTS API enabled
2. Test with `TTS_PROVIDER=google` locally
3. Compare audio quality subjectively across several voice options
4. Measure actual latency numbers
5. Test in Docker environment with credential passthrough

### Phase 4: Rollout
1. **Default remains `TTS_PROVIDER=openai`.** Nothing changes for existing users.
2. Document the `TTS_PROVIDER=google` option in README/CLAUDE.md
3. After a validation period, consider whether to switch the default to `google`

### Recommended Google Voices to Evaluate
- `en-US-Standard-C` (female) -- generally the most natural Standard voice
- `en-US-Standard-D` (male) -- good male alternative
- `en-US-Standard-A` (male) -- deeper tone
- `en-US-Standard-F` (female) -- alternative female voice

Test each with a sample of typical Claude responses (code explanations, file listings, error descriptions) and pick the one that sounds clearest through Pixel Buds.

## Cost Projection

Assuming 500 interactions/day at ~300 characters average per TTS call:

| Provider | Cost/1M chars | Daily chars | Daily cost | Monthly cost |
|----------|--------------|-------------|------------|--------------|
| OpenAI tts-1 | $15.00 | 150,000 | $2.25 | $67.50 |
| Google Standard | $4.00 | 150,000 | $0.60 | $18.00 |
| **Savings** | | | **$1.65/day** | **$49.50/month (73%)** |

Google also offers a free tier of 1 million characters/month for Standard voices (4 million for the first 12 months), which would cover light usage entirely for free.
