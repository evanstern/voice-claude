import type { Server } from 'node:http'
import { serve } from '@hono/node-server'
import { app } from './app.js'
import { attachWebSocket } from './ws/audio.js'

if (!process.env.PORT) {
  throw new Error('Missing required environment variable: PORT')
}
const port = Number.parseInt(process.env.PORT, 10)

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`Server running on http://localhost:${port}`)
  console.log(`WebSocket available at ws://localhost:${port}/ws/audio`)
})

attachWebSocket(server as unknown as Server)
