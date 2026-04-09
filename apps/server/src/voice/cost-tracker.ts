import { logger } from '../logger.js'
import { appendCostRecord } from '../storage/costs.js'

const log = logger.child({ module: 'cost' })

// Fallback pricing rates (Anthropic Claude Sonnet defaults).
// Used only when the provider does not report cost via reportedCost.
const RATES = {
  whisperPerMinute: 0.006,
  llmInputPer1M: 3,
  llmOutputPer1M: 15,
  llmCacheReadPer1M: 0.3,
  llmCacheWritePer1M: 3.75,
  ttsCharsPer1M: 15,
} as const

export interface LLMUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

interface ServiceCosts {
  stt: number
  llm: number
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
  llmInputTokens: number
  llmOutputTokens: number
  llmCacheReadTokens: number
  llmCacheWriteTokens: number
  ttsChars: number
}

interface GlobalStats {
  totalInteractions: number
  totalCosts: ServiceCosts
  totalSttDurationSec: number
  totalLlmInputTokens: number
  totalLlmOutputTokens: number
  totalLlmCacheReadTokens: number
  totalLlmCacheWriteTokens: number
  totalTtsChars: number
  sessions: number
  startedAt: string
}

// In-memory state
const sessionData = new Map<string, SessionStats>()
const globalStats: GlobalStats = {
  totalInteractions: 0,
  totalCosts: { stt: 0, llm: 0, tts: 0 },
  totalSttDurationSec: 0,
  totalLlmInputTokens: 0,
  totalLlmOutputTokens: 0,
  totalLlmCacheReadTokens: 0,
  totalLlmCacheWriteTokens: 0,
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
  { stt: number; llm: number; tts: number }
>()

// Pending usage metrics for the current interaction (for persistence)
const pendingUsage = new Map<
  string,
  {
    sttDurationSec: number
    llmInputTokens: number
    llmOutputTokens: number
    llmCacheReadTokens: number
    llmCacheWriteTokens: number
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
      costs: { stt: 0, llm: 0, tts: 0 },
      sttDurationSec: 0,
      llmInputTokens: 0,
      llmOutputTokens: 0,
      llmCacheReadTokens: 0,
      llmCacheWriteTokens: 0,
      ttsChars: 0,
    })
  }
  const session = sessionData.get(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found after init`)
  return session
}

function ensurePending(sessionId: string): {
  stt: number
  llm: number
  tts: number
} {
  if (!pendingCosts.has(sessionId)) {
    pendingCosts.set(sessionId, { stt: 0, llm: 0, tts: 0 })
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
      llmInputTokens: 0,
      llmOutputTokens: 0,
      llmCacheReadTokens: 0,
      llmCacheWriteTokens: 0,
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

export function recordLLM(
  sessionId: string,
  usage: LLMUsage,
  model = 'claude-sonnet-4-6',
  provider = 'anthropic',
  reportedCost?: number,
): number {
  let cost: number
  if (reportedCost != null && reportedCost > 0) {
    cost = reportedCost
  } else {
    const inputCost = (usage.input_tokens / 1_000_000) * RATES.llmInputPer1M
    const outputCost = (usage.output_tokens / 1_000_000) * RATES.llmOutputPer1M
    const cacheReadCost =
      ((usage.cache_read_input_tokens ?? 0) / 1_000_000) *
      RATES.llmCacheReadPer1M
    const cacheWriteCost =
      ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) *
      RATES.llmCacheWritePer1M
    cost = inputCost + outputCost + cacheReadCost + cacheWriteCost
  }

  const session = ensureSession(sessionId)
  session.costs.llm += cost
  session.llmInputTokens += usage.input_tokens
  session.llmOutputTokens += usage.output_tokens
  session.llmCacheReadTokens += usage.cache_read_input_tokens ?? 0
  session.llmCacheWriteTokens += usage.cache_creation_input_tokens ?? 0
  globalStats.totalCosts.llm += cost
  globalStats.totalLlmInputTokens += usage.input_tokens
  globalStats.totalLlmOutputTokens += usage.output_tokens
  globalStats.totalLlmCacheReadTokens += usage.cache_read_input_tokens ?? 0
  globalStats.totalLlmCacheWriteTokens += usage.cache_creation_input_tokens ?? 0
  trackProviderModel(provider, model, cost)

  const pending = ensurePending(sessionId)
  pending.llm += cost
  const pu = ensurePendingUsage(sessionId)
  pu.llmInputTokens += usage.input_tokens
  pu.llmOutputTokens += usage.output_tokens
  pu.llmCacheReadTokens += usage.cache_read_input_tokens ?? 0
  pu.llmCacheWriteTokens += usage.cache_creation_input_tokens ?? 0
  addPendingProvider(sessionId, provider, model, cost)
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

export function finalizeInteraction(sessionId: string): void {
  const session = ensureSession(sessionId)
  session.interactions++
  globalStats.totalInteractions++

  const pending = pendingCosts.get(sessionId) ?? { stt: 0, llm: 0, tts: 0 }
  const total = pending.stt + pending.llm + pending.tts

  log.info(
    {
      interaction: globalStats.totalInteractions,
      stt: pending.stt.toFixed(4),
      llm: pending.llm.toFixed(4),
      tts: pending.tts.toFixed(4),
      total: total.toFixed(4),
      cumulative: (
        globalStats.totalCosts.stt +
        globalStats.totalCosts.llm +
        globalStats.totalCosts.tts
      ).toFixed(4),
    },
    'interaction cost',
  )

  // Persist to disk for historical queries
  const usage = pendingUsage.get(sessionId) ?? {
    sttDurationSec: 0,
    llmInputTokens: 0,
    llmOutputTokens: 0,
    llmCacheReadTokens: 0,
    llmCacheWriteTokens: 0,
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
    globalStats.totalCosts.llm +
    globalStats.totalCosts.tts

  const avgCostPerInteraction =
    globalStats.totalInteractions > 0
      ? totalCost / globalStats.totalInteractions
      : 0

  const sessionSummaries = Array.from(sessionData.entries()).map(([id, s]) => ({
    sessionId: id.slice(0, 8),
    interactions: s.interactions,
    totalCost: s.costs.stt + s.costs.llm + s.costs.tts,
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
      llmInputTokens: globalStats.totalLlmInputTokens,
      llmOutputTokens: globalStats.totalLlmOutputTokens,
      llmCacheReadTokens: globalStats.totalLlmCacheReadTokens,
      llmCacheWriteTokens: globalStats.totalLlmCacheWriteTokens,
      ttsChars: globalStats.totalTtsChars,
    },
    byProviderModel,
    sessions: sessionSummaries,
    activeSessions: sessionData.size,
    startedAt: globalStats.startedAt,
  }
}
