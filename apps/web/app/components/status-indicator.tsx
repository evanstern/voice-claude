interface StatusIndicatorProps {
  phase: string
  activeTools: string[]
}

export function StatusIndicator({ phase, activeTools }: StatusIndicatorProps) {
  let label: string
  let colorClass: string

  switch (phase) {
    case 'recording':
      label = 'Listening...'
      colorClass = 'bg-red-500'
      break
    case 'transcribing':
      label = 'Transcribing...'
      colorClass = 'bg-primary'
      break
    case 'thinking':
      label =
        activeTools.length > 0
          ? `Running ${activeTools[activeTools.length - 1]}...`
          : 'Thinking...'
      colorClass = 'bg-primary'
      break
    case 'synthesizing':
      label = 'Generating speech...'
      colorClass = 'bg-primary'
      break
    case 'speaking':
      label = 'Speaking...'
      colorClass = 'bg-green-500'
      break
    default:
      return null
  }

  return (
    <div className="flex justify-start w-full animate-fade-in-up">
      <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-card border border-border rounded-bl-md">
        <div
          className={`w-2 h-2 rounded-full animate-pulse ${colorClass}`}
        />
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
    </div>
  )
}
