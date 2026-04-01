// Per-interaction cost tracking for STT, Claude, and TTS API calls.

import { logger } from '../logger.js'
import { appendCostRecord } from '../storage/costs.js'

const log = logger.child({ module: 'cost' })

// Pricing rates
const RATES = {
  // Whisper: $0.006 per minute of audio
  whisperPerMinute: 0.006,
  // Claude Sonnet: $3 per 1M input tokens, $15 per 1M output tokens
  claudeInputPer1M: 3,
  claudeOutputPer1M: 15,
  // Cache tokens: input tokens read from cache are 90% cheaper, write is 25% more
  claudeCacheReadPer1M: 0.3,
  claudeCacheWritePer1M: 3.75,
  // OpenAI TTS (tts-1): $15 per 1M characters
  ttsCharsPer1M: 15,
} as const

export interface ClaudeUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

interface ServiceCosts {
  stt: number
  claude: number
  tts: number
}

export interface ProviderModelEntry {
  provider: string
  model: string
  cost: number
  count: number
}

interface SessionStats {
  interactions: number
  costs: ServiceCosts
  sttDurationSec: number
  claudeInputTokens: number
  claudeOutputTokens: number
  claudeCacheReadTokens: number
  claudeCacheWriteTokens: number
  ttsChars: number
}

interface GlobalStats {
  totalInteractions: number
  totalCosts: ServiceCosts
  totalSttDurationSec: number
  totalClaudeInputTokens: number
  totalClaudeOutputTokens: number
  totalClaudeCacheReadTokens: number
  totalClaudeCacheWriteTokens: number
  totalTtsChars: number
  sessions: number
  startedAt: string
}

// In-memory state
const sessionData = new Map<string, SessionStats>()
const globalStats: GlobalStats = {
  totalInteractions: 0,
  totalCosts: { stt: 0, claude: 0, tts: 0 },
  totalSttDurationSec: 0,
  totalClaudeInputTokens: 0,
  totalClaudeOutputTokens: 0,
  totalClaudeCacheReadTokens: 0,
  totalClaudeCacheWriteTokens: 0,
  totalTtsChars: 0,
  sessions: 0,
  startedAt: new Date().toISOString(),
}

// Per provider+model cost tracking (global, not per-session)
const providerModelStats = new Map<string, ProviderModelEntry>()

function trackProviderModel(
  provider: string,
  model: string,
  cost: number,
): void {
  const key = `${provider}:${model}`
  const entry = providerModelStats.get(key)
  if (entry) {
    entry.cost += cost
    entry.count++
  } else {
    providerModelStats.set(key, { provider, model, cost, count: 1 })
  }
}

// Pending costs for the current interaction (accumulated across calls, logged together)
const pendingCosts = new Map<
  string,
  { stt: number; claude: number; tts: number }
>()

// Pending usage metrics for the current interaction (for persistence)
const pendingUsage = new Map<
  string,
  {
    sttDurationSec: number
    claudeInputTokens: number
    claudeOutputTokens: number
    claudeCacheReadTokens: number
    claudeCacheWriteTokens: number
    ttsChars: number
  }
>()

// Pending provider entries for the current interaction (for persistence)
const pendingProviders = new Map<
  string,
  Array<{ provider: string; model: string; cost: number }>
>()

