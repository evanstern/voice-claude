# Cost & Data Audit

Last updated: 2026-03-29

This document breaks down the API costs, data consumption, and bandwidth for each voice interaction in voice-claude, then projects daily and monthly spend for moderate use.

---

## Assumptions

| Parameter | Value |
|---|---|
| Average speech duration | ~10 seconds per interaction |
| Average Claude response | ~200 words (~270 tokens output) |
| Claude input (prompt + tool defs + history) | ~1,500 tokens per turn (conservative) |
| Interactions per day (moderate use) | 50 |
| Audio format (capture) | webm/opus, ~250ms chunks, sent as single blob |
| Audio format (playback) | MP3 from OpenAI TTS |

---

## 1. Per-Interaction Cost Breakdown

### 1a. Whisper STT (OpenAI)

| Item | Detail |
|---|---|
| Model | whisper-1 |
| Pricing | $0.006 per minute of audio |
| 10 seconds of audio | $0.001 |

Whisper bills per minute, rounded up to the nearest second. A 10-second clip costs $0.001.

### 1b. Claude API (Anthropic)

Pricing for claude-sonnet-4-5 (as of early 2026):

| Item | Rate | Amount | Cost |
|---|---|---|---|
| Input tokens | $3.00 / 1M tokens | ~1,500 tokens | $0.0045 |
| Output tokens | $15.00 / 1M tokens | ~270 tokens | $0.00405 |
| **Subtotal** | | | **$0.0086** |

Notes:
- Input tokens include the system prompt, tool definitions (tool_use schema for git, file ops, shell), conversation history, and the user's transcribed message.
- Tool use adds overhead: each tool definition adds ~200-400 tokens to the input. With 5-6 tools defined, that is roughly 1,500-2,400 extra input tokens on the first turn, though these are cached after the first request in a session.
- If Claude invokes a tool, there is a second round-trip: tool result goes back as input, Claude produces a second output. This roughly doubles the per-interaction cost to ~$0.017 for tool-using turns.
- Prompt caching (if enabled) can reduce repeated input token costs by up to 90% for the cached portion, bringing the effective input cost down significantly for multi-turn conversations.

**Estimated per-interaction: $0.009 (no tool use) to $0.017 (with one tool call)**

### 1c. OpenAI TTS

| Item | Detail |
|---|---|
| Model | tts-1 |
| Pricing | $15.00 per 1M characters |
| 200-word response (~1,000 characters) | $0.015 |

The higher-quality tts-1-hd model costs $30.00 per 1M characters (double).

### 1d. Per-Interaction Total

| Scenario | Whisper | Claude | TTS | Total |
|---|---|---|---|---|
| Simple Q&A (no tools) | $0.001 | $0.009 | $0.015 | **$0.025** |
| With one tool call | $0.001 | $0.017 | $0.015 | **$0.033** |
| Longer response (400 words) | $0.001 | $0.013 | $0.030 | **$0.044** |

TTS is the largest single cost component in a typical interaction.

---

## 2. Daily and Monthly Projections

Based on 50 interactions/day, mixed between simple and tool-using turns:

| Period | Low (all simple) | Typical (60/40 mix) | High (all tool use) |
|---|---|---|---|
| Per day (50 interactions) | $1.25 | $1.45 | $1.65 |
| Per month (30 days) | $37.50 | $43.50 | $49.50 |

For heavier use (100 interactions/day):

| Period | Typical (60/40 mix) |
|---|---|
| Per day | $2.90 |
| Per month | $87.00 |

---

## 3. Data Flow Per Interaction

### 3a. Upload: Audio to Server (WebSocket)

| Item | Detail |
|---|---|
| Format | webm/opus |
| Bitrate | Opus typically encodes speech at ~24-32 kbps |
| 10 seconds of audio | ~30-40 KB |
| WebSocket overhead | ~2-5% framing overhead |
| **Total upload per interaction** | **~32-42 KB** |

