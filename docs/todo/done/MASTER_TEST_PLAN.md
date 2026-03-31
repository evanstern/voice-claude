# Master Test Plan

Consolidated test plan covering PRs #11-#20. Designed to be walked through with an AI agent.

## Prerequisites

- Node.js 22+, pnpm 9.15+
- `.env` populated with `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
- `pnpm install && pnpm build` succeeds
- Server running on :4000, web on :3000 (`pnpm dev`)
- A browser (phone or desktop) pointed at the web app
- Server logs visible in terminal

---

## 1. Core Voice Loop

These tests verify the basic speak-to-hear pipeline works end to end.

### 1.1 Simple question (PR #11, #14)
- [ ] Ask a simple question ("what's the weather like?" or "tell me a joke")
- [ ] Response should be **~100 words**, conversational tone, no bullet points or markdown
- [ ] Server logs should show **Haiku** was selected (model routing)

### 1.2 Tool-triggering question (PR #11, #14)
- [ ] Ask a tool question ("what files are in this directory?")
- [ ] Response should **summarize** results ("I found 3 files..."), not list them verbatim
- [ ] Server logs should show **Sonnet** was selected

### 1.3 File read (PR #11, #12)
- [ ] Ask Claude to read a file ("read the package.json")
- [ ] TTS should say something like "code omitted" — should NOT read raw file contents aloud
- [ ] Response should describe the file, not dump it

### 1.4 Code-only response (PR #12)
- [ ] Ask for only code ("write a hello world function")
- [ ] Should hear "Here's the code you asked for" or similar — not the actual code

---

## 2. Model Routing (PR #14)

### 2.1 Auto mode (default)
- [ ] Simple question uses Haiku (check server logs for model selection)
- [ ] Tool question uses Sonnet (check server logs)

### 2.2 Forced Sonnet
- [ ] Set `CLAUDE_MODEL=sonnet` in `.env`, restart server
- [ ] Simple question now uses Sonnet (check logs)

### 2.3 Forced Haiku
- [ ] Set `CLAUDE_MODEL=haiku` in `.env`, restart server
- [ ] All questions use Haiku (check logs)

### 2.4 Escalation
- [ ] In auto mode, if Haiku tries tool_use, server should replay with Sonnet (check logs for escalation message)

**Cleanup:** Reset `CLAUDE_MODEL=auto` (or remove) and restart.

---

## 3. Prompt Caching (PR #13)

### 3.1 Cache creation
- [ ] Restart server (fresh session)
- [ ] First voice request — server logs show `cache_creation_input_tokens` > 0

### 3.2 Cache hit
- [ ] Second request in same session — server logs show `cache_read_input_tokens` > 0
- [ ] Response quality is unchanged

---

## 4. Cost Tracking (PR #15)

### 4.1 Per-interaction logging
- [ ] Make a voice interaction
- [ ] Server logs show a one-line cost summary (STT, Claude, TTS costs)

### 4.2 Stats endpoint
- [ ] Hit `http://localhost:4000/trpc/stats` (GET) in a browser or curl
- [ ] Returns JSON with interaction count, per-service cost breakdown, and averages

### 4.3 Accumulation
- [ ] Make 2-3 voice interactions
- [ ] Stats endpoint shows accumulated totals increasing correctly

### 4.4 Tool-use cost tracking
- [ ] Ask a question that triggers tools
- [ ] Stats should reflect both API calls in the usage

---

## 5. TTS Providers (PR #16, #18)

### 5.1 OpenAI TTS (default)
- [ ] No `TTS_PROVIDER` set (or `TTS_PROVIDER=openai`)
- [ ] Voice responses play back normally
- [ ] Server logs show `[tts] using provider: openai`

### 5.2 Google Cloud TTS (PR #16)
- [ ] Set `TTS_PROVIDER=google` with valid Google Cloud credentials
- [ ] Voice responses play back (may sound different)
- [ ] Server logs show `[tts] using provider: google`

### 5.3 Piper TTS — local (PR #18, OPEN)
- [ ] Set `TTS_PROVIDER=piper` with piper binary + model installed
- [ ] Voice responses synthesize locally
- [ ] Default unchanged when switching back

---

## 6. STT Providers (PR #17)

### 6.1 OpenAI Whisper (default)
- [ ] No `STT_PROVIDER` set (or `STT_PROVIDER=openai`)
- [ ] Speech transcription works as before

### 6.2 Local Whisper (whisper-cpp)
- [ ] Set `STT_PROVIDER=local` with whisper-cpp and model installed
- [ ] Speech transcribes locally (may be slower)

---

## 7. Always-Listening / VAD (PR #19, OPEN)

### 7.1 Push-to-talk (default)
- [ ] Default mode — hold/tap mic button to record, release to send
- [ ] Works exactly as before

### 7.2 Auto mode
- [ ] Toggle to auto mode in the UI
- [ ] Mic opens and stays open (green listening indicator visible)
- [ ] Speak, then pause ~1.5 seconds — audio sends automatically
- [ ] Response plays back, then mic reopens for next utterance

---

## 8. Conversation Persistence (PR #20, OPEN)

### 8.1 UI elements
- [ ] Hamburger menu appears in the header
- [ ] Tapping it opens a conversation drawer/panel

### 8.2 Auto-save
- [ ] Send a voice message
- [ ] Check `data/conversations/` on disk — JSONL file created
- [ ] Open drawer — conversation appears with auto-generated title

### 8.3 Conversation management
- [ ] Create a new conversation from the drawer
- [ ] Select an old conversation — history loads in the chat
- [ ] Delete a conversation — removed from drawer and from disk

### 8.4 Persistence across refresh
- [ ] Refresh the page
- [ ] Conversations still appear in the drawer
- [ ] Selecting one restores its history

---

## Quick Reference: PR Coverage

| PR  | Title | Status | Sections |
|-----|-------|--------|----------|
| #11 | Concise voice prompt | Merged | 1.1, 1.2, 1.3 |
| #12 | TTS text filter | Merged | 1.3, 1.4 |
| #13 | Prompt caching | Merged | 3 |
| #14 | Smart model routing | Merged | 1.1, 1.2, 2 |
| #15 | Cost tracking + /stats | Merged | 4 |
| #16 | TTS provider factory + Google | Merged | 5.1, 5.2 |
| #17 | STT provider factory + local | Merged | 6 |
| #18 | Piper TTS (local) | **Open** | 5.3 |
| #19 | Always-listening VAD | **Open** | 7 |
| #20 | Conversation persistence | **Open** | 8 |
