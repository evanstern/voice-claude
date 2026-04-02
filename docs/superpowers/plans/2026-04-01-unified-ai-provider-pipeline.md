# Unified AI Provider Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the API Key and Claude Code AI provider paths with a shared voice middleware layer that gives both providers consistent Voice Claude identity, shared keyword processing, and a common pre-processing pipeline.

**Architecture:** A stateless voice middleware sits between `audio.ts` and the AI providers, orchestrating voice context building (shared identity/system prompt) and keyword processing (operational intents + routing hints). Providers receive structured context; AnthropicProvider uses routing hints for model selection, ClaudeCodeProvider ignores them. Both get identical Voice Claude identity.

**Tech Stack:** TypeScript, Node.js 22+, Vitest (new), Biome

---

## File Structure

```
apps/server/src/voice/
├── voice-context.ts          # NEW — shared identity/system prompt builder
├── voice-keywords.ts         # NEW — keyword detection (operational + routing)
├── voice-middleware.ts        # NEW — orchestrates context + keywords
├── environment.ts            # EXISTS — no changes needed
├── ai-provider.ts            # MODIFY — add VoiceContext to ChatParams
├── anthropic-provider.ts     # MODIFY — consume VoiceContext, delegate model routing
├── claude-code-provider.ts   # MODIFY — consume VoiceContext for system prompt
├── claude.ts                 # MODIFY — pass through VoiceContext + routingHint
├── commands.ts               # DELETE — absorbed into voice-keywords.ts

apps/server/src/ws/
├── audio.ts                  # MODIFY — replace scattered logic with processVoiceInput()

apps/server/
├── vitest.config.ts          # NEW — test configuration
├── src/voice/__tests__/
│   ├── voice-context.test.ts # NEW
│   ├── voice-keywords.test.ts# NEW
│   └── voice-middleware.test.ts # NEW
```

---

### Task 1: Set Up Vitest

The server package has no test runner. We need vitest before writing TDD tests.

**Files:**
- Create: `apps/server/vitest.config.ts`
- Modify: `apps/server/package.json`

- [ ] **Step 1: Install vitest**

Run:
```bash
cd apps/server && pnpm add -D vitest
```

- [ ] **Step 2: Create vitest config**

Create `apps/server/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
})
```

- [ ] **Step 3: Add test script to package.json**

Add to `apps/server/package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify vitest runs (no tests yet)**

Run: `cd apps/server && pnpm test`
Expected: vitest runs and reports "no test files found" or similar clean exit.

- [ ] **Step 5: Commit**

```bash
git add apps/server/vitest.config.ts apps/server/package.json pnpm-lock.yaml
git commit -m "chore(server): add vitest test runner"
```

---

### Task 2: Create Voice Context Builder

Builds the shared Voice Claude identity and voice rules consumed by both providers.

**Files:**
- Create: `apps/server/src/voice/__tests__/voice-context.test.ts`
- Create: `apps/server/src/voice/voice-context.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/server/src/voice/__tests__/voice-context.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { buildVoiceContext } from '../voice-context.js'

