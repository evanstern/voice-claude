# Always-Listening Mode Strategy

## Status: Design (not yet implemented)

## Problem Statement

The current voice-claude interaction model requires the user to tap a mic button to start recording, tap again to stop, and then wait for the STT-Claude-TTS pipeline to complete. This defeats the goal of a truly hands-free experience. A user working at a bakery with flour-covered hands cannot touch their phone screen.

We need **continuous listening** with **wake-word activation** so the user can speak naturally without any screen interaction.

## Goals

1. The phone mic stays open continuously while the app is active.
2. The system detects when the user says a wake phrase (e.g., "Hey Claude" or "Claude:").
3. After the wake word, the system captures the user's full utterance and sends it through the existing STT-Claude-TTS pipeline.
4. The system returns to passive listening after the response completes.
5. Battery drain and bandwidth usage remain acceptable for multi-hour sessions.

## Non-Goals (for this phase)

- Barge-in (interrupting Claude mid-response with a new command). Addressed separately.
- Multi-user / speaker identification.
- Offline operation.

---

## Architecture Overview

```
              CLIENT (Phone Browser)                         SERVER (Mac)
  ┌──────────────────────────────────────┐      ┌──────────────────────────┐
  │                                      │      │                          │
  │  Mic (MediaStream, always open)      │      │                          │
  │       │                              │      │                          │
  │       ▼                              │      │                          │
  │  VAD (Voice Activity Detection)      │      │                          │
  │       │                              │      │                          │
  │       ▼ (speech segments only)       │      │                          │
  │  Wake-Word Detector (client-side)    │      │                          │
  │       │                              │      │                          │
  │       ▼ (activated segments)         │      │                          │
  │  Audio Buffer → WebSocket ──────────────────→ Whisper STT             │
  │                                      │      │       │                  │
  │  Audio Playback ◄───────────────────────────── Claude → TTS           │
  │                                      │      │                          │
  └──────────────────────────────────────┘      └──────────────────────────┘
```

The key insight: **VAD and wake-word detection happen on the client**. Only audio that passes both gates gets sent to the server. This minimizes bandwidth, server load, and API cost.

---

## Component Design

### 1. Voice Activity Detection (VAD)

VAD determines whether the audio stream contains human speech or just background noise. It runs continuously on the client and is the first filter before wake-word detection.

#### Recommended approach: `@ricky0123/vad-web`

This is a browser-based VAD library built on the Silero VAD model (ONNX), which is the same model used by many production speech systems. It runs entirely client-side using Web Audio API + ONNX Runtime for WebAssembly.

**Why this library:**
- Silero VAD is state-of-the-art for speech/non-speech classification.
- Runs in the browser with no server round-trip. Latency is sub-10ms per frame.
- ONNX/WASM execution is efficient enough for continuous use on mobile.
- MIT licensed. Actively maintained. ~50KB WASM bundle.
- Provides `onSpeechStart` and `onSpeechEnd` callbacks with configurable silence thresholds.

**Configuration strategy:**
- `positiveSpeechThreshold`: 0.5 (default). Raise to 0.7 if false positives from ambient bakery noise.
- `minSpeechFrames`: 3 (require ~90ms of speech to trigger, avoids coughs/bumps).
- `redemptionFrames`: 8 (~240ms of silence before declaring end-of-speech). This is the pause tolerance. Too low and mid-sentence pauses split the utterance; too high and it feels laggy.

**Alternatives considered:**
| Option | Pros | Cons |
|--------|------|------|
| `@ricky0123/vad-web` (Silero) | Best accuracy, fast, small | Requires WASM/ONNX setup |
| `hark` (energy-based) | Very simple, tiny | Poor accuracy in noisy environments |
| Web Audio `AnalyserNode` (manual energy threshold) | No dependencies | Extremely fragile, no ML |
| Server-side VAD | Offloads computation | Requires streaming all audio, high bandwidth |

**Verdict:** Use `@ricky0123/vad-web`. The accuracy/efficiency tradeoff is clearly the best for our use case, especially in a noisy bakery environment where simple energy-based approaches will fail.

### 2. Wake-Word Detection

After VAD confirms speech is present, we need to determine whether the user is talking to Claude or just having a conversation with a coworker. The wake word solves this.

#### Option A: Client-side wake-word model (Recommended for Phase 1)

**Approach:** Use a lightweight keyword-spotting model that runs in the browser.

**Libraries evaluated:**

