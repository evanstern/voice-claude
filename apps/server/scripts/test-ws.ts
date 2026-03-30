import WebSocket from 'ws'

const ws = new WebSocket('ws://localhost:4000/ws/audio')
const messages: string[] = []

ws.on('message', (data: Buffer) => messages.push(data.toString()))
ws.on('open', () => {
  ws.send(Buffer.alloc(1024))
  ws.send(JSON.stringify({ type: 'ping' }))
})

setTimeout(() => {
  for (const msg of messages) console.log(msg)
  ws.close()
  process.exit(0)
}, 1000)
