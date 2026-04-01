const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const
type Level = keyof typeof LEVELS

function getCurrentLevel(): Level {
  if (
    typeof window !== 'undefined' &&
    (window as unknown as Record<string, unknown>).__LOG_LEVEL__
  ) {
    const level = (window as unknown as Record<string, unknown>)
      .__LOG_LEVEL__ as string
    if (level in LEVELS) return level as Level
  }
  return 'info'
}

export function createLogger(module: string) {
  const prefix = `[${module}]`
  const enabled = (level: Level) => LEVELS[level] >= LEVELS[getCurrentLevel()]

  return {
    debug: (...args: unknown[]) => {
      if (enabled('debug')) console.debug(prefix, ...args)
    },
    info: (...args: unknown[]) => {
      if (enabled('info')) console.log(prefix, ...args)
    },
    warn: (...args: unknown[]) => {
      if (enabled('warn')) console.warn(prefix, ...args)
    },
    error: (...args: unknown[]) => {
      if (enabled('error')) console.error(prefix, ...args)
    },
  }
}
