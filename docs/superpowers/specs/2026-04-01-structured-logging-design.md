# Structured Logging Design

## Summary

Replace all `console.*` calls with structured logging across the voice-claude application. Server uses pino with child loggers per subsystem. Web client gets a lightweight zero-dependency logger. Hono request logging via hono-pino middleware.

## Server Logger

### Root Logger

New file: `apps/server/src/logger.ts`

- Uses `pino` with level-based configuration
- Default level: `debug` in development, `info` in production
- Override via `LOG_LEVEL` environment variable
- Pretty-printed output in dev (`pino-pretty`), JSON in production
- `NODE_ENV` determines environment

### Child Loggers

Each subsystem creates a child logger with a `module` field:

| File(s) | Module name |
|---------|-------------|
| `index.ts` | `server` |
| `ws/audio.ts` | `ws` |
| `voice/anthropic-provider.ts` | `claude` |
| `voice/claude-code-provider.ts` | `claude-code` |
| `voice/openai-stt.ts`, `local-stt.ts`, `stt.ts` | `stt` |
| `voice/openai-tts.ts`, `piper-tts.ts`, `google-tts.ts`, `tts.ts` | `tts` |
| `voice/cost-tracker.ts` | `cost` |
| `voice/ai-provider.ts` | `ai` |
| `voice/environment.ts` | `env` |

### Hono Middleware

Add `hono-pino` middleware to `app.ts` for automatic HTTP/tRPC request logging (method, path, status, latency).

### Dependencies

- `pino` — runtime
- `pino-pretty` — dev dependency
- `hono-pino` — runtime
- `pino-http` — runtime (required by hono-pino)

## Web Client Logger

### Lightweight Logger

New file: `apps/web/app/lib/logger.ts`

- Zero dependencies, ~20 lines
- `createLogger(module)` returns `{ debug, info, warn, error }`
- Level-gated: calls below the current level are no-ops
- Default level: `info`
- Override via `window.__LOG_LEVEL__` for devtools debugging
- Prefixes output with `[module]`
- Delegates to native `console.debug`, `console.log`, `console.warn`, `console.error`

### Files to Update

- `apps/web/app/routes/home.tsx` (6 calls)
- `apps/web/app/hooks/use-audio-socket.ts` (32 calls)

## Migration Strategy

File-by-file replacement, no big-bang rewrite.

### Level Mapping

| Current pattern | New level |
|----------------|-----------|
| Startup messages, provider selection | `info` |
| Routine lifecycle events (connect, disconnect, stream start) | `info` |
| Verbose data (byte counts, timing, tool invocations) | `debug` |
| `console.warn(...)` | `warn` |
| `console.error(...)` | `error` |

### Structured Data

Values currently interpolated into log strings become object properties in the first argument:

```
// Before
console.log(`[ws] closed code=${code}`)

// After
log.info({ code }, "connection closed")
```

### Environment

Add `LOG_LEVEL` to `.env.example` with a comment explaining valid values.
