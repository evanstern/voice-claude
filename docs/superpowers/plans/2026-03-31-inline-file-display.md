# Inline File Display & Immediate Response Rendering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show file contents inline (expanded, no scroll cap), display response text immediately while audio plays, and make Claude respond briefly when showing files.

**Architecture:** Three independent, targeted changes: (1) UI component tweak to expand `read_file` results by default with no height cap, (2) system prompt update for file-showing behavior, (3) decouple text display from audio completion in the home route's state management.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, react-syntax-highlighter, Hono WebSocket

---

### Task 1: Expand `read_file` tool results by default

**Files:**
- Modify: `apps/web/app/components/chat-message.tsx:62-121`

- [ ] **Step 1: Change `expanded` default based on tool name**

In `ToolCallItem`, change the `useState` initialization to check if the tool is `read_file`:

```tsx
function ToolCallItem({ toolCall }: { toolCall: ToolCall }) {
  const isFileRead = toolCall.name === 'read_file'
  const [expanded, setExpanded] = useState(isFileRead)
```

- [ ] **Step 2: Remove max-height scroll constraint for `read_file`**

Replace the expanded result container to conditionally apply the scroll constraint. `read_file` results flow at full height; `run_shell` results keep the 400px cap:

```tsx
      {expanded && hasResult && (
        <div className="mt-1.5 rounded-lg overflow-hidden border border-border/60">
          <div className={isFileRead ? '' : 'max-h-[400px] overflow-auto'}>
            <SyntaxHighlighter
              language={language}
              style={oneDark}
              customStyle={{
                margin: 0,
                fontSize: '0.75rem',
                borderRadius: 0,
              }}
              showLineNumbers
            >
              {toolCall.result}
            </SyntaxHighlighter>
          </div>
        </div>
      )}
```

Note the border class changed from `border-border` to `border-border/60` for a softer look.

- [ ] **Step 3: Verify in browser**

Run: `pnpm dev`

Test manually:
1. Ask Claude "show me the package.json file" — verify the file appears expanded inline with syntax highlighting, no scroll constraint, no click needed.
2. Ask Claude "list the files in apps/server/src" — verify the shell output appears collapsed behind the toggle button.
3. Click the toggle on the `read_file` result — verify it collapses. Click again — verify it expands.
4. Click the toggle on the `run_shell` result — verify it expands within the 400px scroll container.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/chat-message.tsx
git commit -m "feat: expand read_file tool results by default with no scroll cap"
```

---

### Task 2: Update system prompt for brief file responses

**Files:**
- Modify: `apps/server/src/voice/claude.ts:149-164`

- [ ] **Step 1: Update the VOICE RULES in the system prompt**

Replace the current VOICE RULES block in the `getSystemPrompt` function:

```typescript
  _systemPrompt = `You are a hands-free voice coding assistant called Voice Claude. You run as a web app that the user accesses from their phone or computer. You can hear them speak through their microphone — their speech is transcribed and sent to you. Your responses are spoken back to them via text-to-speech. This is a live, real-time voice conversation.

When the user says things like "can you hear me" or "are you there", respond naturally — you can hear them. If they ask what you are, explain that you're a voice interface for Claude that can help with coding tasks hands-free.

Input is speech-to-text — interpret generously despite transcription errors.

You have tools for files, shell commands, and git. Use them as needed.${envCapabilities}

VOICE RULES (responses are spoken via TTS):
- 100 words max. Two to three sentences typical.
- When the user asks to see or show a file, respond briefly: "Here's package.json" or "Here's the config file." The file contents are displayed inline in the chat — do not describe, summarize, or read back the contents.
- After tool use, report results conversationally: "I found 3 matching files" or "The build succeeded with 2 warnings." Don't echo raw output.
- No markdown, code blocks, or bullet points — plain spoken language only.
- If the user asks for details, give slightly more but still stay concise.

Working directory: ${WORK_DIR}`
```

The key change is replacing "Never read back file contents, code, or long lists. Summarize instead" with the new rule that distinguishes showing files (brief acknowledgment) from other tool use (conversational summary).

- [ ] **Step 2: Clear the cached system prompt**

The system prompt is cached in `_systemPrompt`. Since it's a module-level variable that's set once, a server restart is needed. The dev server auto-restarts on file save, so this happens automatically.

- [ ] **Step 3: Verify in browser**

Run: `pnpm dev` (if not already running, restart the server)

Test manually:
1. Ask Claude "show me package.json" — verify Claude responds with something brief like "Here's package.json" instead of a long description.
2. Ask Claude "how many dependencies are in package.json" — verify Claude still summarizes conversationally ("There are 12 dependencies").

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/voice/claude.ts
git commit -m "feat: update system prompt for brief responses when showing files"
```

---

### Task 3: Show response text immediately (before audio finishes)

**Files:**
- Modify: `apps/web/app/routes/home.tsx:280-306`

- [ ] **Step 1: Replace the phase-gated finalization effect**

The current effect at lines 280-306 waits for `phase === 'done'` to finalize the entry. Replace it with two separate effects:

**Effect A — Finalize entry when Claude responds (not when audio finishes):**

```tsx
  // When Claude responds, finalize the entry immediately so text appears in chat
  // while TTS audio continues playing in the background.
  const prevClaudeResponseRef = useRef<string | null>(null)
  useEffect(() => {
    const hasNewResponse =
      audio.claudeResponse !== null &&
      audio.claudeResponse !== prevClaudeResponseRef.current

    const hasNewError =
      audio.claudeError !== null &&
      audio.claudeError !== prevClaudeResponseRef.current

    if ((hasNewResponse || hasNewError) && pendingEntry) {
      prevClaudeResponseRef.current = audio.claudeResponse ?? audio.claudeError
      const finalized: ConversationEntry = {
        ...pendingEntry,
        assistantText: audio.claudeResponse,
        assistantError: audio.claudeError,
        toolCalls:
          audio.toolCalls.length > 0 ? [...audio.toolCalls] : undefined,
      }
      setConversation((prev) => [...prev, finalized])
      setPendingEntry(null)
      isFirstMessageRef.current = false
      refreshConversations()
    }
  }, [
    audio.claudeResponse,
    audio.claudeError,
    audio.toolCalls,
    pendingEntry,
    refreshConversations,
  ])
```

**Effect B — Track phase for the ref (used by sound effects):**

```tsx
  // Keep phaseRef in sync (used by sound effects and other phase-dependent logic)
  useEffect(() => {
    phaseRef.current = audio.phase
  }, [audio.phase])
```

This replaces the entire existing effect block from lines 280-306.

- [ ] **Step 2: Verify in browser**

Run: `pnpm dev`

Test manually:
1. Ask Claude anything — verify the response text appears in the chat immediately, before audio finishes playing.
2. Verify audio still plays correctly to completion.
3. Verify the status indicator still shows "synthesizing" and "speaking" phases.
4. Verify the sound effects (recording started, message sent, thinking pulse) still work.
5. Ask a follow-up question after the first one — verify conversation history accumulates correctly.
6. Refresh the page and navigate to the conversation — verify persisted messages load correctly.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/routes/home.tsx
git commit -m "feat: display response text immediately while audio plays"
```

---

### Task 4: Run lint and typecheck

- [ ] **Step 1: Run lint**

```bash
pnpm lint
```

Expected: No errors in the changed files.

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: No type errors.

- [ ] **Step 3: Fix any issues and commit if needed**

If lint or typecheck report issues in the changed files, fix them and commit:

```bash
git add -A
git commit -m "fix: resolve lint/typecheck issues"
```
