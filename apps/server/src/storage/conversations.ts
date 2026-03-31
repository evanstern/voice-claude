import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { ConversationSummary, Message } from '@voice-claude/contracts'

const DATA_DIR = join(process.cwd(), 'data', 'conversations')
const INDEX_FILE = join(DATA_DIR, 'index.jsonl')

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
  }
  if (!existsSync(INDEX_FILE)) {
    writeFileSync(INDEX_FILE, '')
  }
}

function convFile(id: string): string {
  return join(DATA_DIR, `conv_${id}.jsonl`)
}

function readJsonlLines<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return []
  const content = readFileSync(filePath, 'utf-8').trim()
  if (!content) return []
  return content.split('\n').map((line) => JSON.parse(line) as T)
}

function appendJsonl(filePath: string, obj: unknown) {
  appendFileSync(filePath, `${JSON.stringify(obj)}\n`)
}

function rewriteIndex(entries: ConversationSummary[]) {
  writeFileSync(
    INDEX_FILE,
    entries.map((e) => JSON.stringify(e)).join('\n') +
      (entries.length ? '\n' : ''),
  )
}

// ── Public API ──────────────────────────────────────────────────

export function listConversations(): ConversationSummary[] {
  ensureDataDir()
  return readJsonlLines<ConversationSummary>(INDEX_FILE).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )
}

export function createConversation(title?: string): ConversationSummary {
  ensureDataDir()
  const now = new Date().toISOString()
  const summary: ConversationSummary = {
    id: randomUUID(),
    title: title ?? 'New conversation',
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  }
  appendJsonl(INDEX_FILE, summary)
  writeFileSync(convFile(summary.id), '')
  return summary
}

export function getConversation(
  id: string,
): { summary: ConversationSummary; messages: Message[] } | null {
  ensureDataDir()
  const entries = readJsonlLines<ConversationSummary>(INDEX_FILE)
  const summary = entries.find((e) => e.id === id)
  if (!summary) return null
  const messages = readJsonlLines<Message>(convFile(id))
  return { summary, messages }
}

export function appendMessage(
  conversationId: string,
  message: Omit<Message, 'id' | 'timestamp'>,
): Message {
  ensureDataDir()
  const full: Message = {
    ...message,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
  }
  appendJsonl(convFile(conversationId), full)

  // Update index entry
  const entries = readJsonlLines<ConversationSummary>(INDEX_FILE)
  const idx = entries.findIndex((e) => e.id === conversationId)
  const entry = entries[idx]
  if (entry) {
    entry.messageCount++
    entry.updatedAt = full.timestamp
    rewriteIndex(entries)
  }

  return full
}

export function deleteConversation(id: string): boolean {
  ensureDataDir()
  const entries = readJsonlLines<ConversationSummary>(INDEX_FILE)
  const filtered = entries.filter((e) => e.id !== id)
  if (filtered.length === entries.length) return false
  rewriteIndex(filtered)
  const file = convFile(id)
  if (existsSync(file)) unlinkSync(file)
  return true
}

export function updateConversationTitle(id: string, title: string): boolean {
  ensureDataDir()
  const entries = readJsonlLines<ConversationSummary>(INDEX_FILE)
  const idx = entries.findIndex((e) => e.id === id)
  const entry = entries[idx]
  if (!entry) return false
  entry.title = title
  entry.updatedAt = new Date().toISOString()
  rewriteIndex(entries)
  return true
}

export function autoTitle(conversationId: string, firstUserMessage: string) {
  const title =
    firstUserMessage.slice(0, 60) + (firstUserMessage.length > 60 ? '…' : '')
  updateConversationTitle(conversationId, title)
}
