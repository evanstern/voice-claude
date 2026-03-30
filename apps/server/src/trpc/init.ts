import { initTRPC } from '@trpc/server'
import type { Context } from './context.js'

const t = initTRPC.context<Context>().create()

export const createRouter = t.router
export const publicProcedure = t.procedure