function ensureSession(sessionId: string): SessionStats {
  if (!sessionData.has(sessionId)) {
    globalStats.sessions++
    sessionData.set(sessionId, {
      interactions: 0,
      costs: { stt: 0, claude: 0, tts: 0 },
      sttDurationSec: 0,
      claudeInputTokens: 0,
      claudeOutputTokens: 0,
      claudeCacheReadTokens: 0,
      claudeCacheWriteTokens: 0,
      ttsChars: 0,
    })
  }
  const session = sessionData.get(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found after init`)
  return session
}

function ensurePending(sessionId: string): {
  stt: number
  claude: number
  tts: number
} {
  if (!pendingCosts.has(sessionId)) {
    pendingCosts.set(sessionId, { stt: 0, claude: 0, tts: 0 })
  }
  const pending = pendingCosts.get(sessionId)
  if (!pending)
    throw new Error(`Pending costs ${sessionId} not found after init`)
  return pending
}

function ensurePendingUsage(sessionId: string) {
  let usage = pendingUsage.get(sessionId)
  if (!usage) {
    usage = {
      sttDurationSec: 0,
      claudeInputTokens: 0,
      claudeOutputTokens: 0,
      claudeCacheReadTokens: 0,
      claudeCacheWriteTokens: 0,
      ttsChars: 0,
    }
    pendingUsage.set(sessionId, usage)
  }
  return usage
}

function addPendingProvider(
  sessionId: string,
  provider: string,
  model: string,
  cost: number,
) {
  let providers = pendingProviders.get(sessionId)
  if (!providers) {
    providers = []
    pendingProviders.set(sessionId, providers)
  }
  providers.push({ provider, model, cost })
}

export function recordSTT(
  sessionId: string,
  durationSec: number,
  provider = 'openai',
  model = 'whisper-1',
): number {
  const cost = (durationSec / 60) * RATES.whisperPerMinute
  const session = ensureSession(sessionId)
  session.costs.stt += cost
  session.sttDurationSec += durationSec
  globalStats.totalCosts.stt += cost
  globalStats.totalSttDurationSec += durationSec
  trackProviderModel(provider, model, cost)

  const pending = ensurePending(sessionId)
  pending.stt += cost
  const pu = ensurePendingUsage(sessionId)
  pu.sttDurationSec += durationSec
  addPendingProvider(sessionId, provider, model, cost)
  return cost
}

export function recordClaude(
  sessionId: string,
  usage: ClaudeUsage,
  model = 'claude-sonnet-4-6',
): number {
  const inputCost = (usage.input_tokens / 1_000_000) * RATES.claudeInputPer1M
  const outputCost = (usage.output_tokens / 1_000_000) * RATES.claudeOutputPer1M
  const cacheReadCost =
    ((usage.cache_read_input_tokens ?? 0) / 1_000_000) *
    RATES.claudeCacheReadPer1M
  const cacheWriteCost =
    ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) *
    RATES.claudeCacheWritePer1M
  const cost = inputCost + outputCost + cacheReadCost + cacheWriteCost

  const session = ensureSession(sessionId)
  session.costs.claude += cost
  session.claudeInputTokens += usage.input_tokens
  session.claudeOutputTokens += usage.output_tokens
  session.claudeCacheReadTokens += usage.cache_read_input_tokens ?? 0
  session.claudeCacheWriteTokens += usage.cache_creation_input_tokens ?? 0
  globalStats.totalCosts.claude += cost
  globalStats.totalClaudeInputTokens += usage.input_tokens
  globalStats.totalClaudeOutputTokens += usage.output_tokens
  globalStats.totalClaudeCacheReadTokens += usage.cache_read_input_tokens ?? 0
  globalStats.totalClaudeCacheWriteTokens +=
    usage.cache_creation_input_tokens ?? 0
  trackProviderModel('anthropic', model, cost)

  const pending = ensurePending(sessionId)
  pending.claude += cost
  const pu = ensurePendingUsage(sessionId)
  pu.claudeInputTokens += usage.input_tokens
  pu.claudeOutputTokens += usage.output_tokens
  pu.claudeCacheReadTokens += usage.cache_read_input_tokens ?? 0
  pu.claudeCacheWriteTokens += usage.cache_creation_input_tokens ?? 0
  addPendingProvider(sessionId, 'anthropic', model, cost)
  return cost
}

export function recordTTS(
  sessionId: string,
  charCount: number,
  provider = 'openai',
  model = 'tts-1',
): number {
  const cost = (charCount / 1_000_000) * RATES.ttsCharsPer1M
  const session = ensureSession(sessionId)
  session.costs.tts += cost
  session.ttsChars += charCount
  globalStats.totalCosts.tts += cost
  globalStats.totalTtsChars += charCount
  trackProviderModel(provider, model, cost)

  const pending = ensurePending(sessionId)
  pending.tts += cost
  const pu = ensurePendingUsage(sessionId)
  pu.ttsChars += charCount
  addPendingProvider(sessionId, provider, model, cost)
  return cost
}

/**
 * Call after each full interaction (STT + Claude + TTS) to log the cost
 * summary and increment the interaction counter.
 */
export function finalizeInteraction(sessionId: string): void {
  const session = ensureSession(sessionId)
  session.interactions++
  globalStats.totalInteractions++

  const pending = pendingCosts.get(sessionId) ?? { stt: 0, claude: 0, tts: 0 }
  const total = pending.stt + pending.claude + pending.tts

  log.info({
    interaction: globalStats.totalInteractions,
    stt: pending.stt,
    claude: pending.claude,
    tts: pending.tts,
    total,
    cumulative: globalStats.totalCosts.stt + globalStats.totalCosts.claude + globalStats.totalCosts.tts,
  }, 'interaction cost')

  // Persist to disk for historical queries
  const usage = pendingUsage.get(sessionId) ?? {
    sttDurationSec: 0,
    claudeInputTokens: 0,
    claudeOutputTokens: 0,
    claudeCacheReadTokens: 0,
    claudeCacheWriteTokens: 0,
    ttsChars: 0,
  }
  const providers = pendingProviders.get(sessionId) ?? []
  appendCostRecord({
    timestamp: new Date().toISOString(),
    sessionId,
    costs: { ...pending },
    usage: { ...usage },
    providers,
  }).catch((err) => log.error({ err }, 'failed to persist cost record'))

  pendingCosts.delete(sessionId)
  pendingUsage.delete(sessionId)
  pendingProviders.delete(sessionId)
}

/**
 * Remove all tracking data for a session. Call when the WebSocket disconnects
 * so the sessionData map doesn't grow unbounded.
 */
export function cleanupSession(sessionId: string): void {
  sessionData.delete(sessionId)
  pendingCosts.delete(sessionId)
  pendingUsage.delete(sessionId)
  pendingProviders.delete(sessionId)
}

export function getStats() {
  const totalCost =
    globalStats.totalCosts.stt +
    globalStats.totalCosts.claude +
    globalStats.totalCosts.tts

  const avgCostPerInteraction =
    globalStats.totalInteractions > 0
      ? totalCost / globalStats.totalInteractions
      : 0

  const sessionSummaries = Array.from(sessionData.entries()).map(([id, s]) => ({
    sessionId: id.slice(0, 8),
    interactions: s.interactions,
    totalCost: s.costs.stt + s.costs.claude + s.costs.tts,
    costs: { ...s.costs },
  }))

  const byProviderModel = Array.from(providerModelStats.values()).sort(
    (a, b) => b.cost - a.cost,
  )

  return {
    totalInteractions: globalStats.totalInteractions,
    totalCost,
    avgCostPerInteraction,
    costBreakdown: { ...globalStats.totalCosts },
    usage: {
      sttDurationSec: globalStats.totalSttDurationSec,
      claudeInputTokens: globalStats.totalClaudeInputTokens,
      claudeOutputTokens: globalStats.totalClaudeOutputTokens,
      claudeCacheReadTokens: globalStats.totalClaudeCacheReadTokens,
      claudeCacheWriteTokens: globalStats.totalClaudeCacheWriteTokens,
      ttsChars: globalStats.totalTtsChars,
    },
    byProviderModel,
    sessions: sessionSummaries,
    activeSessions: sessionData.size,
    startedAt: globalStats.startedAt,
  }
}
