import { getStats } from '../voice/cost-tracker.js'
import { createRouter, publicProcedure } from './init.js'

export const appRouter = createRouter({
  health: createRouter({
    check: publicProcedure.query(() => {
      return { status: 'ok' as const, timestamp: new Date().toISOString() }
    }),
  }),
  config: createRouter({
    wsUrl: publicProcedure.query(() => {
      const port = process.env.PORT ?? '4000'
      return { path: '/ws/audio', port: Number.parseInt(port, 10) }
    }),
  }),
  stats: publicProcedure.query(() => {
    return getStats()
  }),
})

export type AppRouter = typeof appRouter
