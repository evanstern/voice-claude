interface ConnectionHeaderProps {
  apiConnected: boolean
  wsConnected: boolean
  onMenuToggle?: () => void
}

export function ConnectionHeader({
  apiConnected,
  wsConnected,
  onMenuToggle,
}: ConnectionHeaderProps) {
  const allGood = apiConnected && wsConnected

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 bg-background/80 backdrop-blur-md border-b border-border">
      <div className="flex items-center gap-2">
        {onMenuToggle && (
          <button
            type="button"
            onClick={onMenuToggle}
            className="text-muted-foreground hover:text-foreground p-1 -ml-1"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <title>Menu</title>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
              />
            </svg>
          </button>
        )}
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          Voice Claude
        </h1>
      </div>
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
