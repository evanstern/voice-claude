# Code Review Synthesis

**Date:** 2026-03-31
**Reviewer Lens:** Senior architect
**Reviewed Tree:** checked-out `master` branch state at review time

## Summary

The current system has a solid product direction and a workable monorepo structure, but it is still closer to an advanced prototype than a production-capable voice coding system.

The main concerns are not cosmetic. They are architectural:

- The server currently exposes a powerful remote execution surface without authentication or origin restrictions.
- The voice path is not truly streaming end-to-end, which adds latency and undermines the product's core UX goal.
- Tool execution and persistence both block the Node event loop in latency-sensitive paths.
- Type safety and quality gates are inconsistent: build passes while typecheck fails.
- There is no automated test coverage.

## Priority Backlog

### P0 - Secure the execution surface

**Problem**

The websocket and HTTP surfaces are effectively unauthenticated, while the Claude tool layer can execute shell commands and read files on disk.

**Why it matters**

This is the single biggest production blocker. Any network exposure turns the app into an unauthenticated remote shell/file agent.

**Evidence**

- `apps/server/src/ws/audio.ts`
- `apps/server/src/app.ts`
- `apps/server/src/voice/claude.ts`

**Backlog tasks**

- Add authentication for websocket and tRPC access.
- Restrict allowed origins instead of global CORS.
- Add authorization around tool use, not just transport access.
- Constrain tool execution to an explicit sandbox and allowed command set.
- Block path traversal and absolute-path file reads outside the working directory.
- Add audit logging for tool invocations.

### P1 - Rework the voice pipeline into true streaming

**Problem**

The client buffers recorded audio locally and sends one blob on stop. The server then buffers again before transcription. This is not a real streaming pipeline.

**Why it matters**

Latency is the core product requirement. Buffer-then-send architecture will continue to feel slow and brittle, especially on mobile networks.

**Evidence**

- `apps/web/app/hooks/use-audio-socket.ts`
- `apps/server/src/ws/audio.ts`

**Backlog tasks**

- Stream audio incrementally over the websocket instead of buffering full utterances.
- Fix the stop-recording race so the final `dataavailable` chunk is not dropped.
- Define a proper protocol for chunked audio, turn boundaries, partial transcripts, and server acknowledgements.
- Add backpressure and max-buffer guards on both client and server.
- Measure end-to-end latency by stage: capture, upload, STT, model, TTS, playback.

### P1 - Move tool execution off the event loop

**Problem**

Shell tool execution uses `execSync` in the request path.

**Why it matters**

A single long-running command can stall websocket handling and degrade every active session.

**Evidence**

- `apps/server/src/voice/claude.ts`

**Backlog tasks**

- Replace `execSync` with async process execution.
- Add execution timeouts, cancellation, and concurrency limits.
- Separate tool-running work from the websocket request thread.
- Distinguish safe read-only tools from mutating tools.

### P1 - Fix session lifecycle and model routing

**Problem**

Session state is unbounded in memory, not cleared on websocket close, and resumed conversations are incorrectly treated as tool-heavy sessions.

**Why it matters**

This increases cost, increases latency, and creates a slow memory leak.

**Evidence**

- `apps/server/src/voice/claude.ts`
- `apps/server/src/ws/audio.ts`

**Backlog tasks**

- Clear or expire sessions on disconnect/inactivity.
- Persist only the metadata needed to resume sessions correctly.
- Track actual tool usage rather than assuming any assistant reply implies Sonnet.
- Limit retained history depth per session.

### P2 - Replace synchronous JSONL persistence with an async store abstraction

**Problem**

Conversation writes are synchronous and rewrite the full index file on every message append.

**Why it matters**

This is both a throughput bottleneck and a concurrency risk once multiple sessions are active.

**Evidence**

- `apps/server/src/storage/conversations.ts`

**Backlog tasks**

- Introduce a repository layer for conversations.
- Replace sync filesystem operations with async IO at minimum.
- Move from JSONL files to SQLite or another small transactional store.
- Add locking or transactional semantics around index/message updates.

### P2 - Tighten quality gates so build cannot hide broken types

**Problem**

`pnpm build` currently passes while `pnpm typecheck` fails in the web app.

**Why it matters**

This weakens trust in CI and allows broken strict-mode TypeScript to ship.

**Evidence**

- `turbo.json`
- `apps/web/package.json`
- `apps/web/app/components/mic-button.tsx`
- `apps/web/app/hooks/use-vad.ts`
- `apps/web/app/hooks/use-sound-effects.ts`

**Backlog tasks**

- Make `typecheck` mandatory in CI before merge.
- Fold typecheck into package build or make Turbo build depend on it.
- Fix the current strict-mode failures.
- Decide whether lint should include formatter enforcement in CI or be split into separate jobs.

### P2 - Formalize transport contracts

**Problem**

Websocket messages are manually shaped on both sides without shared discriminated unions.

**Why it matters**

This makes protocol changes fragile and easy to break silently.

**Evidence**

- `apps/server/src/ws/audio.ts`
- `apps/web/app/hooks/use-audio-socket.ts`
- `packages/contracts/src/index.ts`

**Backlog tasks**

- Define shared websocket client/server message contracts in `@voice-claude/contracts`.
- Validate inbound control messages on the server.
- Use the shared protocol types in the client parser.
- Add contract tests for the transport layer.

### P3 - Clean up DRY and standards gaps

**Problem**

A number of smaller issues indicate the codebase is still consolidating patterns.

**Examples**

- Duplicate client-singleton patterns for OpenAI and Anthropic clients.
- Utility helpers like formatting and elapsed-time logic are embedded in feature modules.
- Phase labels are duplicated across UI components.
- `packages/shared` is effectively unused.
- The conversation list contains nested `button` elements.
- There is a case-sensitive import risk in `@voice-claude/ui/components/Button`.

**Backlog tasks**

- Extract shared utilities intentionally or delete the package until it has a real role.
- Centralize UI phase metadata and transport enums.
- Normalize import casing.
- Fix invalid interactive markup.

## Missing Coverage

There are currently no automated tests in the repo.

**Backlog tasks**

- Add unit tests for command parsing, text filtering, and provider selection.
- Add integration tests for websocket message flow.
- Add persistence tests for conversation create/load/delete/update.
- Add a smoke test for the end-to-end voice turn lifecycle.

## Recommended Delivery Order

### Phase 1 - Safety and correctness

- Authentication and origin restrictions
- Tool sandboxing and path validation
- Typecheck gate enforcement
- Fix current TypeScript failures

### Phase 2 - Core runtime reliability

- Async tool runner
- Session cleanup and bounded memory
- Async conversation store
- Websocket reconnection and transport hardening

### Phase 3 - Product-performance work

- True streaming audio transport
- Stage-by-stage latency instrumentation
- Better turn-boundary protocol and partial responses

### Phase 4 - Maintainability

- Shared contracts and protocol typing
- DRY cleanup
- Test suite buildout

## Review Notes

- `pnpm build` passed during review.
- `pnpm typecheck` failed in the web package.
- `pnpm lint` failed on formatter/style issues.
- This review was based on the checked-out `master` branch, not a branch literally named `main`.

## Bottom Line

The codebase is pointed in the right direction, but the next work should focus on security, event-loop safety, transport design, and typed contracts before broader feature expansion. Those changes will do more for product quality than incremental UI or provider work.
