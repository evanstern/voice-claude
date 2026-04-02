import { describe, expect, it } from 'vitest'
import { buildVoiceContext } from '../voice-context.js'

describe('buildVoiceContext', () => {
  const defaultOptions = {
    workDir: '/workspace',
    environment: '\nAvailable CLI tools: git (version control), node (Node.js runtime).',
  }

  it('includes Voice Claude identity', () => {
    const ctx = buildVoiceContext(defaultOptions)
    expect(ctx.systemPrompt).toContain('Voice Claude')
    expect(ctx.systemPrompt).toContain('hands-free voice coding assistant')
  })

  it('includes environment capabilities', () => {
    const ctx = buildVoiceContext(defaultOptions)
    expect(ctx.systemPrompt).toContain('git (version control)')
    expect(ctx.systemPrompt).toContain('node (Node.js runtime)')
  })

  it('includes working directory', () => {
    const ctx = buildVoiceContext(defaultOptions)
    expect(ctx.systemPrompt).toContain('/workspace')
  })

  it('includes voice rules', () => {
    const ctx = buildVoiceContext(defaultOptions)
    expect(ctx.voiceRules).toContain('100 words max')
    expect(ctx.systemPrompt).toContain('100 words max')
  })

  it('mentions Claude Code capabilities when provider hint is claude-code', () => {
    const ctx = buildVoiceContext({ ...defaultOptions, providerHint: 'claude-code' })
    expect(ctx.systemPrompt).toContain('Claude Code')
  })

  it('does not mention Claude Code when provider hint is anthropic', () => {
    const ctx = buildVoiceContext({ ...defaultOptions, providerHint: 'anthropic' })
    expect(ctx.systemPrompt).not.toContain('Claude Code')
  })

  it('handles empty environment string', () => {
    const ctx = buildVoiceContext({ ...defaultOptions, environment: '' })
    expect(ctx.systemPrompt).toContain('Voice Claude')
    expect(ctx.systemPrompt).not.toContain('Available CLI tools')
  })
})