The audio is captured in ~250ms chunks and buffered client-side, then sent as a single blob over WebSocket to the server.

### 3b. Upload: Audio to Whisper API (Server to OpenAI)

The server forwards the webm/opus blob to the Whisper API via multipart form upload.

| Item | Detail |
|---|---|
| Payload | Same ~32-42 KB webm/opus file |
| HTTP overhead | ~1-2 KB (headers, multipart boundary) |
| Response | JSON with transcribed text, ~200-500 bytes |

### 3c. Claude API (Server to Anthropic)

| Item | Detail |
|---|---|
| Request payload | JSON, ~2-4 KB (prompt + message + tool defs) |
| Response payload | JSON, ~1-2 KB (200-word response) |
| With tool use | Additional round-trip: +2-3 KB each direction |

### 3d. Download: TTS Audio (OpenAI to Server)

| Item | Detail |
|---|---|
| Format | MP3 |
| 200-word response (~15 seconds of speech) | ~120-180 KB at tts-1 quality |
| 400-word response (~30 seconds) | ~240-360 KB |

### 3e. Download: TTS Audio to Client (Server to Phone)

The MP3 is streamed back to the client over WebSocket.

| Item | Detail |
|---|---|
| Payload | Same ~120-180 KB MP3 |
| WebSocket overhead | ~2-5% |
| **Total download per interaction** | **~125-190 KB** |

### 3f. Total Bandwidth Per Interaction

| Direction | Amount |
|---|---|
| Phone upload (audio) | ~35-45 KB |
| Phone download (TTS MP3) | ~125-190 KB |
| **Round-trip total (phone)** | **~160-235 KB** |
| Server egress (Whisper + Claude + TTS APIs) | ~40-50 KB upload, ~125-185 KB download |

### 3g. Daily Bandwidth (50 interactions)

| Direction | Amount |
|---|---|
| Phone upload | ~1.7-2.2 MB |
| Phone download | ~6.1-9.3 MB |
| **Phone total** | **~8-12 MB/day** |

This is very modest. Even on a metered mobile connection, 50 voice interactions per day would consume less data than streaming a single song.

---

## 4. Storage

Currently, voice-claude does **not persist anything to disk**:

- Conversation history is held in-memory on the server and lost on restart.
- Audio blobs are processed in-memory and discarded after transcription/playback.
- No database or file-based logging.

Potential future storage considerations:

| What | Size estimate | Notes |
|---|---|---|
| Conversation logs (text) | ~2-5 KB/interaction | Useful for debugging, could add up over months |
| Audio recordings | ~35-45 KB/interaction (input) + ~150 KB (output) | Only if we add a "save recording" feature |
| Session state | ~10-50 KB | If we persist conversation history for resume |

At 50 interactions/day with full audio logging, that would be roughly **9-10 MB/day** or **~280 MB/month**. Text-only logging would be about **100-250 KB/day**.

---

## 5. Optimization Opportunities

### 5a. Reduce TTS Cost (biggest lever)

TTS accounts for roughly 50-60% of per-interaction cost.

- **Shorter responses**: Instruct Claude via system prompt to keep voice responses concise. A 100-word response instead of 200 words cuts TTS cost in half.
- **Selective TTS**: Only synthesize the "spoken" portion of Claude's response. Skip code blocks, file contents, and structured output from tool results. Summarize those verbally instead.
- **Switch to a cheaper TTS provider**: Google Cloud TTS standard voices cost $4.00 per 1M characters (vs. $15.00 for OpenAI tts-1). That is a 73% reduction. Quality is lower but acceptable for utilitarian voice feedback.
- **Local TTS**: Run Piper TTS or Coqui TTS on the server Mac. Zero marginal cost after setup. Quality has improved significantly and is usable for non-conversational output.

