# openWakeWord follow-up intent

This repo is reserved for the **second phase** of wake-word work after we prove the UX with a Whisper-based keyword prototype in `activate-on-command`.

## Why this exists

The current app's "always listening" mode records too much ambient audio. The immediate plan is to ship a lightweight **Whisper-first wake phrase test** so we can validate the user experience:

1. passive listen
2. hear `"Coda"`
3. play a ding
4. capture the actual request
5. auto-send after a short silence

Once that flow feels right, this repo becomes the place to build the real wake-word layer with **openWakeWord**.

## Intended outcome for this repo

Build an openWakeWord-based listener that can replace the Whisper wake-phrase prototype with a lower-latency, lower-cost, more reliable passive listening path.

Target behavior:

- microphone can stay open in passive mode
- passive mode should only do lightweight wake-word detection
- on detecting `"Coda"`, emit a clear activation event / ding
- hand off to the existing active-recording pipeline for the spoken request
- after the request finishes and response playback completes, return to passive mode

## Expected architecture direction

Likely shape:

- **Browser / PWA:** keep mic capture and active recording UX
- **Wake-word service:** openWakeWord model runner, likely Python-based
- **Main app/server:** receive wake events and continue handling STT, Codex/Claude processing, and TTS

Most likely deployment options to evaluate:

1. **Docker sidecar** for openWakeWord next to the existing app services
2. **Bare-metal helper process** on the home Mac for lower friction during testing

## Scope for this repo

- evaluate openWakeWord integration options
- train or generate a custom `"Coda"` model
- define the passive-listen → wake → active-record state machine
- expose a simple interface back to the main app (WebSocket, HTTP, or local IPC)
- measure false positives, missed wakes, and activation latency

## Out of scope for the first pass here

- reworking the full Codex/Claude request pipeline
- replacing the current active recording UX
- solving every mobile browser background-audio limitation up front

## Handoff trigger

Start this effort **after** the Whisper wake-phrase prototype in `activate-on-command` is working well enough to validate the UX and timing.
