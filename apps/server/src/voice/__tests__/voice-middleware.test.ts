import { describe, expect, it, vi } from 'vitest'

// Mock the environment module to avoid actual shell calls
vi.mock('../environment.js', () => ({
  discoverEnvironment: vi
    .fn()
    .mockResolvedValue('\nAvailable CLI tools: git (version control).'),
}))

import { processVoiceInput } from '../voice-middleware.js'

describe('processVoiceInput', () => {
  const defaultInput = {
    rawText: 'show me the package.json file',
    sessionId: 'test-session',
    provider: 'anthropic' as const,
  }

  it('returns voice context with system prompt', async () => {
    const result = await processVoiceInput(defaultInput)
    expect(result.voiceContext.systemPrompt).toContain('Voice Assistant')
  })

  it('processes keywords and returns intents', async () => {
    const result = await processVoiceInput(defaultInput)
    expect(result.operationalIntents).toContain('file-view')
  })

  it('appends decorations to chatText', async () => {
    const result = await processVoiceInput(defaultInput)
    expect(result.chatText).toContain('show me the package.json file')
    expect(result.chatText).toContain('[SYSTEM:')
  })

  it('detects commands and short-circuits', async () => {
    const result = await processVoiceInput({
      ...defaultInput,
      rawText: 'something disregard',
    })
    expect(result.command).toBe('disregard')
    expect(result.operationalIntents).toHaveLength(0)
  })

  it('includes routing hint for complex tasks', async () => {
    const result = await processVoiceInput({
      ...defaultInput,
      rawText: 'refactor the auth module',
    })
    expect(result.routingHint).toBe('complex')
  })

  it('passes provider hint to voice context', async () => {
    const result = await processVoiceInput({
      ...defaultInput,
      provider: 'claude-code',
    })
    expect(result.voiceContext.systemPrompt).toContain('Claude Code')
  })

  it('does not mention Claude Code for anthropic provider', async () => {
    const result = await processVoiceInput({
      ...defaultInput,
      provider: 'anthropic',
    })
    expect(result.voiceContext.systemPrompt).not.toContain('Claude Code')
  })

  it('mentions OpenCode for opencode provider', async () => {
    const result = await processVoiceInput({
      ...defaultInput,
      provider: 'opencode',
    })
    expect(result.voiceContext.systemPrompt).toContain('OpenCode')
  })

  it('separates displayText (clean) from chatText (with decorations)', async () => {
    const result = await processVoiceInput(defaultInput)
    expect(result.displayText).toBe('show me the package.json file')
    expect(result.chatText).toContain('[SYSTEM:')
  })

  it('returns matching displayText and chatText when no decorations', async () => {
    const result = await processVoiceInput({
      ...defaultInput,
      rawText: 'tell me about the project',
    })
    expect(result.displayText).toBe('tell me about the project')
    expect(result.chatText).toBe('tell me about the project')
    expect(result.command).toBeNull()
  })
})
