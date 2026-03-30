# CLAUDE.md

## Project: voice-claude

## Active Worktree: voice-commands
This is a worktree branch for implementing voice command keywords.
Scope: Command detection module, WebSocket integration, client handling.
Other parallel branches: always-listening-strategy, dockerize, cost-audit, audio-feedback, chat-redesign

A hands-free voice interface for Claude Code. The goal: talk to Claude through Bluetooth earbuds (Pixel Buds) on an Android phone while your hands are busy — like working at a bakery — and have Claude working on code, managing repos, and talking back.

## Origin

This project was spun off from the `evanstern/ideas` repo after exploring the concept. The core insight: Claude Code's web app (claude.ai/code) works today with voice typing, but what we really want is a **full voice loop** — continuous speech-to-text input, Claude processing with tool use, and text-to-speech output back through earbuds.

## Architecture

```
Pixel Buds → Phone Mic → Speech-to-Text (Whisper / Google STT)
    → Claude API (with tool_use for git, file ops, bash)
    → Text-to-Speech (OpenAI TTS / ElevenLabs / Google TTS)
    → Pixel Buds speaker
```

**Components:**
- **Server (`apps/server`)** — Hono + tRPC backend running on a home Mac. Manages the Claude API session, executes tools (git, file I/O, shell commands), handles the STT→Claude→TTS pipeline. WebSocket endpoint for real-time audio streaming.
- **Web client (`apps/web`)** — React Router 7 PWA accessed from phone browser. Captures mic audio, streams to server via WebSocket, plays back TTS audio. SSR-enabled with Hono server proxy to backend tRPC.
- **Voice pipeline** — STT on inbound audio, TTS on outbound text. Needs to handle conversational pacing (know when you're done talking, don't interrupt).

## Tech Stack

- **Monorepo:** pnpm workspaces + Turborepo
- **Runtime:** Node.js 22+ (TypeScript, ES modules)
- **Backend:** Hono + tRPC 11 (typesafe API)
- **Frontend:** React 19 + React Router 7 + Vite 6
- **Styling:** Tailwind CSS 4 + Radix UI
- **UI Library:** `@voice-claude/ui` (shared components with CVA + tailwind-merge)
- **Contracts:** `@voice-claude/contracts` (shared Zod schemas)
- **API:** Anthropic Claude API with tool_use
- **STT:** OpenAI Whisper (may switch to Google Cloud STT)
- **TTS:** OpenAI TTS (may switch to ElevenLabs or Google Cloud TTS)
- **Transport:** tRPC for control plane, WebSocket for audio streaming
- **Code Quality:** Biome (formatter + linter)
- **Containerization:** Docker Compose for local dev

## Key Challenges

- **Latency** — Voice conversations need to feel snappy. STT + API + TTS round-trip needs to stay under ~3-4 seconds.
- **Turn detection** — Knowing when the user is done speaking vs. just pausing. Voice Activity Detection (VAD) is critical.
- **Audio streaming** — Continuous mic capture on mobile browser, reliable WebSocket streaming to server. May need to upgrade beyond basic WebSocket for audio quality.
- **Tool execution context** — Claude needs access to repos, files, and shell on the server. Security model matters.
- **Background audio** — Mobile browser needs to keep the mic/audio session alive when the screen is off or app is backgrounded.

## Project Structure

```
voice-claude/
├── apps/
│   ├── server/          — Hono + tRPC backend (API, WebSocket, tool execution)
│   └── web/             — React Router 7 PWA (mic capture, audio playback)
├── packages/
│   ├── contracts/       — Shared Zod schemas & types
│   ├── shared/          — Shared utilities
│   └── ui/              — Radix + Tailwind component library
├── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
└── biome.json
```

## Getting Started

### Prerequisites
- Node.js 22+
- pnpm 9.15+
- Docker (for containerized dev)

### Local Development
```bash
cp .env.example .env
pnpm install
pnpm dev          # starts server (port 4000) + web (port 3000)
```

### Docker Development
```bash
cp .env.example .env
docker compose up
```

### Build
```bash
pnpm build        # builds all packages via Turbo
```

### Other Commands
```bash
pnpm lint         # biome check
pnpm format       # biome format
pnpm typecheck    # tsc --noEmit
```

## Build Phases

1. ~~Set up monorepo with Hono + tRPC + React Router~~ (done)
2. Get a minimal WebSocket connection between phone browser and server
3. Wire up STT (speech-to-text) on incoming audio
4. Connect to Claude API with a simple tool (e.g., read a file)
5. Wire up TTS on Claude's response
6. Test the full loop: speak → transcribe → Claude → synthesize → hear
