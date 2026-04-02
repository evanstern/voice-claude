export type VoiceCommandType = 'disregard' | 'clear'
export type OperationalIntent = 'file-view' | 'health-check'
export type RoutingHint = 'complex'

export interface KeywordResult {
  command: VoiceCommandType | null
  operationalIntents: OperationalIntent[]
  routingHint: RoutingHint | null
  processedText: string
  decorations: string[]
}

// --- Command detection (trailing keywords) ---

interface CommandDefinition {
  type: VoiceCommandType
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

function detectCommand(text: string): {
  command: VoiceCommandType | null
  stripped: string
} {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()

  for (const def of COMMANDS) {
    for (const keyword of def.keywords) {
      if (lower === keyword) {
        return { command: def.type, stripped: '' }
      }
      const suffix = ` ${keyword}`
      if (lower.endsWith(suffix)) {
        const stripped = trimmed.slice(0, trimmed.length - suffix.length).trim()
        return { command: def.type, stripped }
      }
    }
  }

  return { command: null, stripped: trimmed }
}

// --- Operational intent detection ---

const FILE_VIEW_PATTERNS = [
  /\b(show|open|display|view|see|read|cat|print|look at)\b.*\b(file|contents?|code|package\.json|tsconfig|config|readme|makefile|dockerfile)\b/i,
  /\b(what'?s in|what does|can i see|let me see|pull up)\b.*\b(file|the)\b/i,
  /\b(show|open|display|view|see|read|cat)\b\s+\S+\.\w{1,5}\s*$/i,
]

const HEALTH_CHECK_PATTERNS = [
  /\bcan you hear me\b/i,
  /\bare you there\b/i,
  /\bare you listening\b/i,
  /\bis this (thing )?working\b/i,
]

interface IntentDefinition {
  intent: OperationalIntent
  patterns: RegExp[]
  decoration: string
}

const INTENTS: IntentDefinition[] = [
  {
    intent: 'file-view',
    patterns: FILE_VIEW_PATTERNS,
    decoration:
      '[SYSTEM: The file contents will be displayed inline in the chat UI. Just read the file and say "Here\'s [filename]." Do NOT describe, summarize, or explain the contents. One sentence max.]',
  },
  {
    intent: 'health-check',
    patterns: HEALTH_CHECK_PATTERNS,
    decoration:
      '[SYSTEM: Respond briefly confirming you can hear the user. One short sentence.]',
  },
]

function detectIntents(text: string): {
  intents: OperationalIntent[]
  decorations: string[]
} {
  const intents: OperationalIntent[] = []
  const decorations: string[] = []

  for (const def of INTENTS) {
    if (def.patterns.some((p) => p.test(text))) {
      intents.push(def.intent)
      decorations.push(def.decoration)
    }
  }

  return { intents, decorations }
}

// --- Routing hint detection ---

const COMPLEX_TASK_PHRASES = [
  'refactor',
  'implement',
  'debug the',
  'fix the bug',
  'fix the error',
  'rewrite',
  'redesign',
  'architect',
  'write a',
  'write the',
  'create a new',
  'build the',
  'deploy',
  'migrate',
  'explain the code',
  'explain how',
  'review the code',
  'code review',
  'plan',
]

function detectRoutingHint(text: string): RoutingHint | null {
  const lower = text.toLowerCase()
  if (COMPLEX_TASK_PHRASES.some((phrase) => lower.includes(phrase))) {
    return 'complex'
  }
  return null
}

// --- Main processor ---

export function processKeywords(text: string): KeywordResult {
  const { command, stripped } = detectCommand(text)

  // If a command was detected, skip intent and routing analysis
  if (command) {
    return {
      command,
      operationalIntents: [],
      routingHint: null,
      processedText: stripped,
      decorations: [],
    }
  }

  const { intents, decorations } = detectIntents(stripped)
  const routingHint = detectRoutingHint(stripped)

  return {
    command: null,
    operationalIntents: intents,
    routingHint,
    processedText: stripped,
    decorations,
  }
}
