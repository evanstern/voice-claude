/**
 * Phase hint labels shown below the mic button, varying by input mode.
 */
export const PHASE_HINTS: Record<string, Record<string, string>> = {
  'push-to-talk': {
    idle: 'Tap or hold space',
    recording: 'Release to send',
    transcribing: 'Tap to cancel',
    thinking: 'Tap to cancel',
    synthesizing: 'Tap to cancel',
    speaking: 'Tap to stop',
    done: 'Tap or hold space',
  },
  auto: {
    idle: 'Listening...',
    recording: 'Speak now...',
    transcribing: 'Tap to cancel',
    thinking: 'Tap to cancel',
    synthesizing: 'Tap to cancel',
    speaking: 'Tap to stop',
    done: 'Listening...',
  },
}

/**
 * Status indicator labels and styling for each processing phase.
 * Used by the status indicator bubble shown during active processing.
 */
export const STATUS_PHASE_CONFIG: Record<
  string,
  { label: string; colorClass: string; showTimer: boolean }
> = {
  recording: {
    label: 'Listening...',
    colorClass: 'bg-red-500',
    showTimer: false,
  },
  transcribing: {
    label: 'Transcribing...',
    colorClass: 'bg-primary',
    showTimer: false,
  },
  thinking: {
    label: 'Thinking...',
    colorClass: 'bg-primary',
    showTimer: true,
  },
  synthesizing: {
    label: 'Generating speech...',
    colorClass: 'bg-primary',
    showTimer: true,
  },
  speaking: {
    label: 'Speaking...',
    colorClass: 'bg-green-500',
    showTimer: false,
  },
}
