// Persistent cost history — each finalized interaction is appended as a JSONL record.
// Supports querying by time range for rolling cost views.

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const DATA_DIR = join(process.cwd(), 'data', 'costs')
const HISTORY_FILE = join(DATA_DIR, 'history.jsonl')

export interface CostRecord {
  timestamp: string
  sessionId: string
  costs: { stt: number; claude: number; tts: number }
  usage: {
    sttDurationSec: number
    claudeInputTokens: number
    claudeOutputTokens: number
    claudeCacheReadTokens: number
    claudeCacheWriteTokens: number
    ttsChars: number
  }
  providers: Array<{ provider: string; model: string; cost: number }>
}

export interface AggregatedCosts {
  totalInteractions: number
  totalCost: number
  avgCostPerInteraction: number
  costBreakdown: { stt: number; claude: number; tts: number }
  usage: {
    sttDurationSec: number
    claudeInputTokens: number
    claudeOutputTokens: number
    claudeCacheReadTokens: number
    claudeCacheWriteTokens: number
    ttsChars: number
  }
  byProviderModel: Array<{
    provider: string
    model: string
    cost: number
    count: number
  }>
  periodStart: string
  periodEnd: string
}

let initialized = false

async function ensureDir() {
  if (initialized) return
  await mkdir(DATA_DIR, { recursive: true })
  initialized = true
}

export async function appendCostRecord(record: CostRecord): Promise<void> {
  await ensureDir()
  await appendFile(HISTORY_FILE, `${JSON.stringify(record)}\n`)
}

async function readAllRecords(): Promise<CostRecord[]> {
  await ensureDir()
  let content: string
  try {
    content = (await readFile(HISTORY_FILE, 'utf-8')).trim()
  } catch {
    return []
  }
  if (!content) return []
  return content.split('\n').map((line) => JSON.parse(line) as CostRecord)
}

export async function queryCosts(
  from: string,
  to: string,
): Promise<AggregatedCosts> {
  const records = await readAllRecords()
  const fromTime = new Date(from).getTime()
  const toTime = new Date(to).getTime()

  const filtered = records.filter((r) => {
    const t = new Date(r.timestamp).getTime()
    return t >= fromTime && t <= toTime
  })

  const costBreakdown = { stt: 0, claude: 0, tts: 0 }
  const usage = {
    sttDurationSec: 0,
    claudeInputTokens: 0,
    claudeOutputTokens: 0,
    claudeCacheReadTokens: 0,
    claudeCacheWriteTokens: 0,
    ttsChars: 0,
  }
  const providerMap = new Map<
    string,
    { provider: string; model: string; cost: number; count: number }
  >()

  for (const r of filtered) {
    costBreakdown.stt += r.costs.stt
    costBreakdown.claude += r.costs.claude
    costBreakdown.tts += r.costs.tts

    usage.sttDurationSec += r.usage.sttDurationSec
    usage.claudeInputTokens += r.usage.claudeInputTokens
    usage.claudeOutputTokens += r.usage.claudeOutputTokens
    usage.claudeCacheReadTokens += r.usage.claudeCacheReadTokens
    usage.claudeCacheWriteTokens += r.usage.claudeCacheWriteTokens
    usage.ttsChars += r.usage.ttsChars

    for (const p of r.providers) {
      const key = `${p.provider}:${p.model}`
      const existing = providerMap.get(key)
      if (existing) {
        existing.cost += p.cost
        existing.count++
      } else {
        providerMap.set(key, { ...p, count: 1 })
      }
    }
  }

  const totalCost = costBreakdown.stt + costBreakdown.claude + costBreakdown.tts
  const totalInteractions = filtered.length

  return {
    totalInteractions,
    totalCost,
    avgCostPerInteraction:
      totalInteractions > 0 ? totalCost / totalInteractions : 0,
    costBreakdown,
    usage,
    byProviderModel: Array.from(providerMap.values()).sort(
      (a, b) => b.cost - a.cost,
    ),
    periodStart: from,
    periodEnd: to,
  }
}
