# Google Cloud TTS Migration Plan

## Overview

This document outlines the plan for migrating voice-claude's text-to-speech from OpenAI TTS (`tts-1`) to Google Cloud Text-to-Speech. The primary motivation is cost: Google Cloud TTS Standard voices cost $4/1M characters vs OpenAI's $15/1M characters, a 73% reduction. Since TTS accounts for 50-60% of per-interaction cost, this is the single highest-impact cost optimization available.

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

## Authentication Setup

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

### Environment Variables to Add
```env
# TTS provider selection
TTS_PROVIDER=google          # "openai" | "google" (default: "openai" for backward compat)

# Google Cloud TTS config
GOOGLE_APPLICATION_CREDENTIALS=  # path to service account JSON key
GOOGLE_TTS_VOICE=en-US-Standard-C  # voice name
GOOGLE_TTS_SPEAKING_RATE=1.0       # 0.25 to 4.0
```

## SDK: @google-cloud/text-to-speech

The official npm package is `@google-cloud/text-to-speech`.

### Installation
```bash
pnpm add @google-cloud/text-to-speech --filter @voice-claude/server
```

### Basic Usage
```typescript
import textToSpeech from '@google-cloud/text-to-speech'

const client = new textToSpeech.TextToSpeechClient()

const [response] = await client.synthesizeSpeech({
  input: { text: 'Hello from Google Cloud TTS' },
  voice: {
    languageCode: 'en-US',
    name: 'en-US-Standard-C',
  },
  audioConfig: {
    audioEncoding: 'OGG_OPUS',  // or 'MP3'
    speakingRate: 1.0,
  },
})

// response.audioContent is a Buffer
```

### SSML Support (Future Enhancement)
Google TTS supports SSML, which could be useful for:
- Adding pauses between code blocks and explanations
- Spelling out variable names letter-by-letter when needed
- Controlling emphasis on important words

This is not needed for the initial migration but is a nice capability to have available.

## Implementation Plan

### Step 1: Define a TTS Provider Interface

Create `apps/server/src/voice/tts-provider.ts`:

```typescript
export interface TTSProvider {
  synthesize(text: string, options?: TTSOptions): Promise<Buffer>
}

export interface TTSOptions {
  voice?: string
  format?: 'mp3' | 'ogg_opus'
  speakingRate?: number
}
```

### Step 2: Wrap Existing OpenAI TTS

Refactor `apps/server/src/voice/tts.ts` into `apps/server/src/voice/openai-tts.ts` implementing the `TTSProvider` interface. This preserves the current behavior exactly.

### Step 3: Implement Google Cloud TTS Provider

Create `apps/server/src/voice/google-tts.ts` implementing `TTSProvider` using `@google-cloud/text-to-speech`.

### Step 4: Create Provider Factory

Update `apps/server/src/voice/tts.ts` to export a factory that reads `TTS_PROVIDER` from env and returns the appropriate provider:

```typescript
import type { TTSProvider } from './tts-provider.js'

let provider: TTSProvider | null = null

export function getTTSProvider(): TTSProvider {
  if (!provider) {
    const name = process.env.TTS_PROVIDER ?? 'openai'
    if (name === 'google') {
      // dynamic import to avoid loading SDK when not needed
      const { GoogleTTSProvider } = require('./google-tts.js')
      provider = new GoogleTTSProvider()
    } else {
      const { OpenAITTSProvider } = require('./openai-tts.js')
      provider = new OpenAITTSProvider()
    }
  }
  return provider
}

// Keep backward-compatible export
export async function synthesize(text: string): Promise<Buffer> {
  return getTTSProvider().synthesize(text)
}
```

### Step 5: Update Callers

Any code that imports `synthesize` from `./voice/tts.js` should continue to work without changes since we maintain the same export signature.

### Step 6: Update Configuration

- Add new env vars to `.env.example`
- Update `docker-compose.yml` and `docker-compose.prod.yml` to pass through the new env vars
- Update the CLAUDE.md environment variables table

## Audio Format Considerations

### MP3 (current)
- Universal browser support
- Higher bandwidth (~32kbps at low quality, ~128kbps typical)
- Higher encoding overhead
- What we use today with OpenAI

### OGG/Opus (recommended for Google TTS)
- Excellent browser support (all modern browsers)
- Much lower bandwidth (~16-24kbps for speech with similar quality)
- Lower latency encoding
- Native WebSocket-friendly format
- Google TTS supports it natively (no server-side transcoding)

**Recommendation:** Use OGG/Opus with Google TTS. It reduces bandwidth by roughly 50% compared to MP3, which matters for mobile connections. The web client's `AudioContext` API handles Opus decoding natively. Keep MP3 as the format for OpenAI TTS since that is what their API returns most efficiently.

This means the `TTSOptions.format` field matters: the provider factory should default to `ogg_opus` for Google and `mp3` for OpenAI, and the client playback code needs to handle both formats (which it effectively already does via the browser's built-in audio decoding).

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

## Migration Steps

### Phase 1: Abstraction (no behavior change)
1. Create `TTSProvider` interface
2. Refactor current OpenAI code into `OpenAITTSProvider` class
3. Create factory in `tts.ts` that defaults to OpenAI
4. Verify all existing tests pass, no behavior change

### Phase 2: Google TTS Implementation
1. Add `@google-cloud/text-to-speech` dependency
2. Implement `GoogleTTSProvider`
3. Add Google-specific env vars to `.env.example`
4. Write unit tests for the Google provider (mock the SDK)

### Phase 3: Integration Testing
1. Set up a GCP project with TTS API enabled
2. Test with `TTS_PROVIDER=google` locally
3. Compare audio quality subjectively across several voice options
4. Measure actual latency numbers
5. Test in Docker environment with credential passthrough

### Phase 4: Rollout
1. Default remains `TTS_PROVIDER=openai`
2. Document the switch in README/CLAUDE.md
3. After validation period, consider switching the default to `google`

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
