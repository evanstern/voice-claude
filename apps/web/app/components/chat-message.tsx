interface ToolCall {
  name: string
  input: string
  result: string
}

interface ChatMessageProps {
  sender: 'user' | 'assistant'
  content: string
  error?: string | null
  toolCalls?: ToolCall[]
  timestamp?: number
}

function ToolCallBadge({ toolCall }: { toolCall: ToolCall }) {
  let detail = '...'
  try {
    const parsed = JSON.parse(toolCall.input)
    detail = parsed.command ?? parsed.path ?? '...'
  } catch {
    // ignore
  }

  return (
    <div className="inline-flex items-center gap-1.5 text-xs font-mono bg-secondary/60 rounded-md px-2 py-1">
      <span className="text-primary">{toolCall.name}</span>
      <span className="text-muted-foreground truncate max-w-[180px]">
        {detail}
      </span>
    </div>
  )
}

export function ChatMessage({
  sender,
  content,
  error,
  toolCalls,
}: ChatMessageProps) {
  const isUser = sender === 'user'

  return (
    <div
      className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in-up`}
    >
      <div
        className={`max-w-[85%] md:max-w-[75%] ${isUser ? 'order-1' : 'order-1'}`}
      >
        {/* Role label */}
        <p
          className={`text-xs font-medium mb-1 ${
            isUser
              ? 'text-right text-muted-foreground'
              : 'text-left text-primary/80'
          }`}
        >
          {isUser ? 'You' : 'Claude'}
        </p>

        {/* Message bubble */}
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? 'bg-primary/15 text-foreground rounded-br-md'
              : 'bg-card border border-border text-foreground rounded-bl-md'
          }`}
        >
          {error ? (
            <p className="text-destructive">{error}</p>
          ) : (
            <p className="whitespace-pre-wrap">{content}</p>
          )}
        </div>

        {/* Tool calls (shown below assistant messages) */}
        {!isUser && toolCalls && toolCalls.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {toolCalls.map((tc, i) => (
              <ToolCallBadge key={`${tc.name}-${i}`} toolCall={tc} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
