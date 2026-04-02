# Unified AI Provider Pipeline Design

## Problem

Voice Claude has two AI provider paths — API Key (Anthropic) and Claude Code — that diverge significantly in how they handle identity, voice rules, and pre-processing. In Claude Code mode, the AI identifies itself as Claude Code and has no awareness it's operating inside Voice Claude. The API mode has keyword-based routing and message decoration that doesn't exist in the Claude Code path. We need a shared layer so both providers deliver a consistent Voice Claude experience while preserving each provider's native strengths.

## Goals

- Both providers present the same Voice Claude identity and follow the same voice rules
- Operational keywords (file-view, health-check) work identically regardless of provider
- Routing keywords (simple vs. complex) drive model selection in API mode only
- Claude Code remains in charge of its own model selection, session management, and tool execution
- The existing `AIProvider` interface stays largely unchanged
- New voice-layer intelligence has a clear, testable home

## Non-Goals

- Unifying session management across providers
- Unifying tool execution across providers
- Adding sentiment/NLP analysis (keyword matching is sufficient for now)
- Model routing for Claude Code mode
- Changes to STT, TTS, cost tracking, or conversation persistence

## Approach: Voice Middleware Layer

A stateless middleware that sits between the WebSocket handler (`audio.ts`) and the AI providers. It orchestrates two new modules — voice context building and keyword processing — into a single pre-processing step.

## Components

### 1. Voice Context Builder (`voice-context.ts`)

Builds the shared identity and voice rules that both providers receive.

```typescript
interface VoiceContext {
  systemPrompt: string
  voiceRules: string[]
}

function buildVoiceContext(options: {
  workDir: string
  environment: EnvironmentCapabilities
}): VoiceContext
```

**System prompt content:**
- Voice Claude identity: "You are Voice Claude, a hands-free voice coding assistant..."
- Environment capabilities (git, curl, jq, rg, etc.) discovered dynamically
- Working directory context
- Voice rules: 100 word max, no markdown, conversational tone, file-view brevity, tool-use result reporting

**Provider consumption:**
- AnthropicProvider: uses `systemPrompt` as the `system` parameter in API calls (replaces its current hardcoded prompt)
- ClaudeCodeProvider: passes `systemPrompt` via `--append-system-prompt` CLI flag (replaces the current terse `VOICE_SYSTEM_PROMPT` constant)

The Claude Code prompt should make the AI aware it has Claude Code capabilities underneath, e.g., "You are Voice Claude, a hands-free voice coding assistant, powered by Claude Code for code editing and tool use."

### 2. Keyword Processor (`voice-keywords.ts`)

Replaces `commands.ts`. Formalizes two keyword categories in a single processing step.

```typescript
interface KeywordResult {
  command: 'disregard' | 'clear' | null
  operationalIntents: OperationalIntent[]
  routingHint: 'simple' | 'complex' | null
  processedText: string
  decorations: string[]
}

type OperationalIntent = 'file-view' | 'health-check'

function processKeywords(text: string): KeywordResult
```

**Operational intents** (apply to both providers):
- `file-view`: "show me", "pull up", "what's in" patterns. Appends instruction: "Just read the file and say 'Here's [filename].' Do NOT describe, summarize, or explain the contents."
- `health-check`: "can you hear me", "are you there" patterns. Appends instruction: "Respond briefly confirming you can hear."
- Extensible: new intents are new pattern matchers + decoration strings.

**Routing hints** (API mode only):
- `simple`: file reads, quick questions, status checks. Keywords: "read", "show", "list", "what is", "check". Suggests Haiku.
- `complex`: planning, refactoring, implementation, debugging. Keywords: "plan", "refactor", "implement", "design", "debug", "architect". Suggests Sonnet/Opus.
- `null`: no strong signal, default to Haiku.

**Commands** (same as today, absorbed from `commands.ts`):
- `disregard`: trailing "disregard", "never mind", "nevermind", "cancel"
- `clear`: trailing "clear", "reset"

### 3. Voice Middleware (`voice-middleware.ts`)

Orchestrates context building and keyword processing into one call.

```typescript
interface VoiceInput {
  command: 'disregard' | 'clear' | null
  chatText: string
  voiceContext: VoiceContext
  routingHint: 'simple' | 'complex' | null
  operationalIntents: OperationalIntent[]
}

function processVoiceInput(input: {
  rawText: string
  sessionId: string
  provider: 'anthropic' | 'claude-code'
}): VoiceInput
```