| TTS option | Cost per 1M chars | Per-interaction (1K chars) | Monthly (50/day) |
|---|---|---|---|
| OpenAI tts-1 | $15.00 | $0.015 | $22.50 |
| OpenAI tts-1-hd | $30.00 | $0.030 | $45.00 |
| Google Cloud TTS (Standard) | $4.00 | $0.004 | $6.00 |
| Google Cloud TTS (WaveNet) | $16.00 | $0.016 | $24.00 |
| ElevenLabs (Creator plan) | ~$22.00* | $0.022 | $33.00 |
| Local (Piper/Coqui) | $0.00 | $0.000 | $0.00 |

*ElevenLabs pricing is subscription-based; effective per-character cost depends on plan and usage.

### 5b. Reduce Claude API Cost

- **Prompt caching**: Anthropic's prompt caching can cache the system prompt and tool definitions. For a multi-turn session, this reduces input token costs by up to 90% on the cached portion. At 1,200 cached tokens per turn, savings are ~$0.003/interaction.
- **Shorter tool definitions**: Minimize JSON schema descriptions. Each unnecessary word in tool definitions costs tokens on every request.
- **Haiku for simple queries**: Route simple questions (no tool use needed) to claude-3-5-haiku at $0.80/$4.00 per 1M tokens (input/output). That drops Claude cost from $0.009 to ~$0.002 for simple turns.
- **Batching context**: Summarize older conversation turns instead of sending full history.

### 5c. Reduce STT Cost

Whisper is already very cheap ($0.001 per 10-second interaction). Optimization here has minimal impact on total cost, but options exist:

- **Local Whisper**: Run whisper.cpp or faster-whisper on the server Mac. Eliminates the $0.001/interaction cost entirely. A Mac with Apple Silicon runs the small model in near-real-time. Trade-off: slightly lower accuracy than the API, ~1-2 seconds of local processing time.
- **Voice Activity Detection (VAD) pre-filter**: Only send audio that contains speech. Avoids paying for silence. This is already planned for the always-listening feature.

### 5d. Reduce Bandwidth

- **Opus everywhere**: Already using opus for capture. For playback, consider sending opus instead of MP3 to the client. Opus at equivalent quality is ~30-40% smaller than MP3. Browser support for opus playback is universal.
- **Streaming TTS**: Stream TTS audio chunks as they are generated rather than waiting for the full MP3. Reduces perceived latency even though total bandwidth is the same.

### 5e. Cost Summary with Optimizations Applied

| Optimization | Monthly savings | New monthly total |
|---|---|---|
| Baseline (current) | -- | $43.50 |
| + Concise responses (100 words) | -$11.25 | $32.25 |
| + Google Cloud TTS Standard | -$16.50 | $15.75 |
| + Prompt caching | -$4.50 | $11.25 |
| + Haiku for simple turns | -$2.10 | $9.15 |
| + Local STT (whisper.cpp) | -$1.50 | $7.65 |
| + Local TTS (Piper) | -$6.00 | **$1.65** |

Going fully local for STT and TTS brings the monthly cost down to essentially just the Claude API cost: **under $2/month** at 50 interactions/day.

---

## 6. Cost Monitoring Recommendations

- Log token counts (input/output) per Claude request for actual cost tracking.
- Log audio duration per Whisper call.
- Log character count per TTS call.
- Expose a `/stats` endpoint or dashboard showing cumulative costs per session and per day.
- Set up billing alerts on OpenAI and Anthropic dashboards.

---

## Summary

| Metric | Value |
|---|---|
| Cost per interaction (typical) | $0.025-0.033 |
| Monthly cost (50/day, current stack) | ~$43.50 |
| Monthly cost (fully optimized) | ~$1.65 |
| Data per interaction (phone) | ~160-235 KB |
| Data per day (phone, 50 interactions) | ~8-12 MB |
| Persistent storage | None (in-memory only) |
| Biggest cost lever | TTS provider/approach |
| Biggest latency lever | Local STT + streaming TTS |
