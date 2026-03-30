export async function createContext({
  req: _req,
  resHeaders: _resHeaders,
}: {
  req: Request
  resHeaders: Headers
}) {
  return {}
}

export type Context = Awaited<ReturnType<typeof createContext>>
