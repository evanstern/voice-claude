# voice-coda plan

## Proposed repo name

`voice-coda`

## Suggested GitHub description

Hands-free voice interface for coding agents with wake-word activation, tool use, and spoken responses.

## Suggested tagline options

1. Talk to your coding agent hands-free.
2. Wake with “Coda,” code by voice.
3. Earbuds in, hands busy, agent working.

## Positioning

`voice-coda` should present the project as the successor to `voice-claude`, not just a rename. The differentiators now visible in this branch are:

- wake-word-first interaction (`Coda`) instead of tap-to-talk only
- provider-agnostic agent backend (`anthropic`, `claude-code`, `opencode`)
- self-hosted voice loop with tool use, conversation history, and spoken responses

## README direction for the successor repo

The successor README should lead with:

1. **What it is** — a wake-word-enabled voice coding assistant
2. **Why it exists** — hands-free use while working away from keyboard/screen
3. **How it works** — wake word → request capture → agent/tool use → spoken response
4. **What is pluggable** — AI provider, STT, TTS, wake-word model
5. **What is still experimental** — mobile background audio, false-positive tuning, passive mode UX

## Scope to carry forward from this repo

- wake-word browser + service integration
- provider abstraction and OpenCode support
- conversation persistence and cost tracking
- self-hosting scripts and Docker deployment paths

## Scope to leave behind or downplay

- Claude-specific branding in user-facing copy
- naming that assumes Anthropic is the only backend
- docs that describe the project as only a voice shell for Claude
