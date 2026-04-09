# Crush Headless HTTP API Reference

**Version**: Based on Crush (successor to OpenCode)  
**Repository**: https://github.com/charmbracelet/crush  
**Base Path**: `/v1`

---

## Overview

The Crush headless API provides a complete HTTP interface for programmatic interaction with the AI agent. The API is organized around **workspaces** (project directories) and **sessions** (conversation threads).

### Key Concepts

- **Workspace**: A project directory where the agent operates. Contains sessions, configuration, and file tracking.
- **Session**: A conversation thread within a workspace. Contains messages exchanged with the AI.
- **Agent**: The AI assistant that processes prompts and executes tools.
- **Message**: A single message in a session, with role (user/assistant/system/tool) and content parts.
- **Events**: Real-time updates via Server-Sent Events (SSE) on workspace changes.

---

## Authentication

**No authentication required** for local development. The API listens on:
- **Default**: Unix socket at `/tmp/crush-{uid}.sock` (or `crush.sock`)
- **TCP**: Specify with `--host tcp://127.0.0.1:4096`
- **Custom**: Use `--host` flag when starting the server

---

## System Endpoints

### Health Check
```
GET /v1/health
```
**Response**: `200 OK` (empty body)

### Get Server Version
```
GET /v1/version
```
**Response**:
```json
{
  "version": "0.1.0",
  "commit": "abc123...",
  "build_time": "2026-04-08T..."
}
```

### Get Server Config
```
GET /v1/config
```
**Response**: Global server configuration object

### Server Control
```
POST /v1/control
Content-Type: application/json

{
  "command": "shutdown"
}
```
**Commands**: `shutdown`

---

## Workspace Management

### List All Workspaces
```
GET /v1/workspaces
```
**Response**:
```json
[
  {
    "id": "workspace-1",
    "path": "/home/user/project",
    "yolo": false,
    "debug": false,
    "data_dir": ".crush",
    "version": "0.1.0",
    "config": { ... },
    "env": []
  }
]
```

### Create Workspace
```
POST /v1/workspaces
Content-Type: application/json

{
  "path": "/home/user/project",
  "yolo": false,
  "debug": false,
  "data_dir": ".crush"
}
```
**Response**: Created workspace object (same structure as list)

### Get Workspace
```
GET /v1/workspaces/{id}
```
**Response**: Single workspace object

### Delete Workspace
```
DELETE /v1/workspaces/{id}
```
**Response**: `200 OK`

### Get Workspace Config
```
GET /v1/workspaces/{id}/config
```
**Response**: Configuration object for the workspace

### Get Workspace Providers
```
GET /v1/workspaces/{id}/providers
```
**Response**: Available AI providers and their models

### Stream Workspace Events (SSE)
```
GET /v1/workspaces/{id}/events
```
**Response**: Server-Sent Events stream

**Event Types**:
- `message` - New message in a session
- `session` - Session created/updated
- `file` - File change tracked
- `lsp_event` - Language Server Protocol event
- `mcp_event` - Model Context Protocol event
- `permission_request` - Permission needed for tool execution
- `permission_notification` - Permission granted/denied
- `agent_event` - Agent state change

**Example Event**:
```
data: {
  "type": "message",
  "payload": {
    "id": "msg-123",
    "role": "assistant",
    "session_id": "sess-456",
    "parts": [...],
    "model": "claude-3.5-sonnet",
    "provider": "anthropic",
    "created_at": 1712600000,
    "updated_at": 1712600001
  }
}
```

---

## Session Management

### List Sessions in Workspace
```
GET /v1/workspaces/{id}/sessions
```
**Response**:
```json
[
  {
    "id": "sess-123",
    "parent_session_id": "",
    "title": "Debug authentication flow",
    "message_count": 5,
    "prompt_tokens": 1200,
    "completion_tokens": 450,
    "summary_message_id": "",
    "cost": 0.0045,
    "created_at": 1712600000,
    "updated_at": 1712600100
  }
]
```

### Create Session
```
POST /v1/workspaces/{id}/sessions
Content-Type: application/json

{
  "title": "Debug authentication flow"
}
```
**Response**: Created session object

### Get Session
```
GET /v1/workspaces/{id}/sessions/{sid}
```
**Response**: Single session object

### Update Session
```
PUT /v1/workspaces/{id}/sessions/{sid}
Content-Type: application/json

{
  "id": "sess-123",
  "title": "Updated title",
  "message_count": 5,
  ...
}
```
**Response**: Updated session object

### Delete Session
```
DELETE /v1/workspaces/{id}/sessions/{sid}
```
**Response**: `200 OK`

