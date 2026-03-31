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

const wss = attachWebSocket(server as unknown as Server)

function gracefulShutdown(signal: string) {
  console.log(`[server] received ${signal}, shutting down gracefully...`)

  for (const client of wss.clients) {
    client.close(1001, 'Server shutting down')
  }

  server.close(() => {
    console.log('[server] HTTP server closed')
    process.exit(0)
  })

  setTimeout(() => {
    console.log('[server] forced shutdown after timeout')
    process.exit(1)
  }, 5000).unref()
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
