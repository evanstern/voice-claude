# Inline File Display & Immediate Response Rendering

## Problem

Three related issues degrade the experience when Claude shows file contents:

1. **Tool results are hidden behind a click-to-expand dropdown.** `read_file` results require a click to see and are constrained to a 400px scrollable container. File contents should flow naturally in the conversation.
2. **Claude generates verbose descriptions of file contents.** The system prompt tells Claude to "summarize instead" of showing files, so it produces long spoken descriptions even when the user just wants to see the file.
3. **Response text doesn't appear until audio finishes playing.** The conversation entry is only finalized when `audio.phase === 'done'`, which happens after TTS playback completes. Users must wait through the entire audio before seeing text.

## Solution

### Change 1: Tool results open by default for `read_file`

**File:** `apps/web/app/components/chat-message.tsx`

- `ToolCallItem`: Initialize `expanded` state based on tool name. `read_file` starts expanded (`true`), `run_shell` stays collapsed (`false`).
- Remove the `max-h-[400px] overflow-auto` wrapper for `read_file` results. File contents render at full height, flowing naturally in the conversation.
- Keep the toggle button on all tool results so users can collapse if desired.
- Soften the expanded result styling to feel more integrated with the conversation (lighter border treatment, less "widget" feel).

### Change 2: Brief response when showing files

**File:** `apps/server/src/voice/claude.ts`

- Update the system prompt's VOICE RULES section to distinguish between "showing" and "describing" files.
- When the user asks to see/show a file, Claude should respond with a brief acknowledgment (e.g., "Here's package.json") and let the inline tool result speak for itself.
- Claude should not summarize or describe the file contents when the tool result is visible inline.

### Change 3: Show response text immediately

**File:** `apps/web/app/routes/home.tsx`

- Decouple text display from audio completion. Currently, the `pendingEntry` is finalized into the `conversation` array only when `phase === 'done'` (after audio playback).
- Instead, finalize the entry as soon as `claudeResponse` arrives from the WebSocket (the `claude_response` message). This happens before TTS synthesis even starts.
- Audio playback continues independently. The status indicator still tracks the phase for showing synthesizing/speaking states, but the text and tool results are already visible.

## Files Changed

| File | Change |
|---|---|
| `apps/web/app/components/chat-message.tsx` | Expand `read_file` by default, remove scroll constraint, soften styling |
| `apps/server/src/voice/claude.ts` | Update system prompt for brief file-showing responses |
| `apps/web/app/routes/home.tsx` | Finalize entry on `claudeResponse` arrival, not on `phase === 'done'` |

## Testing

- Send "show me package.json" and verify:
  - File contents appear inline immediately, syntax highlighted, no dropdown click needed
  - Claude's spoken/text response is brief ("Here's package.json")
  - Text and file contents appear on screen before/while audio plays
- Send "list the files in src" (a `run_shell` command) and verify:
  - Shell output remains collapsed by default
  - Can still click to expand
- Verify collapsing/expanding toggle works for both tool types
- Verify audio still plays correctly and phase indicator still shows synthesizing/speaking states
