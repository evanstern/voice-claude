# Crush Headless API Summary

## What You Need to Know

The **Crush headless API** (successor to OpenCode) provides a complete HTTP interface for building voice-enabled AI assistants. It's designed for exactly what you're building: transcribed speech → AI processing → text response → TTS playback.

---

## The Complete API Surface

### System (4 endpoints)
- `GET /v1/health` — Health check
- `GET /v1/version` — Server version
- `GET /v1/config` — Global config
- `POST /v1/control` — Server control (shutdown)

### Workspaces (6 endpoints)
- `GET /v1/workspaces` — List all
- `POST /v1/workspaces` — Create
- `GET /v1/workspaces/{id}` — Get one
- `DELETE /v1/workspaces/{id}` — Delete
- `GET /v1/workspaces/{id}/config` — Get config
- `GET /v1/workspaces/{id}/providers` — List providers
- `GET /v1/workspaces/{id}/events` — **Stream events (SSE)**

### Sessions (7 endpoints)
- `GET /v1/workspaces/{id}/sessions` — List
- `POST /v1/workspaces/{id}/sessions` — Create
- `GET /v1/workspaces/{id}/sessions/{sid}` — Get one
- `PUT /v1/workspaces/{id}/sessions/{sid}` — Update
- `DELETE /v1/workspaces/{id}/sessions/{sid}` — Delete
- `GET /v1/workspaces/{id}/sessions/{sid}/messages` — Get all messages
- `GET /v1/workspaces/{id}/sessions/{sid}/history` — Get file changes

### Agent & Prompts (11 endpoints) ⭐ **MOST IMPORTANT FOR VOICE**
- `GET /v1/workspaces/{id}/agent` — Get agent status
- `POST /v1/workspaces/{id}/agent` — **Send prompt (async)**
- `POST /v1/workspaces/{id}/agent/init` — Initialize agent
- `POST /v1/workspaces/{id}/agent/update` — Update agent
- `GET /v1/workspaces/{id}/agent/sessions/{sid}` — Get session status
- `POST /v1/workspaces/{id}/agent/sessions/{sid}/cancel` — Cancel
- `GET /v1/workspaces/{id}/agent/sessions/{sid}/prompts/queued` — Check queue
- `GET /v1/workspaces/{id}/agent/sessions/{sid}/prompts/list` — List queued
- `POST /v1/workspaces/{id}/agent/sessions/{sid}/prompts/clear` — Clear queue
- `POST /v1/workspaces/{id}/agent/sessions/{sid}/summarize` — Summarize
- `GET /v1/workspaces/{id}/agent/default-small-model` — Get small model

### File Tracking (3 endpoints)
- `GET /v1/workspaces/{id}/sessions/{sid}/filetracker/files` — List tracked
- `POST /v1/workspaces/{id}/filetracker/read` — Record read
- `GET /v1/workspaces/{id}/filetracker/lastread` — Get last read time

### LSP (4 endpoints)
- `GET /v1/workspaces/{id}/lsps` — List LSP clients
- `GET /v1/workspaces/{id}/lsps/{lsp}/diagnostics` — Get diagnostics
- `POST /v1/workspaces/{id}/lsps/start` — Start LSP
- `POST /v1/workspaces/{id}/lsps/stop` — Stop all LSP

### Permissions (3 endpoints)
- `GET /v1/workspaces/{id}/permissions/skip` — Get skip status
- `POST /v1/workspaces/{id}/permissions/skip` — Set skip
- `POST /v1/workspaces/{id}/permissions/grant` — Grant permission

### Configuration (5 endpoints)
- `POST /v1/workspaces/{id}/config/set` — Set value
- `POST /v1/workspaces/{id}/config/remove` — Remove value
- `POST /v1/workspaces/{id}/config/model` — Set model
- `POST /v1/workspaces/{id}/config/provider-key` — Set API key
- `POST /v1/workspaces/{id}/config/compact` — Enable auto-compact

### MCP (8 endpoints)
- `POST /v1/workspaces/{id}/mcp/refresh-tools` — Refresh tools
- `POST /v1/workspaces/{id}/mcp/read-resource` — Read resource
- `POST /v1/workspaces/{id}/mcp/get-prompt` — Get prompt
- `GET /v1/workspaces/{id}/mcp/states` — Get states
- `POST /v1/workspaces/{id}/mcp/refresh-prompts` — Refresh prompts
- `POST /v1/workspaces/{id}/mcp/refresh-resources` — Refresh resources
- `POST /v1/workspaces/{id}/mcp/docker/enable` — Enable Docker
- `POST /v1/workspaces/{id}/mcp/docker/disable` — Disable Docker

### Project (3 endpoints)
- `GET /v1/workspaces/{id}/project/needs-init` — Check init status
- `POST /v1/workspaces/{id}/project/init` — Initialize
- `GET /v1/workspaces/{id}/project/init-prompt` — Get init prompt

**Total: 68 endpoints**

---

## The Voice Loop (What You Actually Need)

For voice-claude, you only need **5 endpoints**:

