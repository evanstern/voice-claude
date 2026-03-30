/**
 * Voice command detection module.
 *
 * Inspects transcription text for trailing keywords that trigger
 * special actions (e.g. discard the message, clear conversation).
 * Commands are case-insensitive and matched at the end of the text.
 */

export type VoiceCommandType = 'disregard' | 'clear'

export interface VoiceCommandResult {
  /** The command that was detected, or null if no command matched. */
  command: VoiceCommandType | null
  /** The transcription text with the command keyword stripped. */
  text: string
}

interface CommandDefinition {
  type: VoiceCommandType
  /** Keywords that trigger this command (matched at end of text). */
  keywords: string[]
}

const COMMANDS: CommandDefinition[] = [
  {
    type: 'disregard',
    keywords: ['disregard', 'never mind', 'nevermind', 'cancel'],
  },
  {
    type: 'clear',
    keywords: ['clear', 'reset'],
  },
]

/**
 * Check a transcription for a trailing voice command keyword.
 *
 * Returns the detected command (if any) and the transcription with
 * the keyword stripped. Matching is case-insensitive.
 *
 * Examples:
 *   parseCommand("what files are here disregard")
 *     => { command: "disregard", text: "what files are here" }
 *
 *   parseCommand("hello there")
 *     => { command: null, text: "hello there" }
 *
 *   parseCommand("disregard")
 *     => { command: "disregard", text: "" }
 */
export function parseCommand(transcription: string): VoiceCommandResult {
  const trimmed = transcription.trim()
  const lower = trimmed.toLowerCase()

  for (const def of COMMANDS) {
    for (const keyword of def.keywords) {
      // Check if the entire text is just the command keyword
      if (lower === keyword) {
        return { command: def.type, text: '' }
      }

      // Check if the text ends with the keyword preceded by a space
      const suffix = ` ${keyword}`
      if (lower.endsWith(suffix)) {
        const stripped = trimmed.slice(0, trimmed.length - suffix.length).trim()
        return { command: def.type, text: stripped }
      }
    }
  }

  return { command: null, text: trimmed }
}
