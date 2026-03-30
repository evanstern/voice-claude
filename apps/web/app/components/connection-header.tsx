interface ConnectionHeaderProps {
  apiConnected: boolean
  wsConnected: boolean
}

export function ConnectionHeader({
  apiConnected,
  wsConnected,
}: ConnectionHeaderProps) {
  const allGood = apiConnected && wsConnected

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 bg-background/80 backdrop-blur-md border-b border-border">
      <h1 className="text-lg font-semibold tracking-tight text-foreground">
        Voice Claude
      </h1>
      <div className="flex items-center gap-2">
        <div
          className={`w-2 h-2 rounded-full transition-colors ${
            allGood
              ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]'
              : 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]'
          }`}
        />
        <span className="text-xs text-muted-foreground">
          {allGood ? 'Connected' : !wsConnected ? 'WS offline' : 'API offline'}
        </span>
      </div>
    </header>
  )
}