| Library | Model | Size | Accuracy | Runs in Browser | License |
|---------|-------|------|----------|-----------------|---------|
| Porcupine (Picovoice) | Proprietary CNN | ~2MB | High | Yes (WASM) | Free tier (3 keywords, rate-limited) |
| Snowboy | DNN | ~1MB | Medium | No (deprecated, native only) | Apache 2.0 |
| OpenWakeWord | Small transformer | ~5MB | Medium-High | Not natively (Python/ONNX) | Apache 2.0 |
| Custom ONNX keyword spotter | Trained small model | ~1-3MB | Variable | Yes (with ONNX Runtime Web) | Depends |

**Recommended: Porcupine (Picovoice)**

Porcupine is the most mature browser-compatible wake-word engine. It ships a WASM build, supports custom keywords, and has production-grade accuracy. The free tier allows 3 custom wake words, which is sufficient for our needs (e.g., "Hey Claude", "Claude", "Computer").

**Tradeoffs:**
- The free tier has an API key and is rate-limited, but the actual detection runs fully on-device. The key is used for model generation, not runtime.
- If we outgrow the free tier, we can train a custom small ONNX keyword spotter using a few hundred audio samples and run it with ONNX Runtime Web, similar to the VAD setup.

#### Option B: Server-side wake-word via STT (Simpler, higher latency)

**Approach:** Stream all speech segments (post-VAD) to the server and run Whisper on them. Check if the transcript starts with the wake phrase. If yes, continue processing; if no, discard.

**Tradeoffs:**
- Simpler client code (no wake-word model in the browser).
- Higher bandwidth: every speech segment goes to the server.
- Higher latency: ~500ms-1s for Whisper to process each segment before we know if it is addressed to Claude.
- Higher API cost: Whisper runs on every utterance, not just wake-word-activated ones.
- Privacy concern: all nearby speech gets sent to the server.

**When this makes sense:** If Porcupine licensing becomes problematic or if the user only uses the app in quiet environments where almost all speech is directed at Claude.

#### Option C: Hybrid (Phase 2 optimization)

Run a lightweight client-side classifier that estimates probability of wake word. If confidence is above 0.8, activate immediately. If between 0.4-0.8, send the audio to the server for Whisper verification. Below 0.4, discard. This reduces false positives from the client model while keeping latency low for clear wake words.

#### Recommendation

**Phase 1: Porcupine on the client.** It handles the common case well, keeps bandwidth minimal, and respects privacy. Revisit with Option C if false positive/negative rates are unacceptable in practice.

### 3. Utterance Capture (Post-Wake-Word)

Once the wake word is detected, we need to capture the full command that follows. This is where VAD plays its second role: detecting when the user has finished speaking.

**Flow:**
1. Wake word detected. Begin buffering audio.
2. VAD monitors the ongoing speech. As long as speech continues (with short pauses tolerated up to ~300ms), keep buffering.
3. When VAD detects a sustained silence (e.g., 800ms-1.2s), declare end-of-utterance.
4. Send the buffered audio (from just after the wake word to end-of-utterance) to the server via WebSocket.
5. Server runs Whisper on it, forwards the transcript to Claude, generates TTS, streams audio back.

**Edge case: Wake word embedded in the command.**
If the user says "Claude, read the README file," we want to capture "read the README file" not "Claude read the README file." Porcupine gives us a timestamp for the end of the wake word. We can trim the buffer to start after that point. Alternatively, we can send the full audio and strip the wake word from the transcript server-side (simpler, Whisper handles it).

**Recommended:** Send the full audio including the wake word. Strip "Claude" / "Hey Claude" from the beginning of the transcript on the server. This is more robust than trying to splice audio at exact millisecond boundaries.

### 4. State Machine

The client operates as a simple state machine:

```
                        ┌───────────────┐
                        │               │
                  ┌─────│   IDLE        │◄──────────────────┐
                  │     │  (listening)  │                   │
                  │     └───────────────┘                   │
                  │          │                              │
                  │     VAD: speech detected                │
                  │          │                              │
                  │          ▼                              │
                  │     ┌───────────────┐                   │
                  │     │  DETECTING    │                   │
                  │     │  (wake word?) │                   │
                  │     └───────────────┘                   │
                  │       │           │                     │
                  │  no wake word   wake word detected      │
                  │  + silence       │                      │
                  │       │          ▼                      │
                  │       │     ┌───────────────┐           │
                  │       │     │  CAPTURING    │           │
                  │       │     │  (utterance)  │           │
                  │       └─────┤               │           │
                  │             └───────────────┘           │
                  │                  │                      │
                  │             end-of-utterance            │
                  │             (VAD silence)               │
                  │                  │                      │
                  │                  ▼                      │
                  │             ┌───────────────┐           │
                  │             │  PROCESSING   │           │
                  │             │  (STT+Claude  │           │
                  │             │   +TTS)       │           │
                  │             └───────────────┘           │
                  │                  │                      │
                  │             response complete           │
                  │                  │                      │
                  └──────────────────┴──────────────────────┘
```

