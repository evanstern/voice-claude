import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '@voice-claude/server/trpc/router'

let _client: ReturnType<typeof createTRPCClient<AppRouter>> | null = null
let _currentPort: number | null = null

export function getClientTRPC(serverPort: number | null) {
  if (_client && _currentPort === serverPort) return _client

  const host = serverPort
    ? `${window.location.hostname}:${serverPort}`
    : window.location.host
  const url = `${window.location.protocol}//${host}/trpc`

  _client = createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url })],
  })
  _currentPort = serverPort

  return _client
}