The middleware is stateless. It calls `processKeywords()` on the raw text, builds `chatText` by appending any decorations to the processed text, and attaches the `VoiceContext`. The `provider` field is passed through for downstream use but does not affect processing.

### 4. Environment Discovery (`environment.ts`)

Extracted from `AnthropicProvider`. Discovers available CLI tools in the environment (git, curl, jq, rg, etc.) and caches the result.

```typescript
interface EnvironmentCapabilities {
  tools: string[]
  description: string
}

function discoverEnvironment(): Promise<EnvironmentCapabilities>
```

Used by the voice context builder to populate the system prompt. Cached per process (same as current behavior).

## Modifications to Existing Code

### `ai-provider.ts`

Add `voiceContext` and `routingHint` to `ChatParams`:

```typescript
interface ChatParams {
  sessionId: string
  userText: string
  voiceContext?: VoiceContext
  routingHint?: 'simple' | 'complex' | null
  onToolUse?: (name: string, input: unknown) => void
  signal?: AbortSignal
}
```

Both fields are optional for backwards compatibility (e.g., testing), but the voice middleware always provides them in production.

### `anthropic-provider.ts`

- Remove hardcoded system prompt construction
- Remove `discoverEnvironment()` (moved to `environment.ts`)
- Use `voiceContext.systemPrompt` as the `system` parameter
- Use `routingHint` for model selection in `auto` mode instead of internal complexity heuristic
- Keep: session history management, tool execution loop, Haiku→Sonnet escalation after N tool iterations (this is runtime behavior, not initial routing)

### `claude-code-provider.ts`

- Remove `VOICE_SYSTEM_PROMPT` constant
- Use `voiceContext.systemPrompt` for `--append-system-prompt` flag
- Ignore `routingHint`
- Keep: subprocess spawning, session ID mapping, stream parsing, timeout handling

### `ws/audio.ts`

- Replace scattered command parsing, file-view detection, and prompt building with a single `processVoiceInput()` call
- If `command` is set, handle it and stop (same as today)
- Pass `chatText`, `voiceContext`, and `routingHint` to the provider's `chat()` method
- Net reduction in lines — transport and orchestration logic stays, voice intelligence moves out

### `commands.ts`

Removed. All functionality absorbed into `voice-keywords.ts`.

## File Organization

```
apps/server/src/voice/
├── voice-context.ts          # NEW — shared identity/system prompt builder
├── voice-keywords.ts         # NEW — keyword detection (operational + routing)
├── voice-middleware.ts        # NEW — orchestrates context + keywords
├── environment.ts            # NEW — extracted from anthropic-provider.ts
├── ai-provider.ts            # MODIFIED — VoiceContext in ChatParams
├── anthropic-provider.ts     # MODIFIED — consumes VoiceContext, delegates routing
├── claude-code-provider.ts   # MODIFIED — consumes VoiceContext for system prompt
├── claude.ts                 # UNCHANGED
├── text-filter.ts            # UNCHANGED
├── cost-tracker.ts           # UNCHANGED
├── stt.ts                    # UNCHANGED
├── tts.ts                    # UNCHANGED

apps/server/src/ws/
├── audio.ts                  # MODIFIED — simplified, delegates to voice-middleware
```

## Testing Strategy

All new modules are stateless/pure-function, making them straightforward to unit test.

**`voice-context.ts`:**
- Given environment capabilities, produces expected system prompt with Voice Claude identity
- Prompt includes working directory and environment tools
- Both providers receive identical prompt content

**`voice-keywords.ts`:**
- Operational intents: "show me package.json" → `file-view` intent + correct decoration
- Routing hints: "read the file" → `simple`, "plan a refactor" → `complex`
- Commands: "never mind" → `disregard`, trailing "clear" → `clear`
- Edge cases: no keywords → null hint, multiple intents in one utterance, partial matches

**`voice-middleware.ts`:**
- Integration: raw text in → fully processed `VoiceInput` out
- Decorations correctly appended to `chatText`
- `VoiceContext` always populated

**Provider modifications:**
- AnthropicProvider respects `routingHint` for model selection in auto mode
- ClaudeCodeProvider passes `voiceContext.systemPrompt` to subprocess args
- Both providers continue to pass existing tests with the new interface

## Migration

This is a refactor with behavioral change (Claude Code now identifies as Voice Claude). No database migrations, no breaking API changes, no new environment variables required. The `AI_PROVIDER` env var continues to select the provider. Existing voice commands continue to work. The system prompt content changes for Claude Code mode — this is the intended behavioral change.
