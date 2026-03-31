import { useEffect, useState } from 'react'
import { STATUS_PHASE_CONFIG } from '../constants/phase-labels.js'

interface StatusIndicatorProps {
  phase: string
  activeTools: string[]
}

function useElapsedSeconds(active: boolean) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!active) {
      setSeconds(0)
      return
    }
    const start = Date.now()
    const timer = setInterval(() => {
      setSeconds(Math.floor((Date.now() - start) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [active])
  return seconds
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function StatusIndicator({ phase, activeTools }: StatusIndicatorProps) {
  const config = STATUS_PHASE_CONFIG[phase]
  if (!config) return null

  const { colorClass, showTimer } = config
  const label =
    phase === 'thinking' && activeTools.length > 0
      ? `Running ${activeTools[activeTools.length - 1]}...`
      : config.label

  const isProcessing = phase === 'thinking' || phase === 'synthesizing'
  const elapsed = useElapsedSeconds(isProcessing)

  return (
    <div className="flex justify-start w-full animate-fade-in-up">
      <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-card border border-border rounded-bl-md">
        <div className="relative flex items-center justify-center w-3 h-3">
          {isProcessing && (
            <span
              className={`absolute inset-0 rounded-full opacity-40 animate-ping ${colorClass}`}
            />
          )}
          <div className={`w-2 h-2 rounded-full animate-pulse ${colorClass}`} />
        </div>
        <span className="text-sm text-muted-foreground">{label}</span>
        {showTimer && elapsed >= 3 && (
          <span className="text-xs text-muted-foreground/50 tabular-nums">
            {formatElapsed(elapsed)}
          </span>
        )}
      </div>
    </div>
  )
}
