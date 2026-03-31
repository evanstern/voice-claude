import type { ConversationSummary } from '@voice-claude/contracts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router'
import { ChatMessage } from '../components/chat-message.js'
import { ConnectionHeader } from '../components/connection-header.js'
import { ConversationList } from '../components/conversation-list.js'
import { MicButton } from '../components/mic-button.js'
import { StatusIndicator } from '../components/status-indicator.js'
import { useAudioSocket } from '../hooks/use-audio-socket.js'
import { useSoundEffects } from '../hooks/use-sound-effects.js'
import { useVAD } from '../hooks/use-vad.js'
import { getClientTRPC } from '../trpc/client.js'

interface RootContext {
  health: { status: string; timestamp: string } | null
  wsConfig: { path: string; port: number } | null
}

interface ConversationEntry {
  id: number
  userText: string
  userError?: string | null
  assistantText?: string | null
  assistantError?: string | null
  toolCalls?: Array<{ name: string; input: string; result: string }>
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

export default function Home() {
  const { health, wsConfig } = useOutletContext<RootContext>()

  const wsUrl = useMemo(() => {
    if (typeof window === 'undefined' || !wsConfig) return null
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.hostname}:${wsConfig.port}${wsConfig.path}`
  }, [wsConfig])

  const trpc = useMemo(() => {
    if (typeof window === 'undefined' || !wsConfig) return null
    return getClientTRPC(wsConfig.port)
  }, [wsConfig])

  const audio = useAudioSocket(wsUrl)
  const { play } = useSoundEffects()
  const phaseRef = useRef(audio.phase)
  const spaceDownRef = useRef(false)

  // Mode: push-to-talk (default) or auto (always-listening with VAD)
  const [mode, setMode] = useState<'push-to-talk' | 'auto'>('push-to-talk')
  const toggleMode = useCallback(() => {
    setMode((m) => (m === 'push-to-talk' ? 'auto' : 'push-to-talk'))
  }, [])

  // VAD for auto mode
  const vad = useVAD(mode === 'auto' ? audio.micStream : null, {
    silenceThreshold: 0.01,
    silenceTimeout: 1500,
  })

  // In auto mode, start recording when connected and idle
  useEffect(() => {
    if (
      mode === 'auto' &&
      audio.connected &&
      (audio.phase === 'idle' || audio.phase === 'done') &&
      !audio.busy
    ) {
      audio.startRecording()
    }
  }, [mode, audio.connected, audio.phase, audio.busy, audio.startRecording])

  // In auto mode, stop recording when VAD detects silence after speech
  useEffect(() => {
    if (mode !== 'auto') return
    vad.setOnSpeechEnd(() => {
      if (audio.phase === 'recording') {
        console.log('[auto] VAD detected speech end, sending...')
        audio.stopRecording()
      }
    })
    return () => vad.setOnSpeechEnd(null)
  }, [mode, vad, audio])
  const scrollRef = useRef<HTMLDivElement>(null)
  const nextIdRef = useRef(1)

  // Conversation history (in-memory for current session)
  const [conversation, setConversation] = useState<ConversationEntry[]>([])
  const [pendingEntry, setPendingEntry] = useState<ConversationEntry | null>(
    null,
  )

  // Conversation management
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null)
  const isFirstMessageRef = useRef(true)

  // Fetch conversation list
  const refreshConversations = useCallback(async () => {
    if (!trpc) return
    try {
      const list = await trpc.conversations.list.query()
      setConversations(list)
    } catch (err) {
      console.error('[home] failed to fetch conversations:', err)
    }
  }, [trpc])

  // Fetch on mount
  useEffect(() => {
    refreshConversations()
  }, [refreshConversations])

  // Create a new conversation and tell the server about it
  const createNewConversation = useCallback(async () => {
    if (!trpc) return
    try {
      const conv = await trpc.conversations.create.mutate()
      setActiveConversationId(conv.id)
      isFirstMessageRef.current = true
      setConversation([])
      setPendingEntry(null)
      nextIdRef.current = 1
      audio.sendConversation(conv.id, true)
      refreshConversations()
      setDrawerOpen(false)
    } catch (err) {
      console.error('[home] failed to create conversation:', err)
    }
  }, [trpc, audio, refreshConversations])

  // Select existing conversation and load its messages
  const selectConversation = useCallback(
    async (id: string) => {
      if (!trpc) return
      try {
        const data = await trpc.conversations.get.query({ id })
        if (!data) return
        setActiveConversationId(id)
        isFirstMessageRef.current = data.messages.length === 0

        // Convert persisted messages to ConversationEntry pairs
        const entries: ConversationEntry[] = []
        let entryId = 1
        const msgs = data.messages
        for (let i = 0; i < msgs.length; i++) {
          const msg = msgs[i]
          if (!msg) continue
          if (msg.role === 'user') {
            const next = msgs[i + 1]
            const entry: ConversationEntry = {
              id: entryId++,
              userText: msg.content,
              userError: msg.error ?? null,
            }
            if (next?.role === 'assistant') {
              entry.assistantText = next.content
              entry.assistantError = next.error ?? null
              entry.toolCalls = next.toolCalls
              i++ // skip assistant message
            }
            entries.push(entry)
          }
        }
        setConversation(entries)
        setPendingEntry(null)
        nextIdRef.current = entryId
        audio.sendConversation(id, isFirstMessageRef.current)
        setDrawerOpen(false)
      } catch (err) {
        console.error('[home] failed to load conversation:', err)
      }
    },
    [trpc, audio],
  )

  // Delete conversation
  const deleteConversation = useCallback(
    async (id: string) => {
      if (!trpc) return
      try {
        await trpc.conversations.delete.mutate({ id })
        if (activeConversationId === id) {
          setActiveConversationId(null)
          setConversation([])
          setPendingEntry(null)
          nextIdRef.current = 1
          audio.sendConversation(null, true)
        }
        refreshConversations()
      } catch (err) {
        console.error('[home] failed to delete conversation:', err)
      }
    },
    [trpc, activeConversationId, audio, refreshConversations],
  )

  // Auto-create conversation on first recording if none active
  const handleStartRecording = useCallback(async () => {
    if (!activeConversationId && trpc) {
      try {
        const conv = await trpc.conversations.create.mutate()
        setActiveConversationId(conv.id)
        isFirstMessageRef.current = true
        audio.sendConversation(conv.id, true)
        refreshConversations()
      } catch (err) {
        console.error('[home] failed to auto-create conversation:', err)
      }
    }
    audio.startRecording()
  }, [activeConversationId, trpc, audio, refreshConversations])

  // When transcription arrives, start a new pending entry
  const prevTranscriptionRef = useRef<string | null>(null)
  useEffect(() => {
    if (
      audio.transcription &&
      audio.transcription !== prevTranscriptionRef.current
    ) {
      prevTranscriptionRef.current = audio.transcription
      const entry: ConversationEntry = {
        id: nextIdRef.current++,
        userText: audio.transcription,
        userError: audio.transcriptionError,
      }
      setPendingEntry(entry)
    } else if (
      audio.transcription === null &&
      audio.transcriptionError &&
      audio.transcriptionError !== prevTranscriptionRef.current
    ) {
      prevTranscriptionRef.current = audio.transcriptionError
      const entry: ConversationEntry = {
        id: nextIdRef.current++,
        userText: '',
        userError: audio.transcriptionError,
      }
      setPendingEntry(entry)
    }
  }, [audio.transcription, audio.transcriptionError])

  // When Claude responds and phase goes to done, finalize the entry
  useEffect(() => {
    if (audio.phase === 'done' && phaseRef.current !== 'done') {
      if (pendingEntry) {
        const finalized: ConversationEntry = {
          ...pendingEntry,
          assistantText: audio.claudeResponse,
          assistantError: audio.claudeError,
          toolCalls:
            audio.toolCalls.length > 0 ? [...audio.toolCalls] : undefined,
        }
        setConversation((prev) => [...prev, finalized])
        setPendingEntry(null)
        isFirstMessageRef.current = false
        // Refresh list to pick up auto-title and updated timestamps
        refreshConversations()
      }
    }
    phaseRef.current = audio.phase
  }, [
    audio.phase,
    audio.claudeResponse,
    audio.claudeError,
    audio.toolCalls,
    pendingEntry,
    refreshConversations,
  ])

  // Auto-scroll to bottom
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [conversation, pendingEntry, audio.phase, scrollToBottom])

  // Play audio cues on phase transitions
  const prevPhaseForSoundRef = useRef(audio.phase)
  useEffect(() => {
    const prev = prevPhaseForSoundRef.current
    const curr = audio.phase
    prevPhaseForSoundRef.current = curr

    if (prev === curr) return

    if (curr === 'recording') {
      play('recordingStarted')
    }

    if (
      prev === 'recording' &&
      (curr === 'transcribing' || curr === 'thinking')
    ) {
      play('messageSent')
    }

    if (curr === 'done' && (audio.transcriptionError || audio.claudeError)) {
      play('error')
    }
  }, [audio.phase, audio.transcriptionError, audio.claudeError, play])

  // Push-to-talk with spacebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.code !== 'Space' ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return
      }
      e.preventDefault()
      if (spaceDownRef.current) return
      spaceDownRef.current = true

      if (
        (audio.phase === 'idle' || audio.phase === 'done') &&
        audio.connected &&
        !audio.busy
      ) {
        handleStartRecording()
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      e.preventDefault()
      if (!spaceDownRef.current) return
      spaceDownRef.current = false

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
  }, [audio, handleStartRecording])

  const showStatus =
    audio.phase === 'recording' ||
    audio.phase === 'transcribing' ||
    audio.phase === 'thinking' ||
    audio.phase === 'synthesizing' ||
    audio.phase === 'speaking'

  const isEmpty = conversation.length === 0 && !pendingEntry && !showStatus

  return (
    <div className="flex flex-col h-dvh max-w-2xl mx-auto">
      {/* Conversation drawer */}
      <ConversationList
        open={drawerOpen}
        conversations={conversations}
        activeId={activeConversationId}
        onSelect={selectConversation}
        onNew={createNewConversation}
        onDelete={deleteConversation}
        onClose={() => setDrawerOpen(false)}
      />

      {/* Voice command toast */}
      {audio.commandNotice && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 animate-fade-in-up">
          <div className="rounded-lg border border-border bg-card px-4 py-2 shadow-lg text-sm text-muted-foreground">
            {audio.commandNotice}
          </div>
        </div>
      )}

      {/* Header */}
      <ConnectionHeader
        apiConnected={health?.status === 'ok'}
        wsConnected={audio.connected}
        onMenuToggle={() => setDrawerOpen((o) => !o)}
      />

      {/* Scrollable chat area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overscroll-contain px-4 py-4"
      >
        <div className="flex flex-col gap-4">
          {isEmpty && (
            <div className="flex flex-col items-center justify-center h-full min-h-[50vh] text-center gap-3 animate-fade-in-up">
              <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-primary/60"
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
              </div>
              <p className="text-sm text-muted-foreground">
                Tap the mic or hold space to start talking
              </p>
            </div>
          )}

          {conversation.map((entry) => (
            <div key={entry.id} className="flex flex-col gap-3">
              {(entry.userText || entry.userError) && (
                <ChatMessage
                  role="user"
                  content={entry.userText || 'No speech detected'}
                  error={entry.userError}
                />
              )}
              {(entry.assistantText || entry.assistantError) && (
                <ChatMessage
                  role="assistant"
                  content={entry.assistantText ?? ''}
                  error={entry.assistantError}
                  toolCalls={entry.toolCalls}
                />
              )}
            </div>
          ))}

          {pendingEntry && (
            <div className="flex flex-col gap-3">
              <ChatMessage
                role="user"
                content={pendingEntry.userText || 'No speech detected'}
                error={pendingEntry.userError}
              />
            </div>
          )}

          {showStatus && (
            <StatusIndicator
              phase={audio.phase}
              activeTools={audio.activeTools}
            />
          )}
        </div>
      </div>

      <MicButton
        phase={audio.phase}
        connected={audio.connected}
        busy={audio.busy}
        mode={mode}
        onStart={handleStartRecording}
        onStop={audio.stopRecording}
        onToggleMode={toggleMode}
      />
    </div>
  )
}
