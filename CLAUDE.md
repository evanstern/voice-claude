# CLAUDE.md

## Project: voice-claude

A hands-free voice interface for Claude Code. The goal: talk to Claude through Bluetooth earbuds (Pixel Buds) on an Android phone while your hands are busy — like working at a bakery — and have Claude working on code, managing repos, and talking back.

## Origin

This project was spun off from the `evanstern/ideas` repo after exploring the concept. The core insight: Claude Code's web app (claude.ai/code) works today with voice typing, but what we really want is a **full voice loop** — continuous speech-to-text input, Claude processing with tool use, and text-to-speech output back through earbuds.

## Architecture (PROPOSED — verify with user before building)

```
Pixel Buds → Phone Mic → Speech-to-Text (Google STT / Whisper)
    → Claude API (with tool_use for git, file ops, bash)
    → Text-to-Speech (Google TTS / ElevenLabs)
    → Pixel Buds speaker
```

**Components:**
- **Server (Node.js)** — Runs on a home Mac. Manages the Claude API session, executes tools (git, file I/O, shell commands), handles the STT→Claude→TTS pipeline.
- **Mobile client** — Lightweight web app (PWA or simple page) accessed from phone browser. Captures mic audio, streams to server, plays back TTS audio. WebRTC or WebSocket-based.
- **Voice pipeline** — STT on inbound audio, TTS on outbound text. Needs to handle conversational pacing (know when you're done talking, don't interrupt).

## Tech Stack

- **Runtime:** Node.js (TypeScript)
- **API:** Anthropic Claude API with tool_use
- **STT:** Google Cloud Speech-to-Text or OpenAI Whisper
- **TTS:** Google Cloud TTS, ElevenLabs, or OpenAI TTS
- **Transport:** WebSocket (audio streaming between phone and server)
- **Mobile:** Browser-based (PWA), no native app needed

## Key Challenges

- **Latency** — Voice conversations need to feel snappy. STT + API + TTS round-trip needs to stay under ~3-4 seconds.
- **Turn detection** — Knowing when the user is done speaking vs. just pausing. Voice Activity Detection (VAD) is critical.
- **Audio streaming** — Continuous mic capture on mobile browser, reliable WebSocket streaming to server.
- **Tool execution context** — Claude needs access to repos, files, and shell on the server. Security model matters.
- **Background audio** — Mobile browser needs to keep the mic/audio session alive when the screen is off or app is backgrounded.

## Project Structure

```
src/
  server/       — Node.js server (API, WebSocket, tool execution)
  client/       — Mobile web client (mic capture, audio playback)
  voice/        — STT and TTS pipeline modules
  tools/        — Claude tool_use implementations (git, file ops, shell)
config/         — Configuration files
docs/           — Documentation and design notes
```

**NOTE TO CLAUDE:** This architecture was captured from an initial brainstorming conversation.
Before implementing, walk through this design with the user to confirm it still reflects their
vision. Things may have evolved since this was written. Ask the user: "I've read the CLAUDE.md —
does this architecture still match your vision, or has your thinking evolved?"

## Getting Started

When first opening this project in Claude Code:
1. **Review the architecture above with the user.** Confirm the proposed design before writing code.
2. Then proceed with the build phases below.

### Build Phases
1. Set up Node.js/TypeScript project with basic structure
2. Get a minimal WebSocket connection between phone browser and server
3. Wire up STT (speech-to-text) on incoming audio
4. Connect to Claude API with a simple tool (e.g., read a file)
5. Wire up TTS on Claude's response
6. Test the full loop: speak → transcribe → Claude → synthesize → hear

## Commands

(To be filled in as we build)
