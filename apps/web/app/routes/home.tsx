import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@voice-claude/ui/components/card'
import { useEffect, useMemo, useRef } from 'react'
import { useOutletContext } from 'react-router'
import { useAudioSocket } from '../hooks/use-audio-socket.js'
import { useSoundEffects } from '../hooks/use-sound-effects.js'

interface RootContext {
  health: { status: string; timestamp: string } | null
  wsConfig: { path: string; port: number } | null
}

export function meta() {
  return [
    { title: 'Voice Claude' },
    {
      name: 'description',
      content: 'Hands-free voice interface for Claude Code',
    },
  ]
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

const PHASE_LABELS: Record<string, string> = {
  idle: 'Hold space to speak',
  recording: 'Release space to send',
  transcribing: 'Transcribing...',
  thinking: 'Claude is thinking...',
  synthesizing: 'Generating speech...',
  speaking: 'Speaking...',
  done: 'Hold space to speak',
}

export default function Home() {
  const { health, wsConfig } = useOutletContext<RootContext>()

  const wsUrl = useMemo(() => {
    if (typeof window === 'undefined' || !wsConfig) return null
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.hostname}:${wsConfig.port}${wsConfig.path}`
  }, [wsConfig])

  const audio = useAudioSocket(wsUrl)
  const { play } = useSoundEffects()
  const prevPhaseRef = useRef(audio.phase)
  const spaceDownRef = useRef(false)

  // Play audio cues on phase transitions
  useEffect(() => {
    const prev = prevPhaseRef.current
    const curr = audio.phase
    prevPhaseRef.current = curr

    if (prev === curr) return

    // Recording started: ascending chirp
    if (curr === 'recording') {
      play('recordingStarted')
    }

    // Recording stopped, processing started: send sound
    if (prev === 'recording' && (curr === 'transcribing' || curr === 'thinking')) {
      play('messageSent')
    }

    // Error states: play error tone
    if (curr === 'done' && (audio.transcriptionError || audio.claudeError)) {
      play('error')
    }
  }, [audio.phase, audio.transcriptionError, audio.claudeError, play])

  // Handle push-to-talk with spacebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only respond to space when not in an input field
      if (e.code !== 'Space' || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      // Prevent default scroll behavior
      e.preventDefault()

      // Prevent key repeat from triggering multiple starts
      if (spaceDownRef.current) return
      spaceDownRef.current = true

      // Only start if we're idle or done and connected
      if ((audio.phase === 'idle' || audio.phase === 'done') && audio.connected && !audio.busy) {
        audio.startRecording()
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      
      // Prevent default scroll behavior
      e.preventDefault()
      
      if (!spaceDownRef.current) return
      spaceDownRef.current = false

      // Only stop if we're actually recording
      if (audio.phase === 'recording') {
        audio.stopRecording()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [audio])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      {/* Voice command toast */}
      {audio.commandNotice && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in-up">
          <div className="rounded-lg border border-border bg-card px-4 py-2 shadow-lg text-sm text-muted-foreground">
            {audio.commandNotice}
          </div>
        </div>
      )}

      <div className="max-w-lg w-full space-y-8 animate-fade-in-up">
        <div className="text-center space-y-3">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            Voice Claude
          </h1>
          <p className="text-lg text-muted-foreground">
            Hands-free voice interface for Claude Code
          </p>
        </div>

        {/* Mic button */}
        <div className="flex flex-col items-center gap-4">
          <button
            type="button"
            onClick={
              audio.phase === 'recording'
                ? audio.stopRecording
                : audio.startRecording
            }
            disabled={!audio.connected || audio.busy}
            className={`relative inline-flex items-center justify-center w-24 h-24 rounded-full transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:cursor-not-allowed ${
              audio.phase === 'recording'
                ? 'bg-red-500/20 border-2 border-red-500 text-red-400 hover:bg-red-500/30'
                : audio.busy
                  ? 'bg-primary/5 border-2 border-primary/20 text-primary/50'
                  : 'bg-primary/10 border-2 border-primary/40 text-primary hover:bg-primary/20 hover:border-primary/60'
            }`}
          >
            {audio.phase === 'recording' && (
              <span className="absolute inset-0 rounded-full animate-pulse-ring bg-red-500/20" />
            )}
            {audio.busy && (
              <span className="absolute inset-0 rounded-full animate-pulse bg-primary/10" />
            )}
            {audio.phase === 'recording' ? (
              <StopIcon className="w-10 h-10 relative z-10" />
            ) : (
              <MicIcon className="w-10 h-10 relative z-10" />
            )}
          </button>
          <span className="text-sm text-muted-foreground">
            {!audio.connected
              ? 'Connecting...'
              : PHASE_LABELS[audio.phase] ?? 'Hold space to speak'}
          </span>
        </div>

        <div className="space-y-4">
          {/* Connection status */}
          <Card>
            <CardHeader>
              <CardTitle>Connection</CardTitle>
              <CardDescription>Backend API & WebSocket</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center gap-3">
                <div
                  className={`w-2.5 h-2.5 rounded-full ${
                    health?.status === 'ok'
                      ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]'
                      : 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]'
                  }`}
                />
                <span className="text-sm text-foreground">
                  API {health?.status === 'ok' ? 'connected' : 'disconnected'}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className={`w-2.5 h-2.5 rounded-full ${
                    audio.connected
                      ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]'
                      : 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]'
                  }`}
                />
                <span className="text-sm text-foreground">
                  WebSocket{' '}
                  {audio.connected ? 'connected' : 'disconnected'}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Transcription */}
          {audio.transcription !== null && (
            <Card>
              <CardHeader>
                <CardTitle>You said</CardTitle>
              </CardHeader>
              <CardContent>
                {audio.transcriptionError ? (
                  <p className="text-sm text-destructive">
                    {audio.transcriptionError}
                  </p>
                ) : audio.transcription ? (
                  <p className="text-sm text-foreground leading-relaxed italic">
                    &ldquo;{audio.transcription}&rdquo;
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    No speech detected
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Processing indicator */}
          {(audio.phase === 'transcribing' ||
            audio.phase === 'thinking' ||
            audio.phase === 'synthesizing' ||
            audio.phase === 'speaking') && (
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      audio.phase === 'speaking'
                        ? 'bg-green-500 animate-pulse'
                        : 'bg-primary animate-pulse'
                    }`}
                  />
                  <span className="text-sm text-muted-foreground">
                    {audio.phase === 'transcribing'
                      ? 'Transcribing audio...'
                      : audio.phase === 'synthesizing'
                        ? 'Generating speech...'
                        : audio.phase === 'speaking'
                          ? 'Speaking...'
                          : audio.activeTools.length > 0
                            ? `Running ${audio.activeTools[audio.activeTools.length - 1]}...`
                            : 'Claude is thinking...'}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tool calls */}
          {audio.toolCalls.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Tools used</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {audio.toolCalls.map((tc, i) => (
                  <div
                    key={`${tc.name}-${i}`}
                    className="text-xs font-mono bg-secondary/50 rounded px-3 py-2"
                  >
                    <span className="text-primary">{tc.name}</span>
                    <span className="text-muted-foreground">
                      ({JSON.parse(tc.input).command ?? JSON.parse(tc.input).path ?? '...'})
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Claude response */}
          {audio.claudeResponse !== null && audio.phase === 'done' && (
            <Card>
              <CardHeader>
                <CardTitle>Claude</CardTitle>
              </CardHeader>
              <CardContent>
                {audio.claudeError ? (
                  <p className="text-sm text-destructive">
                    {audio.claudeError}
                  </p>
                ) : (
                  <p className="text-sm text-foreground leading-relaxed">
                    {audio.claudeResponse}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
