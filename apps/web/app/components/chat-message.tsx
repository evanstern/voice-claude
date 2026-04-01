import { useState } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { MarkdownContent } from './markdown-content'

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

const extToLang: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  json: 'json',
  py: 'python',
  rs: 'rust',
  go: 'go',
  css: 'css',
  html: 'html',
  md: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'bash',
  bash: 'bash',
  sql: 'sql',
  toml: 'toml',
  xml: 'xml',
  rb: 'ruby',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
}

function inferLanguage(toolCall: ToolCall): string {
  if (toolCall.name === 'run_shell') return 'bash'
  try {
    const parsed = JSON.parse(toolCall.input)
    const path = parsed.path as string | undefined
    if (path) {
      const ext = path.split('.').pop()?.toLowerCase() ?? ''
      return extToLang[ext] ?? 'text'
    }
  } catch {
    // ignore
  }
  return 'text'
}

function ToolCallItem({ toolCall }: { toolCall: ToolCall }) {
  const isFileRead = toolCall.name === 'read_file'
  const [expanded, setExpanded] = useState(isFileRead)

  let detail = '...'
  try {
    const parsed = JSON.parse(toolCall.input)
    detail = parsed.command ?? parsed.path ?? '...'
  } catch {
    // ignore
  }

  const language = inferLanguage(toolCall)
  const hasResult = toolCall.result && toolCall.result.length > 0

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => hasResult && setExpanded(!expanded)}
        className={`inline-flex items-center gap-1.5 text-xs font-mono bg-secondary/60 rounded-md px-2 py-1 ${hasResult ? 'cursor-pointer hover:bg-secondary/80 transition-colors' : 'cursor-default'}`}
      >
        <span className="text-primary">{toolCall.name}</span>
        <span className="text-muted-foreground truncate max-w-[180px]">
          {detail}
        </span>
        {hasResult && (
          <svg
            className={`w-3 h-3 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </button>
      {expanded && hasResult && (
        <div className="mt-1.5 rounded-lg overflow-hidden border border-border/60">
          <div className={isFileRead ? '' : 'max-h-[400px] overflow-auto'}>
            <SyntaxHighlighter
              language={language}
              style={oneDark}
              customStyle={{
                margin: 0,
                fontSize: '0.75rem',
                borderRadius: 0,
              }}
              showLineNumbers
            >
              {toolCall.result}
            </SyntaxHighlighter>
          </div>
        </div>
      )}
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
          ) : isUser ? (
            <p className="whitespace-pre-wrap">{content}</p>
          ) : (
            <MarkdownContent content={content} />
          )}
        </div>

        {/* Tool calls (shown below assistant messages) */}
        {!isUser && toolCalls && toolCalls.length > 0 && (
          <div className="mt-2 flex flex-col gap-1.5">
            {toolCalls.map((tc, i) => (
              <ToolCallItem key={`${tc.name}-${i}`} toolCall={tc} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
