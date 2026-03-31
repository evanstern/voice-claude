import { PHASE_HINTS } from '../constants/phase-labels.js'

interface MicButtonProps {
  phase: string
  connected: boolean
  busy: boolean
  mode: 'push-to-talk' | 'auto'
  onStart: () => void
  onStop: () => void
  onToggleMode: () => void
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
      <title>Microphone</title>
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
      <title>Stop</title>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h9a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-9a2.25 2.25 0 0 1-2.25-2.25v-9Z"
      />
    </svg>
  )
}

export function MicButton({
  phase,
  connected,
  busy,
  mode,
  onStart,
  onStop,
  onToggleMode,
}: MicButtonProps) {
  const isRecording = phase === 'recording'
  const isAuto = mode === 'auto'
  const hints = PHASE_HINTS[mode] ?? PHASE_HINTS['push-to-talk'] ?? {}

  return (
    <div className="sticky bottom-0 z-20 flex flex-col items-center gap-2 pb-6 pt-3 bg-gradient-to-t from-background via-background to-transparent">
      <span className="text-xs text-muted-foreground">
        {!connected
          ? 'Connecting...'
          : (hints[phase] ?? hints.idle ?? 'Tap or hold space')}
      </span>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={isRecording ? onStop : onStart}
          disabled={!connected || busy}
          className={`relative inline-flex items-center justify-center w-16 h-16 rounded-full transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:cursor-not-allowed ${
            isRecording
              ? 'bg-red-500/20 border-2 border-red-500 text-red-400 hover:bg-red-500/30'
              : isAuto && (phase === 'idle' || phase === 'done')
                ? 'bg-green-500/10 border-2 border-green-500/40 text-green-400 hover:bg-green-500/20'
                : busy
                  ? 'bg-primary/5 border-2 border-primary/20 text-primary/50'
                  : 'bg-primary/10 border-2 border-primary/40 text-primary hover:bg-primary/20 hover:border-primary/60 active:scale-95'
          }`}
        >
          {isRecording && (
            <span className="absolute inset-0 rounded-full animate-pulse-ring bg-red-500/20" />
          )}
          {isAuto && !isRecording && !busy && (
            <span className="absolute inset-0 rounded-full animate-pulse bg-green-500/5" />
          )}
          {busy && !isAuto && (
            <span className="absolute inset-0 rounded-full animate-pulse bg-primary/10" />
          )}
          {isRecording ? (
            <StopIcon className="w-7 h-7 relative z-10" />
          ) : (
            <MicIcon className="w-7 h-7 relative z-10" />
          )}
        </button>
      </div>
      <button
        type="button"
        onClick={onToggleMode}
        className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
      >
        {isAuto ? 'Switch to tap-to-talk' : 'Switch to auto'}
      </button>
    </div>
  )
}