**States:**
- **IDLE** -- Mic is open. VAD is running. Wake-word detector is loaded but passive. Minimal CPU/bandwidth.
- **DETECTING** -- VAD has flagged speech. Wake-word model is actively processing audio frames. If the wake word is found, transition to CAPTURING. If speech ends without a wake word, return to IDLE.
- **CAPTURING** -- Wake word confirmed. Audio is being buffered. VAD monitors for end-of-utterance silence. When silence threshold is hit, transition to PROCESSING.
- **PROCESSING** -- Audio sent to server. Waiting for STT, Claude response, and TTS playback. During this state, VAD can be paused or we can continue listening for a follow-up wake word (Phase 2: conversational mode).

### 5. Audio Pipeline (Client-Side Implementation Detail)

```javascript
// Pseudocode for the client audio pipeline

const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const audioContext = new AudioContext({ sampleRate: 16000 });
const source = audioContext.createMediaStreamSource(stream);

// VAD processes audio frames continuously
const vad = await MicVAD.init({
  positiveSpeechThreshold: 0.5,
  minSpeechFrames: 3,
  redemptionFrames: 8,
  onSpeechStart: () => { /* transition to DETECTING */ },
  onSpeechEnd: (audio) => { /* handle based on current state */ },
});

// Porcupine runs on speech segments
const porcupine = await PorcupineWorker.create(
  accessKey,
  [{ label: "Hey Claude", sensitivity: 0.6 }],
  (detection) => { /* transition to CAPTURING */ }
);
```

The actual implementation will need to bridge the VAD output into the Porcupine input. Both can run off the same `AudioWorklet` source. Porcupine's WASM worker accepts raw PCM frames, which aligns with what the VAD produces.

---

## Constraints and Mitigations

### Battery Life

**Concern:** Keeping the mic open and running ML models continuously will drain the phone battery.

**Mitigations:**
- The mic itself draws minimal power. It is the processing that costs.
- VAD (Silero WASM) is lightweight: ~2-5% CPU on a modern phone. This is comparable to what music streaming apps use for audio processing.
- Porcupine's WASM model is similarly efficient. Picovoice benchmarks claim <5% CPU on mobile.
- Combined steady-state CPU for IDLE mode: ~5-10%. This is acceptable for sessions of 2-4 hours. For 8+ hour shifts, we should provide a "low-power" mode that uses energy-based VAD instead of Silero (trading accuracy for battery).
- AudioContext can be suspended when the user manually pauses (e.g., break time).

**Estimated battery impact:** On a Pixel phone with a 4500mAh battery, continuous listening should consume roughly 5-8% battery per hour (mic + VAD + wake word). A full shift (6-8 hours) would use 30-50% of battery, which is manageable if the phone is periodically charged or on a wireless charger.

### Bandwidth

**Concern:** Continuous audio streaming would consume significant data.

**Mitigation:** Audio only leaves the phone after wake-word activation. During passive listening, zero bytes are sent to the server. After activation, a typical 5-10 second utterance at 16kHz 16-bit mono is ~160-320KB. Even with 100 commands per hour, that is only ~16-32MB/hour. On Wi-Fi (the expected use case, since the server is on the local network), this is negligible.

### Privacy

**Concern:** An always-listening mic raises privacy concerns.

**Mitigations:**
- All passive processing (VAD + wake word) runs on-device. No audio leaves the phone unless the wake word is detected.
- The server only receives audio that the user intentionally directed at Claude.
- The app should display a clear visual indicator showing the current state (IDLE / listening passively, CAPTURING, PROCESSING).
- A physical mute gesture should be available (e.g., Pixel Buds long-press, or a simple "Claude, stop listening" voice command).

### Chrome Background Audio Restrictions

**Concern:** Chrome on Android aggressively suspends background tabs and stops media capture when the screen is off.

**This is the hardest technical challenge in the entire project.**

**Mitigations (in order of preference):**

1. **PWA with `display: standalone` + Web Lock API.** When installed as a PWA and running in standalone mode, Chrome gives the app more leeway. Combined with the Web Locks API (`navigator.locks.request`), we can signal that the app holds an active resource. This does not guarantee mic access but improves reliability.

