# Structured Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all `console.*` calls with structured pino logging (server) and a lightweight level-gated logger (web client).

**Architecture:** Server gets a root pino logger with child loggers per subsystem. Hono middleware auto-logs HTTP requests. Web client gets a ~20-line `createLogger` utility. All existing `console.*` calls are migrated file-by-file.

**Tech Stack:** pino, pino-pretty (dev), hono-pino, pino-http

---

### Task 1: Install dependencies

**Files:**
- Modify: `apps/server/package.json`

- [ ] **Step 1: Install pino and hono-pino**

```bash
cd apps/server && pnpm add pino hono-pino pino-http
```

- [ ] **Step 2: Install pino-pretty as dev dependency**

```bash
cd apps/server && pnpm add -D pino-pretty
```

- [ ] **Step 3: Verify installation**

Run: `cd apps/server && pnpm ls pino hono-pino pino-http pino-pretty`
Expected: All four packages listed with versions.

- [ ] **Step 4: Commit**

```bash
git add apps/server/package.json pnpm-lock.yaml
git commit -m "feat: add pino logging dependencies"
```

---

### Task 2: Create server root logger

**Files:**
- Create: `apps/server/src/logger.ts`

- [ ] **Step 1: Create the logger module**

```ts
import pino from 'pino'

const isDev = process.env.NODE_ENV !== 'production'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  transport: isDev ? { target: 'pino-pretty' } : undefined,
})
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/server && pnpm exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/logger.ts
git commit -m "feat: add root pino logger module"
```

---

### Task 3: Add hono-pino middleware

**Files:**
- Modify: `apps/server/src/app.ts`

- [ ] **Step 1: Add hono-pino middleware to app.ts**

Add import and middleware usage. The middleware should be added before other middleware so it captures all requests.

```ts
import { pinoLogger } from 'hono-pino'
import { logger } from './logger.js'
```

Add before the CORS middleware:

```ts
app.use(pinoLogger({ pino: logger }))
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/server && pnpm exec tsc --noEmit`
Expected: No errors. If `hono-pino` types don't match, check the API — the import might be `import { logger as pinoMiddleware } from 'hono-pino'` or similar. Adjust accordingly.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/app.ts
git commit -m "feat: add hono-pino request logging middleware"
```

---

### Task 4: Migrate `apps/server/src/index.ts`

**Files:**
- Modify: `apps/server/src/index.ts`

- [ ] **Step 1: Replace console calls with pino logger**

Add at top:

```ts
import { logger } from './logger.js'

