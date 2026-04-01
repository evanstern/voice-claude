import type { Server } from 'node:http'
import { serve } from '@hono/node-server'
import { app } from './app.js'
import { logger } from './logger.js'
import { attachWebSocket } from './ws/audio.js'

const log = logger.child({ module: 'server' })

if (!process.env.PORT) {
  throw new Error('Missing required environment variable: PORT')
}
const port = Number.parseInt(process.env.PORT, 10)

const server = serve({ fetch: app.fetch, port }, () => {
  log.info({ port }, 'server started')
  log.info({ port, path: '/ws/audio' }, 'WebSocket endpoint available')
})

// serve() returns ServerType (Server | Http2Server | Http2SecureServer);
// we use the default HTTP server, so narrow to Server for WebSocket attachment.
const wss = attachWebSocket(server as Server)

function gracefulShutdown(signal: string) {
  log.info({ signal }, 'received shutdown signal')

  for (const client of wss.clients) {
    client.close(1001, 'Server shutting down')
  }

  server.close(() => {
    log.info('HTTP server closed')
    process.exit(0)
  })

  setTimeout(() => {
    log.warn('forced shutdown after timeout')
    process.exit(1)
  }, 5000).unref()
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
