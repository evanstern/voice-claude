// Thin wrapper that delegates to the configured AI provider.
// Preserves the original export signatures so audio.ts needs no changes.

import { type ChatResponse, getAIProvider } from './ai-provider.js'

export type { ChatResponse as ClaudeResponse }
export type ClaudeUsageResult = ChatResponse['usage']

export async function chat(
  sessionId: string,
  userText: string,
  onToolUse?: (name: string, input: string) => void,
  signal?: AbortSignal,
): Promise<ChatResponse> {
  return getAIProvider().chat({ sessionId, userText, onToolUse, signal })
}

export function clearSession(sessionId: string): void {
  getAIProvider().clearSession(sessionId)
}

export function restoreSession(
  sessionId: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): void {
  getAIProvider().restoreSession(sessionId, history)
}