describe('buildVoiceContext', () => {
  const defaultOptions = {
    workDir: '/workspace',
    environment: '\nAvailable CLI tools: git (version control), node (Node.js runtime).',
  }

  it('includes Voice Claude identity', () => {
    const ctx = buildVoiceContext(defaultOptions)
    expect(ctx.systemPrompt).toContain('Voice Claude')
    expect(ctx.systemPrompt).toContain('hands-free voice coding assistant')
  })

  it('includes environment capabilities', () => {
    const ctx = buildVoiceContext(defaultOptions)
    expect(ctx.systemPrompt).toContain('git (version control)')
    expect(ctx.systemPrompt).toContain('node (Node.js runtime)')
  })

  it('includes working directory', () => {
    const ctx = buildVoiceContext(defaultOptions)
    expect(ctx.systemPrompt).toContain('/workspace')
  })

  it('includes voice rules', () => {
    const ctx = buildVoiceContext(defaultOptions)
    expect(ctx.voiceRules).toContain('100 words max')
    expect(ctx.systemPrompt).toContain('100 words max')
  })

  it('mentions Claude Code capabilities when provider hint is claude-code', () => {
    const ctx = buildVoiceContext({ ...defaultOptions, providerHint: 'claude-code' })
    expect(ctx.systemPrompt).toContain('Claude Code')
  })

  it('does not mention Claude Code when provider hint is anthropic', () => {
    const ctx = buildVoiceContext({ ...defaultOptions, providerHint: 'anthropic' })
    expect(ctx.systemPrompt).not.toContain('Claude Code')
  })

  it('handles empty environment string', () => {
    const ctx = buildVoiceContext({ ...defaultOptions, environment: '' })
    expect(ctx.systemPrompt).toContain('Voice Claude')
    expect(ctx.systemPrompt).not.toContain('Available CLI tools')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/server && pnpm test`
Expected: FAIL — module `../voice-context.js` not found.

- [ ] **Step 3: Implement voice-context.ts**

Create `apps/server/src/voice/voice-context.ts`:

```typescript
export interface VoiceContext {
  systemPrompt: string
  voiceRules: string[]
}

interface BuildVoiceContextOptions {
  workDir: string
  environment: string
  providerHint?: 'anthropic' | 'claude-code'
}

const VOICE_RULES = [
  '100 words max. Two to three sentences typical.',
  'When the user asks to see or show a file, respond briefly: "Here\'s package.json" or "Here\'s the config file." The file contents are displayed inline in the chat — do not describe, summarize, or read back the contents.',
  'After tool use, report results conversationally: "I found 3 matching files" or "The build succeeded with 2 warnings." Don\'t echo raw output.',
  'No markdown, code blocks, or bullet points — plain spoken language only.',
  'If the user asks for details, give slightly more but still stay concise.',
]

export function buildVoiceContext(options: BuildVoiceContextOptions): VoiceContext {
  const { workDir, environment, providerHint } = options

  const identityLine =
    providerHint === 'claude-code'
      ? 'You are a hands-free voice coding assistant called Voice Claude, powered by Claude Code for code editing and tool use.'
      : 'You are a hands-free voice coding assistant called Voice Claude.'

  const systemPrompt = `${identityLine} You run as a web app that the user accesses from their phone or computer. You can hear them speak through their microphone — their speech is transcribed and sent to you. Your responses are spoken back to them via text-to-speech. This is a live, real-time voice conversation.

When the user says things like "can you hear me" or "are you there", respond naturally — you can hear them. If they ask what you are, explain that you're Voice Claude, a voice interface that can help with coding tasks hands-free.

Input is speech-to-text — interpret generously despite transcription errors.

You have tools for files, shell commands, and git. Use them as needed.${environment}

VOICE RULES (responses are spoken via TTS):
${VOICE_RULES.map((r) => `- ${r}`).join('\n')}

Working directory: ${workDir}`

  return { systemPrompt, voiceRules: VOICE_RULES }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/server && pnpm test`
Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/voice/voice-context.ts apps/server/src/voice/__tests__/voice-context.test.ts
git commit -m "feat(server): add voice context builder for shared AI provider identity"
```

---

### Task 3: Create Keyword Processor

Replaces `commands.ts` with a unified keyword processor that handles commands, operational intents, and routing hints.

**Files:**
- Create: `apps/server/src/voice/__tests__/voice-keywords.test.ts`
- Create: `apps/server/src/voice/voice-keywords.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/server/src/voice/__tests__/voice-keywords.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { processKeywords } from '../voice-keywords.js'

describe('processKeywords', () => {
  describe('commands', () => {
    it('detects trailing "disregard"', () => {
      const result = processKeywords('show me the file disregard')
      expect(result.command).toBe('disregard')
      expect(result.processedText).toBe('show me the file')
    })

    it('detects trailing "never mind"', () => {
      const result = processKeywords('read the config never mind')
      expect(result.command).toBe('disregard')
      expect(result.processedText).toBe('read the config')
    })

    it('detects trailing "cancel"', () => {
      const result = processKeywords('do something cancel')
      expect(result.command).toBe('disregard')
    })

    it('detects trailing "clear"', () => {
      const result = processKeywords('whatever clear')
      expect(result.command).toBe('clear')
    })

    it('detects trailing "reset"', () => {
      const result = processKeywords('stuff reset')
      expect(result.command).toBe('clear')
    })

    it('detects standalone command', () => {
      const result = processKeywords('disregard')
      expect(result.command).toBe('disregard')
      expect(result.processedText).toBe('')
    })

    it('returns null command for normal text', () => {
      const result = processKeywords('show me the package.json')
      expect(result.command).toBeNull()
    })
  })

  describe('operational intents', () => {
    it('detects file-view intent with "show me"', () => {
      const result = processKeywords('show me the package.json file')
      expect(result.operationalIntents).toContain('file-view')
      expect(result.decorations.length).toBeGreaterThan(0)
    })

    it('detects file-view intent with "pull up"', () => {
      const result = processKeywords('pull up the config file')
      expect(result.operationalIntents).toContain('file-view')
    })

    it('detects file-view intent with "what\'s in"', () => {
      const result = processKeywords("what's in the tsconfig file")
      expect(result.operationalIntents).toContain('file-view')
    })

    it('detects file-view intent with file extension', () => {
      const result = processKeywords('show package.json')
      expect(result.operationalIntents).toContain('file-view')
    })

    it('detects health-check intent', () => {
      const result = processKeywords('can you hear me')
      expect(result.operationalIntents).toContain('health-check')
    })

    it('detects health-check with "are you there"', () => {
      const result = processKeywords('are you there')
      expect(result.operationalIntents).toContain('health-check')
    })

    it('returns empty intents for normal text', () => {
      const result = processKeywords('list the files in the src directory')
      expect(result.operationalIntents).toHaveLength(0)
    })
  })

  describe('routing hints', () => {
    it('returns "complex" for planning tasks', () => {
      const result = processKeywords('plan a refactor of the auth module')
      expect(result.routingHint).toBe('complex')
    })

    it('returns "complex" for implementation tasks', () => {
      const result = processKeywords('implement a new login endpoint')
      expect(result.routingHint).toBe('complex')
    })

    it('returns "complex" for debugging tasks', () => {
      const result = processKeywords('debug the failing test in auth')
      expect(result.routingHint).toBe('complex')
    })

    it('returns "complex" for refactoring', () => {
      const result = processKeywords('refactor the database module')
      expect(result.routingHint).toBe('complex')
    })

    it('returns "complex" for architecture tasks', () => {
      const result = processKeywords('architect a new microservice')
      expect(result.routingHint).toBe('complex')
    })

    it('returns null for simple queries', () => {
      const result = processKeywords('what time is it')
      expect(result.routingHint).toBeNull()
    })

    it('returns null when command is detected (command takes priority)', () => {
      const result = processKeywords('refactor the code disregard')
      expect(result.command).toBe('disregard')
      expect(result.routingHint).toBeNull()
    })
  })

  describe('decorations', () => {
    it('appends file-view instruction to decorations', () => {
      const result = processKeywords('show me the package.json file')
      expect(result.decorations[0]).toContain('file contents will be displayed inline')
    })

    it('appends health-check instruction to decorations', () => {
      const result = processKeywords('can you hear me')
      expect(result.decorations[0]).toContain('confirming you can hear')
    })

    it('has no decorations for normal text', () => {
      const result = processKeywords('tell me about the project')
      expect(result.decorations).toHaveLength(0)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/server && pnpm test`
Expected: FAIL — module `../voice-keywords.js` not found.

- [ ] **Step 3: Implement voice-keywords.ts**

Create `apps/server/src/voice/voice-keywords.ts`:

```typescript
export type VoiceCommandType = 'disregard' | 'clear'
export type OperationalIntent = 'file-view' | 'health-check'
export type RoutingHint = 'simple' | 'complex'

export interface KeywordResult {
  command: VoiceCommandType | null
  operationalIntents: OperationalIntent[]
  routingHint: RoutingHint | null
  processedText: string
  decorations: string[]
}

// --- Command detection (trailing keywords) ---

interface CommandDefinition {
  type: VoiceCommandType
  keywords: string[]
}

const COMMANDS: CommandDefinition[] = [
  {
    type: 'disregard',
    keywords: ['disregard', 'never mind', 'nevermind', 'cancel'],
  },
  {
    type: 'clear',
    keywords: ['clear', 'reset'],
  },
]

function detectCommand(text: string): { command: VoiceCommandType | null; stripped: string } {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()

  for (const def of COMMANDS) {
    for (const keyword of def.keywords) {
      if (lower === keyword) {
        return { command: def.type, stripped: '' }
      }
      const suffix = ` ${keyword}`
      if (lower.endsWith(suffix)) {
        const stripped = trimmed.slice(0, trimmed.length - suffix.length).trim()
        return { command: def.type, stripped }
      }
    }
  }

  return { command: null, stripped: trimmed }
}

// --- Operational intent detection ---

const FILE_VIEW_PATTERNS = [
  /\b(show|open|display|view|see|read|cat|print|look at)\b.*\b(file|contents?|code|package\.json|tsconfig|config|readme|makefile|dockerfile)\b/i,
  /\b(what'?s in|what does|can i see|let me see|pull up)\b.*\b(file|the)\b/i,
  /\b(show|open|display|view|see|read|cat)\b\s+\S+\.\w{1,5}\s*$/i,
]

const HEALTH_CHECK_PATTERNS = [
  /\bcan you hear me\b/i,
  /\bare you there\b/i,
  /\bare you listening\b/i,
  /\bis this (thing )?working\b/i,
]

interface IntentDefinition {
  intent: OperationalIntent
  patterns: RegExp[]
  decoration: string
}

const INTENTS: IntentDefinition[] = [
  {
    intent: 'file-view',
    patterns: FILE_VIEW_PATTERNS,
    decoration:
      '[SYSTEM: The file contents will be displayed inline in the chat UI. Just read the file and say "Here\'s [filename]." Do NOT describe, summarize, or explain the contents. One sentence max.]',
  },
  {
    intent: 'health-check',
    patterns: HEALTH_CHECK_PATTERNS,
    decoration:
      '[SYSTEM: Respond briefly confirming you can hear the user. One short sentence.]',
  },
]

function detectIntents(text: string): { intents: OperationalIntent[]; decorations: string[] } {
  const intents: OperationalIntent[] = []
  const decorations: string[] = []

  for (const def of INTENTS) {
    if (def.patterns.some((p) => p.test(text))) {
      intents.push(def.intent)
      decorations.push(def.decoration)
    }
  }

  return { intents, decorations }
}

// --- Routing hint detection ---

const COMPLEX_TASK_PHRASES = [
  'refactor',
  'implement',
  'debug the',
  'fix the bug',
  'fix the error',
  'rewrite',
  'redesign',
  'architect',
  'write a',
  'write the',
  'create a new',
  'build the',
  'deploy',
  'migrate',
  'explain the code',
  'explain how',
  'review the code',
  'code review',
  'plan',
]

function detectRoutingHint(text: string): RoutingHint | null {
  const lower = text.toLowerCase()
  if (COMPLEX_TASK_PHRASES.some((phrase) => lower.includes(phrase))) {
    return 'complex'
  }
  return null
}

// --- Main processor ---

export function processKeywords(text: string): KeywordResult {
  const { command, stripped } = detectCommand(text)

  // If a command was detected, skip intent and routing analysis
  if (command) {
    return {
      command,
      operationalIntents: [],
      routingHint: null,
      processedText: stripped,
      decorations: [],
    }
  }

  const { intents, decorations } = detectIntents(stripped)
  const routingHint = detectRoutingHint(stripped)

  return {
    command: null,
    operationalIntents: intents,
    routingHint,
    processedText: stripped,
    decorations,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/server && pnpm test`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/voice/voice-keywords.ts apps/server/src/voice/__tests__/voice-keywords.test.ts
git commit -m "feat(server): add keyword processor for commands, intents, and routing"
```

---

### Task 4: Create Voice Middleware

Orchestrates context building and keyword processing into a single pre-processing call.

**Files:**
- Create: `apps/server/src/voice/__tests__/voice-middleware.test.ts`
- Create: `apps/server/src/voice/voice-middleware.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/server/src/voice/__tests__/voice-middleware.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'

// Mock the environment module to avoid actual shell calls
vi.mock('../environment.js', () => ({
  discoverEnvironment: vi.fn().mockResolvedValue(
    '\nAvailable CLI tools: git (version control).',
  ),
}))

import { processVoiceInput } from '../voice-middleware.js'

describe('processVoiceInput', () => {
  const defaultInput = {
    rawText: 'show me the package.json file',
    sessionId: 'test-session',
    provider: 'anthropic' as const,
  }

  it('returns voice context with system prompt', async () => {
    const result = await processVoiceInput(defaultInput)
    expect(result.voiceContext.systemPrompt).toContain('Voice Claude')
  })

  it('processes keywords and returns intents', async () => {
    const result = await processVoiceInput(defaultInput)
    expect(result.operationalIntents).toContain('file-view')
  })

  it('appends decorations to chatText', async () => {
    const result = await processVoiceInput(defaultInput)
    expect(result.chatText).toContain('show me the package.json file')
    expect(result.chatText).toContain('[SYSTEM:')
  })

  it('detects commands and short-circuits', async () => {
    const result = await processVoiceInput({
      ...defaultInput,
      rawText: 'something disregard',
    })
    expect(result.command).toBe('disregard')
    expect(result.operationalIntents).toHaveLength(0)
  })

  it('includes routing hint for complex tasks', async () => {
    const result = await processVoiceInput({
      ...defaultInput,
      rawText: 'refactor the auth module',
    })
    expect(result.routingHint).toBe('complex')
  })

  it('passes provider hint to voice context', async () => {
    const result = await processVoiceInput({
      ...defaultInput,
      provider: 'claude-code',
    })
    expect(result.voiceContext.systemPrompt).toContain('Claude Code')
  })

  it('does not mention Claude Code for anthropic provider', async () => {
    const result = await processVoiceInput({
      ...defaultInput,
      provider: 'anthropic',
    })
    expect(result.voiceContext.systemPrompt).not.toContain('Claude Code')
  })

  it('separates displayText (clean) from chatText (with decorations)', async () => {
    const result = await processVoiceInput(defaultInput)
    expect(result.displayText).toBe('show me the package.json file')
    expect(result.chatText).toContain('[SYSTEM:')
  })

  it('returns matching displayText and chatText when no decorations', async () => {
    const result = await processVoiceInput({
      ...defaultInput,
      rawText: 'tell me about the project',
    })
    expect(result.displayText).toBe('tell me about the project')
    expect(result.chatText).toBe('tell me about the project')
    expect(result.command).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/server && pnpm test`
Expected: FAIL — module `../voice-middleware.js` not found.

- [ ] **Step 3: Implement voice-middleware.ts**

Create `apps/server/src/voice/voice-middleware.ts`:

```typescript
import { discoverEnvironment } from './environment.js'
import { type VoiceContext, buildVoiceContext } from './voice-context.js'
import {
  type OperationalIntent,
  type RoutingHint,
  type VoiceCommandType,
  processKeywords,
} from './voice-keywords.js'

export type { VoiceContext, OperationalIntent, RoutingHint, VoiceCommandType }

export interface VoiceInput {
  command: VoiceCommandType | null
  /** The clean user text with command keywords stripped (no decorations). Use for display and storage. */
  displayText: string
  /** The text to send to the AI provider, including any system decorations. */
  chatText: string
  voiceContext: VoiceContext
  routingHint: RoutingHint | null
  operationalIntents: OperationalIntent[]
}

interface ProcessVoiceInputParams {
  rawText: string
  sessionId: string
  provider: 'anthropic' | 'claude-code'
}

const WORK_DIR = process.env.WORK_DIR ?? process.cwd()

export async function processVoiceInput(params: ProcessVoiceInputParams): Promise<VoiceInput> {
  const { rawText, provider } = params

  // Build shared voice context (cached environment discovery)
  const environment = await discoverEnvironment()
  const voiceContext = buildVoiceContext({
    workDir: WORK_DIR,
    environment,
    providerHint: provider,
  })

  // Process keywords
  const keywords = processKeywords(rawText)

  // If command detected, return early with minimal result
  if (keywords.command) {
    return {
      command: keywords.command,
      displayText: keywords.processedText,
      chatText: keywords.processedText,
      voiceContext,
      routingHint: null,
      operationalIntents: [],
    }
  }

  // Build chatText by appending any decorations
  let chatText = keywords.processedText
  if (keywords.decorations.length > 0) {
    chatText += '\n\n' + keywords.decorations.join('\n\n')
  }

  return {
    command: null,
    displayText: keywords.processedText,
    chatText,
    voiceContext,
    routingHint: keywords.routingHint,
    operationalIntents: keywords.operationalIntents,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/server && pnpm test`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/voice/voice-middleware.ts apps/server/src/voice/__tests__/voice-middleware.test.ts
git commit -m "feat(server): add voice middleware orchestrating context and keywords"
```

---

### Task 5: Update AIProvider Interface and claude.ts Wrapper

Add `voiceContext` and `routingHint` to `ChatParams` and update the thin wrapper.

**Files:**
- Modify: `apps/server/src/voice/ai-provider.ts:17-22`
- Modify: `apps/server/src/voice/claude.ts`

- [ ] **Step 1: Update ChatParams in ai-provider.ts**

In `apps/server/src/voice/ai-provider.ts`, replace the `ChatParams` interface (lines 17-22):

```typescript
export interface ChatParams {
  sessionId: string
  userText: string
  onToolUse?: (name: string, input: string) => void
  signal?: AbortSignal
}
```

With:

```typescript
export interface ChatParams {
  sessionId: string
  userText: string
  voiceContext?: VoiceContext
  routingHint?: 'simple' | 'complex' | null
  onToolUse?: (name: string, input: string) => void
  signal?: AbortSignal
}
```

Add the import at the top of `ai-provider.ts`:

```typescript
import type { VoiceContext } from './voice-context.js'
```

- [ ] **Step 2: Update claude.ts to pass through new params**

Replace the entire contents of `apps/server/src/voice/claude.ts`:

```typescript
// Thin wrapper that delegates to the configured AI provider.
// Preserves the original export signatures so audio.ts can migrate incrementally.

import { type ChatParams, type ChatResponse, getAIProvider } from './ai-provider.js'
import type { VoiceContext } from './voice-context.js'

export type { ChatResponse as ClaudeResponse }
export type ClaudeUsageResult = ChatResponse['usage']

export async function chat(
  sessionId: string,
  userText: string,
  onToolUse?: (name: string, input: string) => void,
  signal?: AbortSignal,
  voiceContext?: VoiceContext,
  routingHint?: ChatParams['routingHint'],
): Promise<ChatResponse> {
  return getAIProvider().chat({
    sessionId,
    userText,
    voiceContext,
    routingHint,
    onToolUse,
    signal,
  })
}

export function clearSession(sessionId: string): void {
  getAIProvider().clearSession(sessionId)
}

export function restoreSession(
  sessionId: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): void {
  getAIProvider().restoreSession(sessionId, history)
}
```

- [ ] **Step 3: Run typecheck to verify no type errors**

Run: `cd apps/server && pnpm typecheck`
Expected: No errors. The new optional params are backwards-compatible.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/voice/ai-provider.ts apps/server/src/voice/claude.ts
git commit -m "feat(server): add voiceContext and routingHint to ChatParams"
```

---

### Task 6: Update AnthropicProvider to Consume VoiceContext

Remove the hardcoded system prompt and use the voice context. Use routingHint for model selection.

**Files:**
- Modify: `apps/server/src/voice/anthropic-provider.ts`

- [ ] **Step 1: Remove getSystemPrompt and use voiceContext**

In `apps/server/src/voice/anthropic-provider.ts`:

1. Remove the `_systemPrompt` variable (line 125) and entire `getSystemPrompt()` function (lines 127-152). Also remove the `COMPLEX_TASK_PHRASES` array (lines 27-46) and `looksLikeComplexTask` function (lines 48-51) since routing is now handled by the middleware.

2. Update the `pickModel` function to accept a routing hint instead of analyzing text:

Replace:
```typescript
const COMPLEX_TASK_PHRASES = [
  'refactor',
  'implement',
  'debug the',
  'fix the bug',
  'fix the error',
  'rewrite',
  'redesign',
  'architect',
  'write a',
  'write the',
  'create a new',
  'build the',
  'deploy',
  'migrate',
  'explain the code',
  'explain how',
  'review the code',
  'code review',
]

function looksLikeComplexTask(text: string): boolean {
  const lower = text.toLowerCase()
  return COMPLEX_TASK_PHRASES.some((phrase) => lower.includes(phrase))
}
```

With:
```typescript
// Model routing now driven by middleware routingHint
```

Replace the `pickModel` function:
```typescript
function pickModel(_sessionId: string, userText: string): string {
  const mode = getModelMode()

  if (mode === 'sonnet') return MODEL_SONNET
  if (mode === 'haiku') return MODEL_HAIKU

  if (looksLikeComplexTask(userText)) {
    return MODEL_SONNET
  }

  return MODEL_HAIKU
}
```

With:
```typescript
function pickModel(routingHint?: 'simple' | 'complex' | null): string {
  const mode = getModelMode()

  if (mode === 'sonnet') return MODEL_SONNET
  if (mode === 'haiku') return MODEL_HAIKU

  if (routingHint === 'complex') {
    return MODEL_SONNET
  }

  return MODEL_HAIKU
}
```

3. Remove `_systemPrompt` and `getSystemPrompt`:

Delete lines 125-152 (the `_systemPrompt` variable and `getSystemPrompt` function).

4. Update the `chat` method to use `voiceContext`:

Change line 309 from:
```typescript
let model = pickModel(sessionId, userText)
```
To:
```typescript
let model = pickModel(params.routingHint)
```

Change the system parameter in the API call (lines 353-359) from:
```typescript
system: [
  {
    type: 'text',
    text: await getSystemPrompt(),
    cache_control: { type: 'ephemeral' },
  },
],
```
To:
```typescript
system: params.voiceContext
  ? [
      {
        type: 'text',
        text: params.voiceContext.systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ]
  : [],
```

5. Remove the unused import of `discoverEnvironment` from the top of the file since it's now consumed via voice-context.ts. The import on line 10:
```typescript
import { discoverEnvironment } from './environment.js'
```
Remove this line.

- [ ] **Step 2: Run typecheck**

Run: `cd apps/server && pnpm typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/voice/anthropic-provider.ts
git commit -m "refactor(server): AnthropicProvider consumes VoiceContext and routingHint"
```

---

### Task 7: Update ClaudeCodeProvider to Consume VoiceContext

Replace the hardcoded `VOICE_SYSTEM_PROMPT` with the shared voice context.

**Files:**
- Modify: `apps/server/src/voice/claude-code-provider.ts`

- [ ] **Step 1: Remove VOICE_SYSTEM_PROMPT and use voiceContext**

In `apps/server/src/voice/claude-code-provider.ts`:

1. Remove the `VOICE_SYSTEM_PROMPT` constant (lines 11-18).

2. Update the `chat` method to use `params.voiceContext`. Replace the args construction (lines 39-54):

```typescript
const args = [
  '-p',
  params.userText,
  '--output-format',
  'stream-json',
  '--verbose',
  // First call: create session with --session-id
  // Subsequent calls: resume with --resume to continue conversation
  ...(isFirstCall
    ? ['--session-id', ccSessionId]
    : ['--resume', ccSessionId]),
  '--permission-mode',
  process.env.CLAUDE_CODE_PERMISSION_MODE ?? 'bypassPermissions',
  '--append-system-prompt',
  VOICE_SYSTEM_PROMPT,
]
```

With:

```typescript
const systemPrompt = params.voiceContext?.systemPrompt ?? ''

const args = [
  '-p',
  params.userText,
  '--output-format',
  'stream-json',
  '--verbose',
  ...(isFirstCall
    ? ['--session-id', ccSessionId]
    : ['--resume', ccSessionId]),
  '--permission-mode',
  process.env.CLAUDE_CODE_PERMISSION_MODE ?? 'bypassPermissions',
  ...(systemPrompt
    ? ['--append-system-prompt', systemPrompt]
    : []),
]
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/server && pnpm typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/voice/claude-code-provider.ts
git commit -m "refactor(server): ClaudeCodeProvider consumes shared VoiceContext"
```

---

### Task 8: Wire Up audio.ts to Use Voice Middleware

Replace the scattered command parsing and file-view detection in `audio.ts` with a single `processVoiceInput()` call.

**Files:**
- Modify: `apps/server/src/ws/audio.ts`

- [ ] **Step 1: Update imports**

In `apps/server/src/ws/audio.ts`, replace the imports on lines 15-16:

```typescript
import { chat, clearSession, restoreSession } from '../voice/claude.js'
import { looksLikeFileView, parseCommand } from '../voice/commands.js'
```

With:

```typescript
import { chat, clearSession, restoreSession } from '../voice/claude.js'
import { getAIProvider } from '../voice/ai-provider.js'
import { processVoiceInput } from '../voice/voice-middleware.js'
```

- [ ] **Step 2: Replace command parsing and file-view detection in handleControl**

In the `'stop'` case of `handleControl`, replace lines 322-373 (from `// Check for voice commands` through the `looksLikeFileView` block):

```typescript
// Check for voice commands before sending to Claude
const { command, text: cleanedText } = parseCommand(userText)

if (command === 'disregard') {
  log.info('voice command: disregard, dropping message')
  send(ws, { type: 'transcription', text: userText })
  send(ws, { type: 'command', command: 'disregard' })
  clearAbort()
  break
}

if (command === 'clear') {
  log.info(
    { session: sessionId.slice(0, 8) },
    'voice command: clear, resetting session',
  )
  clearSession(sessionId)
  send(ws, { type: 'transcription', text: userText })
  send(ws, { type: 'command', command: 'clear' })
  clearAbort()
  break
}

// Use the cleaned text (command keyword stripped) going forward
userText = cleanedText

send(ws, { type: 'transcription', text: userText })

if (!userText) {
  clearAbort()
  break
}

// Persist user message
if (conversationId) {
  await appendMessage(conversationId, { role: 'user', content: userText })
  if (isFirstMessage) {
    await autoTitle(conversationId, userText)
    setFirstMessage(false)
  }
}

// Phase 2: Send to Claude
send(ws, { type: 'thinking' })

// Detect file-viewing intent and append a terse instruction
let chatText = userText
if (looksLikeFileView(userText)) {
  log.debug('detected file-view intent')
  chatText +=
    '\n\n[SYSTEM: The file contents will be displayed inline in the chat UI. Just read the file and say "Here\'s [filename]." Do NOT describe, summarize, or explain the contents. One sentence max.]'
}
```

With:

```typescript
// Process voice input through middleware
const providerName = getAIProvider().name as 'anthropic' | 'claude-code'
const voiceInput = await processVoiceInput({
  rawText: userText,
  sessionId,
  provider: providerName,
})

if (voiceInput.command === 'disregard') {
  log.info('voice command: disregard, dropping message')
  send(ws, { type: 'transcription', text: userText })
  send(ws, { type: 'command', command: 'disregard' })
  clearAbort()
  break
}

if (voiceInput.command === 'clear') {
  log.info(
    { session: sessionId.slice(0, 8) },
    'voice command: clear, resetting session',
  )
  clearSession(sessionId)
  send(ws, { type: 'transcription', text: userText })
  send(ws, { type: 'command', command: 'clear' })
  clearAbort()
  break
}

send(ws, { type: 'transcription', text: voiceInput.displayText })

if (!voiceInput.displayText) {
  clearAbort()
  break
}

// Persist user message (clean text without system decorations)
if (conversationId) {
  await appendMessage(conversationId, { role: 'user', content: voiceInput.displayText })
  if (isFirstMessage) {
    await autoTitle(conversationId, voiceInput.displayText)
    setFirstMessage(false)
  }
}

// Phase 2: Send to Claude
send(ws, { type: 'thinking' })

if (voiceInput.operationalIntents.length > 0) {
  log.debug({ intents: voiceInput.operationalIntents }, 'detected operational intents')
}
```

- [ ] **Step 3: Update the chat() call to pass voiceContext and routingHint**

Replace the `chat()` call (lines 376-383):

```typescript
const response = await chat(
  sessionId,
  chatText,
  (toolName, toolInput) => {
    send(ws, { type: 'tool_use', name: toolName, input: toolInput })
  },
  signal,
)
```

With:

```typescript
const response = await chat(
  sessionId,
  voiceInput.chatText,
  (toolName, toolInput) => {
    send(ws, { type: 'tool_use', name: toolName, input: toolInput })
  },
  signal,
  voiceInput.voiceContext,
  voiceInput.routingHint,
)
```

- [ ] **Step 4: Run typecheck**

Run: `cd apps/server && pnpm typecheck`
Expected: No errors.

- [ ] **Step 5: Run lint**

Run: `cd apps/server && pnpm lint`
Expected: Clean or only pre-existing warnings.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/ws/audio.ts
git commit -m "refactor(server): wire audio.ts to voice middleware pipeline"
```

---

### Task 9: Delete commands.ts

Now that all functionality is absorbed into `voice-keywords.ts`, remove the old module.

**Files:**
- Delete: `apps/server/src/voice/commands.ts`

- [ ] **Step 1: Verify no remaining imports of commands.ts**

Run: `grep -r "from.*commands" apps/server/src/`
Expected: No matches (audio.ts was updated in Task 8).

- [ ] **Step 2: Delete commands.ts**

```bash
rm apps/server/src/voice/commands.ts
```

- [ ] **Step 3: Run typecheck to confirm nothing breaks**

Run: `cd apps/server && pnpm typecheck`
Expected: No errors.

- [ ] **Step 4: Run all tests**

Run: `cd apps/server && pnpm test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A apps/server/src/voice/commands.ts
git commit -m "refactor(server): remove commands.ts, absorbed into voice-keywords"
```

---

### Task 10: Final Verification

Run the full build pipeline to ensure everything works end-to-end.

**Files:** None — verification only.

- [ ] **Step 1: Run all tests**

Run: `cd apps/server && pnpm test`
Expected: All tests pass.

- [ ] **Step 2: Run typecheck across entire monorepo**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 3: Run lint across entire monorepo**

Run: `pnpm lint`
Expected: Clean or only pre-existing warnings.

- [ ] **Step 4: Run build**

Run: `pnpm build`
Expected: Successful build.

- [ ] **Step 5: Commit any lint/format fixes if needed**

If biome auto-fixed anything:
```bash
git add -A
git commit -m "style: format changes from biome"
```
