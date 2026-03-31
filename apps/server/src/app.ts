import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createContext } from './trpc/context.js'
import { appRouter } from './trpc/router.js'

export const app = new Hono()

const allowedOrigin = process.env.ALLOWED_ORIGIN
app.use('/*', cors(allowedOrigin ? { origin: allowedOrigin } : undefined))

const authSecret = process.env.AUTH_SECRET
app.use('/trpc/*', async (c, next) => {
  if (authSecret) {
    const authHeader = c.req.header('Authorization')
    if (authHeader !== `Bearer ${authSecret}`) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
  }
  await next()
})

app.use('/trpc/*', async (c) => {
  const response = await fetchRequestHandler({
    endpoint: '/trpc',
    req: c.req.raw,
    router: appRouter,
    createContext,
  })
  return response
})
