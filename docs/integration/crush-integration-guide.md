# Crush Headless API Integration Guide

## Quick Start for voice-claude

### 1. Start the Crush Server
```bash
# On your Mac (or wherever the server runs)
crush serve --host tcp://127.0.0.1:4096
```

### 2. Create a Workspace
```bash
curl -X POST http://localhost:4096/v1/workspaces \
  -H "Content-Type: application/json" \
  -d '{
    "path": "/path/to/your/project",
    "yolo": false,
    "debug": false
  }'
# Returns: { "id": "workspace-abc123", ... }
```

### 3. Create a Session
```bash
curl -X POST http://localhost:4096/v1/workspaces/workspace-abc123/sessions \
  -H "Content-Type: application/json" \
  -d '{"title": "Voice session"}'
# Returns: { "id": "sess-xyz789", ... }
```

### 4. Subscribe to Events (in background)
```bash
# This streams all events for the workspace
curl -N http://localhost:4096/v1/workspaces/workspace-abc123/events
```

### 5. Send Transcribed Speech as Prompt
```bash
curl -X POST http://localhost:4096/v1/workspaces/workspace-abc123/agent \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "sess-xyz789",
    "prompt": "Explain how authentication works in this codebase"
  }'
```

### 6. Listen for Response in Event Stream
The event stream will emit messages like:
```json
{
  "type": "message",
  "payload": {
    "id": "msg-456",
    "role": "assistant",
    "session_id": "sess-xyz789",
    "parts": [
      {
        "type": "text",
        "data": {
          "text": "Authentication in this codebase uses JWT tokens..."
        }
      }
    ]
  }
}
```

### 7. Extract Text and Feed to TTS
```javascript
// Parse the message event
const message = JSON.parse(event.data).payload;
const textPart = message.parts.find(p => p.type === 'text');
const responseText = textPart.data.text;

// Send to TTS (OpenAI, ElevenLabs, etc.)
const audio = await ttsService.synthesize(responseText);

// Play through earbuds
audioPlayer.play(audio);
```

---

## Key API Endpoints for voice-claude

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/workspaces` | POST | Create workspace |
| `/v1/workspaces/{id}/sessions` | POST | Create session |
| `/v1/workspaces/{id}/events` | GET | Stream events (SSE) |
| `/v1/workspaces/{id}/agent` | POST | Send prompt to agent |
| `/v1/workspaces/{id}/sessions/{sid}/messages` | GET | Get all messages |
| `/v1/workspaces/{id}/agent/sessions/{sid}` | GET | Get session status |

---

## Response Flow

```
User speaks
    ↓
STT (Whisper/Google) → transcribed text
    ↓
POST /agent with prompt
    ↓
Agent processes (async)
    ↓
SSE /events stream emits "message" events
    ↓
Extract text from message.parts[].data.text
    ↓
TTS (OpenAI/ElevenLabs) → audio
    ↓
Play through earbuds
```

---

## Message Structure

Every message has:
- `id`: Unique message ID
- `role`: "user", "assistant", "system", or "tool"
- `session_id`: Which session it belongs to
- `parts`: Array of content parts
- `model`: Which model generated it
- `provider`: Which provider (anthropic, openai, etc.)
- `created_at`: Unix timestamp

### Content Parts

Each part in `parts[]` has `type` and `data`:

**Text** (most common for voice):
```json
{
  "type": "text",
  "data": { "text": "The response" }
}
```

**Tool Call** (if agent executes bash/file ops):
```json
{
  "type": "tool_call",
  "data": {
    "id": "tool-123",
    "name": "bash",
    "input": "{\"command\": \"ls -la\"}"
  }
}
```

**Tool Result** (output from tool):
```json
{
  "type": "tool_result",
  "data": {
    "tool_call_id": "tool-123",
    "name": "bash",
    "content": "total 48\ndrwxr-xr-x..."
  }
}
```

**Finish** (end of message):
```json
{
  "type": "finish",
  "data": {
    "reason": "end_turn",
    "time": 1712600002
  }
}
```

---

## Async Processing Model

The `/agent` endpoint is **asynchronous**:

1. **POST /agent** → Returns `200 OK` immediately
2. **Agent processes** in background
3. **SSE stream** emits `message` events as they're generated
4. **Message parts** arrive incrementally (streaming)
5. **Finish part** signals completion

### Detecting Completion

Listen for a `message` event where the last part has `type: "finish"`:

```javascript
const isComplete = message.parts.some(p => p.type === 'finish');
if (isComplete) {
  // Message is done, safe to extract full text
  const text = message.parts
    .filter(p => p.type === 'text')
    .map(p => p.data.text)
    .join('');
}
```

---

## Polling Alternative (if SSE unavailable)

If your environment doesn't support SSE, poll for messages:

```bash
# Poll every 500ms
while true; do
  curl -s http://localhost:4096/v1/workspaces/{id}/sessions/{sid}/messages \
    | jq '.[-1]'  # Get latest message
  sleep 0.5
done
```

---

## Error Handling

All errors return JSON:
```json
{
  "message": "Workspace not found"
}
```

**Status Codes**:
- `200` - Success
- `400` - Bad request (invalid JSON, missing fields)
- `404` - Not found (workspace, session, etc.)
- `500` - Server error

---

## Configuration

### Set Model
```bash
curl -X POST http://localhost:4096/v1/workspaces/{id}/config/model \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "anthropic",
    "model": "claude-3.5-sonnet",
    "max_tokens": 4096
  }'
```

### Set API Key
```bash
curl -X POST http://localhost:4096/v1/workspaces/{id}/config/provider-key \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "anthropic",
    "api_key": "sk-ant-..."
  }'
```

### Skip Permissions (auto-approve tool execution)
```bash
curl -X POST http://localhost:4096/v1/workspaces/{id}/permissions/skip \
  -H "Content-Type: application/json" \
  -d '{"skip": true}'
```

---

## Implementation Checklist for voice-claude

- [ ] Start Crush server on port 4096
- [ ] Create workspace for project
- [ ] Create session for voice conversation
- [ ] Set up SSE event listener
- [ ] Implement prompt submission (POST /agent)
- [ ] Parse message events from SSE stream
- [ ] Extract text from message.parts
- [ ] Detect message completion (finish part)
- [ ] Feed text to TTS service
- [ ] Play audio through earbuds
- [ ] Handle tool execution (if needed)
- [ ] Handle permission requests (if needed)
- [ ] Implement error handling
- [ ] Test end-to-end flow

---

## Full API Reference

See `crush-api-reference.md` for complete endpoint documentation.

---

## Troubleshooting

### "Workspace not found"
- Verify workspace ID from creation response
- Check workspace exists: `GET /v1/workspaces`

### No events in SSE stream
- Verify event stream is connected: `curl -N http://localhost:4096/v1/workspaces/{id}/events`
- Check for network issues
- Verify workspace ID is correct

### Agent not responding
- Check agent is ready: `GET /v1/workspaces/{id}/agent`
- Verify API key is set: `POST /config/provider-key`
- Check permissions: `GET /v1/workspaces/{id}/permissions/skip`

### Tool execution fails
- Check permissions: `GET /v1/workspaces/{id}/permissions/skip`
- Grant permission: `POST /v1/workspaces/{id}/permissions/grant`
- Check tool output in `tool_result` part

---

## Performance Notes

- **Latency**: STT + API + TTS should stay under 3-4 seconds for good UX
- **Streaming**: Messages arrive incrementally, start playing TTS as soon as you have text
- **Buffering**: Buffer text parts until you see a `finish` part
- **Concurrency**: One prompt at a time per session (queue additional prompts)