### Get Session Messages
```
GET /v1/workspaces/{id}/sessions/{sid}/messages
```
**Response**:
```json
[
  {
    "id": "msg-123",
    "role": "user",
    "session_id": "sess-456",
    "parts": [
      {
        "type": "text",
        "data": {
          "text": "Explain this code"
        }
      }
    ],
    "model": "claude-3.5-sonnet",
    "provider": "anthropic",
    "created_at": 1712600000,
    "updated_at": 1712600000
  },
  {
    "id": "msg-124",
    "role": "assistant",
    "session_id": "sess-456",
    "parts": [
      {
        "type": "text",
        "data": {
          "text": "This code implements..."
        }
      }
    ],
    "model": "claude-3.5-sonnet",
    "provider": "anthropic",
    "created_at": 1712600001,
    "updated_at": 1712600001
  }
]
```

### Get User Messages Only
```
GET /v1/workspaces/{id}/sessions/{sid}/messages/user
```
**Response**: Array of messages with role="user"

### Get All User Messages in Workspace
```
GET /v1/workspaces/{id}/messages/user
```
**Response**: Array of all user messages across all sessions

### Get Session History (File Changes)
```
GET /v1/workspaces/{id}/sessions/{sid}/history
```
**Response**:
```json
[
  {
    "id": "file-123",
    "session_id": "sess-456",
    "path": "src/auth.ts",
    "content": "...",
    "version": 1,
    "created_at": 1712600000
  }
]
```

---

## Agent & Prompts

### Get Agent Info
```
GET /v1/workspaces/{id}/agent
```
**Response**:
```json
{
  "is_busy": false,
  "is_ready": true,
  "model": {
    "id": "claude-3.5-sonnet",
    "name": "Claude 3.5 Sonnet",
    "provider": "anthropic",
    "context_window": 200000,
    "max_output_tokens": 4096
  },
  "model_cfg": {
    "provider": "anthropic",
    "model": "claude-3.5-sonnet",
    "max_tokens": 4096
  }
}
```

### Initialize Agent
```
POST /v1/workspaces/{id}/agent/init
```
**Response**: `200 OK`

### Update Agent
```
POST /v1/workspaces/{id}/agent/update
```
**Response**: `200 OK`

### Send Message to Agent (Async)
```
POST /v1/workspaces/{id}/agent
Content-Type: application/json

{
  "session_id": "sess-123",
  "prompt": "Explain how this authentication works",
  "attachments": [
    {
      "file_path": "src/auth.ts",
      "file_name": "auth.ts",
      "mime_type": "text/plain",
      "content": "base64-encoded-content"
    }
  ]
}
```
**Response**: `200 OK`

**Notes**:
- This is **asynchronous** — the agent processes the prompt in the background
- Monitor progress via the SSE `/events` endpoint
- Messages are added to the session's message list as they arrive
- The agent will emit `message` events as it generates responses

### Get Agent Session
```
GET /v1/workspaces/{id}/agent/sessions/{sid}
```
**Response**:
```json
{
  "id": "sess-123",
  "title": "Debug auth",
  "message_count": 5,
  "prompt_tokens": 1200,
  "completion_tokens": 450,
  "summary_message_id": "",
  "cost": 0.0045,
  "created_at": 1712600000,
  "updated_at": 1712600100,
  "is_busy": false
}
```

### Cancel Agent Session
```
POST /v1/workspaces/{id}/agent/sessions/{sid}/cancel
```
**Response**: `200 OK`

### Get Queued Prompt Status
```
GET /v1/workspaces/{id}/agent/sessions/{sid}/prompts/queued
```
**Response**:
```json
{
  "has_queued": true,
  "count": 1
}
```

### List Queued Prompts
```
GET /v1/workspaces/{id}/agent/sessions/{sid}/prompts/list
```
**Response**:
```json
[
  "First queued prompt text",
  "Second queued prompt text"
]
```

### Clear Prompt Queue
```
POST /v1/workspaces/{id}/agent/sessions/{sid}/prompts/clear
```
**Response**: `200 OK`

### Summarize Session
```
POST /v1/workspaces/{id}/agent/sessions/{sid}/summarize
```
**Response**: `200 OK`

**Notes**:
- Creates a new session with a summary of the current session
- Useful for managing context window limits

### Get Default Small Model
```
GET /v1/workspaces/{id}/agent/default-small-model?provider_id=anthropic
```
**Response**:
```json
{
  "id": "claude-3.5-haiku",
  "name": "Claude 3.5 Haiku",
  "provider": "anthropic"
}
```

---

## File Tracking

### Get Tracked Files for Session
```
GET /v1/workspaces/{id}/sessions/{sid}/filetracker/files
```
**Response**:
```json
[
  "src/auth.ts",
  "src/utils.ts"
]
```

### Record File Read
```
POST /v1/workspaces/{id}/filetracker/read
Content-Type: application/json

{
  "session_id": "sess-123",
  "path": "src/auth.ts"
}
```
**Response**: `200 OK`

