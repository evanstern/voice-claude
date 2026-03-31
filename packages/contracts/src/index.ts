import { z } from 'zod/v4'

export const heartbeatResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.iso.datetime(),
})

export type HeartbeatResponse = z.infer<typeof heartbeatResponseSchema>

// ── Chat History ────────────────────────────────────────────────

export const toolCallSchema = z.object({
  name: z.string(),
  input: z.string(),
  result: z.string(),
})

export type ToolCall = z.infer<typeof toolCallSchema>

export const messageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  timestamp: z.iso.datetime(),
  error: z.string().optional(),
  toolCalls: z.array(toolCallSchema).optional(),
  model: z.string().optional(),
})

export type Message = z.infer<typeof messageSchema>

export const conversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  messageCount: z.number(),
})

export type ConversationSummary = z.infer<typeof conversationSummarySchema>
