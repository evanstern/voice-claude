import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@voice-claude/ui/components/card'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router'
import { getClientTRPC } from '../trpc/client.js'

interface RootContext {
  health: { status: string; timestamp: string } | null
  wsConfig: { path: string; port: number } | null
}

interface ServiceCosts {
  stt: number
  claude: number
  tts: number
}

interface SessionSummary {
  sessionId: string
  interactions: number
  totalCost: number
  costs: ServiceCosts
}

interface Stats {
  totalInteractions: number
  totalCost: number
  avgCostPerInteraction: number
  costBreakdown: ServiceCosts
  usage: {
    sttDurationSec: number
    claudeInputTokens: number
    claudeOutputTokens: number
    claudeCacheReadTokens: number
    claudeCacheWriteTokens: number
    ttsChars: number
  }
  sessions: SessionSummary[]
  activeSessions: number
  startedAt: string
}

export function meta() {
  return [
    { title: 'Costs | Voice Claude' },
    { name: 'description', content: 'API usage costs and breakdown' },
  ]
}

function formatCost(amount: number): string {
  if (amount < 0.01) return `$${amount.toFixed(4)}`
  return `$${amount.toFixed(2)}`
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${secs.toFixed(0)}s`
}

function CostBar({
  label,
  cost,
  total,
  color,
}: {
  label: string
  cost: number
  total: number
  color: string
}) {
  const pct = total > 0 ? (cost / total) * 100 : 0
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-medium text-foreground">
          {formatCost(cost)}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }}
        />
      </div>
    </div>
  )
}

export default function Costs() {
  const { wsConfig } = useOutletContext<RootContext>()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const trpc = useMemo(() => {
    if (typeof window === 'undefined' || !wsConfig) return null
    return getClientTRPC(wsConfig.port)
  }, [wsConfig])

  const fetchStats = useCallback(async () => {
    if (!trpc) return
    try {
      const data = await trpc.stats.query()
      setStats(data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch stats')
    } finally {
      setLoading(false)
    }
  }, [trpc])

  useEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, 10_000)
    return () => clearInterval(interval)
  }, [fetchStats])

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="text-muted-foreground hover:text-foreground transition-colors p-1 -ml-1"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <title>Back</title>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 19.5L8.25 12l7.5-7.5"
              />
            </svg>
          </Link>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            Costs
          </h1>
        </div>
        {stats && (
          <span className="text-xs text-muted-foreground">
            Since {new Date(stats.startedAt).toLocaleDateString()}
          </span>
        )}
      </header>

      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-destructive">{error}</p>
            </CardContent>
          </Card>
        )}

        {stats && !loading && (
          <>
            {/* Total Cost */}
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Spend</CardDescription>
                <CardTitle className="text-3xl font-mono">
                  {formatCost(stats.totalCost)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4 text-sm text-muted-foreground">
                  <span>{stats.totalInteractions} interactions</span>
                  <span className="text-border">|</span>
                  <span>
                    {stats.activeSessions} active session
                    {stats.activeSessions !== 1 ? 's' : ''}
                  </span>
                  <span className="text-border">|</span>
                  <span>{formatCost(stats.avgCostPerInteraction)} avg</span>
                </div>
              </CardContent>
            </Card>

            {/* Cost Breakdown by Service */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Cost by Service</CardTitle>
                <CardDescription>
                  Breakdown across API providers
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <CostBar
                  label="Claude (Anthropic)"
                  cost={stats.costBreakdown.claude}
                  total={stats.totalCost}
                  color="bg-violet-500"
                />
                <CostBar
                  label="Speech-to-Text (OpenAI Whisper)"
                  cost={stats.costBreakdown.stt}
                  total={stats.totalCost}
                  color="bg-emerald-500"
                />
                <CostBar
                  label="Text-to-Speech (OpenAI TTS)"
                  cost={stats.costBreakdown.tts}
                  total={stats.totalCost}
                  color="bg-amber-500"
                />
              </CardContent>
            </Card>

            {/* Usage Details */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Usage Details</CardTitle>
                <CardDescription>Raw consumption metrics</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div className="space-y-3">
                    <div>
                      <p className="text-muted-foreground">STT Duration</p>
                      <p className="font-mono font-medium">
                        {formatDuration(stats.usage.sttDurationSec)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        Claude Input Tokens
                      </p>
                      <p className="font-mono font-medium">
                        {formatNumber(stats.usage.claudeInputTokens)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        Claude Output Tokens
                      </p>
                      <p className="font-mono font-medium">
                        {formatNumber(stats.usage.claudeOutputTokens)}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <p className="text-muted-foreground">TTS Characters</p>
                      <p className="font-mono font-medium">
                        {formatNumber(stats.usage.ttsChars)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Cache Read Tokens</p>
                      <p className="font-mono font-medium">
                        {formatNumber(stats.usage.claudeCacheReadTokens)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        Cache Write Tokens
                      </p>
                      <p className="font-mono font-medium">
                        {formatNumber(stats.usage.claudeCacheWriteTokens)}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Active Sessions */}
            {stats.sessions.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Active Sessions</CardTitle>
                  <CardDescription>
                    {stats.sessions.length} session
                    {stats.sessions.length !== 1 ? 's' : ''} with tracked costs
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {stats.sessions.map((session) => (
                      <div
                        key={session.sessionId}
                        className="flex items-center justify-between py-2 border-b border-border last:border-0"
                      >
                        <div>
                          <p className="font-mono text-sm text-foreground">
                            {session.sessionId}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {session.interactions} interaction
                            {session.interactions !== 1 ? 's' : ''}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono text-sm font-medium">
                            {formatCost(session.totalCost)}
                          </p>
                          <div className="flex gap-2 text-[10px] text-muted-foreground">
                            <span className="text-violet-400">
                              C:{formatCost(session.costs.claude)}
                            </span>
                            <span className="text-emerald-400">
                              S:{formatCost(session.costs.stt)}
                            </span>
                            <span className="text-amber-400">
                              T:{formatCost(session.costs.tts)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Refresh */}
            <div className="flex justify-center pb-4">
              <button
                type="button"
                onClick={fetchStats}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Auto-refreshes every 10s
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
