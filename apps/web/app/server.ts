import { createHonoServer } from 'react-router-hono-server/node'

export default await createHonoServer({
  configure(app) {
    const serverUrl = process.env.SERVER_URL ?? 'http://localhost:4000'

    app.all('/trpc/*', async (c) => {
      const target = new URL(serverUrl)
      const url = new URL(c.req.url)
      url.hostname = target.hostname
      url.port = target.port
      url.protocol = target.protocol

      const res = await fetch(
        new Request(url.toString(), {
          method: c.req.method,
          headers: c.req.raw.headers,
          body: c.req.raw.body,
          duplex: 'half',
        } as RequestInit),
      )

      const headers = new Headers()
      for (const [key, value] of res.headers.entries()) {
        if (key.toLowerCase() === 'set-cookie') continue
        headers.append(key, value)
      }
      for (const cookie of res.headers.getSetCookie()) {
        headers.append('set-cookie', cookie)
      }

      headers.set('cache-control', 'no-store')

      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
      })
    })
  },
  getLoadContext(c) {
    return {
      cookie: c.req.header('cookie') ?? '',
    }
  },
})
