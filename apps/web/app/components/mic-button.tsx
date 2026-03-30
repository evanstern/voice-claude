interface MicButtonProps {
  phase: string
  connected: boolean
  busy: boolean
  onStart: () => void
  onStop: () => void
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z"
      />
    </svg>
  )
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h9a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-9a2.25 2.25 0 0 1-2.25-2.25v-9Z"
      />
    </svg>
  )
}

const PHASE_HINTS: Record<string, string> = {
  idle: 'Tap or hold space',
  recording: 'Release to send',
  transcribing: 'Transcribing...',
  thinking: 'Thinking...',
  synthesizing: 'Generating...',
  speaking: 'Speaking...',
  done: 'Tap or hold space',
}

export function MicButton({
  phase,
  connected,
  busy,
  onStart,
  onStop,
}: MicButtonProps) {
  const isRecording = phase === 'recording'

  return (
    <div className="sticky bottom-0 z-20 flex flex-col items-center gap-2 pb-6 pt-3 bg-gradient-to-t from-background via-background to-transparent">
      <span className="text-xs text-muted-foreground">
        {!connected
          ? 'Connecting...'
          : PHASE_HINTS[phase] ?? 'Tap or hold space'}
      </span>
      <button
        type="button"
        onClick={isRecording ? onStop : onStart}
        disabled={!connected || busy}
        className={`relative inline-flex items-center justify-center w-16 h-16 rounded-full transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:cursor-not-allowed ${
          isRecording
            ? 'bg-red-500/20 border-2 border-red-500 text-red-400 hover:bg-red-500/30'
            : busy
              ? 'bg-primary/5 border-2 border-primary/20 text-primary/50'
              : 'bg-primary/10 border-2 border-primary/40 text-primary hover:bg-primary/20 hover:border-primary/60 active:scale-95'
        }`}
      >
        {isRecording && (
          <span className="absolute inset-0 rounded-full animate-pulse-ring bg-red-500/20" />
        )}
        {busy && (
          <span className="absolute inset-0 rounded-full animate-pulse bg-primary/10" />
        )}
        {isRecording ? (
          <StopIcon className="w-7 h-7 relative z-10" />
        ) : (
          <MicIcon className="w-7 h-7 relative z-10" />
        )}
      </button>
    </div>
  )
}