### Get Last Read Time for File
```
GET /v1/workspaces/{id}/filetracker/lastread?session_id=sess-123&path=src/auth.ts
```
**Response**:
```json
{
  "last_read": 1712600000
}
```

---

## Language Server Protocol (LSP)

### List LSP Clients
```
GET /v1/workspaces/{id}/lsps
```
**Response**:
```json
{
  "go": {
    "name": "gopls",
    "state": "connected",
    "error": "",
    "diagnostic_count": 2,
    "connected_at": "2026-04-08T12:00:00Z"
  },
  "typescript": {
    "name": "typescript-language-server",
    "state": "connected",
    "error": "",
    "diagnostic_count": 0,
    "connected_at": "2026-04-08T12:00:00Z"
  }
}
```

### Get LSP Diagnostics
```
GET /v1/workspaces/{id}/lsps/{lsp}/diagnostics
```
**Response**: Diagnostics object from the LSP server

### Start LSP Server
```
POST /v1/workspaces/{id}/lsps/start
Content-Type: application/json

{
  "path": "/home/user/project"
}
```
**Response**: `200 OK`

### Stop All LSP Servers
```
POST /v1/workspaces/{id}/lsps/stop
```
**Response**: `200 OK`

---

## Permissions

### Get Skip Permissions Status
```
GET /v1/workspaces/{id}/permissions/skip
```
**Response**:
```json
{
  "skip": false
}
```

### Set Skip Permissions
```
POST /v1/workspaces/{id}/permissions/skip
Content-Type: application/json

{
  "skip": true
}
```
**Response**: `200 OK`

### Grant Permission
```
POST /v1/workspaces/{id}/permissions/grant
Content-Type: application/json

{
  "permission": {
    "id": "perm-123",
    "session_id": "sess-456",
    "tool_call_id": "tool-789",
    "tool_name": "bash",
    "description": "Execute: rm -rf /",
    "action": "execute",
    "path": "/",
    "params": {}
  },
  "action": "allow"
}
```
**Response**: `200 OK`

**Permission Actions**:
- `allow` - Allow this specific tool call
- `allow_session` - Allow all calls to this tool in this session
- `deny` - Deny this tool call

---

## Configuration

### Set Config Value
```
POST /v1/workspaces/{id}/config/set
Content-Type: application/json

{
  "key": "some_key",
  "value": "some_value"
}
```
**Response**: `200 OK`

### Remove Config Value
```
POST /v1/workspaces/{id}/config/remove
Content-Type: application/json

{
  "key": "some_key"
}
```
**Response**: `200 OK`

### Set Model
```
POST /v1/workspaces/{id}/config/model
Content-Type: application/json

{
  "provider": "anthropic",
  "model": "claude-3.5-sonnet",
  "max_tokens": 4096
}
```
**Response**: `200 OK`

### Set Provider API Key
```
POST /v1/workspaces/{id}/config/provider-key
Content-Type: application/json

{
  "provider": "anthropic",
  "api_key": "sk-ant-..."
}
```
**Response**: `200 OK`

### Enable Auto-Compact
```
POST /v1/workspaces/{id}/config/compact
Content-Type: application/json

{
  "enabled": true,
  "threshold": 0.95
}
```
**Response**: `200 OK`

---

## Model Context Protocol (MCP)

### Refresh MCP Tools
```
POST /v1/workspaces/{id}/mcp/refresh-tools
```
**Response**: `200 OK`

### Read MCP Resource
```
POST /v1/workspaces/{id}/mcp/read-resource
Content-Type: application/json

{
  "uri": "file:///path/to/resource"
}
```
**Response**: Resource content

### Get MCP Prompt
```
POST /v1/workspaces/{id}/mcp/get-prompt
Content-Type: application/json

{
  "name": "prompt-name",
  "arguments": {}
}
```
**Response**: Prompt content

### Get MCP States
```
GET /v1/workspaces/{id}/mcp/states
```
**Response**: State of all MCP servers

### Refresh MCP Prompts
```
POST /v1/workspaces/{id}/mcp/refresh-prompts
```
**Response**: `200 OK`

### Refresh MCP Resources
```
POST /v1/workspaces/{id}/mcp/refresh-resources
```
**Response**: `200 OK`

### Enable Docker for MCP
```
POST /v1/workspaces/{id}/mcp/docker/enable
```
**Response**: `200 OK`

### Disable Docker for MCP
```
POST /v1/workspaces/{id}/mcp/docker/disable
```
**Response**: `200 OK`

---

## Project Initialization

### Check if Project Needs Init
```
GET /v1/workspaces/{id}/project/needs-init
```
**Response**:
```json
{
  "needs_init": true
}
```

