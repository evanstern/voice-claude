import { discoverEnvironment } from './environment.js'
import { type VoiceContext, buildVoiceContext } from './voice-context.js'
import {
  type OperationalIntent,
  type RoutingHint,
  type VoiceCommandType,
  processKeywords,
} from './voice-keywords.js'

export type { VoiceContext, OperationalIntent, RoutingHint, VoiceCommandType }

export interface VoiceInput {
  command: VoiceCommandType | null
  /** The clean user text with command keywords stripped (no decorations). Use for display and storage. */
  displayText: string
  /** The text to send to the AI provider, including any system decorations. */
  chatText: string
  voiceContext: VoiceContext
  routingHint: RoutingHint | null
  operationalIntents: OperationalIntent[]
}

interface ProcessVoiceInputParams {
  rawText: string
  sessionId: string
  provider: 'anthropic' | 'claude-code'
}

const WORK_DIR = process.env.WORK_DIR ?? process.cwd()

export async function processVoiceInput(
  params: ProcessVoiceInputParams,
): Promise<VoiceInput> {
  const { rawText, provider } = params

  // Build shared voice context (cached environment discovery)
  const environment = await discoverEnvironment()
  const voiceContext = buildVoiceContext({
    workDir: WORK_DIR,
    environment,
    providerHint: provider,
  })

  // Process keywords
  const keywords = processKeywords(rawText)

  // If command detected, return early with minimal result
  if (keywords.command) {
    return {
      command: keywords.command,
      displayText: keywords.processedText,
      chatText: keywords.processedText,
      voiceContext,
      routingHint: null,
      operationalIntents: [],
    }
  }

  // Build chatText by appending any decorations
  let chatText = keywords.processedText
  if (keywords.decorations.length > 0) {
    chatText += '\n\n' + keywords.decorations.join('\n\n')
  }

  return {
    command: null,
    displayText: keywords.processedText,
    chatText,
    voiceContext,
    routingHint: keywords.routingHint,
    operationalIntents: keywords.operationalIntents,
  }
}