```
1. POST /v1/workspaces                    → Create workspace
2. POST /v1/workspaces/{id}/sessions      → Create session
3. GET  /v1/workspaces/{id}/events        → Stream events (SSE)
4. POST /v1/workspaces/{id}/agent         → Send prompt
5. GET  /v1/workspaces/{id}/sessions/{sid}/messages → Get messages (fallback)
```

### The Flow

```
User speaks
    ↓
STT (Whisper) → "Explain authentication"
    ↓
POST /agent with prompt
    ↓
Agent processes (async, in background)
    ↓
SSE /events emits "message" events
    ↓
Extract text from message.parts[].data.text
    ↓
TTS (OpenAI/ElevenLabs) → audio
    ↓
Play through earbuds
```

---

## Key Insights

### 1. **Async Processing**
- `POST /agent` returns `200 OK` immediately
- Agent processes in background
- Results stream via SSE `/events`
- No polling needed (unless SSE unavailable)

### 2. **Message Structure**
Every message has:
```json
{
  "id": "msg-123",
  "role": "assistant",  // or "user", "system", "tool"
  "session_id": "sess-456",
  "parts": [
    {
      "type": "text",
      "data": { "text": "The response" }
    },
    {
      "type": "finish",
      "data": { "reason": "end_turn" }
    }
  ],
  "model": "claude-3.5-sonnet",
  "provider": "anthropic",
  "created_at": 1712600000
}
```

### 3. **Content Parts**
Messages can contain multiple parts:
- `text` — The actual response (what you feed to TTS)
- `tool_call` — Agent calling bash/file operations
- `tool_result` — Output from tool execution
- `reasoning` — Extended thinking (if enabled)
- `finish` — End of message (signals completion)

### 4. **Event Types**
The SSE stream emits:
- `message` — New message (most important for voice)
- `session` — Session updated
- `file` — File changed
- `permission_request` — Need approval for tool
- `permission_notification` — Permission granted/denied
- `lsp_event` — Language server event
- `mcp_event` — MCP server event
- `agent_event` — Agent state change

### 5. **No Authentication**
- Local development: no auth required
- Listens on Unix socket or TCP port
- Start with: `crush serve --host tcp://127.0.0.1:4096`

---

## Response Formats

### Success (200 OK)
```json
{
  "id": "msg-123",
  "role": "assistant",
  "parts": [...]
}
```

### Error (400/404/500)
```json
{
  "message": "Workspace not found"
}
```

---

## For voice-claude Implementation

### Minimal Setup
```javascript
// 1. Create workspace
const ws = await fetch('http://localhost:4096/v1/workspaces', {
  method: 'POST',
  body: JSON.stringify({ path: '/project' })
}).then(r => r.json());

// 2. Create session
const sess = await fetch(`http://localhost:4096/v1/workspaces/${ws.id}/sessions`, {
  method: 'POST',
  body: JSON.stringify({ title: 'Voice' })
}).then(r => r.json());

// 3. Subscribe to events
const eventSource = new EventSource(
  `http://localhost:4096/v1/workspaces/${ws.id}/events`
);
eventSource.onmessage = (e) => {
  const event = JSON.parse(e.data);
  if (event.type === 'message' && event.payload.role === 'assistant') {
    const text = event.payload.parts
      .find(p => p.type === 'text')?.data.text;
    if (text) {
      // Feed to TTS
      ttsService.synthesize(text).then(audio => audioPlayer.play(audio));
    }
  }
};

// 4. Send prompt
await fetch(`http://localhost:4096/v1/workspaces/${ws.id}/agent`, {
  method: 'POST',
  body: JSON.stringify({
    session_id: sess.id,
    prompt: transcribedText
  })
});
```

---

## What's NOT in the API

- **No WebSocket** — Uses HTTP + SSE instead
- **No authentication** — Local only
- **No rate limiting** — Not needed for local
- **No file upload endpoint** — Use `attachments` in prompt
- **No streaming request body** — Send complete prompt

---

## Comparison: OpenCode vs Crush

| Feature | OpenCode | Crush |
|---------|----------|-------|
| Status | Archived | Active ✓ |
| Headless API | No | Yes ✓ |
| HTTP Endpoints | No | 68 ✓ |
| SSE Events | No | Yes ✓ |
| Repository | sst/opencode | charmbracelet/crush |

**Use Crush** — it's the maintained successor with the headless API you need.

---

## Related Documentation

1. **crush-api-reference.md** — Complete endpoint documentation
2. **crush-integration-guide.md** — Step-by-step integration guide
3. **crush-api-summary.md** — This file

---

## Next Steps

1. Start Crush server: `crush serve --host tcp://127.0.0.1:4096`
2. Implement the 5-endpoint voice loop
3. Test with curl first, then integrate into voice-claude
4. Monitor SSE events for responses
5. Extract text and feed to TTS

---

## Source Code References

All endpoints are defined in:
- **Server routes**: `/tmp/crush/internal/server/server.go` (lines 109-168)
- **Handler implementations**: `/tmp/crush/internal/server/proto.go` (969 lines)
- **Type definitions**: `/tmp/crush/internal/proto/*.go`
- **Event wrapping**: `/tmp/crush/internal/server/events.go`

Repository: https://github.com/charmbracelet/crush