### Initialize Project
```
POST /v1/workspaces/{id}/project/init
```
**Response**: `200 OK`

### Get Project Init Prompt
```
GET /v1/workspaces/{id}/project/init-prompt
```
**Response**: Suggested initialization prompt

---

## Complete Example: Voice-Claude Integration

### 1. Create Workspace
```bash
curl -X POST http://localhost:4096/v1/workspaces \
  -H "Content-Type: application/json" \
  -d '{
    "path": "/home/user/my-project",
    "yolo": false,
    "debug": false
  }'
```

### 2. Create Session
```bash
curl -X POST http://localhost:4096/v1/workspaces/{workspace-id}/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Voice session"
  }'
```

### 3. Subscribe to Events (in background)
```bash
curl -N http://localhost:4096/v1/workspaces/{workspace-id}/events
```

### 4. Send Transcribed Speech as Prompt
```bash
curl -X POST http://localhost:4096/v1/workspaces/{workspace-id}/agent \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "{session-id}",
    "prompt": "Explain how authentication works in this codebase"
  }'
```

### 5. Listen for Response Messages
The SSE stream will emit `message` events with the assistant's response:
```json
{
  "type": "message",
  "payload": {
    "id": "msg-456",
    "role": "assistant",
    "session_id": "{session-id}",
    "parts": [
      {
        "type": "text",
        "data": {
          "text": "Authentication in this codebase uses JWT tokens..."
        }
      }
    ],
    "created_at": 1712600001
  }
}
```

### 6. Extract Text and Feed to TTS
```javascript
// From the message event payload
const textContent = message.parts.find(p => p.type === 'text');
const responseText = textContent.data.text;

// Send to TTS service (e.g., OpenAI TTS, ElevenLabs)
const audioBuffer = await ttsService.synthesize(responseText);

// Play through earbuds
audioPlayer.play(audioBuffer);
```

---

## Message Content Parts

Messages can contain multiple content parts. Each part has a `type` and `data`:

### Text Content
```json
{
  "type": "text",
  "data": {
    "text": "The response text"
  }
}
```

### Reasoning Content (Extended Thinking)
```json
{
  "type": "reasoning",
  "data": {
    "thinking": "Let me think about this...",
    "signature": "...",
    "started_at": 1712600000,
    "finished_at": 1712600001
  }
}
```

### Tool Call
```json
{
  "type": "tool_call",
  "data": {
    "id": "tool-call-123",
    "name": "bash",
    "input": "{\"command\": \"ls -la\"}",
    "type": "function",
    "finished": false
  }
}
```

### Tool Result
```json
{
  "type": "tool_result",
  "data": {
    "tool_call_id": "tool-call-123",
    "name": "bash",
    "content": "total 48\ndrwxr-xr-x  5 user  staff  160 Apr  8 12:00 .",
    "metadata": "",
    "is_error": false
  }
}
```

### Image URL
```json
{
  "type": "image_url",
  "data": {
    "url": "https://example.com/image.png",
    "detail": "high"
  }
}
```

### Finish (End of Message)
```json
{
  "type": "finish",
  "data": {
    "reason": "end_turn",
    "time": 1712600002,
    "message": "Completed successfully",
    "details": ""
  }
}
```

**Finish Reasons**:
- `end_turn` - Normal completion
- `max_tokens` - Hit token limit
- `tool_use` - Waiting for tool results
- `canceled` - User canceled
- `error` - Error occurred
- `permission_denied` - Permission denied
- `unknown` - Unknown reason

---

## Error Responses

All errors return JSON with status code and message:

```json
{
  "message": "Workspace not found"
}
```

**Common Status Codes**:
- `400` - Bad request (invalid JSON, missing fields)
- `404` - Not found (workspace, session, etc.)
- `500` - Internal server error

---

## Notes for voice-claude Integration

1. **Async Processing**: The `/agent` endpoint is asynchronous. Use SSE `/events` to monitor progress.

2. **Response Streaming**: Messages are streamed as they're generated. Listen for `message` events with `role: "assistant"`.

3. **Tool Execution**: If the agent calls tools (bash, file operations), you'll see:
   - `tool_call` part in the message
   - `permission_request` event (if permissions not auto-approved)
   - `tool_result` part with the tool output

4. **Session Persistence**: All messages are saved to the session. You can retrieve them later with `GET /sessions/{sid}/messages`.

5. **File Attachments**: Send files with the prompt using the `attachments` field in `AgentMessage`.

6. **Polling Alternative**: If SSE is unavailable, poll `GET /sessions/{sid}/messages` periodically to check for new messages.

---

## Swagger/OpenAPI Documentation

Full API documentation is available at:
```
GET /v1/docs/
```

This serves the Swagger UI with interactive API exploration.
