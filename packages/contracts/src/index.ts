import { z } from 'zod/v4'

export const heartbeatResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.iso.datetime(),
})

export type HeartbeatResponse = z.infer<typeof heartbeatResponseSchema>
