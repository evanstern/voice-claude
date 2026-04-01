import { z } from 'zod/v4'
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  updateConversationTitle,
} from '../storage/conversations.js'
import { queryCosts } from '../storage/costs.js'
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
  costHistory: publicProcedure
    .input(z.object({ from: z.string(), to: z.string() }))
    .query(({ input }) => {
      return queryCosts(input.from, input.to)
    }),
  conversations: createRouter({
    list: publicProcedure.query(() => {
      return listConversations()
    }),
    get: publicProcedure
      .input(z.object({ id: z.string() }))
      .query(({ input }) => {
        return getConversation(input.id)
      }),
    create: publicProcedure
      .input(z.object({ title: z.string().optional() }).optional())
      .mutation(({ input }) => {
        return createConversation(input?.title)
      }),
    delete: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ input }) => {
        return deleteConversation(input.id)
      }),
    updateTitle: publicProcedure
      .input(z.object({ id: z.string(), title: z.string() }))
      .mutation(({ input }) => {
        return updateConversationTitle(input.id, input.title)
      }),
  }),
})

export type AppRouter = typeof appRouter
