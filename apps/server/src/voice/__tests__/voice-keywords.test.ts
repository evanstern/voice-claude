import { describe, expect, it } from 'vitest'
import { processKeywords } from '../voice-keywords.js'

describe('processKeywords', () => {
  describe('commands', () => {
    it('detects trailing "disregard"', () => {
      const result = processKeywords('show me the file disregard')
      expect(result.command).toBe('disregard')
      expect(result.processedText).toBe('show me the file')
    })

    it('detects trailing "never mind"', () => {
      const result = processKeywords('read the config never mind')
      expect(result.command).toBe('disregard')
      expect(result.processedText).toBe('read the config')
    })

    it('detects trailing "cancel"', () => {
      const result = processKeywords('do something cancel')
      expect(result.command).toBe('disregard')
    })

    it('detects trailing "clear"', () => {
      const result = processKeywords('whatever clear')
      expect(result.command).toBe('clear')
    })

    it('detects trailing "reset"', () => {
      const result = processKeywords('stuff reset')
      expect(result.command).toBe('clear')
    })

    it('detects standalone command', () => {
      const result = processKeywords('disregard')
      expect(result.command).toBe('disregard')
      expect(result.processedText).toBe('')
    })

    it('returns null command for normal text', () => {
      const result = processKeywords('show me the package.json')
      expect(result.command).toBeNull()
    })
  })

  describe('operational intents', () => {
    it('detects file-view intent with "show me"', () => {
      const result = processKeywords('show me the package.json file')
      expect(result.operationalIntents).toContain('file-view')
      expect(result.decorations.length).toBeGreaterThan(0)
    })

    it('detects file-view intent with "pull up"', () => {
      const result = processKeywords('pull up the config file')
      expect(result.operationalIntents).toContain('file-view')
    })

    it('detects file-view intent with "what\'s in"', () => {
      const result = processKeywords("what's in the tsconfig file")
      expect(result.operationalIntents).toContain('file-view')
    })

    it('detects file-view intent with file extension', () => {
      const result = processKeywords('show package.json')
      expect(result.operationalIntents).toContain('file-view')
    })

    it('detects health-check intent', () => {
      const result = processKeywords('can you hear me')
      expect(result.operationalIntents).toContain('health-check')
    })

    it('detects health-check with "are you there"', () => {
      const result = processKeywords('are you there')
      expect(result.operationalIntents).toContain('health-check')
    })

    it('returns empty intents for normal text', () => {
      const result = processKeywords('list the files in the src directory')
      expect(result.operationalIntents).toHaveLength(0)
    })
  })

  describe('routing hints', () => {
    it('returns "complex" for planning tasks', () => {
      const result = processKeywords('plan a refactor of the auth module')
      expect(result.routingHint).toBe('complex')
    })

    it('returns "complex" for implementation tasks', () => {
      const result = processKeywords('implement a new login endpoint')
      expect(result.routingHint).toBe('complex')
    })

    it('returns "complex" for debugging tasks', () => {
      const result = processKeywords('debug the failing test in auth')
      expect(result.routingHint).toBe('complex')
    })

    it('returns "complex" for refactoring', () => {
      const result = processKeywords('refactor the database module')
      expect(result.routingHint).toBe('complex')
    })

    it('returns "complex" for architecture tasks', () => {
      const result = processKeywords('architect a new microservice')
      expect(result.routingHint).toBe('complex')
    })

    it('returns null for simple queries', () => {
      const result = processKeywords('what time is it')
      expect(result.routingHint).toBeNull()
    })

    it('returns null when command is detected (command takes priority)', () => {
      const result = processKeywords('refactor the code disregard')
      expect(result.command).toBe('disregard')
      expect(result.routingHint).toBeNull()
    })
  })

  describe('decorations', () => {
    it('appends file-view instruction to decorations', () => {
      const result = processKeywords('show me the package.json file')
      expect(result.decorations[0]).toContain(
        'file contents will be displayed inline',
      )
    })

    it('appends health-check instruction to decorations', () => {
      const result = processKeywords('can you hear me')
      expect(result.decorations[0]).toContain('confirming you can hear')
    })

    it('has no decorations for normal text', () => {
      const result = processKeywords('tell me about the project')
      expect(result.decorations).toHaveLength(0)
    })
  })
})