const log = logger.child({ module: 'server' })
```

Replace the 5 `console.*` calls:

| Line | Before | After |
|------|--------|-------|
| 12 | `console.log(\`Server running on http://localhost:${port}\`)` | `log.info({ port }, 'server started')` |
| 13 | `console.log(\`WebSocket available at ws://localhost:${port}/ws/audio\`)` | `log.info({ port, path: '/ws/audio' }, 'WebSocket endpoint available')` |
| 21 | `console.log(\`[server] received ${signal}...\`)` | `log.info({ signal }, 'received shutdown signal')` |
| 28 | `console.log('[server] HTTP server closed')` | `log.info('HTTP server closed')` |
| 33 | `console.log('[server] forced shutdown after timeout')` | `log.warn('forced shutdown after timeout')` |

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/server && pnpm exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/index.ts
git commit -m "feat: migrate index.ts to pino logger"
```

---

### Task 5: Migrate `apps/server/src/ws/audio.ts`

**Files:**
- Modify: `apps/server/src/ws/audio.ts`

This is the largest file — 20 `console.*` calls.

- [ ] **Step 1: Add logger import and child logger**

Add at top:

```ts
import { logger } from '../logger.js'

const log = logger.child({ module: 'ws' })
```

- [ ] **Step 2: Replace all console calls**

Apply these replacements throughout the file:

| Line | Before | After |
|------|--------|-------|
| 84 | `console.log(\`[ws] connected  client=${client}...\`)` | `log.info({ client, sessionId: sessionId.slice(0, 8) }, 'client connected')` |
| 94 | `console.warn('[ws] ignoring malformed JSON')` | `log.warn('ignoring malformed JSON')` |
| 100 | `console.warn('[ws] ignoring unrecognized message', raw)` | `log.warn({ raw }, 'ignoring unrecognized message')` |
| 110 | `console.log(\`[ws] conversation set to...\`)` | `log.info({ conversationId: conversationId?.slice(0, 8) ?? 'none' }, 'conversation set')` |
| 136 | `console.log('[ws] cancel     aborting...')` | `log.info('aborting in-progress processing')` |
| 167 | `console.log('[ws] stream     started')` | `log.debug('audio stream started')` |
| 178 | `console.warn(\`[ws] audio buffer exceeded...\`)` | `log.warn({ maxBytes: MAX_AUDIO_BUFFER_BYTES }, 'audio buffer exceeded limit, clearing')` |
| 191-195 | `console.log(\`[ws] chunk #...\`)` | `log.debug({ chunk: chunkCount, size: bytes, total: totalBytes }, 'audio chunk received')` |
| 213 | `console.log(\`[ws] closed     code=${code}\`)` | `log.info({ code }, 'connection closed')` |
| 214-216 | `console.log(\`[ws] session summary...\`)` | `log.info({ duration, streamDuration, chunkCount, totalBytes: formatBytes(totalBytes), avgChunkSize }, 'session summary')` |
| 225 | `console.error(\`[ws] error      ${err.message}\`)` | `log.error({ err }, 'WebSocket error')` |
| 253 | `console.log(\`[ws] control    type=${msg.type}\`)` | `log.debug({ type: msg.type }, 'control message')` |
| 301 | `console.error(\`[ws] stt error  ${message}\`)` | `log.error({ err: message }, 'STT error')` |
| 308 | `console.log('[ws] cancelled after transcription')` | `log.debug('cancelled after transcription')` |
| 317 | `console.log('[ws] command    disregard...')` | `log.info('voice command: disregard')` |
| 325-327 | `console.log(\`[ws] command    clear...\`)` | `log.info({ sessionId: sessionId.slice(0, 8) }, 'voice command: clear')` |
| 360 | `console.log('[ws] detected file-view intent')` | `log.debug('detected file-view intent')` |
| 379 | `console.log('[ws] cancelled after claude response')` | `log.debug('cancelled after claude response')` |
| 410 | `console.log('[ws] cancelled after TTS synthesis')` | `log.debug('cancelled after TTS synthesis')` |
| 428 | `console.error(\`[ws] tts error  ${ttsMsg}\`)` | `log.error({ err: ttsMsg }, 'TTS error')` |
| 436 | `console.error(\`[ws] claude error  ${message}\`)` | `log.error({ err: message }, 'Claude error')` |

- [ ] **Step 3: Verify it compiles**

Run: `cd apps/server && pnpm exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/ws/audio.ts
git commit -m "feat: migrate ws/audio.ts to pino logger"
```

---

### Task 6: Migrate `apps/server/src/voice/anthropic-provider.ts`

**Files:**
- Modify: `apps/server/src/voice/anthropic-provider.ts`

This file has 12 `console.*` calls.

- [ ] **Step 1: Add logger import and child logger**

```ts
import { logger } from '../logger.js'

const log = logger.child({ module: 'claude' })
```

- [ ] **Step 2: Replace all console calls**

| Line | Before | After |
|------|--------|-------|
| 193 | `console.log(\`[claude] tool run_shell: ${cmd}\`)` | `log.debug({ cmd }, 'tool run_shell')` |
| 196 | `console.log(\`[claude] blocked command: ${cmd}\`)` | `log.warn({ cmd }, 'blocked command')` |
| 219 | `console.log(\`[claude] tool read_file: ${resolved}\`)` | `log.debug({ path: resolved }, 'tool read_file')` |
| 255 | `console.log(\`[claude] evicting stale session...\`)` | `log.debug({ sessionId: id.slice(0, 8), inactiveMin: Math.round((now - lastActive) / 1000 / 60) }, 'evicting stale session')` |
| 303-305 | `console.log(\`[claude] model routing:...\`)` | `log.info({ model, mode: getModelMode(), sessionId }, 'model routing')` |
| 318-320 | `console.log(\`[claude] ${status} error...\`)` | `log.warn({ status, attempt, maxRetries: MAX_RETRIES, delay }, 'rate limited, retrying')` |
| 337-339 | `console.log(\`[claude] sending request...\`)` | `log.debug({ model, iteration: iterations, continueCount }, 'sending API request')` |
| 357-359 | `console.log(\`[claude] cache stats:...\`)` | `log.debug({ cacheRead, cacheCreation, inputTokens: response.usage.input_tokens }, 'cache stats')` |
| 376-378 | `console.log(\`[claude] response...\`)` | `log.info({ iterations, continues: continueCount, textLength: text.length }, 'response complete')` |
| 388-390 | `console.log(\`[claude] Haiku hit...\`)` | `log.info({ iterations }, 'Haiku tool escalation to Sonnet')` |
| 458-460 | `console.log(\`[claude] hit API tool limit...\`)` | `log.warn({ continueCount, maxContinues: MAX_CONTINUES }, 'hit API tool limit, auto-continuing')` |
| 506-508 | `console.log(\`[claude] restored session...\`)` | `log.info({ sessionId: sessionId.slice(0, 8), messageCount: messages.length }, 'restored session')` |

- [ ] **Step 3: Verify it compiles**

Run: `cd apps/server && pnpm exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/voice/anthropic-provider.ts
git commit -m "feat: migrate anthropic-provider.ts to pino logger"
```

---

### Task 7: Migrate `apps/server/src/voice/claude-code-provider.ts`

**Files:**
- Modify: `apps/server/src/voice/claude-code-provider.ts`

2 `console.*` calls.

- [ ] **Step 1: Add logger import and child logger**

```ts
import { logger } from '../logger.js'

const log = logger.child({ module: 'claude-code' })
```

- [ ] **Step 2: Replace console calls**

| Line | Before | After |
|------|--------|-------|
| 105 | `console.log('[claude-code] abort signal received, killing process')` | `log.info('abort signal received, killing process')` |
| 151 | `console.error(\`[claude-code] stderr: ${text}\`)` | `log.error({ stderr: text }, 'process stderr')` |

- [ ] **Step 3: Verify it compiles**

Run: `cd apps/server && pnpm exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/voice/claude-code-provider.ts
git commit -m "feat: migrate claude-code-provider.ts to pino logger"
```

---

### Task 8: Migrate STT files

**Files:**
- Modify: `apps/server/src/voice/stt.ts`
- Modify: `apps/server/src/voice/openai-stt.ts`
- Modify: `apps/server/src/voice/local-stt.ts`

- [ ] **Step 1: Add logger to stt.ts**

```ts
import { logger } from '../logger.js'

const log = logger.child({ module: 'stt' })
```

Replace line 34:
- Before: `console.log(\`[stt] using provider: ${cachedProvider.name}\`)`
- After: `log.info({ provider: cachedProvider.name }, 'using STT provider')`

- [ ] **Step 2: Add logger to openai-stt.ts**

```ts
import { logger } from '../logger.js'

const log = logger.child({ module: 'stt' })
```

Replace lines 17-18:
- Before: `console.log(\`[stt:openai] transcribing ${(audioBuffer.byteLength / 1024).toFixed(1)} KB of ${mimeType}\`)`
- After: `log.debug({ sizeKB: (audioBuffer.byteLength / 1024).toFixed(1), mimeType }, 'transcribing audio')`

Replace lines 33-35:
- Before: `console.log(\`[stt:openai] result (${elapsed}ms, ${durationSec.toFixed(1)}s audio): "${text}"\`)`
- After: `log.info({ elapsedMs: elapsed, durationSec, text }, 'transcription complete')`

- [ ] **Step 3: Add logger to local-stt.ts**

```ts
import { logger } from '../logger.js'

const log = logger.child({ module: 'stt' })
```

Replace lines 35-37:
- Before: `console.log(\`[stt:local] transcribing ${(audioBuffer.byteLength / 1024).toFixed(1)} KB of ${mimeType}\`)`
- After: `log.debug({ sizeKB: (audioBuffer.byteLength / 1024).toFixed(1), mimeType }, 'transcribing audio')`

Replace lines 73-75:
- Before: `console.log(\`[stt:local] result (${elapsed}ms, ${durationSec.toFixed(1)}s audio): "${text}"\`)`
- After: `log.info({ elapsedMs: elapsed, durationSec, text }, 'transcription complete')`

- [ ] **Step 4: Verify it compiles**

Run: `cd apps/server && pnpm exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/voice/stt.ts apps/server/src/voice/openai-stt.ts apps/server/src/voice/local-stt.ts
git commit -m "feat: migrate STT modules to pino logger"
```

---

### Task 9: Migrate TTS files

**Files:**
- Modify: `apps/server/src/voice/tts.ts`
- Modify: `apps/server/src/voice/openai-tts.ts`
- Modify: `apps/server/src/voice/piper-tts.ts`
- Modify: `apps/server/src/voice/google-tts.ts`

- [ ] **Step 1: Add logger to tts.ts**

```ts
import { logger } from '../logger.js'

const log = logger.child({ module: 'tts' })
```

Replace line 30:
- Before: `console.log(\`[tts] using provider: ${cachedProvider.name}\`)`
- After: `log.info({ provider: cachedProvider.name }, 'using TTS provider')`

- [ ] **Step 2: Add logger to openai-tts.ts**

```ts
import { logger } from '../logger.js'

const log = logger.child({ module: 'tts' })
```

Replace lines 17-19:
- Before: `console.log(\`[tts:openai] synthesizing ${text.length} chars with voice="${voice}"\`)`
- After: `log.debug({ chars: text.length, voice }, 'synthesizing')`

Replace lines 34-36:
- Before: `console.log(\`[tts:openai] done (${elapsed}ms): ${(buffer.byteLength / 1024).toFixed(1)} KB mp3\`)`
- After: `log.info({ elapsedMs: elapsed, sizeKB: (buffer.byteLength / 1024).toFixed(1) }, 'synthesis complete')`

- [ ] **Step 3: Add logger to piper-tts.ts**

```ts
import { logger } from '../logger.js'

const log = logger.child({ module: 'tts' })
```

Replace line 16:
- Before: `console.log(\`[tts:piper] using service at ${this.baseUrl}\`)`
- After: `log.info({ url: this.baseUrl }, 'using Piper service')`

Replace line 21:
- Before: `console.log(\`[tts:piper] synthesizing ${text.length} chars\`)`
- After: `log.debug({ chars: text.length }, 'synthesizing')`

Replace lines 43-45:
- Before: `console.log(\`[tts:piper] done (${elapsed}ms): ${(wav.byteLength / 1024).toFixed(1)} KB wav\`)`
- After: `log.info({ elapsedMs: elapsed, sizeKB: (wav.byteLength / 1024).toFixed(1) }, 'synthesis complete')`

- [ ] **Step 4: Add logger to google-tts.ts**

```ts
import { logger } from '../logger.js'

const log = logger.child({ module: 'tts' })
```

Replace lines 31-33:
- Before: `console.log(\`[tts:google] synthesizing ${text.length} chars with voice="${voice}" format=${audioEncoding}\`)`
- After: `log.debug({ chars: text.length, voice, format: audioEncoding }, 'synthesizing')`

Replace lines 51-53:
- Before: `console.log(\`[tts:google] done (${elapsed}ms): ${(buffer.byteLength / 1024).toFixed(1)} KB ${format}\`)`
- After: `log.info({ elapsedMs: elapsed, sizeKB: (buffer.byteLength / 1024).toFixed(1), format }, 'synthesis complete')`

- [ ] **Step 5: Verify it compiles**

Run: `cd apps/server && pnpm exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/voice/tts.ts apps/server/src/voice/openai-tts.ts apps/server/src/voice/piper-tts.ts apps/server/src/voice/google-tts.ts
git commit -m "feat: migrate TTS modules to pino logger"
```

---

### Task 10: Migrate remaining server files

**Files:**
- Modify: `apps/server/src/voice/ai-provider.ts`
- Modify: `apps/server/src/voice/cost-tracker.ts`
- Modify: `apps/server/src/voice/environment.ts`

- [ ] **Step 1: Add logger to ai-provider.ts**

```ts
import { logger } from '../logger.js'

const log = logger.child({ module: 'ai' })
```

Replace line 54:
- Before: `console.log(\`[ai] using provider: ${cached.name}\`)`
- After: `log.info({ provider: cached.name }, 'using AI provider')`

- [ ] **Step 2: Add logger to cost-tracker.ts**

```ts
import { logger } from '../logger.js'

const log = logger.child({ module: 'cost' })
```

Replace lines 280-283:
- Before: `console.log(\`[cost] interaction #${globalStats.totalInteractions}: stt=$... claude=$... tts=$... total=$... | cumulative=$...\`)`
- After: `log.info({ interaction: globalStats.totalInteractions, stt: pending.stt.toFixed(4), claude: pending.claude.toFixed(4), tts: pending.tts.toFixed(4), total: total.toFixed(4), cumulative: (globalStats.totalCosts.stt + globalStats.totalCosts.claude + globalStats.totalCosts.tts).toFixed(4) }, 'interaction cost')`

Replace line 302:
- Before: `}).catch((err) => console.error('[cost] failed to persist record:', err))`
- After: `}).catch((err) => log.error({ err }, 'failed to persist cost record'))`

- [ ] **Step 3: Add logger to environment.ts**

```ts
import { logger } from '../logger.js'

const log = logger.child({ module: 'env' })
```

Replace lines 62-64:
- Before: `console.log(\`[environment] discovered tools: ${available.map((t) => t.binary).join(', ')}\`)`
- After: `log.info({ tools: available.map((t) => t.binary) }, 'discovered CLI tools')`

- [ ] **Step 4: Verify it compiles**

Run: `cd apps/server && pnpm exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/voice/ai-provider.ts apps/server/src/voice/cost-tracker.ts apps/server/src/voice/environment.ts
git commit -m "feat: migrate ai-provider, cost-tracker, environment to pino logger"
```

---

### Task 11: Create web client logger

**Files:**
- Create: `apps/web/app/lib/logger.ts`

- [ ] **Step 1: Create the logger module**

```ts
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const
type Level = keyof typeof LEVELS

function getCurrentLevel(): Level {
  if (typeof window !== 'undefined' && (window as Record<string, unknown>).__LOG_LEVEL__) {
    const level = (window as Record<string, unknown>).__LOG_LEVEL__ as string
    if (level in LEVELS) return level as Level
  }
  return 'info'
}

export function createLogger(module: string) {
  const prefix = `[${module}]`
  const enabled = (level: Level) => LEVELS[level] >= LEVELS[getCurrentLevel()]

  return {
    debug: (...args: unknown[]) => { if (enabled('debug')) console.debug(prefix, ...args) },
    info: (...args: unknown[]) => { if (enabled('info')) console.log(prefix, ...args) },
    warn: (...args: unknown[]) => { if (enabled('warn')) console.warn(prefix, ...args) },
    error: (...args: unknown[]) => { if (enabled('error')) console.error(prefix, ...args) },
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/web && pnpm exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/lib/logger.ts
git commit -m "feat: add lightweight web client logger"
```

---

### Task 12: Migrate web client files

**Files:**
- Modify: `apps/web/app/hooks/use-audio-socket.ts`
- Modify: `apps/web/app/routes/home.tsx`

- [ ] **Step 1: Migrate use-audio-socket.ts**

Add at top:

```ts
import { createLogger } from '~/lib/logger'

const log = createLogger('audio')
```

Replace all 32 `console.*` calls with the appropriate `log.*` calls. Examples:

- `console.log('[audio] reusing existing WebSocket connection')` → `log.debug('reusing existing WebSocket connection')`
- `console.log('[audio] ws connected to', wsUrl)` → `log.info('connected to', wsUrl)`
- `console.warn('[audio] unexpected binary message, ignoring')` → `log.warn('unexpected binary message, ignoring')`
- `console.log(\`[audio] received TTS audio: ...\`)` → `log.debug(\`received TTS audio: ${(bytes / 1024).toFixed(1)} KB\`)`
- `console.log('[audio] playback complete')` → `log.debug('playback complete')`
- `console.error('[audio] playback error:', err)` → `log.error('playback error:', err)`
- `console.warn('[audio] ignoring unrecognized server message', raw)` → `log.warn('ignoring unrecognized server message', raw)`
- `console.log(\`[audio] ack chunk ...\`)` → `log.debug(\`ack chunk #${msg.chunk} (${msg.bytes} B)\`)`
- `console.log(\`[audio] transcribing ...\`)` → `log.debug(\`transcribing ${msg.bytes} B\`)`
- `console.error(\`[audio] transcription error: ...\`)` → `log.error(\`transcription error: ${msg.error}\`)`
- `console.log(\`[audio] transcription: ...\`)` → `log.info(\`transcription: "${msg.text}"\`)`
- `console.log('[audio] claude is thinking...')` → `log.debug('claude is thinking')`
- `console.log(\`[audio] claude using tool: ...\`)` → `log.debug(\`claude using tool: ${msg.name}\`)`
- `console.error(\`[audio] claude error: ...\`)` → `log.error(\`claude error: ${msg.error}\`)`
- `console.log(\`[audio] claude: ...\`)` → `log.info(\`claude response: "${(msg.text ?? '').slice(0, 100)}..."\`)`
- `console.log('[audio] synthesizing TTS...')` → `log.debug('synthesizing TTS')`
- `console.log(\`[audio] TTS audio header: ...\`)` → `log.debug(\`TTS audio header: ${msg.format}, ${msg.bytes} B\`)`
- `console.error(\`[audio] TTS error: ...\`)` → `log.error(\`TTS error: ${msg.error}\`)`
- `console.log(\`[audio] voice command: ...\`)` → `log.info(\`voice command: ${msg.command}\`)`
- `console.log(\`[audio] ws closed ...\`)` → `log.info(\`ws closed (code=${event.code})\`)`
- `console.log(\`[audio] reconnecting ...\`)` → `log.info(\`reconnecting (attempt ${attempt}) in ${delay}ms\`)`
- `console.log('[audio] max reconnection attempts reached, giving up')` → `log.warn('max reconnection attempts reached, giving up')`
- `console.error('[audio] ws error')` → `log.error('ws error')`
- `console.log('[audio] component unmounting, closing WebSocket')` → `log.debug('component unmounting, closing WebSocket')`
- `console.error(\`[audio] getUserMedia failed: ...\`)` → `log.error(\`getUserMedia failed: ${err.message}\`)`
- `console.log(\`[audio] buffered chunk ...\`)` → `log.debug(\`buffered chunk #${chunksRef.current.length} (${event.data.size} B)\`)`
- `console.log('[audio] recording started')` → `log.info('recording started')`
- `console.log(\`[audio] sending complete recording: ...\`)` → `log.info(\`sending recording: ${(blob.size / 1024).toFixed(1)} KB (${chunks.length} chunks)\`)`
- `console.log('[audio] recording stopped, requesting transcription')` → `log.info('recording stopped, requesting transcription')`
- `console.log('[audio] recording cancelled, no audio sent')` → `log.info('recording cancelled')`
- `console.log('[audio] playback cancelled by user')` → `log.info('playback cancelled by user')`

- [ ] **Step 2: Migrate home.tsx**

Add at top:

```ts
import { createLogger } from '~/lib/logger'

const log = createLogger('home')
```

Replace all 6 `console.*` calls:

- `console.log('[auto] VAD detected speech end, sending...')` → `log.debug('VAD detected speech end, sending')`
- `console.error('[home] failed to fetch conversations:', err)` → `log.error('failed to fetch conversations:', err)`
- `console.error('[home] failed to create conversation:', err)` → `log.error('failed to create conversation:', err)`
- `console.error('[home] failed to load conversation:', err)` → `log.error('failed to load conversation:', err)`
- `console.error('[home] failed to delete conversation:', err)` → `log.error('failed to delete conversation:', err)`
- `console.error('[home] failed to auto-create conversation:', err)` → `log.error('failed to auto-create conversation:', err)`

- [ ] **Step 3: Verify it compiles**

Run: `cd apps/web && pnpm exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/hooks/use-audio-socket.ts apps/web/app/routes/home.tsx
git commit -m "feat: migrate web client to lightweight logger"
```

---

### Task 13: Add LOG_LEVEL to .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add LOG_LEVEL entry**

Add after the `PORT` line:

```
# Log level: debug | info | warn | error (default: debug in dev, info in production)
# LOG_LEVEL=info
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "feat: add LOG_LEVEL to .env.example"
```

---

### Task 14: Final verification

- [ ] **Step 1: Verify no remaining console.* calls in server**

Run: `grep -rn 'console\.' apps/server/src/ --include='*.ts' | grep -v node_modules | grep -v '.d.ts'`
Expected: No output (all console calls replaced).

- [ ] **Step 2: Verify no remaining console.* calls in web client files**

Run: `grep -n 'console\.' apps/web/app/hooks/use-audio-socket.ts apps/web/app/routes/home.tsx`
Expected: No output.

- [ ] **Step 3: Run full typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 4: Run lint**

Run: `pnpm lint`
Expected: No errors (or only pre-existing ones).

- [ ] **Step 5: Test dev server starts**

Run: `cd apps/server && pnpm dev`
Expected: Pretty-printed pino output with `[server]` module tag, colorized.

- [ ] **Step 6: Commit any remaining fixes if needed**

```bash
git add -A
git commit -m "fix: clean up remaining logging migration issues"
```