2. **Silent audio playback keepalive.** Play a near-inaudible audio loop through an `<audio>` element. Chrome is less aggressive about suspending tabs that are actively playing audio. The Pixel Buds will route this to the earbuds, so it needs to be truly silent (or a very subtle ambient tone the user can opt into).

3. **Foreground Service via TWA (Trusted Web Activity).** Wrap the PWA in a TWA (thin Android wrapper). This allows requesting a foreground service notification, which keeps the app alive with full mic access. This is the most reliable solution but requires building and sideloading an APK.

4. **`WakeLock` API.** `navigator.wakeLock.request('screen')` prevents the screen from turning off, which indirectly keeps the mic alive. Downside: screen stays on, which wastes battery. Can be mitigated with minimum brightness.

5. **Periodic `fetch` or `setInterval` keepalive.** Less reliable, but some apps use periodic network requests to prevent Chrome from throttling the page. This is fragile and not recommended as a primary strategy.

**Recommended strategy:** Start with (1) PWA standalone + Web Lock + (2) silent audio keepalive. Test on Pixel with Buds. If the mic drops, escalate to (4) WakeLock. If that fails, invest in (3) TWA wrapper.

### Noisy Environments

**Concern:** A bakery has mixers, ovens beeping, coworker conversations, customer chatter.

**Mitigations:**
- Pixel Buds have built-in beamforming that prioritizes the wearer's voice. This helps significantly.
- Silero VAD is trained on noisy audio and handles background noise well.
- Wake-word sensitivity can be tuned. Lower sensitivity reduces false positives at the cost of occasionally needing to repeat the wake word.
- A confirmation tone (from the audio-feedback workstream) lets the user know the wake word was recognized, so they know to proceed with their command.

---

## Integration with Parallel Workstreams

### voice-commands (feature/voice-commands)
Post-transcription commands like "disregard" and "cancel" apply after wake-word activation and STT. The always-listening pipeline feeds into the same transcript processing that voice-commands hooks into. No conflict.

### audio-feedback (feature/audio-feedback)
The confirmation tone when a wake word is detected is a key UX element. The always-listening state machine should emit events that the audio-feedback system listens to (e.g., `wake-word-detected`, `utterance-captured`, `processing-started`, `response-complete`).

### chat-redesign (feature/chat-redesign)
The chat UI should display the current listening state (passive / active / processing). The state machine defined here should expose its state to the React UI via a context or store.

### cost-audit (feature/cost-audit)
Always-listening should reduce unnecessary Whisper calls (since only wake-word-activated audio is sent for STT). The cost audit should account for this change.

---

## Phased Rollout

### Phase 1: Basic always-listening (MVP)
- Integrate `@ricky0123/vad-web` for continuous VAD.
- Integrate Porcupine for client-side wake-word detection.
- Implement the IDLE -> DETECTING -> CAPTURING -> PROCESSING state machine.
- Strip wake word from transcripts server-side.
- PWA keepalive strategy (Web Lock + silent audio).
- Visual state indicator in the UI.
- Confirmation tone on wake-word detection (coordinate with audio-feedback).

### Phase 2: Robustness
- Tune VAD and wake-word thresholds based on real bakery testing.
- Add "low-power" mode for long sessions.
- Implement conversational follow-up (skip wake word for 10s after a response).
- TWA wrapper if Chrome background restrictions prove unworkable.
- Add "Claude, stop listening" / "Claude, start listening" meta-commands.

### Phase 3: Advanced
- Hybrid wake-word verification (client + server, Option C above).
- Barge-in support (interrupt Claude mid-response).
- Adaptive silence threshold based on ambient noise level.
- Multi-device support (same server, multiple clients).

---

## Open Questions

1. **Wake word phrasing.** "Hey Claude" (2 syllables, standard assistant style) vs "Claude" (1 word, faster but more prone to false positives in conversation about Claude). Need user testing.

2. **Post-response listening window.** After Claude responds, should the system immediately require the wake word again, or should there be a 5-10 second window where it stays in "active" mode for follow-up commands? The latter feels more natural for multi-turn conversations.

3. **Pixel Buds button integration.** Can we detect a Pixel Buds button press from the browser? If so, it could serve as an alternative activation method (tap to talk) alongside always-listening.

4. **WASM memory pressure.** Running both Silero VAD and Porcupine as WASM modules simultaneously on a phone browser. Need to profile memory usage to make sure we stay under Chrome's per-tab limits (~512MB on Android).

5. **Overlap with future Gemini integration.** Google may add always-listening capabilities to Chrome/Android natively. Should we design this as a pluggable module that could be swapped out for native APIs later?
